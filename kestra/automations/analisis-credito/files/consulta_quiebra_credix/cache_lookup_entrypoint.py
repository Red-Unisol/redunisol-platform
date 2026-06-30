#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys
from typing import Any

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None

from .service import build_cache_lookup
from .service import CACHE_DUMMY_KEY


def main() -> int:
    try:
        payload = _load_trigger_body()
        output_payload = build_cache_lookup(payload)
    except Exception as exc:
        output_payload = {
            "cuit": "",
            "nombre": "",
            "cuil_cache_key": "",
            "name_cache_key": "",
            "cuil_cache_lookup_key": CACHE_DUMMY_KEY,
            "name_cache_lookup_key": CACHE_DUMMY_KEY,
            "error": str(exc),
        }

    _emit_outputs_if_available(output_payload)
    sys.stdout.write(json.dumps(output_payload, ensure_ascii=True, separators=(",", ":")) + "\n")
    return 0


def _load_trigger_body() -> Any:
    raw = os.environ.get("CREDIX_REQUEST_JSON", "").strip()
    if not raw:
        raw = os.environ.get("TRIGGER_BODY_JSON", "").strip()
    if not raw:
        raise ValueError("Missing CREDIX_REQUEST_JSON or TRIGGER_BODY_JSON.")
    return json.loads(raw)


def _emit_outputs_if_available(output_payload: dict[str, Any]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(output_payload)


if __name__ == "__main__":
    raise SystemExit(main())
