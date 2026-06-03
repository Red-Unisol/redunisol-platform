from __future__ import annotations

import json
import os
import re
import sys
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any, Iterable, Optional, Sequence
from zoneinfo import ZoneInfo

import requests
import urllib3

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None


DEFAULT_BASE_URL = "https://celesol.dyndns.org:5050"
NOVEDAD_FIELDS = (
    "ID;Fecha;Texto;Creado.Descripcion;Solicitud.Oid;"
    "Solicitud.Socio.NroSocio;Solicitud.NroSocio;Solicitud.LineaPrestamo.Descripcion;"
    "Solicitud.Estado.Descripcion"
)
CLOSED_STATES = {"pagada", "abandonada", "rechazada"}
TRANSFER_START_STATE = "a transferir"
TRANSFER_END_STATE = "pagada"
FIRST_RESPONSE_EXCLUDED_LINE_KEYWORDS = ("carlos paz",)
TRANSFER_EXCLUDED_LINE_KEYWORDS = ("medica", "carlos paz")
LOCAL_TZ = ZoneInfo("America/Argentina/Buenos_Aires")


@dataclass
class NovedadEvent:
    event_id: int
    fecha: str
    texto: str
    creado_descripcion: Optional[str]
    solicitud_oid: int
    solicitud_socio_nro_raw: Optional[int]
    solicitud_nro_socio_raw: Optional[int]
    linea_descripcion: Optional[str]
    solicitud_estado_descripcion: Optional[str]
    created_at: Optional[datetime]
    parsed_state: Optional[str]
    nro_socio: Optional[int]

    @classmethod
    def from_api_row(cls, row: Sequence[Any]) -> "NovedadEvent":
        return cls(
            event_id=int(row[0]),
            fecha=str(row[1]),
            texto=row[2] or "",
            creado_descripcion=row[3],
            solicitud_oid=int(row[4]),
            solicitud_socio_nro_raw=to_int(row[5]),
            solicitud_nro_socio_raw=to_int(row[6]),
            linea_descripcion=row[7],
            solicitud_estado_descripcion=row[8],
            created_at=parse_created_description(row[3]),
            parsed_state=extract_state_from_text(row[2]),
            nro_socio=pick_nro_socio(row[5], row[6]),
        )


class EvaluateApiClient:
    def __init__(self, base_url: str, timeout: int, verify_ssl: bool):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.verify_ssl = verify_ssl
        self.session = requests.Session()
        if not verify_ssl:
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    def evaluate_list(self, cmd: str, tipo: str, campos: str, max_rows: int) -> list[list[Any]]:
        response = self.session.request(
            method="POST",
            url=f"{self.base_url}/api/Empresa/EvaluateList",
            json={"cmd": cmd, "tipo": tipo, "campos": campos, "max": max_rows},
            timeout=self.timeout,
            verify=self.verify_ssl,
            headers={"Content-Type": "application/json"},
        )
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, list):
            raise RuntimeError("EvaluateList devolvio un tipo inesperado.")
        return data


def env(name: str, default: str = "") -> str:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    return value.strip()


def require_env(name: str) -> str:
    value = env(name)
    if value == "":
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def normalize_text(value: Optional[str]) -> str:
    if value is None:
        return ""
    raw = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in raw if not unicodedata.combining(ch)).strip().lower()


def to_int(value: Optional[Any]) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def pick_nro_socio(solicitud_socio_nro: Optional[Any], solicitud_nro_socio: Optional[Any]) -> Optional[int]:
    socio_nro = to_int(solicitud_socio_nro)
    legacy_nro = to_int(solicitud_nro_socio)
    if socio_nro is not None and socio_nro > 0:
        return socio_nro
    if legacy_nro is not None and legacy_nro > 0:
        return legacy_nro
    return socio_nro if socio_nro is not None else legacy_nro


def parse_created_description(created_description: Optional[str]) -> Optional[datetime]:
    if not created_description:
        return None
    match = re.match(r"^\s*(\d{2}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2})", created_description)
    if not match:
        return None
    return datetime.strptime(match.group(1), "%d/%m/%y %H:%M:%S")


def extract_state_from_text(texto: Optional[str]) -> Optional[str]:
    if not texto:
        return None
    match = re.match(r"^\s*\[([^\]]+)\]", texto)
    if not match:
        return None
    return match.group(1).strip()


def month_start(month_value: str) -> date:
    try:
        return datetime.strptime(month_value, "%Y-%m").date().replace(day=1)
    except ValueError as exc:
        raise RuntimeError("OBJECTIVES_RUN_MONTH must use YYYY-MM format") from exc


def next_month_start(current: date) -> date:
    if current.month == 12:
        return current.replace(year=current.year + 1, month=1, day=1)
    return current.replace(month=current.month + 1, day=1)


def previous_month_value(month_value: str, offset: int) -> str:
    current = month_start(month_value)
    for _ in range(offset):
        if current.month == 1:
            current = current.replace(year=current.year - 1, month=12)
        else:
            current = current.replace(month=current.month - 1)
    return current.strftime("%Y-%m")


def daterange(start: date, end: date) -> Iterable[date]:
    current = start
    while current < end:
        yield current
        current += timedelta(days=1)


def fetch_month_novedades(
    client: EvaluateApiClient,
    month_value: str,
    per_day_max: int,
    *,
    today: date,
) -> list[NovedadEvent]:
    start = month_start(month_value)
    end = next_month_start(start)
    if start <= today < end:
        end = min(end, today + timedelta(days=1))

    events: list[NovedadEvent] = []
    for current_day in daterange(start, end):
        rows = client.evaluate_list(
            cmd=f"[Fecha] = #{current_day.isoformat()}#",
            tipo="PreSolicitud.Module.NovedadSolicitud",
            campos=NOVEDAD_FIELDS,
            max_rows=per_day_max,
        )
        if len(rows) == per_day_max:
            print(
                f"ADVERTENCIA: {current_day} alcanzo max={per_day_max}. Podria haber truncamiento.",
                file=sys.stderr,
            )
        events.extend(NovedadEvent.from_api_row(row) for row in rows)
    return events


def find_closed_solicitudes(month_events: Sequence[NovedadEvent]) -> list[int]:
    closed: set[int] = set()
    for event in month_events:
        if normalize_text(event.parsed_state) in CLOSED_STATES:
            closed.add(event.solicitud_oid)
    return sorted(closed)


def chunked(values: Sequence[int], size: int) -> Iterable[list[int]]:
    for index in range(0, len(values), size):
        yield list(values[index : index + size])


def fetch_full_history_for_solicitudes(
    client: EvaluateApiClient,
    solicitud_oids: Sequence[int],
    per_query_max: int,
    batch_size: int = 200,
) -> list[NovedadEvent]:
    if not solicitud_oids:
        return []

    all_rows: list[Sequence[Any]] = []

    def fetch_batch(batch_oids: list[int]) -> None:
        rows = client.evaluate_list(
            cmd=f"[Solicitud.Oid] In ({','.join(str(value) for value in batch_oids)})",
            tipo="PreSolicitud.Module.NovedadSolicitud",
            campos=NOVEDAD_FIELDS,
            max_rows=per_query_max,
        )
        if len(rows) >= per_query_max and len(batch_oids) > 1:
            middle = len(batch_oids) // 2
            fetch_batch(batch_oids[:middle])
            fetch_batch(batch_oids[middle:])
            return
        if len(rows) >= per_query_max:
            print(
                f"ADVERTENCIA: solicitud {batch_oids[0]} alcanzo max={per_query_max}. Podria faltar historial.",
                file=sys.stderr,
            )
        all_rows.extend(rows)

    for batch in chunked(list(solicitud_oids), batch_size):
        fetch_batch(batch)

    dedup: dict[int, NovedadEvent] = {}
    for row in all_rows:
        event = NovedadEvent.from_api_row(row)
        dedup[event.event_id] = event
    return list(dedup.values())


def business_seconds_between(start_dt: datetime, end_dt: datetime) -> float:
    if end_dt <= start_dt:
        return 0.0
    work_start = time(8, 0, 0)
    work_end = time(17, 0, 0)
    total_seconds = 0.0
    current_day = start_dt.date()
    end_day = end_dt.date()
    while current_day <= end_day:
        if current_day.weekday() >= 5:
            current_day += timedelta(days=1)
            continue
        day_start = datetime.combine(current_day, work_start)
        day_end = datetime.combine(current_day, work_end)
        interval_start = max(start_dt, day_start)
        interval_end = min(end_dt, day_end)
        if interval_end > interval_start:
            total_seconds += (interval_end - interval_start).total_seconds()
        current_day += timedelta(days=1)
    return total_seconds


def events_by_solicitud(events: Sequence[NovedadEvent]) -> dict[int, list[NovedadEvent]]:
    grouped: dict[int, list[NovedadEvent]] = {}
    for event in events:
        grouped.setdefault(event.solicitud_oid, []).append(event)
    return grouped


def sorted_state_events(items: Sequence[NovedadEvent]) -> list[NovedadEvent]:
    events = [event for event in items if event.created_at is not None and event.parsed_state]
    events.sort(key=lambda event: (event.created_at, event.event_id))
    return events


def compute_first_response_minutes(events: Sequence[NovedadEvent]) -> list[float]:
    values: list[float] = []
    for items in events_by_solicitud(events).values():
        state_events = sorted_state_events(items)
        first_rr_index = next(
            (
                index
                for index, event in enumerate(state_events)
                if normalize_text(event.parsed_state) == "revisionriesgo"
            ),
            None,
        )
        if first_rr_index is None:
            continue
        first_rr_event = state_events[first_rr_index]
        if is_excluded_line(first_rr_event.linea_descripcion, FIRST_RESPONSE_EXCLUDED_LINE_KEYWORDS):
            continue
        response_event = next(
            (
                event
                for event in state_events[first_rr_index + 1 :]
                if normalize_text(event.parsed_state) != "revisionriesgo"
            ),
            None,
        )
        if response_event is None:
            continue
        values.append(business_seconds_between(first_rr_event.created_at, response_event.created_at) / 60.0)
    return values


def is_excluded_line(linea: Optional[str], keywords: Sequence[str]) -> bool:
    normalized = normalize_text(linea)
    return any(keyword in normalized for keyword in keywords)


def compute_transfer_minutes(events: Sequence[NovedadEvent]) -> list[float]:
    values: list[float] = []
    for items in events_by_solicitud(events).values():
        with_datetime = [event for event in items if event.created_at is not None]
        if not with_datetime:
            continue
        paid_currently = any(
            normalize_text(event.solicitud_estado_descripcion) == TRANSFER_END_STATE
            for event in items
        )
        if not paid_currently:
            continue
        linea = next((event.linea_descripcion for event in with_datetime if event.linea_descripcion), None)
        if is_excluded_line(linea, TRANSFER_EXCLUDED_LINE_KEYWORDS):
            continue
        transfer_events = [
            event for event in with_datetime if normalize_text(event.parsed_state) == TRANSFER_START_STATE
        ]
        paid_events = [
            event for event in with_datetime if normalize_text(event.parsed_state) == TRANSFER_END_STATE
        ]
        if not transfer_events or not paid_events:
            continue
        last_paid = max(paid_events, key=lambda event: (event.created_at, event.event_id))
        transfer_before_last_paid = [
            event for event in transfer_events if event.created_at <= last_paid.created_at
        ]
        if not transfer_before_last_paid:
            continue
        transfer_for_measure = max(
            transfer_before_last_paid,
            key=lambda event: (event.created_at, event.event_id),
        )
        values.append(business_seconds_between(transfer_for_measure.created_at, last_paid.created_at) / 60.0)
    return values


def average(values: Sequence[float]) -> Optional[float]:
    if not values:
        return None
    return sum(values) / len(values)


def classify_state(actual: Optional[float], target: Optional[float], yellow_threshold_pct: float) -> str:
    if actual is None or target is None or target <= 0:
        return "neutral"
    if actual <= target:
        return "verde"
    if actual <= target * (1 + yellow_threshold_pct / 100):
        return "amarillo"
    return "rojo"


def metric_payload(
    *,
    metric_id: str,
    name: str,
    current_values: Sequence[float],
    target_values: Sequence[float],
    yellow_threshold_pct: float,
) -> dict[str, Any]:
    actual = average(current_values)
    target = average(target_values)
    delta_pct = None
    if actual is not None and target is not None and target > 0:
        delta_pct = ((actual - target) / target) * 100
    return {
        "id": metric_id,
        "nombre": name,
        "actual_min": actual,
        "objetivo_min": target,
        "delta_pct": delta_pct,
        "casos": len(current_values),
        "casos_objetivo": len(target_values),
        "estado": classify_state(actual, target, yellow_threshold_pct),
    }


def fetch_history_by_month(
    client: EvaluateApiClient,
    months: Sequence[str],
    per_day_max: int,
    *,
    today: date,
) -> dict[str, list[NovedadEvent]]:
    history_by_month: dict[str, list[NovedadEvent]] = {}
    for month_value in months:
        print(f"Extrayendo {month_value}")
        month_events = fetch_month_novedades(client, month_value, per_day_max, today=today)
        closed_oids = find_closed_solicitudes(month_events)
        print(f"- solicitudes cerradas: {len(closed_oids)}")
        history = fetch_full_history_for_solicitudes(client, closed_oids, per_query_max=per_day_max)
        print(f"- novedades historicas: {len(history)}")
        history_by_month[month_value] = history
    return history_by_month


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(path)


def set_kestra_outputs(values: dict[str, Any]) -> None:
    if Kestra is not None:
        Kestra.outputs(values)
        return
    for name, value in values.items():
        print(f"::{name}::{value}")


def build_snapshot() -> tuple[Path, dict[str, Any]]:
    now = datetime.now(LOCAL_TZ)
    run_month = env("OBJECTIVES_RUN_MONTH", now.strftime("%Y-%m"))
    target_months = [previous_month_value(run_month, offset) for offset in (3, 2, 1)]
    months_to_fetch = [*target_months, run_month]

    client = EvaluateApiClient(
        base_url=env("REPORTE_EVALUACION_BASE_URL", DEFAULT_BASE_URL),
        timeout=int(env("REPORTE_EVALUACION_TIMEOUT_SECONDS", "60")),
        verify_ssl=env("REPORTE_EVALUACION_VERIFY_SSL", "false").lower() == "true",
    )
    per_day_max = int(env("REPORTE_EVALUACION_PER_DAY_MAX", "20000"))
    history_by_month = fetch_history_by_month(client, months_to_fetch, per_day_max, today=now.date())

    current_history = history_by_month[run_month]
    target_history = [
        event
        for month_value in target_months
        for event in history_by_month.get(month_value, [])
    ]

    yellow_threshold_pct = float(env("OBJECTIVES_YELLOW_THRESHOLD_PCT", "15"))
    snapshot = {
        "ok": True,
        "periodo_actual": run_month,
        "periodo_objetivo": {
            "meses": target_months,
            "descripcion": "Promedio ponderado por caso de los ultimos 3 meses cerrados",
        },
        "actualizado_en": now.isoformat(),
        "reglas": {
            "primera_respuesta": "desde primera RevisionRiesgo hasta primer cambio de estado posterior, solo horario laboral lunes a viernes 08:00-17:00",
            "transferencia": "ultimo Pagada y A Transferir inmediatamente anterior, solo horario laboral lunes a viernes 08:00-17:00",
            "lineas_excluidas_primera_respuesta": list(FIRST_RESPONSE_EXCLUDED_LINE_KEYWORDS),
            "lineas_excluidas_transferencia": list(TRANSFER_EXCLUDED_LINE_KEYWORDS),
        },
        "thresholds": {
            "verde": "actual <= objetivo",
            "amarillo": f"actual <= objetivo + {yellow_threshold_pct:g}%",
            "rojo": f"actual > objetivo + {yellow_threshold_pct:g}%",
        },
        "metricas": [
            metric_payload(
                metric_id="first_response",
                name="Tiempo de Primera Respuesta",
                current_values=compute_first_response_minutes(current_history),
                target_values=compute_first_response_minutes(target_history),
                yellow_threshold_pct=yellow_threshold_pct,
            ),
            metric_payload(
                metric_id="transfer",
                name="Tiempo de Transferencia",
                current_values=compute_transfer_minutes(current_history),
                target_values=compute_transfer_minutes(target_history),
                yellow_threshold_pct=yellow_threshold_pct,
            ),
        ],
    }

    output_path = Path(env("OBJECTIVES_DASHBOARD_SNAPSHOT_PATH", "/data/reporte-evaluacion/dashboard/latest.json"))
    return output_path, snapshot


def main() -> int:
    try:
        output_path, snapshot = build_snapshot()
        atomic_write_json(output_path, snapshot)
        set_kestra_outputs(
            {
                "ok": True,
                "snapshot_path": str(output_path),
                "periodo_actual": snapshot["periodo_actual"],
                "metricas_json": json.dumps(snapshot["metricas"], ensure_ascii=False),
            }
        )
        print(f"Snapshot generado: {output_path}")
        return 0
    except Exception as exc:
        set_kestra_outputs({"ok": False, "error": str(exc)})
        raise


if __name__ == "__main__":
    raise SystemExit(main())
