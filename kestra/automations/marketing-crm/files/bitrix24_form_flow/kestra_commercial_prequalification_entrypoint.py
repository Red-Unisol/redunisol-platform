#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys
from typing import Any

from .form_processor.commercial_prequalification import (
    RULE_VERSION,
    prequalify_commercial_fields,
)

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
            "prequalified": False,
            "route_to_whatsapp": False,
            "reason": "error",
            "message": str(exc),
            "rule_version": RULE_VERSION,
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
    return prequalify_commercial_fields(dict(payload))


def _emit_outputs_if_available(result: dict[str, object]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(result)


if __name__ == "__main__":
    raise SystemExit(main())
