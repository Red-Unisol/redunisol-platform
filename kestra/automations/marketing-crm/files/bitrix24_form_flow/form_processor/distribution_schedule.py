from __future__ import annotations

from datetime import datetime, time
from zoneinfo import ZoneInfo

BUSINESS_HOURS_TIMEZONE_ENV = "BITRIX24_DISTRIBUTION_TIMEZONE"
BUSINESS_HOURS_WORKDAYS_ENV = "BITRIX24_DISTRIBUTION_WORKDAYS"
BUSINESS_HOURS_FROM_ENV = "BITRIX24_DISTRIBUTION_FROM"
BUSINESS_HOURS_TO_ENV = "BITRIX24_DISTRIBUTION_TO"
WEEKDAY_CODES = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


def is_within_business_hours(
    source: dict[str, str],
    now: datetime | None = None,
) -> bool:
    timezone = ZoneInfo(
        str(source.get(BUSINESS_HOURS_TIMEZONE_ENV, "America/Argentina/Cordoba")).strip()
    )
    local_now = now.astimezone(timezone) if now is not None else datetime.now(timezone)
    workdays = list(
        dict.fromkeys(
            WEEKDAY_CODES[code.strip()]
            for code in str(source.get(BUSINESS_HOURS_WORKDAYS_ENV, "MO,TU,WE,TH,FR"))
            .upper()
            .split(",")
            if code.strip() in WEEKDAY_CODES
        )
    )
    starts_at = time.fromisoformat(str(source.get(BUSINESS_HOURS_FROM_ENV, "00:00")))
    ends_at = time.fromisoformat(str(source.get(BUSINESS_HOURS_TO_ENV, "17:00")))
    local_time = local_now.time().replace(tzinfo=None)
    weekday = local_now.weekday()

    if weekday not in workdays:
        return False
    if len(workdays) == 1:
        return starts_at <= local_time < ends_at
    if weekday == workdays[0]:
        return local_time >= starts_at
    if weekday == workdays[-1]:
        return local_time < ends_at
    return True

