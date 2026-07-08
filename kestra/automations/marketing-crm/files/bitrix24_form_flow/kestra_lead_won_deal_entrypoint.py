#!/usr/bin/env python3

from __future__ import annotations

import json
import os
from urllib.parse import parse_qs
import sys
from typing import Any

from .form_processor.lead_won_deal_service import process_lead_update_event

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None


def main() -> int:
    try:
        payload = _load_trigger_body()
        result = process_lead_update_event(payload)
    except Exception as exc:
        result = {
            "ok": False,
            "action": "error",
            "reason": "error",
            "message": str(exc),
            "lead_id": None,
            "lead_status": None,
            "deal_id": None,
        }

    _emit_outputs_if_available(result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0


def _load_trigger_body() -> dict[str, Any]:
    raw = os.environ.get("TRIGGER_BODY_JSON", "").strip()
    if not raw:
        raise ValueError("Falta la variable TRIGGER_BODY_JSON.")

    parsed = json.loads(raw)
    if isinstance(parsed, dict):
        return parsed
    if isinstance(parsed, str):
        try:
            nested = json.loads(parsed)
        except json.JSONDecodeError:
            return _parse_form_encoded(parsed)
        if isinstance(nested, dict):
            return nested

    raise ValueError("El body del webhook debe ser un objeto JSON o form-urlencoded.")


def _parse_form_encoded(raw: str) -> dict[str, str]:
    parsed = parse_qs(raw, keep_blank_values=True)
    return {key: values[-1] if values else "" for key, values in parsed.items()}


def _emit_outputs_if_available(result: dict[str, object]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(
        {
            "ok": bool(result.get("ok", False)),
            "action": str(result.get("action") or ""),
            "reason": str(result.get("reason") or ""),
            "message": str(result.get("message") or ""),
            "lead_id": "" if result.get("lead_id") is None else str(result.get("lead_id")),
            "lead_status": str(result.get("lead_status") or ""),
            "deal_id": "" if result.get("deal_id") is None else str(result.get("deal_id")),
        }
    )


if __name__ == "__main__":
    raise SystemExit(main())
