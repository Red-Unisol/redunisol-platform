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
    CACHE_MAX_AGE_DAYS,
    build_error_result,
    build_output_payload,
    cache_key_for_cuil,
    cache_key_for_name,
    decode_cache_env,
    find_cached_result_in_payloads,
    parse_search_request,
)
from .sqlite_cache import write_cache_entries


def main() -> int:
    request = None
    cache_by_cuil = None
    cache_by_name = None
    try:
        payload = _load_trigger_body()
        request = parse_search_request(payload)
        cache_by_cuil = decode_cache_env(os.getenv("CREDIX_CACHE_BY_CUIL_JSON", ""))
        cache_by_name = decode_cache_env(os.getenv("CREDIX_CACHE_BY_NAME_JSON", ""))
        result = find_cached_result_in_payloads(
            request,
            cache_by_cuil,
            cache_by_name,
            _parse_max_age_days(),
        )
        if result is None:
            result = build_error_result(request, "cache_miss", status="cache_miss")
            result["cache_hit"] = False
    except Exception as exc:
        result = build_error_result(request, str(exc))

    # Repair a missing/stale shared copy without re-dating a KV cache hit.
    _mirror_cache_hit(result, cache_by_cuil, cache_by_name)
    output_payload = build_output_payload(result)
    _emit_outputs_if_available(output_payload)
    if Kestra is None:
        sys.stdout.write(output_payload["response_json"] + "\n")
    else:
        print(json.dumps({"event": "credixsa_cache_checked", "status": output_payload["status"],
                          "cache_hit": output_payload["cache_hit"]}))
    return 0


def _mirror_cache_hit(result, cache_by_cuil, cache_by_name) -> None:
    db_path = os.getenv("CREDIX_CACHE_SQLITE_PATH", "").strip()
    if not db_path or not result.get("cache_hit"):
        return
    payload = cache_by_cuil if result.get("cache_source") == "cuil" else cache_by_name
    if not isinstance(payload, dict):
        return
    value = json.dumps(payload, ensure_ascii=True)
    keys = (cache_key_for_cuil(result.get("cuit")), cache_key_for_name(result.get("nombre")))
    write_cache_entries(db_path, [{"key": key, "value": value} for key in keys if key])


def _load_trigger_body() -> Any:
    raw = os.environ.get("CREDIX_REQUEST_JSON", "").strip()
    if not raw:
        raw = os.environ.get("TRIGGER_BODY_JSON", "").strip()
    if not raw:
        raise ValueError("Missing CREDIX_REQUEST_JSON or TRIGGER_BODY_JSON.")
    return json.loads(raw)


def _parse_max_age_days() -> int:
    raw_value = os.getenv("CREDIX_CACHE_MAX_AGE_DAYS", str(CACHE_MAX_AGE_DAYS)).strip()
    try:
        return int(raw_value or CACHE_MAX_AGE_DAYS)
    except ValueError:
        return CACHE_MAX_AGE_DAYS


def _emit_outputs_if_available(output_payload: dict[str, Any]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(output_payload)


if __name__ == "__main__":
    raise SystemExit(main())
