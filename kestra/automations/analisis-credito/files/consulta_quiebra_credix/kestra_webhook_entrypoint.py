#!/usr/bin/env python3

from __future__ import annotations

import json
import logging
import os
import sys
import time
from typing import Any

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None

from .service import (
    ConfigurationError,
    CredixConfig,
    InvalidRequestError,
    SearchRequest,
    build_error_result,
    build_output_payload,
    consultar_tabla,
    load_config_from_env,
    parse_search_request,
)
from .sqlite_cache import write_cache_entries
from .bcra import enrich_bcra

logger = logging.getLogger(__name__)

# El reintento vive aca: en la instalacion actual de Kestra 2 se observaron
# estados FAILED intermedios y task runs duplicados con el retry del YAML.
# Se mantienen los 2 intentos y la pausa de d784e78; no es un timeout global,
# porque cada consulta puede acumular varias esperas del navegador.
CONSULTA_MAX_ATTEMPTS = 2
CONSULTA_RETRY_PAUSE_SECONDS = 10


def main() -> int:
    request = None
    exit_code = 0
    try:
        payload = _load_trigger_body()
        request = parse_search_request(payload)
        config = load_config_from_env()
        result = _consultar_con_reintento(request, config)
    except InvalidRequestError as exc:
        logger.warning("Solicitud invalida de consulta CredixSA: %s", exc)
        result = build_error_result(request, str(exc), status="invalid_request")
    except (ConfigurationError, Exception) as exc:
        logger.error("Error tecnico al consultar CredixSA: %s", exc, exc_info=True)
        result = build_error_result(request, str(exc), status="technical_error")
        exit_code = 1

    output_payload = build_output_payload(enrich_bcra(result))
    _write_sqlite_cache_if_configured(output_payload)
    _emit_outputs_if_available(output_payload)
    if Kestra is None:
        sys.stdout.write(output_payload["response_json"] + "\n")
    else:
        # The full contract is already emitted as Kestra outputs.
        print(json.dumps({"event": "credixsa_completed", "status": output_payload["status"],
                          "cache_hit": output_payload["cache_hit"]}))
    return exit_code


def _consultar_con_reintento(request: SearchRequest, config: CredixConfig) -> dict[str, Any]:
    for attempt in range(1, CONSULTA_MAX_ATTEMPTS + 1):
        try:
            return consultar_tabla(request, config)
        except (InvalidRequestError, ConfigurationError):
            raise
        except Exception as exc:
            if attempt >= CONSULTA_MAX_ATTEMPTS:
                raise
            logger.warning(
                "Intento %s/%s de consulta CredixSA fallo: %s. Reintentando en %s segundos.",
                attempt,
                CONSULTA_MAX_ATTEMPTS,
                exc,
                CONSULTA_RETRY_PAUSE_SECONDS,
            )
            time.sleep(CONSULTA_RETRY_PAUSE_SECONDS)
    raise RuntimeError("CredixSA: se agotaron los intentos sin resultado.")


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
