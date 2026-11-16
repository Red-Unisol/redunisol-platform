from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache

import holidays


@lru_cache(maxsize=16)
def national_holidays(year: int) -> frozenset[date]:
    """Same mandatory national holiday policy as the other management reports."""
    calendar = holidays.AR(
        years=[year], language="es", categories=[holidays.PUBLIC], expand=False
    )
    days = {
        day
        for day, label in calendar.items()
        if any(
            name != "Jueves Santo"
            and not (year >= 2025 and name == "Feriado con fines turísticos")
            for name in label.split("; ")
        )
    }
    # Exceptional transfer not included in holidays 0.104 (Resolucion 139/2025).
    if year == 2025:
        days.discard(date(2025, 10, 12))
        days.add(date(2025, 10, 10))
    if year == 2026:
        # Exceptional national holiday, confirmed in the official 2026 calendar:
        # https://www.bcra.gob.ar/consulta-feriados-bancarios/
        # November 10 is banking/provincial only, outside the agreed policy.
        days.add(date(2026, 11, 9))
    return frozenset(days)


def next_business_day(day: date) -> date:
    while day.weekday() >= 5 or day in national_holidays(day.year):
        day += timedelta(days=1)
    return day


def consultation_dates(year: int, month: int) -> frozenset[date]:
    """First business day, then Mondays strictly after it, rolling holidays forward.

    Weekly anchors stay on Mondays: a Tuesday run never shifts the following week.
    The final Monday may roll into the next month.
    """
    first = next_business_day(date(year, month, 1))
    result = {first}
    monday = first + timedelta(days=(7 - first.weekday()) % 7 or 7)
    while (monday.year, monday.month) == (year, month):
        result.add(next_business_day(monday))
        monday += timedelta(days=7)
    return frozenset(result)


def is_consultation_date(day: date) -> bool:
    previous_month = day.replace(day=1) - timedelta(days=1)
    # Include rolled Mondays from the previous month and deduplicate collisions.
    return day in consultation_dates(day.year, day.month) or day in consultation_dates(
        previous_month.year, previous_month.month
    )
