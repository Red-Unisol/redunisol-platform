#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys
from typing import Any

from .form_processor.lead_prefill_service import resolve_prefill_identity

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover
    Kestra = None


def main() -> int:
    try:
        result = resolve_prefill_identity(
            source_id=os.getenv("PREFILL_SOURCE_ID", ""),
            cuil=os.getenv("PREFILL_CUIL", ""),
            dni=os.getenv("PREFILL_DNI", ""),
            credixsa_output=_load_credixsa_output(),
        )
        result["ok"] = result["status"] != "unresolved"
    except Exception as exc:
        result = {
            "ok": False,
            "status": "unresolved",
            "effective_cuil": "",
            "sanitized": False,
            "reason": "internal_error",
            "message": str(exc),
        }

    if Kestra is not None:
        Kestra.outputs(result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0


def _load_credixsa_output() -> dict[str, Any]:
    return {
        "ok": _load_bool("CREDIX_OK"),
        "status": os.getenv("CREDIX_STATUS", "").strip(),
        "cuit": os.getenv("CREDIX_CUIT", "").strip(),
        "error": os.getenv("CREDIX_ERROR", "").strip(),
    }


def _load_bool(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "y", "si", "s"}


if __name__ == "__main__":
    raise SystemExit(main())
