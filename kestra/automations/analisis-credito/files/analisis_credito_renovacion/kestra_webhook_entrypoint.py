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


def main() -> int:
    ok = False
    try:
        payload = _load_trigger_body()
        cuil_raw = _extract_cuil(payload)
        cuil_digits = normalize_cuil(cuil_raw)

        if len(cuil_digits) != 11:
            raise ValueError("CUIL invalido: deben ser 11 digitos")
        if not validar_dv_cuil(cuil_digits):
            raise ValueError("CUIL invalido: digito verificador incorrecto")

        result = evaluar_socio(cuil_digits)
        result["cuil"] = format_cuil(cuil_digits)
        ok = True
    except Exception as exc:
        result = {
            "puede_renovar": False,
            "saldo_renovacion": 0.0,
            "motivo": "error",
            "cuil": None,
            "error": str(exc),
        }

    _emit_outputs_if_available(ok, result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0


def _load_trigger_body() -> Any:
    raw = os.environ.get("TRIGGER_BODY_JSON", "").strip()
    if not raw:
        raise ValueError("Missing TRIGGER_BODY_JSON.")
    return json.loads(raw)


def _extract_cuil(payload: Any) -> str:
    if isinstance(payload, dict):
        if "cuil" in payload:
            return str(payload["cuil"])
        raise ValueError("Missing 'cuil' in request body.")
    if payload is None:
        raise ValueError("Missing request body.")
    if isinstance(payload, (list, tuple)):
        raise ValueError("Body must be an object or string.")
    return str(payload)


def _emit_outputs_if_available(ok: bool, result: Dict[str, Any]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(
        {
            "ok": ok,
            "puede_renovar": bool(result.get("puede_renovar", False)),
            "saldo_renovacion": float(result.get("saldo_renovacion", 0.0)),
            "motivo": "" if result.get("motivo") is None else str(result.get("motivo")),
            "cuil": "" if result.get("cuil") is None else str(result.get("cuil")),
            "error": "" if result.get("error") is None else str(result.get("error")),
        }
    )


if __name__ == "__main__":
    raise SystemExit(main())
