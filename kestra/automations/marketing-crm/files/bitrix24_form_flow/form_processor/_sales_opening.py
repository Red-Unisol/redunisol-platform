"""Closed sales windows and the durable queue reason shared with the web chat linker."""

from datetime import datetime, timezone


WAIT_FOR_OPENING = "waiting_for_sales_opening"
QUEUE_COHORT_REASONS = {WAIT_FOR_OPENING, "assignment_queued", "routing_pool_paused"}


def sales_closed_window(now: datetime, settings: dict | None) -> dict | None:
    # Loaded only by the two commercial routing flows. Other flows share this package.
    from edna_incoming.out_of_hours import calendar

    if not isinstance(settings, dict):
        raise RuntimeError("No se recibió el calendario comercial vigente.")
    return calendar(now, settings)


def encode_queue_reason(state: str, commercial_reason: str, enqueued_at: datetime, window: dict | None) -> str:
    if state == WAIT_FOR_OPENING:
        if window is None:
            raise ValueError("Falta la próxima apertura de Ventas.")
        start = max(enqueued_at, datetime.fromisoformat(window["window_start"]))
        return "|".join((state, start.astimezone(timezone.utc).isoformat(), window["window_end"], commercial_reason))
    return f"{state}|{commercial_reason}"


def queue_marker_sleeping(raw: object, now: datetime) -> bool:
    parts = str(raw or "").split("|", 3)
    if len(parts) != 4 or parts[0] != WAIT_FOR_OPENING or not parts[3]:
        return False
    try:
        start, opening = (datetime.fromisoformat(value) for value in parts[1:3])
        return start <= now < opening
    except (ValueError, TypeError):
        return False


def decode_queue_reason(raw: str) -> tuple[str, str]:
    """Unmarked records retain the historical weekly policy and their commercial reason."""
    state, separator, remainder = raw.partition("|")
    if not separator or state not in QUEUE_COHORT_REASONS:
        return "", raw
    if state == WAIT_FOR_OPENING:
        dates = remainder.split("|", 2)
        if len(dates) != 3:
            return "invalid_queue_marker", raw
        return state, dates[2]
    return state, remainder
