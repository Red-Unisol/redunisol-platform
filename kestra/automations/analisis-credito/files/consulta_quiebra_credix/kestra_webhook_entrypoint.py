#!/usr/bin/env python3

from __future__ import annotations

import json
import logging
import os
import sys
from typing import Any

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None

from .service import (
    ConfigurationError,
    InvalidRequestError,
    build_error_result,
    build_output_payload,
    consultar_tabla,
    load_config_from_env,
    parse_search_request,
)
from .sqlite_cache import write_cache_entries

logger = logging.getLogger(__name__)


def main() -> int:
    request = None
    exit_code = 0
    try:
        payload = _load_trigger_body()
        request = parse_search_request(payload)
        config = load_config_from_env()
        result = consultar_tabla(request, config)
    except InvalidRequestError as exc:
        logger.warning("Solicitud invalida de consulta CredixSA: %s", exc)
        result = build_error_result(request, str(exc), status="invalid_request")
    except (ConfigurationError, Exception) as exc:
        logger.error("Error tecnico al consultar CredixSA: %s", exc, exc_info=True)
        result = build_error_result(request, str(exc), status="technical_error")
        exit_code = 1

    output_payload = build_output_payload(result)
    _write_sqlite_cache_if_configured(output_payload)
    _emit_outputs_if_available(output_payload)
    sys.stdout.write(output_payload["response_json"] + "\n")
    return exit_code


def _load_trigger_body() -> Any:
    raw = os.environ.get("CREDIX_REQUEST_JSON", "").strip()
    if not raw:
        raw = os.environ.get("TRIGGER_BODY_JSON", "").strip()
    if not raw:
        raise InvalidRequestError("Missing CREDIX_REQUEST_JSON or TRIGGER_BODY_JSON.")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidRequestError("Request body must be valid JSON.") from exc


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
