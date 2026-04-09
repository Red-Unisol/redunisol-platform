#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys

from .form_processor.business_logic import classify_lead

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None


def main() -> int:
    try:
        lead_id = _load_lead_id()
        force_processing = _load_bool("FORCE_PROCESSING", default=False)
        result = classify_lead(lead_id, force_processing=force_processing)
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


def _load_lead_id() -> str:
    value = os.environ.get("LEAD_ID", "").strip()
    if not value:
        raise ValueError("Falta la variable LEAD_ID.")
    return value


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
