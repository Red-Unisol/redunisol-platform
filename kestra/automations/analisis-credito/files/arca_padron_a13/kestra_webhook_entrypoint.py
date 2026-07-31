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
    TechnicalError,
    build_error_result,
    build_output_payload,
    consultar_padron,
    load_config_from_env,
    log_event,
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
        payload = _load_payload()
        request = parse_search_request(payload)
        config = load_config_from_env()
        result = consultar_padron(request, config)
        return _finalize_execution(result, exit_code=0)

    except InvalidRequestError as exc:
        logger.warning("Solicitud invalida de consulta padron A13: %s", exc)
        result = build_error_result(request, str(exc), status="invalid_request")
        return _finalize_execution(result, exit_code=0)

    except ConfigurationError as exc:
        logger.error(
            "Configuracion invalida del flow consulta_padron_a13: %s",
            exc,
            exc_info=True,
        )
        result = build_error_result(request, str(exc), status="technical_error")
        return _finalize_execution(result, exit_code=1)

    except TechnicalError as exc:
        logger.error("Error tecnico al consultar padron A13: %s", exc, exc_info=True)
        result = build_error_result(request, str(exc), status=exc.status)
        return _finalize_execution(result, exit_code=1)

    except Exception as exc:
        logger.error("Fallo inesperado en consulta_padron_a13: %s", exc, exc_info=True)
        result = build_error_result(request, str(exc), status="technical_error")
        return _finalize_execution(result, exit_code=1)


def _load_payload() -> Any:
    input_cuit_cuil = os.environ.get("ARCA_INPUT_CUIT_CUIL", "").strip()
    if input_cuit_cuil:
        return {"cuit_cuil": input_cuit_cuil}

    return _load_trigger_body()


def _load_trigger_body() -> Any:
    raw = os.environ.get("TRIGGER_BODY_JSON", "").strip()
    if not raw:
        raise InvalidRequestError("Missing request body.")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidRequestError("TRIGGER_BODY_JSON is not valid JSON.") from exc


def _finalize_execution(result: dict[str, Any], *, exit_code: int) -> int:
    output_payload = build_output_payload(result)
    _emit_outputs_if_available(output_payload)
    log_event(
        "arca_padron_a13_entrypoint_result",
        exit_code=exit_code,
        ok=output_payload["ok"],
        found=output_payload["found"],
        status=output_payload["status"],
        cuit_cuil=output_payload["cuit_cuil"],
        error=output_payload["error"],
    )
    sys.stdout.write(output_payload["response_json"] + "\n")
    return exit_code


def _emit_outputs_if_available(output_payload: dict[str, Any]) -> None:
    if Kestra is None:
        return
    Kestra.outputs(output_payload)


if __name__ == "__main__":
    raise SystemExit(main())
