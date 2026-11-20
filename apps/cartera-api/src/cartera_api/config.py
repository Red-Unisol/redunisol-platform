"""Configuración por variables de entorno."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

# Proveedores de Vimarx (F.Module.ProveedorPrestamo.Nombre) que entran en la cartera.
# Un valor terminado en % se compara con Like (prefijo).
DEFAULT_PROVEEDORES = ["SANCOR%", "M SANATORIO SANTA FE", "MEDICA ROSARIO"]

# Porcentaje de participación de la mutual por proveedor. No sale de Vimarx.
# Gana la regla más específica: nombre exacto antes que prefijo.
DEFAULT_PARTICIPACION = {
    "SANCOR 20 PLAN DESEN": 0.5705,
    "SANCOR%": 0.5,
}


@dataclass(frozen=True)
class Settings:
    vimarx_base_url: str
    db_path: str
    proveedores: list[str] = field(default_factory=lambda: list(DEFAULT_PROVEEDORES))
    participacion: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_PARTICIPACION))
    lote_prestamos: int = 100
    timeout_segundos: int = 120


def load_settings() -> Settings:
    base = os.getenv("VIMARX_EVAL_BASE_URL", "").strip().rstrip("/")
    if not base:
        raise RuntimeError("Falta VIMARX_EVAL_BASE_URL.")
    proveedores = _json_env("CARTERA_PROVEEDORES", DEFAULT_PROVEEDORES)
    participacion = _json_env("CARTERA_PARTICIPACION", DEFAULT_PARTICIPACION)
    return Settings(
        vimarx_base_url=base,
        db_path=os.getenv("CARTERA_DB_PATH", "/data/cartera/cartera.sqlite"),
        proveedores=list(proveedores),
        participacion={str(k): float(v) for k, v in dict(participacion).items()},
        lote_prestamos=int(os.getenv("CARTERA_LOTE_PRESTAMOS", "100")),
        timeout_segundos=int(os.getenv("CARTERA_TIMEOUT_SEGUNDOS", "120")),
    )


def _json_env(name: str, default):
    raw = os.getenv(name, "").strip()
    return json.loads(raw) if raw else default


def participacion_para(proveedor: str | None, reglas: dict[str, float]) -> float | None:
    if not proveedor:
        return None
    nombre = proveedor.strip()
    if nombre in reglas:
        return reglas[nombre]
    mejor: tuple[int, float] | None = None
    for patron, valor in reglas.items():
        if patron.endswith("%") and nombre.startswith(patron[:-1]):
            if mejor is None or len(patron) > mejor[0]:
                mejor = (len(patron), valor)
    return mejor[1] if mejor else None
