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
    decode_cache_env,
    find_cached_result_in_payloads,
    parse_search_request,
)


def main() -> int:
    request = None
    try:
        payload = _load_trigger_body()
        request = parse_search_request(payload)
        result = find_cached_result_in_payloads(
            request,
            decode_cache_env(os.getenv("CREDIX_CACHE_BY_CUIL_JSON", "")),
            decode_cache_env(os.getenv("CREDIX_CACHE_BY_NAME_JSON", "")),
            _parse_max_age_days(),
        )
        if result is None:
            result = build_error_result(request, "cache_miss")
            result["cache_hit"] = False
    except Exception as exc:
        result = build_error_result(request, str(exc))

    output_payload = build_output_payload(result)
    _emit_outputs_if_available(output_payload)
    sys.stdout.write(output_payload["response_json"] + "\n")
    return 0


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
