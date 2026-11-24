"""Register an exact-session transfer in Laravel before committing the CRM assignment."""
from __future__ import annotations

from dataclasses import dataclass
from http.client import HTTPException
from urllib.error import HTTPError
from urllib.request import Request
import json
import re

from .deal_service import ChatTransferResult, active_open_line_session_id
from .internal_web import internal_web_origin, open_without_redirects


STATES = {
    "pending": "delivery_queued", "waiting": "delivery_waiting",
    "reconciling": "delivery_uncertain", "needs_attention": "delivery_uncertain",
    "confirmed": "delivery_previously_confirmed", "observed": "delivery_observed",
    "preserved": "delivery_preserved", "expired": "delivery_expired",
}


def _positive(value):
    return type(value) is int and value > 0


def _same(left, right):
    # bool and float compare equal to integers in Python.
    return type(left) is type(right) and left == right


def register(origin, token, payload):
    """Only a matching durable receipt authorizes releasing the CRM selector."""
    request = Request(origin + "/api/internal/sales-chat/transfer-requests",
        data=json.dumps(payload).encode(), method="POST",
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json",
                 "Accept": "application/json", "User-Agent": "redunisol-chat-routing/1"})
    try:
        try:
            response = open_without_redirects(request, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            status = response.status
            if status not in (200, 202, 409, 422):
                return None
            body = response.read(4097)
            if len(body) > 4096:
                return None
            receipt = json.loads(body)
        if status == 422:
            if isinstance(receipt, dict) and receipt.get("ok") is False and receipt.get("error") in (
                    "case_binding_mismatch", "session_closed_or_replaced"):
                return receipt["error"]
            return None
        if (not isinstance(receipt, dict) or receipt.get("ok") is not (status != 409)
                or not _positive(receipt.get("request_id")) or not _positive(receipt.get("target_id"))
                or receipt.get("status") not in STATES
                or any(key not in receipt or not _same(receipt[key], value)
                       for key, value in payload.items() if key != "target_id")
                or ((receipt["target_id"] == payload["target_id"]) != (status != 409))):
            return None
        return receipt
    except (OSError, HTTPException, ValueError, TypeError, EOFError):
        return None


def _current_case_binding(client, chat_id, session_id, deal):
    """Check the current native case, even if chat.get lists several historical deals."""
    try:
        dialog = client.call("imopenlines.dialog.get", {"CHAT_ID": chat_id})
        if (not isinstance(dialog, dict) or str(dialog.get("id")) != str(chat_id)
                or dialog.get("entity_type") != "LINES"
                or str(dialog.get("entity_id")).split("|")[:2] != ["whatsappbyedna", "1"]
                or active_open_line_session_id(dialog) != session_id):
            return None
        primary = str(dialog["entity_data_1"]).split("|")[1:3]
        raw = dialog.get("entity_data_2") or ""
        pairs = raw.split("|") if raw else []
        if len(primary) != 2 or len(pairs) % 2 or len(pairs) > 8:
            return None
        bindings = {}
        for entity, value in zip(pairs[::2], pairs[1::2]):
            if entity.lower() in bindings:
                return None
            bindings[entity.lower()] = value
        key, value = primary[0].lower(), primary[1]
        if value not in ("", "0"):
            if key in bindings and bindings[key] not in ("", "0", value):
                return False
            bindings[key] = value
        for key, value in bindings.items():
            if key not in ("lead", "deal", "contact", "company") or (
                    value not in ("", "0") and not re.fullmatch(r"[1-9][0-9]{0,17}", value)):
                return None
        expected = {"lead": str(deal["leadId"]), "deal": str(deal["id"]), "contact": str(deal.get("contactId") or "")}
        if any(bindings.get(key) not in (None, "", "0", value) for key, value in expected.items()):
            return False
        return any(bindings.get(key) == expected[key] for key in ("lead", "deal"))
    except (OSError, RuntimeError, TypeError, KeyError, ValueError, AttributeError):
        return None


@dataclass(frozen=True)
class Handoff(ChatTransferResult):
    target_id: int
    states: tuple[tuple[int, str], ...]
    blocked: str = ""

    @property
    def status(self):
        if self.blocked:
            return self.blocked
        if not self.states:
            return super().status
        statuses = set(state for _, state in self.states)
        for state in ("delivery_uncertain", "delivery_waiting", "delivery_queued"):
            if state in statuses:
                return state
        return next(iter(statuses)) if len(statuses) == 1 else "delivery_recorded"


def reserve_sessions(mode, env, sessions, deal, stage_id, assignment, *, client):
    target = assignment.assigned_by_id
    allowed_targets = set(assignment.online_pool)
    if len(assignment.configured_pool) == 1:
        allowed_targets.update(assignment.configured_pool)
    states = []
    skipped = tuple((chat_id, "no_current_transferable_session") for chat_id, sid in sessions.items() if sid == 0)
    unavailable = "handoff_unconfirmed"
    scope = env.get("SALES_CHAT_WINDOW_SCOPE")
    origin = internal_web_origin(scope)
    token = env.get("SALES_CHAT_WINDOW_TOKEN")
    for chat_id, sid in sorted(sessions.items()):
        if not sid:
            continue
        if mode == "paused":
            unavailable = "delivery_paused"
            break
        matches = _current_case_binding(client, chat_id, sid, deal)
        if matches is None:
            unavailable = "delivery_binding_pending"
            break
        if not matches:
            states.append((chat_id, "delivery_binding_unverified"))
            continue
        if not origin or not token:
            break
        payload = {"scope": scope, "chat_id": chat_id, "session_id": sid, "deal_id": int(deal["id"]),
                   "lead_id": int(deal["leadId"]), "contact_id": int(deal["contactId"]) if deal.get("contactId") else None,
                   "stage_id": stage_id, "target_id": target}
        receipt = register(origin, token, payload)
        if not receipt:
            break
        if isinstance(receipt, str):  # Authoritative rejection from Laravel's fresh native read.
            states.append((chat_id, "delivery_binding_unverified" if receipt == "case_binding_mismatch" else "delivery_session_replaced"))
            continue
        if receipt["target_id"] != target:
            # A previous handoff may have committed before its HTTP response was lost.
            # Retain that seller only when still eligible and before accepting any other session.
            already_reserved = any(state in STATES.values() for _, state in states)
            if already_reserved or receipt["target_id"] not in allowed_targets or receipt["status"] not in ("pending", "waiting"):
                unavailable = "delivery_target_conflict"
                break
            target = receipt["target_id"]
        states.append((chat_id, STATES[receipt["status"]]))
    else:
        unavailable = ""
    if unavailable:
        registered = {chat for chat, _ in states}
        states.extend((chat, unavailable) for chat, sid in sessions.items() if sid and chat not in registered)
    return Handoff(tuple(sessions), (), skipped, target, tuple(states), unavailable)