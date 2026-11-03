"""Small, durable event batches; the web database owns the cross-worker lease."""
from __future__ import annotations

from collections import Counter
import json
import re
import time
from urllib.request import Request, urlopen

from .deal_chat_response import (
    CATEGORY_ID, SOURCE_STAGES, _get_deal, _normalize_decision, reconcile_deal,
)


class BudgetReached(Exception):
    pass


class QueueClient:
    def __init__(self, url, token, scope):
        if not url.startswith("https://") or not token or not scope:
            raise ValueError("Chat response queue is not configured")
        self.url, self.token, self.scope = url.rstrip("/"), token, scope

    def request(self, action, **body):
        request = Request(self.url + "/" + action,
            data=json.dumps({"scope": self.scope, **body}).encode(),
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=10) as response:
                result = json.load(response)
            if not isinstance(result, dict):
                raise ValueError("Invalid queue response")
            return result
        except Exception:
            raise RuntimeError("Chat response queue operation failed") from None


class BudgetedClient:
    """Count every HTTP attempt, pace it, and fence it with the shared lease."""
    def __init__(self, client, queue, lease, *, clock=time.monotonic, sleep=time.sleep,
                 max_calls=20, seconds=45, interval=2.0):
        self.client, self.queue, self.lease = client, queue, lease
        self.clock, self.sleep = clock, sleep
        self.deadline, self.max_calls, self.interval = clock() + seconds, max_calls, interval
        self.last = -float("inf")
        self.calls, self.failures = Counter(), Counter()

    def call_full(self, method, payload):
        read = method.endswith((".get", ".list")) or method == "crm.duplicate.findbycomm"
        for attempt in range(3):
            if sum(self.calls.values()) >= self.max_calls or self.clock() >= self.deadline:
                raise BudgetReached()
            self.sleep(max(0, self.interval - (self.clock() - self.last)))
            if self.clock() >= self.deadline:
                raise BudgetReached()
            # A lost/expired lease stops even an old Kestra process before its next CRM call.
            self.queue.request("renew", lease=self.lease)
            self.last = self.clock()
            self.calls[method] += 1
            try:
                return self.client.call_full(method, payload)
            except Exception as exc:
                self.failures[method] += 1
                limited = "query_limit_exceeded" in str(exc).lower()
                if not read or not limited or attempt == 2:
                    raise
                self.sleep(2 ** attempt)
        raise AssertionError("unreachable")

    def call(self, method, payload):
        return self.call_full(method, payload).get("result")


def _page(api, cursor, extra=None):
    result = api.call("crm.item.list", {"entityTypeId": 2,
        "useOriginalUfNames": "Y", "select": ["*"], "order": {"id": "ASC"},
        "filter": {"=categoryId": CATEGORY_ID, "@stageId": list(SOURCE_STAGES),
                   ">id": cursor, **(extra or {})}})
    items = result.get("items") if isinstance(result, dict) else None
    if not isinstance(items, list):
        raise ValueError("Invalid candidate list")
    if any(not isinstance(x, dict) or int(x.get("id", 0)) <= cursor for x in items):
        raise ValueError("Invalid candidate cursor")
    return [_normalize_decision(item) for item in items]


def _candidates(api, claim):
    cursor, payload = int(claim.get("cursor", 0)), claim.get("payload") or {}
    if claim["mode"] == "fallback":
        items = _page(api, cursor)
        return items, len(items) < 50
    if payload.get("deal_id"):
        return [_get_deal(api, int(payload["deal_id"]))], True
    phone = str(payload.get("phone", ""))
    if not re.fullmatch(r"[0-9]{10,15}", phone):
        raise ValueError("Invalid queued identity")
    identities = api.call("crm.duplicate.findbycomm", {"type": "PHONE", "values": [phone]})
    if not isinstance(identities, dict):
        raise ValueError("Invalid identity response")
    found, page_ends = {}, []
    for kind, field in [("CONTACT", "contactId"), ("LEAD", "leadId")]:
        ids = identities.get(kind) or []
        if not isinstance(ids, list) or len(ids) > 200 or any(not str(i).isdigit() or int(i) < 1 for i in ids):
            raise ValueError("Invalid identity list")
        if ids:
            items = _page(api, cursor, {"@" + field: ids})
            if len(items) >= 50:
                page_ends.append(int(items[-1]["id"]))
            found.update({int(item["id"]): item for item in items})
    # Two independently paginated identity lists can cover different ID ranges.
    # Do not advance past the shorter range while that list still has another page.
    boundary = min(page_ends) if page_ends else float("inf")
    return [found[key] for key in sorted(found) if key <= boundary], not page_ends


def run_worker(client, queue, *, clock=time.monotonic, sleep=time.sleep, _api=None, **budget):
    claim = queue.request("claim")
    mode = claim.get("mode")
    if mode in {"busy", "idle"}:
        return {"ok": True, "mode": mode, "api_calls": {}, "counts": {}, "events": [], "checked": 0}
    if mode not in {"event", "fallback"} or not claim.get("lease"):
        raise ValueError("Invalid queue claim")
    api = _api or BudgetedClient(client, queue, claim["lease"], clock=clock, sleep=sleep, **budget)
    api.lease = claim["lease"]
    calls_before, failures_before = api.calls.copy(), api.failures.copy()
    cursor, counts, outcome, error_type = int(claim.get("cursor", 0)), Counter(), "completed", None
    events, current = [], None
    try:
        items, last_page = _candidates(api, claim)
        for item in items:
            current = item
            event = reconcile_deal(api, item)
            events.append(event)
            counts[event["status"]] += 1
            cursor = max(cursor, int(item["id"]))
            current = None
        if not last_page:
            outcome = "retry"
        elif mode == "fallback":
            cursor = 0
        elif not items or counts.get("no_active_sales_session"):
            # Edna can notify before its independent Bitrix callback creates the session.
            if int(claim.get("attempts", 1)) < 3:
                outcome, cursor = "retry", 0
    except BudgetReached:
        outcome = "retry"
    except Exception as exc:
        outcome, error_type = "error", type(exc).__name__
        if current:
            events.append({"deal_id": int(current["id"]), "status": "error", "error_type": error_type})
            counts["error"] += 1
    calls, failures = api.calls - calls_before, api.failures - failures_before
    queue.request("finish", lease=claim["lease"], outcome=outcome, cursor=cursor,
                  calls=sum(calls.values()), moved=counts.get("moved", 0))
    return {"ok": outcome != "error", "mode": mode, "outcome": outcome,
            "counts": dict(counts), "api_calls": dict(calls),
            "api_failed_attempts": dict(failures), "error_type": error_type,
            "events": events, "checked": len(events)}


def run_batches(client, queue, *, clock=time.monotonic, sleep=time.sleep, **budget):
    """Drain several notices under ONE shared time/call/pacing budget."""
    api = BudgetedClient(client, queue, None, clock=clock, sleep=sleep, **budget)
    counts, events, batches, last = Counter(), [], 0, None
    while batches < 20 and sum(api.calls.values()) < api.max_calls and clock() < api.deadline:
        result = run_worker(client, queue, clock=clock, sleep=sleep, _api=api)
        if result["mode"] in {"busy", "idle"}:
            if last is None:
                return result
            break
        batches += 1
        counts.update(result["counts"])
        events.extend(result["events"])
        last = result
        if not result["ok"] or result["mode"] == "fallback" or result["outcome"] == "retry":
            break
    return {**last, "batches": batches, "counts": dict(counts), "events": events,
            "checked": len(events), "api_calls": dict(api.calls),
            "api_failed_attempts": dict(api.failures)}


def enqueue_classified_deal(event, source, logger):
    if not source.get("CHAT_RESPONSE_QUEUE_TOKEN") or not source.get("CHAT_RESPONSE_EVENT_ID"):
        return
    if not event.get("ok") or event.get("stage_id") not in SOURCE_STAGES:
        return
    try:
        queue = QueueClient(source["CHAT_RESPONSE_QUEUE_URL"], source["CHAT_RESPONSE_QUEUE_TOKEN"],
                            source["CHAT_RESPONSE_SCOPE"])
        queue.request("enqueue", deal_id=int(event["deal_id"]), source=source["CHAT_RESPONSE_EVENT_ID"])
    except Exception:
        # Commercial writes already succeeded. The bounded reconciliation recovers this notification.
        logger.error("No se pudo encolar la revision de chat; se recuperara por reconciliacion.")
