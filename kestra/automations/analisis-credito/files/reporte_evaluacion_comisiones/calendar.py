from __future__ import annotations

from datetime import date
from typing import Iterable

import holidays

CALENDAR_VERSION = "AR-obligatorios-2026-09-08"
CALENDAR_DESCRIPTION = (
    "Lunes a viernes 08:00-17:00, excluyendo feriados nacionales obligatorios. "
    "Los dias no laborables turisticos y Jueves Santo se trabajan, salvo coincidencia "
    "con un feriado obligatorio. Sin feriados provinciales ni locales."
)
SOURCES = (
    "https://www.argentina.gob.ar/normativa/nacional/ley-27399-281835/texto",
    "https://www.argentina.gob.ar/normativa/nacional/norma-417061/texto",
    "https://www.argentina.gob.ar/normativa/nacional/norma-421799/texto",
)


def national_holidays(years: Iterable[int]) -> dict[date, str]:
    years = sorted(set(years))
    # Los traslados excepcionales y las declaraciones anuales requieren revision.
    # No publicar una liquidacion con un calendario futuro supuesto.
    if any(year < 2017 or year > 2026 for year in years):
        raise ValueError("Calendario nacional validado para 2017-2026; actualizar antes de liquidar otro anio.")
    if holidays.__version__ != "0.104":
        raise RuntimeError("El calendario requiere holidays==0.104 para mantener resultados reproducibles.")
    calendar = holidays.AR(years=years, language="es", categories=[holidays.PUBLIC], expand=False)
    result = {}
    for day, label in calendar.items():
        # PUBLIC tambien incluye dias optativos. Filtrar cada nombre, conservando
        # el feriado obligatorio si comparte fecha (Malvinas / Jueves Santo 2026).
        names = [
            name for name in label.split("; ")
            if name != "Jueves Santo"
            and not (day.year >= 2025 and name == "Feriado con fines turísticos")
        ]
        if names:
            result[day] = "; ".join(names)
    # Resolucion 139/2025: excepcion aun no incorporada en holidays 0.104.
    if 2025 in years:
        label = result.pop(date(2025, 10, 12))
        result[date(2025, 10, 10)] = label
    return dict(sorted(result.items()))
