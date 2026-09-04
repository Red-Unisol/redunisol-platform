from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - enables local unit tests
    Kestra = None

from . import corrida, cuad, entrada, exportar, sesion


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)


def _positive_int(name: str, default: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} debe ser un entero.") from exc
    if value <= 0:
        raise ValueError(f"{name} debe ser mayor que cero.")
    return value


def _non_negative_int(name: str, default: int) -> int:
    value = _positive_int(name, default) if default > 0 else int(os.getenv(name, "0").strip())
    if value < 0:
        raise ValueError(f"{name} no puede ser negativo.")
    return value


def _non_negative_float(name: str, default: float) -> float:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} debe ser un numero.") from exc
    if value < 0:
        raise ValueError(f"{name} no puede ser negativo.")
    return value


def _flag(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes"}


def build_output_payload(
    *,
    source: dict[str, Any],
    summary: dict[str, Any],
    output_dir: Path,
    totals_path: Path,
    movements_path: Path | None,
) -> dict[str, Any]:
    state = summary["estado"]
    return {
        "ok": not summary["detenida"],
        "completed": summary["completada"],
        "stopped": summary["detenida"],
        "error": summary["motivo_corte"] or "",
        "input_cuil_count": source["cantidad_cuiles_unicos"],
        "input_invalid_count": source["cantidad_invalidos"],
        "consulted_count": summary["consultadas_en_esta_corrida"],
        "ok_count": state["cantidad_ok"],
        "not_found_count": state["cantidad_sin_resultado"],
        "pending_retry_count": state["cantidad_pendientes_reintento"],
        "login_count": summary["login_count"],
        "output_dir": str(output_dir),
        "results_path": summary["archivo_resultados"],
        "totals_path": str(totals_path),
        "movements_path": str(movements_path or ""),
    }


def run() -> dict[str, Any]:
    input_path = Path(os.getenv("CUAD_MASIVO_INPUT_FILE", "entrada.xlsx"))
    if not input_path.is_file():
        raise ValueError("No se encontro el Excel de entrada de Consulta CUAD masivo.")

    output_dir = Path(os.getenv("CUAD_MASIVO_OUTPUT_DIR", "salida"))
    output_dir.mkdir(parents=True, exist_ok=True)
    source = entrada.cargar(
        input_path,
        os.getenv("CUAD_MASIVO_HOJA", "").strip() or None,
        os.getenv("CUAD_MASIVO_COLUMNA", "").strip() or None,
    )
    routes = corrida.RutasCorrida(
        directorio=output_dir,
        archivo_cuiles=output_dir / "cuiles_normalizados.json",
        archivo_resultados=output_dir / "resultados.ndjson",
        periodo="execution",
    )
    corrida.preparar_corrida(routes, iniciar_nueva=True)
    corrida.guardar_json(source["cuiles"], routes.archivo_cuiles)

    config = corrida.ConfigCorrida(
        limite=_positive_int("CUAD_MASIVO_LIMITE", 10),
        ritmo=corrida.Ritmo(
            demora_entre_consultas=_non_negative_float("CUAD_MASIVO_DEMORA_SECONDS", 12),
            pausa_cada=_non_negative_int("CUAD_MASIVO_PAUSA_CADA", 50),
            pausa_larga_segundos=_non_negative_float("CUAD_MASIVO_PAUSA_LARGA_SECONDS", 180),
        ),
        config_cuad=cuad.ConfigCuad(
            incluir_movimientos=_flag("CUAD_MASIVO_INCLUIR_MOVIMIENTOS", False),
        ),
    )
    session = sesion.SesionCuad(sesion.config_desde_entorno(modo_login="vision"))
    try:
        summary = corrida.procesar_reanudable(source["cuiles"], session, routes, config=config)
    finally:
        session.cerrar()

    summary["login_count"] = session.cantidad_de_logins
    totals_path, _, _ = exportar.exportar(routes.archivo_resultados, "totales")
    movements_path = None
    if config.config_cuad.incluir_movimientos:
        movements_path, _, _ = exportar.exportar(routes.archivo_resultados, "movimientos")
    return build_output_payload(
        source=source,
        summary=summary,
        output_dir=output_dir,
        totals_path=totals_path,
        movements_path=movements_path,
    )


def main() -> int:
    payload = run()
    if Kestra is not None:
        Kestra.outputs(payload)
    print(json.dumps(payload, ensure_ascii=True))
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
