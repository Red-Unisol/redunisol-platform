"""Authenticated website-origin intake; all business outcomes retain a lead."""
import os
import re
from datetime import datetime

from edna_incoming.intake import VERSION, normalize_answer
from .attribution import normalize_attribution
from .whatsapp_intake_crm import persist


class InvalidIntake(ValueError):
    """Rejected before any provider access or mutation."""


def process(payload, *, env=None, client=None):
    try:
        if not isinstance(payload, dict) or payload.get("contract") != VERSION:
            raise ValueError("Invalid WhatsApp intake contract.")
        source = dict(os.environ if env is None else env)
        flow_id = source.get("EDNA_INTAKE_FLOW_ID", "")
        accepted = {flow_id, *(v.strip() for v in source.get("EDNA_INTAKE_ACCEPTED_FLOW_IDS", "").split(",") if v.strip())}
        if (any(not re.fullmatch(r"[0-9]{1,18}", id) or id in {"1850162769693486", "1993586314642842"} for id in accepted)
                or payload.get("flow_id") not in accepted):
            raise ValueError("A dedicated published intake Flow is required.")
        attribution = normalize_attribution(payload.get("attribution"))
        if (not attribution or attribution.get("status") != "resolved" or not attribution.get("journey_id")
                or attribution.get("wa", {}).get("WA_ENTRY") != "website"):
            raise ValueError("A verified website journey is required.")
        attributed_flow = attribution.get("wa", {}).get("WA_FLOW_ID")
        if attributed_flow is not None and attributed_flow != payload.get("flow_id"):
            raise ValueError("The website journey belongs to another intake Flow.")
        if payload.get("test_mode", False) is not False:
            raise ValueError("The assistance test contract cannot be used for intake.")
        ack_version = payload.get("acknowledgement_version", 1)
        if isinstance(ack_version, bool) or ack_version not in {1, 2}:
            raise ValueError("Invalid intake acknowledgement version.")
        timestamp = datetime.fromisoformat(str(payload.get("received_at", "")).replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            raise ValueError("An aware response timestamp is required.")
        answer = normalize_answer(payload.get("answer"), retain_invalid_identity=True)
    except (ValueError, TypeError, AttributeError):
        raise InvalidIntake("Invalid WhatsApp intake response.") from None
    result = persist(payload, answer, env=source, client=client)
    # During a rolling deploy the old Web bridge knows only this terminal ack.
    # It still records the rejection reason and persisted lead without retrying.
    if result["action"] == "rejected" and ack_version == 1:
        result = dict(result, action="already_processed", commercial_outcome="rejected")
    return result
