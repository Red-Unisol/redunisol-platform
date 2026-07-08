#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys

from .form_processor.business_logic import persist_submission
from .kestra_form_intake_entrypoint import _apply_full_name_override

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None


def main() -> int:
    try:
        payload = _load_json_env("SUBMISSION_PAYLOAD_JSON", required=True)
        payload = _apply_full_name_override(payload)
        qualified = _load_bool("QUALIFIED", default=False)
        reason = _load_string("REASON", required=True)
        message = _load_string("MESSAGE", required=True)
        rejection_label = _load_string("REJECTION_LABEL", required=False)
        bcra_result = _load_json_env("BCRA_RESULT_JSON", required=False)
        result = persist_submission(
            payload,
            qualified=qualified,
            reason=reason,
            message=message,
            rejection_label=rejection_label,
            bcra_result_payload=bcra_result,
        )
    except Exception as exc:
        result = {
            "ok": False,
            "qualified": False,
            "contact_id": None,
            "lead_id": None,
            "lead_status": None,
            "action": "error",
            "reason": "error",
            "message": str(exc),
        }

    _emit_outputs_if_available(result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0


def _load_json_env(name: str, *, required: bool) -> dict[str, object] | None:
    raw = os.environ.get(name, "").strip()
    if not raw:
        if required:
            raise ValueError(f"Falta la variable {name}.")
        return None
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError(f"La variable {name} debe contener un objeto JSON.")
    return parsed


def _load_string(name: str, *, required: bool) -> str | None:
    value = os.environ.get(name, "").strip()
    if not value and required:
        raise ValueError(f"Falta la variable {name}.")
    return value or None


def _load_bool(name: str, *, default: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "y", "yes", "si", "s"}


def _emit_outputs_if_available(result: dict[str, object]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(
        {
            "ok": bool(result.get("ok", False)),
            "qualified": bool(result.get("qualified", False)),
            "contact_id": "" if result.get("contact_id") is None else str(result.get("contact_id")),
            "lead_id": "" if result.get("lead_id") is None else str(result.get("lead_id")),
            "lead_status": str(result.get("lead_status") or ""),
            "action": str(result.get("action") or ""),
            "reason": str(result.get("reason") or ""),
            "message": str(result.get("message") or ""),
        }
    )


if __name__ == "__main__":
    raise SystemExit(main())
