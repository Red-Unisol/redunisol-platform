"""Reconcile existing WhatsApp conversations with the sales pipeline."""
from __future__ import annotations

import time
from collections import Counter

from .deal_commercial_decision import CONTACTABLE_DECISIONS, DECISION_FIELD, DECISION_FIELD_REST
from .deal_service import active_open_line_session_id

CATEGORY_ID = 1
SOURCE_STAGES = ("C1:NEW", "C1:KESTRA_REVIEW")
RESPONSE_STAGE = "C1:UC_ZH5DGU"
SALES_LINE_ID = "1"
WHATSAPP_CONNECTOR = "whatsappbyedna"
SELECT = ["id", "categoryId", "stageId", "stageSemanticId", "leadId", "contactId", "assignedById", "updatedTime", DECISION_FIELD]


class PacedReadClient:
    """Limit API pressure; retry transient reads, never blindly repeat writes."""
    def __init__(self, client, interval=0.55, sleep=time.sleep, clock=time.monotonic):
        self.client, self.interval, self.sleep, self.clock = client, interval, sleep, clock
        self.last_call = -float("inf")

    def call_full(self, method, payload):
        read = method.endswith((".get", ".list"))
        for attempt in range(3):
            self.sleep(max(0, self.interval - (self.clock() - self.last_call)))
            self.last_call = self.clock()
            try:
                return self.client.call_full(method, payload)
            except (RuntimeError, TimeoutError) as exc:
                transient = isinstance(exc, TimeoutError) or any(token in str(exc).lower() for token in (
                    "http 429", "http 500", "http 502", "http 503", "http 504",
                    "error de red", "too many requests", "query_limit_exceeded",
                ))
                if not read or not transient or attempt == 2:
                    raise
                self.sleep(2 ** attempt)

    def call(self, method, payload):
        return self.call_full(method, payload).get("result")


def _get_deal(client, deal_id):
    result = client.call("crm.item.get", {"entityTypeId": 2, "id": deal_id, "useOriginalUfNames": "Y"})
    if not isinstance(result, dict) or not isinstance(result.get("item"), dict):
        raise ValueError("Invalid deal response")
    return _normalize_decision(result["item"])


def _normalize_decision(deal):
    if DECISION_FIELD_REST in deal:
        deal[DECISION_FIELD] = deal.pop(DECISION_FIELD_REST)
    return deal


def _eligible(deal):
    return (
        str(deal.get("categoryId")) == str(CATEGORY_ID)
        and deal.get("stageId") in SOURCE_STAGES
        and deal.get("stageSemanticId") == "P"
        and deal.get(DECISION_FIELD) in CONTACTABLE_DECISIONS
    )


def _active_sales_session(client, deal):
    seen = set()
    for kind, entity_id in (("deal", deal["id"]), ("lead", deal.get("leadId")), ("contact", deal.get("contactId"))):
        if not entity_id:
            continue
        chats = client.call("imopenlines.crm.chat.get", {
            "CRM_ENTITY_TYPE": kind, "CRM_ENTITY": entity_id, "ACTIVE_ONLY": "Y",
        })
        if not isinstance(chats, list):
            raise ValueError("Invalid chat list")
        for chat in chats:
            chat_id = int(chat["CHAT_ID"])
            if chat_id in seen:
                continue
            seen.add(chat_id)
            dialog = client.call("imopenlines.dialog.get", {"CHAT_ID": chat_id})
            entity = str(dialog.get("entity_id") or dialog.get("ENTITY_ID") or "").split("|")
            if len(entity) < 2 or entity[:2] != [WHATSAPP_CONNECTOR, SALES_LINE_ID]:
                continue
            session_id = active_open_line_session_id(dialog)
            if session_id:
                return {"chat_id": chat_id, "session_id": session_id}
    return None


def reconcile_deal(client, deal):
    event = {"deal_id": int(deal["id"]), "stage_before": deal.get("stageId")}
    if not _eligible(deal):
        return {**event, "status": "ineligible", "decision": deal.get(DECISION_FIELD) or "unknown"}
    session = _active_sales_session(client, deal)
    if session is None:
        return {**event, "status": "no_active_sales_session"}
    # Last read is immediately before the only write. Respect intervening edits.
    current = _get_deal(client, deal["id"])
    if not _eligible(current) or any(current.get(k) != deal.get(k) for k in SELECT if k != "id"):
        return {**event, **session, "status": "changed_during_scan"}
    try:
        client.call("crm.item.update", {"entityTypeId": 2, "id": deal["id"], "fields": {"stageId": RESPONSE_STAGE}})
    except Exception:
        # An ambiguous write may have succeeded. Do not submit it a second time.
        actual = _get_deal(client, deal["id"])
        if actual.get("stageId") == RESPONSE_STAGE:
            return {**event, **session, "status": "moved", "write_ack": "recovered_by_read"}
        raise
    actual = _get_deal(client, deal["id"])
    if actual.get("stageId") in SOURCE_STAGES:
        raise RuntimeError("Stage update did not persist")
    return {**event, **session, "status": "moved", "stage_after": actual.get("stageId")}


def reconcile_sales_chats(client, *, clock=time.monotonic, max_seconds=600):
    started = clock()
    cursor = 0
    events = []
    # Keyset pagination: moving records out of the source stages cannot skip rows.
    while True:
        if clock() - started > max_seconds:
            raise TimeoutError("Chat reconciliation exceeded its time budget")
        response = client.call("crm.item.list", {
            "entityTypeId": 2,
            "useOriginalUfNames": "Y",
            "filter": {"=categoryId": CATEGORY_ID, "@stageId": list(SOURCE_STAGES), ">id": cursor},
            # This portal drops standard fields from explicit projections when
            # original UF names are enabled. Wildcard preserves both namespaces.
            "select": ["*"],
            "order": {"id": "ASC"},
        })
        items = response.get("items") if isinstance(response, dict) else None
        if not isinstance(items, list):
            raise ValueError("Invalid candidate list")
        if not items:
            break
        for deal in items:
            deal = _normalize_decision(deal)
            if clock() - started > max_seconds:
                raise TimeoutError("Chat reconciliation exceeded its time budget")
            if int(deal["id"]) <= cursor:
                raise ValueError("Candidate pagination did not advance")
            cursor = int(deal["id"])
            try:
                events.append(reconcile_deal(client, deal))
            except Exception as exc:
                # Do not include customer data, API response bodies or webhook URLs.
                events.append({"deal_id": cursor, "status": "error", "error_type": type(exc).__name__})
    counts = dict(Counter(event["status"] for event in events))
    return {"ok": not counts.get("error"), "checked": len(events), "counts": counts, "events": events}
