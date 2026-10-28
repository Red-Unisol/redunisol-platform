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
        if (not re.fullmatch(r"[0-9]{1,18}", flow_id) or flow_id in {"1850162769693486", "1993586314642842"}
                or payload.get("flow_id") != flow_id):
            raise ValueError("A dedicated published intake Flow is required.")
        attribution = normalize_attribution(payload.get("attribution"))
        if (not attribution or attribution.get("status") != "resolved" or not attribution.get("journey_id")
                or attribution.get("wa", {}).get("WA_ENTRY") != "website"):
            raise ValueError("A verified website journey is required.")
        if payload.get("test_mode", False) is not False:
            raise ValueError("The assistance test contract cannot be used for intake.")
        timestamp = datetime.fromisoformat(str(payload.get("received_at", "")).replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            raise ValueError("An aware response timestamp is required.")
        answer = normalize_answer(payload.get("answer"), retain_invalid_identity=True)
    except (ValueError, TypeError, AttributeError):
        raise InvalidIntake("Invalid WhatsApp intake response.") from None
    return persist(payload, answer, env=source, client=client)
