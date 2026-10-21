"""Flow requires CUIL; incomplete/legacy callbacks safely retain manual review."""

import json
import re
from datetime import datetime

FLOW_ID = "1993586314642842"
VERSION = "jubilados-assistance-v1"


def valid_cuil(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{11}", value):
        return False
    check = 11 - sum(int(d) * w for d, w in zip(value[:10], (5, 4, 3, 2, 7, 6, 5, 4, 3, 2))) % 11
    return (0 if check == 11 else 9 if check == 10 else check) == int(value[-1])


def normalize_answer(data):
    if not isinstance(data, dict):
        raise ValueError("Invalid assistance answer.")
    organism = data.get("organismo")
    if not isinstance(organism, str) or organism not in {"caja_cordoba", "anses", "ayuda"}:
        raise ValueError("Invalid assistance organism.")
    result = {"version": VERSION, "organism": organism, "province": "Cordoba",
              "bank": "", "employment_status": "", "continuity": "ayuda",
              "action": "review", "cuil": None, "email": None,
              "cuil_status": "missing", "email_status": "missing"}
    suffix = "ayuda"
    if organism in {"caja_cordoba", "anses"}:
        suffix = "caja" if organism == "caja_cordoba" else "anses"
        if organism == "anses":
            bank = data.get("banco_anses")
            if not isinstance(bank, str) or bank not in {"bancor", "otro"}:
                raise ValueError("Invalid assistance bank.")
            result["bank"] = bank
            if bank == "otro":
                return dict(result, action="bank_rejected", continuity="no_elegible")
        continuity = data.get("continuidad_" + suffix)
        if not isinstance(continuity, str) or continuity not in {"formulario", "ayuda"}:
            raise ValueError("Invalid assistance continuity.")
        result.update(continuity=continuity, employment_status=(
            "Jubilado Provincial" if organism == "caja_cordoba" else "Jubilado Nacional"))
        result["action"] = "landing" if continuity == "formulario" else "intake"
        if continuity == "formulario":
            # Meta includes hidden, sometimes stale branch fields. Never read them.
            return result
    for field in ("cuil", "email"):
        value = data.get(field + "_" + suffix)
        if value is None or value == "":
            continue
        if not isinstance(value, str) or len(value) > 255:
            result[field + "_status"] = "invalid"
            continue
        value = value.strip()
        if not value:
            continue
        if field == "cuil":
            normalized = re.sub(r"[\s.-]", "", value)
            valid = valid_cuil(normalized)
        else:
            normalized = value.lower()
            valid = re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", normalized) is not None
        result[field + "_status"] = "valid" if valid else "invalid"
        if valid:
            result[field] = normalized
    return result


def evaluate(request, allowed_subject):
    """Only the trusted bridge may submit this operation after ledger correlation."""
    receipt = {"ok": False, "kind": "jubilados_assistance", "event_key": "",
               "request_id": request.get("request_id", ""), "assistance_result": ""}
    event, context = request.get("event"), request.get("context")
    try:
        if not isinstance(event, dict) or not isinstance(context, dict):
            raise ValueError("Missing verified assistance context.")
        receipt["event_key"] = str(event.get("subjectId")) + ":" + str(event.get("id"))
        if (not allowed_subject or str(event.get("subjectId")) != str(allowed_subject)
                or context.get("verified") is not True or context.get("flow_id") != FLOW_ID
                or not isinstance(context.get("case_id"), int) or isinstance(context["case_id"], bool)
                or context["case_id"] <= 0 or context.get("request_id") != request.get("request_id")
                or context.get("request_id") != event.get("replyOutMessageExternalRequestId")
                or not context.get("outgoing_message_id")
                or context["outgoing_message_id"] != event.get("replyOutMessageId")
                or (event.get("messageContent") or {}).get("type") != "FLOW"):
            raise ValueError("Invalid verified assistance context.")
        timestamp = datetime.fromisoformat(event["receivedAt"].replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            raise ValueError("Invalid assistance timestamp.")
        text = event["messageContent"]["text"]
        if not isinstance(text, str) or len(text.encode("utf-8")) > 32768:
            raise ValueError("Invalid assistance content.")
        answer = normalize_answer(json.loads(text))
        # Receipts/logs contain decisions, never CUIL, email or phone.
        receipt.update(ok=True, assistance_result=json.dumps(
            {k: v for k, v in answer.items() if k not in {"cuil", "email"}}, ensure_ascii=False))
        return receipt, {"event_key": receipt["event_key"], "case_id": context["case_id"], **answer}
    except (ValueError, TypeError, KeyError, AttributeError, RecursionError):
        return dict(receipt, reason="invalid_assistance_response"), None
