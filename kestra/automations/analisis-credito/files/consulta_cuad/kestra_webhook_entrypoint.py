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
    CuadTechnicalError,
    InvalidRequestError,
    build_error_result,
    build_output_payload,
    consultar_cuad,
    log_event,
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
        result = consultar_cuad(request, config)
        return _finalize_execution(build_output_payload(result), exit_code=0)

    except InvalidRequestError as exc:
        logger.warning("Solicitud invalida de consulta CUAD: %s", exc)
        result = build_error_result(request, "invalid_request", str(exc))
        return _finalize_execution(build_output_payload(result), exit_code=0)

    except ConfigurationError as exc:
        logger.error("Configuracion invalida del flow CUAD: %s", exc, exc_info=True)
        result = build_error_result(request, exc.status, str(exc), captcha_attempts=exc.captcha_attempts)
        return _finalize_execution(build_output_payload(result), exit_code=1)

    except CuadTechnicalError as exc:
        logger.error("Error tecnico al consultar CUAD: %s", exc, exc_info=True)
        result = build_error_result(request, exc.status, str(exc), captcha_attempts=exc.captcha_attempts)
        return _finalize_execution(build_output_payload(result), exit_code=1)

    except Exception as exc:
        logger.error("Fallo inesperado del entrypoint CUAD: %s", exc, exc_info=True)
        result = build_error_result(request, "error", str(exc))
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
    log_event(
        "consulta_cuad_entrypoint_result",
        status=output_payload.get("status") or "",
        ok=bool(output_payload.get("ok", False)),
        found=bool(output_payload.get("found", False)),
        exit_code=exit_code,
        captcha_attempts=int(output_payload.get("captcha_attempts") or 0),
    )
    _emit_outputs_if_available(output_payload)
    sys.stdout.write(output_payload["response_json"] + "\n")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
