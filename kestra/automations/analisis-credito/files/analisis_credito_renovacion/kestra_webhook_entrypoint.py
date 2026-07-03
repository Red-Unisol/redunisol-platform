#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict

from .renovacion import evaluar_socio, format_cuil, normalize_cuil, validar_dv_cuil

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None


class InvalidRequestError(ValueError):
    pass


def main() -> int:
    ok = False
    status = "technical_error"
    exit_code = 1
    cuil_digits = ""
    try:
        payload = _load_trigger_body()
        cuil_raw = _extract_cuil(payload)
        cuil_digits = normalize_cuil(cuil_raw)

        if len(cuil_digits) != 11:
            raise InvalidRequestError("CUIL invalido: deben ser 11 digitos")
        if not validar_dv_cuil(cuil_digits):
            raise InvalidRequestError("CUIL invalido: digito verificador incorrecto")

        cuil_formateado = format_cuil(cuil_digits)
        _log_event("renovacion_cruz_del_eje_start", cuil=cuil_formateado)
        result = evaluar_socio(cuil_digits)
        result["cuil"] = cuil_formateado
        ok = True
        status = "completed"
        exit_code = 0
        _log_event(
            "renovacion_cruz_del_eje_done",
            cuil=cuil_formateado,
            puede_renovar=bool(result.get("puede_renovar", False)),
            motivo="" if result.get("motivo") is None else str(result.get("motivo")),
            saldo_renovacion=float(result.get("saldo_renovacion", 0.0)),
        )
    except InvalidRequestError as exc:
        result = {
            "puede_renovar": False,
            "saldo_renovacion": 0.0,
            "motivo": "error",
            "cuil": format_cuil(cuil_digits) if cuil_digits else None,
            "error": str(exc),
        }
        status = "invalid_request"
        exit_code = 0
        _log_event("renovacion_cruz_del_eje_invalid_request", error=str(exc))
    except Exception as exc:
        result = {
            "puede_renovar": False,
            "saldo_renovacion": 0.0,
            "motivo": "error",
            "cuil": format_cuil(cuil_digits) if cuil_digits else None,
            "error": str(exc),
        }
        status = "technical_error"
        exit_code = 1
        _log_event(
            "renovacion_cruz_del_eje_technical_error",
            cuil=format_cuil(cuil_digits) if cuil_digits else "",
            error_type=type(exc).__name__,
            error=str(exc),
        )

    _emit_outputs_if_available(ok, status, result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return exit_code


def _load_trigger_body() -> Any:
    raw = os.environ.get("TRIGGER_BODY_JSON", "").strip()
    if not raw:
        raise InvalidRequestError("Missing request body.")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidRequestError("Request body must be valid JSON.") from exc


def _extract_cuil(payload: Any) -> str:
    if isinstance(payload, dict):
        if "cuil" in payload:
            return str(payload["cuil"])
        raise InvalidRequestError("Missing 'cuil' in request body.")
    if payload is None:
        raise InvalidRequestError("Missing request body.")
    if isinstance(payload, (list, tuple)):
        raise InvalidRequestError("Body must be an object or string.")
    return str(payload)


def _emit_outputs_if_available(ok: bool, status: str, result: Dict[str, Any]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(
        {
            "ok": ok,
            "status": status,
            "puede_renovar": bool(result.get("puede_renovar", False)),
            "saldo_renovacion": float(result.get("saldo_renovacion", 0.0)),
            "motivo": "" if result.get("motivo") is None else str(result.get("motivo")),
            "cuil": "" if result.get("cuil") is None else str(result.get("cuil")),
            "error": "" if result.get("error") is None else str(result.get("error")),
        }
    )


def _log_event(event: str, **fields: Any) -> None:
    sys.stdout.write(json.dumps({"event": event, **fields}, ensure_ascii=True) + "\n")


if __name__ == "__main__":
    raise SystemExit(main())
