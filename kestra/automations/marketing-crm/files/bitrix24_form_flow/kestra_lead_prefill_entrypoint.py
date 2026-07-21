#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys
from typing import Any

from .form_processor.lead_prefill_service import prefill_lead

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover
    Kestra = None


def main() -> int:
    lead_id = os.getenv("LEAD_ID", "").strip()
    try:
        if not lead_id:
            raise ValueError("Falta LEAD_ID.")
        result = prefill_lead(
            lead_id,
            arca_output=_load_arca_output(),
            credixsa_output=_load_credixsa_output(),
            max_attempts=int(os.getenv("BACKFILL_MAX_ATTEMPTS", "3")),
        )
    except Exception as exc:
        result = {
            "ok": False,
            "action": "error",
            "lead_id": lead_id,
            "lead_status": "",
            "attempts": 0,
            "errors": ["internal"],
            "message": str(exc),
        }

    outputs = dict(result)
    outputs["errors_json"] = json.dumps(result.get("errors") or [], ensure_ascii=True)
    if Kestra is not None:
        Kestra.outputs(outputs)
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0


def _load_arca_output() -> dict[str, Any]:
    return {
        "ok": _load_bool("ARCA_OK"),
        "nombre": os.getenv("ARCA_NOMBRE", "").strip(),
        "apellido": os.getenv("ARCA_APELLIDO", "").strip(),
        "razon_social": os.getenv("ARCA_RAZON_SOCIAL", "").strip(),
        "fecha_nacimiento": os.getenv("ARCA_FECHA_NACIMIENTO", "").strip(),
        "error": os.getenv("ARCA_ERROR", "").strip(),
    }


def _load_credixsa_output() -> dict[str, Any]:
    return {
        "ok": _load_bool("CREDIX_OK"),
        "status": os.getenv("CREDIX_STATUS", "").strip(),
        "cuit": os.getenv("CREDIX_CUIT", "").strip(),
        "nombre": os.getenv("CREDIX_NOMBRE", "").strip(),
        "normalized_json": os.getenv("CREDIX_NORMALIZED_JSON", "").strip(),
        "error": os.getenv("CREDIX_ERROR", "").strip(),
        "cache_hit": _load_bool("CREDIX_CACHE_HIT"),
        "cached_at": os.getenv("CREDIX_CACHED_AT", "").strip(),
    }


def _load_bool(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "y", "si", "s"}


if __name__ == "__main__":
    raise SystemExit(main())
