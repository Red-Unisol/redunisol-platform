#!/usr/bin/env python3

from __future__ import annotations

from datetime import datetime
import json
import os
import sys
from typing import Any
from zoneinfo import ZoneInfo

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover
    Kestra = None

from consulta_quiebra_credix.warmup_entrypoint import (
    DEFAULT_LOCAL_TZ as ZONA_HORARIA_LOCAL_POR_DEFECTO,
    complete_missing_cuils as completar_cuiles_faltantes,
    decode_daily_index as decodificar_indice_diario,
    fetch_today_solicitudes as obtener_solicitudes_de_hoy,
    load_core_config as cargar_configuracion_core,
    parse_int_env as leer_entero_env,
    select_candidates as seleccionar_candidatos,
)

MAXIMO_POR_CORRIDA_POR_DEFECTO = 5
MAXIMO_PREVIEW = 5


def resumen_para_stdout(salida: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": salida.get("ok"),
        "hay_candidatos": salida.get("hay_candidatos"),
        "cantidad_solicitudes": salida.get("cantidad_solicitudes"),
        "cantidad_candidatos": salida.get("cantidad_candidatos"),
        "error": salida.get("error"),
    }


def construir_salida_sondeo(
    *,
    fecha_sondeo: str,
    indice_diario: dict[str, Any],
    solicitudes: list[Any],
    candidatos: list[Any],
    maximo_por_corrida: int,
) -> dict[str, Any]:
    preview = [
        {
            "oid": item.oid,
            "cuil": item.cuil,
            "documento": item.documento,
            "nombre": item.nombre,
        }
        for item in candidatos[:MAXIMO_PREVIEW]
    ]

    return {
        "ok": True,
        "hay_candidatos": bool(candidatos),
        "cantidad_solicitudes": str(len(solicitudes)),
        "cantidad_candidatos": str(len(candidatos)),
        "maximo_por_corrida": str(maximo_por_corrida),
        "fecha_sondeo": fecha_sondeo,
        "indice_diario_json": json.dumps(
            indice_diario, ensure_ascii=True, separators=(",", ":")
        ),
        "candidatos_preview_json": json.dumps(
            preview, ensure_ascii=True, separators=(",", ":")
        ),
        "error": "",
    }


def ejecutar_sondeo() -> dict[str, Any]:
    configuracion_core = cargar_configuracion_core()
    zona_horaria = ZoneInfo(
        os.getenv("LOCAL_TZ", ZONA_HORARIA_LOCAL_POR_DEFECTO).strip()
        or ZONA_HORARIA_LOCAL_POR_DEFECTO
    )
    fecha_hoy = datetime.now(zona_horaria).date()

    indice_diario = decodificar_indice_diario(
        os.getenv("CREDIX_DAILY_INDEX_JSON", ""),
        fecha_hoy.isoformat(),
    )
    maximo_por_corrida = leer_entero_env(
        "CREDIX_WARMUP_MAX_PER_RUN",
        MAXIMO_POR_CORRIDA_POR_DEFECTO,
    )

    solicitudes = obtener_solicitudes_de_hoy(configuracion_core, fecha_hoy)
    solicitudes = completar_cuiles_faltantes(configuracion_core, solicitudes)
    candidatos = seleccionar_candidatos(
        solicitudes,
        indice_diario,
        maximo_por_corrida,
    )

    return construir_salida_sondeo(
        fecha_sondeo=fecha_hoy.isoformat(),
        indice_diario=indice_diario,
        solicitudes=solicitudes,
        candidatos=candidatos,
        maximo_por_corrida=maximo_por_corrida,
    )


def principal() -> int:
    salida = ejecutar_sondeo()

    if Kestra is not None:
        Kestra.outputs(salida)

    sys.stdout.write(
        json.dumps(
            resumen_para_stdout(salida), ensure_ascii=True, separators=(",", ":")
        )
        + "\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(principal())
