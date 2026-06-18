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
    build_error_result,
    build_output_payload,
    consultar_contacto,
    load_config_from_env,
    parse_search_request,
)

logger = logging.getLogger(__name__)


def main() -> int:
    request = None
    try:
        payload = _load_trigger_body()
        request = parse_search_request(payload)
        config = load_config_from_env()
        result = consultar_contacto(request, config)
        output_payload = build_output_payload(result)
        _emit_outputs_if_available(output_payload)
        sys.stdout.write(output_payload["response_json"] + "\n")
        return 0

    except ValueError as exc:
        # Datos inválidos del caller (DNI faltante, body malformado) — no es falla del sistema
        logger.warning("Solicitud inválida: %s", exc)
        result = build_error_result(request, str(exc))
        output_payload = build_output_payload(result)
        _emit_outputs_if_available(output_payload)
        sys.stdout.write(output_payload["response_json"] + "\n")
        return 0

    except Exception as exc:
        # Error técnico (timeout, AFIP caído, respuesta inesperada) — marca el flow como FAILED
        logger.error("Error técnico al consultar AFIP: %s", exc, exc_info=True)
        result = build_error_result(request, str(exc))
        output_payload = build_output_payload(result)
        _emit_outputs_if_available(output_payload)
        sys.stdout.write(output_payload["response_json"] + "\n")
        sys.exit(1)


def _load_trigger_body() -> Any:
    raw = os.environ.get("TRIGGER_BODY_JSON", "").strip()
    if not raw:
        raise ValueError("Missing TRIGGER_BODY_JSON.")
    return json.loads(raw)


def _emit_outputs_if_available(output_payload: dict[str, Any]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(output_payload)


if __name__ == "__main__":
    raise SystemExit(main())