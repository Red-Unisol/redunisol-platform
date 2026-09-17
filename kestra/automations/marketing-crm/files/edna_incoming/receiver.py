"""Pure parsing of the minimal Edna envelope forwarded by the web inbox."""

import json
import re
from datetime import datetime

ENTRY_PHRASE = "vengo del sitio web de red unisol"
SEGMENTS = {
    "cordoba": {
        "jubilado_pensionado", "empleado_publico", "policia_cordoba",
        "docente", "salud", "unc", "otra",
    },
    "catamarca": {"empleado_publico", "policia", "docente", "salud", "otra"},
    "caba": {"pfa", "otra"},
}


def identifier(value):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    value = str(value)
    return value if re.fullmatch(r"[0-9]{1,64}", value) else None


def classify(event, allowed_subject):
    """Return a receipt and, only for relevant messages, a normalized artifact.

    FLOW payload shape is not proof of a specific Meta flow ID. Correlation with
    a sent Flow must be added before any future CRM writes or replies.
    """
    receipt = {"ok": True, "event_key": "", "kind": "invalid", "reason": "invalid_envelope"}
    if not isinstance(event, dict):
        return receipt, None
    subject = identifier(event.get("subjectId"))
    message = identifier(event.get("id"))
    if not subject or not message:
        return receipt, None
    receipt["event_key"] = f"{subject}:{message}"
    if not identifier(allowed_subject):
        raise ValueError("EDNA_INCOMING_SUBJECT_ID must be configured")
    if subject != str(allowed_subject):
        return {**receipt, "kind": "ignored", "reason": "other_channel"}, None
    subscriber = event.get("subscriber")
    content = event.get("messageContent")
    if not isinstance(subscriber, dict) or not isinstance(content, dict):
        return receipt, None
    phone = subscriber.get("identifier")
    received_at = event.get("receivedAt")
    if not isinstance(phone, str) or not phone or len(phone) > 128:
        return receipt, None
    try:
        timestamp = datetime.fromisoformat(received_at.replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            return receipt, None
    except (AttributeError, TypeError, ValueError):
        return receipt, None
    normalized = {
        "event_key": receipt["event_key"], "subject_id": subject, "message_id": message,
        "subscriber_identifier": phone, "received_at": received_at,
    }
    text = content.get("text")
    if not isinstance(text, str) or len(text.encode("utf-8")) > 32768:
        return {**receipt, "reason": "invalid_text"}, None
    if content.get("type") == "TEXT":
        if ENTRY_PHRASE not in " ".join(text.casefold().split()):
            return {**receipt, "kind": "ignored", "reason": "unrelated_text"}, None
        return {**receipt, "kind": "router_entry", "reason": "entry_phrase"}, {
            **normalized, "kind": "router_entry", "wa_entry": "website",
        }
    if content.get("type") != "FLOW":
        return {**receipt, "kind": "ignored", "reason": "unsupported_type"}, None
    try:
        data = json.loads(text)
    except (ValueError, RecursionError):
        return {**receipt, "reason": "invalid_flow_json"}, None
    if not isinstance(data, dict):
        return {**receipt, "reason": "invalid_flow_json"}, None
    province = data.get("provincia")
    if not isinstance(province, str) or province not in {*SEGMENTS, "otra"}:
        return {**receipt, "reason": "invalid_province"}, None
    segment = "otra" if province == "otra" else data.get(f"situacion_{province}")
    if not isinstance(segment, str) or (province != "otra" and segment not in SEGMENTS[province]):
        return {**receipt, "reason": "invalid_segment"}, None
    flow_token = data.get("flow_token")
    if flow_token is not None and (not isinstance(flow_token, str) or len(flow_token) > 512):
        return {**receipt, "reason": "invalid_flow_token"}, None
    return {**receipt, "kind": "flow_response", "reason": "router_shape_matched"}, {
        **normalized, "kind": "flow_response", "province": province, "segment": segment,
        "flow_token": flow_token, "flow_id_verified": False,
    }
