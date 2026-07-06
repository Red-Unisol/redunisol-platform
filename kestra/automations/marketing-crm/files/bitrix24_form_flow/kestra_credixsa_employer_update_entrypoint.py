#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys
from typing import Any

from .form_processor.credixsa_employer_service import update_lead_with_credixsa_output

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None


def main() -> int:
    lead_id = os.getenv("LEAD_ID", "").strip()
    try:
        if not lead_id:
            result = {
                "ok": True,
                "action": "skipped",
                "lead_id": "",
                "status": "",
                "updated": False,
                "dry_run": _load_bool("BACKFILL_DRY_RUN", default=False),
                "message": "No hay lead pendiente para actualizar.",
            }
        else:
            result = update_lead_with_credixsa_output(
                lead_id=lead_id,
                credixsa_output=_load_credixsa_output(),
                dry_run=_load_bool("BACKFILL_DRY_RUN", default=False),
            )
    except Exception as exc:
        result = {
            "ok": False,
            "action": "error",
            "lead_id": lead_id,
            "status": "error",
            "updated": False,
            "dry_run": _load_bool("BACKFILL_DRY_RUN", default=False),
            "message": str(exc),
        }

    _emit_outputs_if_available(result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True, separators=(",", ":")) + "\n")
    return 0


def _load_credixsa_output() -> dict[str, Any]:
    return {
        "ok": _load_bool("CREDIX_OK", default=False),
        "status": os.getenv("CREDIX_STATUS", "").strip(),
        "cuit": os.getenv("CREDIX_CUIT", "").strip(),
        "nombre": os.getenv("CREDIX_NOMBRE", "").strip(),
        "normalized_json": os.getenv("CREDIX_NORMALIZED_JSON", "").strip(),
        "error": os.getenv("CREDIX_ERROR", "").strip(),
        "cache_hit": _load_bool("CREDIX_CACHE_HIT", default=False),
        "cached_at": os.getenv("CREDIX_CACHED_AT", "").strip(),
    }


def _load_bool(name: str, *, default: bool) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "y", "si", "s"}


def _emit_outputs_if_available(result: dict[str, object]) -> None:
    if Kestra is None:
        return
    Kestra.outputs(result)


if __name__ == "__main__":
    raise SystemExit(main())
