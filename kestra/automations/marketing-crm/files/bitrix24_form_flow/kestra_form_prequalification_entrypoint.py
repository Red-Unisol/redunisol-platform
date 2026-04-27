#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys
from typing import Any

from .form_processor.business_logic import prequalify_submission

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None


def main() -> int:
    try:
        payload = _load_trigger_body()
        result = _process_payload(payload)
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
            "rejection_label": None,
            "bcra_result": None,
            "payload": None,
        }

    _emit_outputs_if_available(result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0


def _load_trigger_body() -> Any:
    raw = os.environ.get("TRIGGER_BODY_JSON", "").strip()
    if not raw:
        raise ValueError("Falta la variable TRIGGER_BODY_JSON.")
    return json.loads(raw)


def _process_payload(payload: Any) -> dict[str, object]:
    if not isinstance(payload, dict):
        raise ValueError("El body del webhook debe ser un objeto JSON.")

    enriched_payload = dict(payload)
    _apply_full_name_override(enriched_payload)
    return prequalify_submission(enriched_payload)


def _apply_full_name_override(payload: dict[str, object]) -> None:
    first_name = os.environ.get("ARCA_RESOLVED_NOMBRE", "").strip()
    last_name = os.environ.get("ARCA_RESOLVED_APELLIDO", "").strip()
    business_name = os.environ.get("ARCA_RESOLVED_RAZON_SOCIAL", "").strip()

    resolved_full_name = " ".join(part for part in (first_name, last_name) if part).strip()
    if resolved_full_name:
        payload["full_name"] = resolved_full_name
        payload["full_name_inferred"] = False
        return

    if business_name:
        payload["full_name"] = business_name
        payload["full_name_inferred"] = False


def _emit_outputs_if_available(result: dict[str, object]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(
        {
            "ok": bool(result.get("ok", False)),
            "qualified": bool(result.get("qualified", False)),
            "action": str(result.get("action") or ""),
            "reason": str(result.get("reason") or ""),
            "message": str(result.get("message") or ""),
            "rejection_label": str(result.get("rejection_label") or ""),
            "payload_json": json.dumps(result.get("payload") or {}, ensure_ascii=True),
            "bcra_result_json": json.dumps(result.get("bcra_result") or {}, ensure_ascii=True),
        }
    )


if __name__ == "__main__":
    raise SystemExit(main())
