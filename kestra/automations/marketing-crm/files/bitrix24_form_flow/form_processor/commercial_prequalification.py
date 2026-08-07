from __future__ import annotations

from typing import Any

from .input_parser import normalize_prequalification_input
from .qualification import evaluate_prequalification


RULE_VERSION = "2026-08-07-centralized"


def prequalify_commercial_fields(payload: dict[str, Any]) -> dict[str, object]:
    try:
        submission = normalize_prequalification_input(payload)
        result = evaluate_prequalification(submission)
        return {
            "ok": True,
            "prequalified": result.qualified,
            "route_to_whatsapp": result.qualified,
            "reason": result.reason,
            "message": result.message,
            "rule_version": RULE_VERSION,
        }
    except ValueError as exc:
        return {
            "ok": False,
            "prequalified": False,
            "route_to_whatsapp": False,
            "reason": "invalid_input",
            "message": str(exc),
            "rule_version": RULE_VERSION,
        }
