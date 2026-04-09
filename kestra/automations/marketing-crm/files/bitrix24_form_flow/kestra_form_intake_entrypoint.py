#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys
from typing import Any

from .form_processor.business_logic import ingest_form_body, ingest_submission

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
    content_type = os.environ.get("TRIGGER_CONTENT_TYPE")

    if isinstance(payload, dict):
        return ingest_submission(payload)

    if payload is None:
        return ingest_form_body("", content_type=content_type)

    if isinstance(payload, (list, tuple)):
        raise ValueError("El body del webhook debe ser un objeto JSON o una cadena.")

    return ingest_form_body(str(payload), content_type=content_type)


def _emit_outputs_if_available(result: dict[str, object]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(
        {
            "ok": bool(result.get("ok", False)),
            "contact_id": "" if result.get("contact_id") is None else str(result.get("contact_id")),
            "lead_id": "" if result.get("lead_id") is None else str(result.get("lead_id")),
            "action": str(result.get("action") or ""),
            "reason": str(result.get("reason") or ""),
            "message": str(result.get("message") or ""),
        }
    )


if __name__ == "__main__":
    raise SystemExit(main())
