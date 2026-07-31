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
    consultar_contacto,
    load_config_from_env,
    parse_search_request,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

logger = logging.getLogger(__name__)


def main() -> int:
    request = None
    try:
        payload = _load_trigger_body()
        request = parse_search_request(payload)
        config = load_config_from_env()
        result = consultar_contacto(request, config)
        return _finalize_execution(build_output_payload(result), exit_code=0)

    except InvalidRequestError as exc:
        logger.warning("Solicitud invalida: %s", exc)
        result = build_error_result(request, str(exc), status="invalid_request")
        return _finalize_execution(build_output_payload(result), exit_code=0)

    except ConfigurationError as exc:
        logger.error("Configuracion invalida del flow AFIP: %s", exc, exc_info=True)
        result = build_error_result(request, str(exc), status="technical_error")
        return _finalize_execution(build_output_payload(result), exit_code=1)

    except Exception as exc:
        logger.error("Error tecnico al consultar AFIP: %s", exc, exc_info=True)
        result = build_error_result(request, str(exc), status="technical_error")
        return _finalize_execution(build_output_payload(result), exit_code=1)


def _load_trigger_body() -> Any:
    raw = os.environ.get("TRIGGER_BODY_JSON", "").strip()
    if not raw:
        raise InvalidRequestError("Missing TRIGGER_BODY_JSON.")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidRequestError("Invalid JSON body.") from exc


def _emit_outputs_if_available(output_payload: dict[str, Any]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(output_payload)


def _finalize_execution(output_payload: dict[str, Any], *, exit_code: int) -> int:
    _emit_outputs_if_available(output_payload)
    sys.stdout.write(output_payload["response_json"] + "\n")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
