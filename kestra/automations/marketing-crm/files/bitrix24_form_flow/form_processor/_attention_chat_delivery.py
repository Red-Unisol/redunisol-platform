"""Deliver a recovered session after its CRM assignment, under the single qualification dispatcher."""
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timedelta, timezone
import json

from ._attention_retry import HORIZON
from .deal_service import ChatTransferResult, inspect_attention_retry_sessions


PENDING = "attention_chat_pending"
INTENT = "attention_chat_intent"


def _utc(value=None):
    if value is None:
        return datetime.now(timezone.utc)
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if value.utcoffset() is None:
        raise ValueError("delivery_time_without_zone")
    return value.astimezone(timezone.utc)


@dataclass(frozen=True)
class Delivery:
    deal: int
    lead: int
    contact: int
    chat: int
    session: int
    target: int
    stage: str
    first: int
    deadline: int
    attempt: int = 0
    intent: int = 0

    def encode(self):
        return json.dumps(asdict(self), separators=(",", ":"))

    @classmethod
    def parse(cls, raw):
        data = json.loads(raw)
        marker = cls(**data)
        for key in ("deal", "lead", "contact", "chat", "session", "target", "first", "deadline", "attempt", "intent"):
            value = data.get(key)
            if type(value) is not int or value < (0 if key in {"attempt", "contact", "intent"} else 1):
                raise ValueError("invalid_delivery_marker")
        if (not isinstance(marker.stage, str) or not marker.stage or len(marker.stage) > 80
                or marker.target in {57, 74827, 71283} or marker.deadline - marker.first != HORIZON.total_seconds()
                or not 0 < marker.first < marker.deadline < 253402300799
                or marker.intent and not marker.first <= marker.intent < marker.deadline):
            raise ValueError("invalid_delivery_marker")
        return marker


def delivery_fields(config, deal, fields, sessions, failed_at):
    """Include these fields in the same Bitrix update that assigns the seller."""
    if not sessions or len(sessions) != 1:
        raise ValueError("attention_delivery_requires_one_session")
    chat, session = next(iter(sessions.items()))
    first = _utc(failed_at)
    marker = Delivery(int(deal["id"]), int(deal["leadId"]), int(deal.get("contactId") or 0),
                      int(chat), int(session), int(fields["assignedById"]), fields["stageId"],
                      int(first.timestamp()), int((first + HORIZON).timestamp()))
    raw = marker.encode()
    Delivery.parse(raw)
    return {config.deal.queue_action_field: PENDING, config.deal.queue_reason_field: raw,
            config.deal.queue_enqueued_at_field: first.isoformat(timespec="seconds")}


def due_deliveries(client, config, now, limit):
    """Query by due time, then verify each returned row before spending a batch slot."""
    if limit <= 0:
        return []
    cut = _utc(now)
    action, reason, due = config.deal.queue_action_field, config.deal.queue_reason_field, config.deal.queue_enqueued_at_field
    ids = []
    start = 0
    while True:
        data = client.call_full("crm.item.list", {"entityTypeId": 2, "start": start,
            "filter": {"=categoryId": config.deal.category_id, "="+action: PENDING, "<="+due: cut.isoformat()},
            "select": ["id", "categoryId", action, reason, due], "order": {due: "ASC", "id": "ASC"}})
        rows = data["result"]["items"]
        for row in rows:
            if (row.get(action) != PENDING or str(row.get("categoryId")) != str(config.deal.category_id)
                    or not row.get(due)):
                continue
            try:
                marker = Delivery.parse(row.get(reason))
                eligible = marker.deal == int(row["id"]) and _utc(row[due]) <= cut
            except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
                continue
            if eligible and marker.deal not in ids:
                ids.append(marker.deal)
                if len(ids) >= limit:
                    return ids
        following = data.get("next", data["result"].get("next"))
        if following is None:
            return ids
        following = int(following)
        if following <= start:
            raise ValueError("non_advancing_delivery_page")
        start = following


def _read_deal(client, deal_id):
    record = client.call("crm.item.get", {"entityTypeId": 2, "id": deal_id})["item"]
    if str(record.get("id")) != str(deal_id):
        raise ValueError("wrong_delivery_deal")
    return record


def _business_matches(client, config, marker, deal):
    if (str(deal.get("categoryId")) != str(config.deal.category_id)
            or deal.get("stageId") != marker.stage or str(deal.get("assignedById")) != str(marker.target)
            or str(deal.get("leadId")) != str(marker.lead)
            or str(deal.get("contactId") or 0) != str(marker.contact)):
        return False
    lead = client.call("crm.lead.get", {"id": marker.lead})
    return (str(lead.get("ID")) == str(marker.lead)
            and str(lead.get("ASSIGNED_BY_ID")) == str(marker.target)
            and str(lead.get("CONTACT_ID") or 0) == str(marker.contact))


def deliver_attention_chat(client, config, deal_id, now=None, logger=None):
    """Retry reads only. The written intent survives crashes or an ambiguous transfer response."""
    action, reason, due = config.deal.queue_action_field, config.deal.queue_reason_field, config.deal.queue_enqueued_at_field
    deal = _read_deal(client, deal_id)
    if deal.get(action) != PENDING:
        return ChatTransferResult((), (), ())
    marker = Delivery.parse(deal[reason])
    if marker.deal != int(deal_id) or marker.intent:
        raise ValueError("wrong_delivery_marker")
    raw = deal[reason]
    window = {}

    def skipped(why):
        return ChatTransferResult((marker.chat,), (), ((marker.chat, why),))

    def change(expected_action, new_action, new_reason, next_at=""):
        current = _read_deal(client, deal_id)
        if current.get(action) != expected_action or current.get(reason) != raw:
            return False
        client.call("crm.item.update", {"entityTypeId": 2, "id": deal_id, "fields":
            {action: new_action, reason: new_reason, due: next_at}})
        return True

    def stop(expected, why):
        if why == "attention_inspection_unavailable":
            pending = replace(marker, attempt=marker.attempt + 1)
            backoff = timedelta(minutes=min(30, 2 ** min(marker.attempt, 5)))
            next_at = min(_utc(now) + backoff, datetime.fromtimestamp(marker.deadline, timezone.utc))
            change(expected, PENDING, pending.encode(), next_at.isoformat(timespec="seconds"))
        else:
            change(expected, "attention_chat_preserved", why)
        return skipped(why)

    def validate(expected):
        current = _read_deal(client, deal_id)
        if current.get(action) != expected or current.get(reason) != raw:
            return "attention_delivery_changed"
        if not _business_matches(client, config, marker, current):
            return "crm_changed_before_transfer"
        if _utc(now).timestamp() >= marker.deadline:
            return "attention_delivery_expired"
        sessions, blocked = inspect_attention_retry_sessions(
            client, lead_id=marker.lead, contact_id=marker.contact or None, deal_id=deal_id,
            distributable_open_line_ids=config.deal.distributable_open_line_ids,
            expected_sessions={marker.chat: marker.session},
            failed_at=datetime.fromtimestamp(marker.first, timezone.utc), now=now, window_evidence=window)
        return blocked or (None if sessions == {marker.chat: marker.session} else "session_changed_before_transfer")

    if not deal.get(due) or _utc(deal[due]) > _utc(now):
        return skipped("attention_delivery_not_due")
    # Both preflights are read-only. On an ordinary read failure we KNOW the POST has not run.
    for state in (PENDING, INTENT):
        try:
            blocked = validate(state)
        except Exception:
            blocked = "attention_inspection_unavailable"
        if blocked:
            return stop(state, blocked)
        if state == PENDING:
            claimed_at = int(_utc(now).timestamp())
            if claimed_at >= marker.deadline:
                return stop(PENDING, "attention_delivery_expired")
            intent_raw = replace(marker, intent=claimed_at).encode()
            if not change(PENDING, INTENT, intent_raw):
                return skipped("attention_delivery_changed")
            raw = intent_raw
    if _utc(now).timestamp() >= marker.deadline:
        return stop(INTENT, "attention_delivery_expired")
    # Validation can take several API calls. Reread both CRM owners after it too.
    try:
        final = _read_deal(client, deal_id)
        if final.get(action) != INTENT or final.get(reason) != raw:
            return skipped("attention_delivery_changed")
        if not _business_matches(client, config, marker, final):
            return stop(INTENT, "crm_changed_before_transfer")
    except Exception:
        return stop(INTENT, "attention_inspection_unavailable")
    dispatch_at = _utc(now)
    if dispatch_at.timestamp() >= marker.deadline:
        return stop(INTENT, "attention_delivery_expired")
    if not window.get("expires_at"):
        return stop(INTENT, "attention_evidence_ambiguous")
    if dispatch_at >= window["expires_at"]:
        return stop(INTENT, "whatsapp_window_expired")
    posted_at = dispatch_at.replace(microsecond=0)
    try:
        acknowledged = client.call("imopenlines.operator.transfer", {"CHAT_ID": marker.chat, "USER_ID": marker.target})
    except Exception:
        # Never revert an intent after starting the native transfer.
        return skipped("attention_transfer_uncertain")
    if acknowledged is not True:
        return skipped("attention_transfer_uncertain")
    change(INTENT, "attention_chat_acknowledged", raw)
    # Confirm the native event separately from transport acceptance.
    try:
        transfers = client.call("imopenlines.v2.Session.Transfer.list", {"sessionId": [marker.session]})
        actor = config.webhook_path.strip("/").split("/")[-2]
        matched = [event for event in transfers["transfers"] if
                   str(event.get("sessionId")) == str(marker.session)
                   and str(event.get("toOperatorId")) == str(marker.target)
                   and str(event.get("initiatorId")) == actor and event.get("type") == "USER"
                   and posted_at <= _utc(event["date"]) <= _utc(now)]
        confirmed = actor.isdigit() and transfers.get("hasNextPage", False) is False and len(matched) == 1
    except (RuntimeError, ValueError, TypeError, KeyError, IndexError, AttributeError):
        confirmed = False
    if not confirmed:
        return skipped("attention_transfer_acknowledged_unverified")
    change("attention_chat_acknowledged", "attention_chat_confirmed", raw)
    return ChatTransferResult((marker.chat,), (marker.chat,), ())
