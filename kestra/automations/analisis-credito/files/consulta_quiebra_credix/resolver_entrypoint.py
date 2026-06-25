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

from .service import (
    build_error_result,
    build_output_payload,
    consultar_tabla,
    load_config_from_env,
    parse_search_request,
)
from .sqlite_cache import write_cache_entries


def main() -> int:
    request = None
    try:
        payload = _load_trigger_body()
        request = parse_search_request(payload)
        config = load_config_from_env()
        result = consultar_tabla(request, config)
    except Exception as exc:
        result = build_error_result(request, str(exc))

    output_payload = build_output_payload(result)
    _write_sqlite_cache_if_configured(output_payload)
    _emit_outputs_if_available(output_payload)
    sys.stdout.write(output_payload["response_json"] + "\n")
    return 0


def _load_trigger_body() -> Any:
    raw = os.environ.get("TRIGGER_BODY_JSON", "").strip()
    if not raw:
        raise ValueError("Missing TRIGGER_BODY_JSON.")
    return json.loads(raw)


def _emit_outputs_if_available(output_payload: dict[str, Any]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(output_payload)


def _write_sqlite_cache_if_configured(output_payload: dict[str, Any]) -> None:
    db_path = os.environ.get("CREDIX_CACHE_SQLITE_PATH", "").strip()
    if not db_path or not output_payload.get("cache_should_persist"):
        return

    entries = []
    cache_value_json = str(output_payload.get("cache_value_json") or "")
    for key_name in ("cuil_cache_key", "name_cache_key"):
        key = str(output_payload.get(key_name) or "")
        if key and cache_value_json:
            entries.append({"key": key, "value": cache_value_json})

    write_cache_entries(db_path, entries)


if __name__ == "__main__":
    raise SystemExit(main())
