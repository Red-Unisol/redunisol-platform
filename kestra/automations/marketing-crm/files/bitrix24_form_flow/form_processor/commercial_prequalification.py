from __future__ import annotations

from datetime import datetime
from typing import Any

from .input_parser import normalize_prequalification_input
from .qualification import evaluate_prequalification


RULE_VERSION = "2026-08-31-policia-federal-caba-initial"


def prequalify_commercial_fields(
    payload: dict[str, Any],
    *,
    evaluated_at: datetime | None = None,
) -> dict[str, object]:
    try:
        submission = normalize_prequalification_input(payload)
        result = evaluate_prequalification(submission, evaluated_at=evaluated_at)
        return {
            "ok": True,
            "prequalified": result.is_measurement_qualified,
            "route_to_whatsapp": result.should_route_to_whatsapp,
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
