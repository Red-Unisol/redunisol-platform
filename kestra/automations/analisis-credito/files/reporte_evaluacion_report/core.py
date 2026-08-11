from __future__ import annotations

import json
import re
import sys
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence

import requests
import urllib3

DEFAULT_BASE_URL = ""
TRANSFER_START_STATE = "a transferir"
TRANSFER_END_STATE = "pagada"
ANALYSIS_EXCLUDED_LINE_KEYWORDS = ("carlos paz",)
EXCLUDED_LINE_KEYWORDS = ("medica", "carlos paz")
CLOSED_STATES = {"pagada", "abandonada", "rechazada"}
NOVEDAD_FIELDS = (
    "ID;Fecha;Texto;Creado.Descripcion;Solicitud.Oid;"
    "Solicitud.Socio.NroSocio;Solicitud.NroSocio;Solicitud.LineaPrestamo.Descripcion;"
    "Solicitud.Estado.Descripcion"
)
MONTH_NAMES_ES = {
    1: "Enero",
    2: "Febrero",
    3: "Marzo",
    4: "Abril",
    5: "Mayo",
    6: "Junio",
    7: "Julio",
    8: "Agosto",
    9: "Septiembre",
    10: "Octubre",
    11: "Noviembre",
    12: "Diciembre",
}
MONTH_NAMES_SHORT_ES = {
    1: "Ene",
    2: "Feb",
    3: "Mar",
    4: "Abr",
    5: "May",
    6: "Jun",
    7: "Jul",
    8: "Ago",
    9: "Sep",
    10: "Oct",
    11: "Nov",
    12: "Dic",
}

LogFn = Callable[[str], None]


def normalize_text(value: Optional[str]) -> str:
    if value is None:
        return ""
    raw = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in raw if not unicodedata.combining(ch)).strip().lower()


def month_start_end(month_value: str) -> tuple[date, date]:
    try:
        start = datetime.strptime(month_value, "%Y-%m").date().replace(day=1)
    except ValueError as exc:
        raise ValueError("Formato de mes invalido. Usar YYYY-MM.") from exc

    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1, day=1)
    else:
        end = start.replace(month=start.month + 1, day=1)
    return start, end


def next_month_start(current: date) -> date:
    if current.month == 12:
        return current.replace(year=current.year + 1, month=1, day=1)
    return current.replace(month=current.month + 1, day=1)


def build_month_sequence(from_month: str, to_month: str) -> List[str]:
    start, _ = month_start_end(from_month)
    end, _ = month_start_end(to_month)
    if end < start:
        raise ValueError("El mes final no puede ser anterior al mes inicial.")

    values: List[str] = []
    current = start
    while current <= end:
        values.append(current.strftime("%Y-%m"))
        current = next_month_start(current)
    return values


def resolve_report_months(
    month: Optional[str],
    from_month: Optional[str],
    to_month: Optional[str],
) -> List[str]:
    if month:
        if from_month or to_month:
            raise ValueError("Usar --month o --from-month/--to-month, pero no ambos.")
        return [month]

    if not from_month or not to_month:
        raise ValueError("Informar --month o bien --from-month y --to-month.")

    return build_month_sequence(from_month, to_month)


def format_month_label(month_value: str, short: bool = False) -> str:
    start, _ = month_start_end(month_value)
    names = MONTH_NAMES_SHORT_ES if short else MONTH_NAMES_ES
    return f"{names[start.month]} {start.year}"


def format_period_label(month_values: Sequence[str]) -> str:
    if not month_values:
        return ""
    if len(month_values) == 1:
        return format_month_label(month_values[0])
    return f"{format_month_label(month_values[0])} a {format_month_label(month_values[-1])}"


def derive_month_seed(base_seed: int, month_value: str) -> int:
    return base_seed + int(month_value.replace("-", ""))


def daterange(start: date, end: date) -> Iterable[date]:
    current = start
    while current < end:
        yield current
        current += timedelta(days=1)


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


def extract_user_from_created_description(created_description: Optional[str]) -> Optional[str]:
    if not created_description:
        return None
    match = re.match(r"^\s*\d{2}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2}\s*(.*)$", created_description)
    if not match:
        return None
    user = match.group(1).strip()
    return user or None


def _to_int(value: Optional[Any]) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def pick_nro_socio(
    solicitud_socio_nro: Optional[Any],
    solicitud_nro_socio: Optional[Any],
) -> Optional[int]:
    socio_nro = _to_int(solicitud_socio_nro)
    legacy_nro = _to_int(solicitud_nro_socio)

    if socio_nro is not None and socio_nro > 0:
        return socio_nro
    if legacy_nro is not None and legacy_nro > 0:
        return legacy_nro
    if socio_nro is not None:
        return socio_nro
    return legacy_nro


def _chunked(values: Sequence[int], size: int) -> Iterable[List[int]]:
    for index in range(0, len(values), size):
        yield list(values[index : index + size])


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
    usuario_evento: Optional[str]
    nro_socio: Optional[int]
    raw_payload: Optional[str] = None

    @classmethod
    def from_api_row(cls, row: Sequence[Any]) -> "NovedadEvent":
        return cls(
            event_id=int(row[0]),
            fecha=str(row[1]),
            texto=row[2] or "",
            creado_descripcion=row[3],
            solicitud_oid=int(row[4]),
            solicitud_socio_nro_raw=_to_int(row[5]),
            solicitud_nro_socio_raw=_to_int(row[6]),
            linea_descripcion=row[7],
            solicitud_estado_descripcion=row[8],
            created_at=parse_created_description(row[3]),
            parsed_state=extract_state_from_text(row[2]),
            usuario_evento=extract_user_from_created_description(row[3]),
            nro_socio=pick_nro_socio(row[5], row[6]),
            raw_payload=json.dumps(list(row), ensure_ascii=False),
        )


@dataclass
class MonthDataset:
    month_value: str
    month_label: str
    sample_seed: int
    month_events: List[NovedadEvent]
    closed_solicitud_oids: List[int]
    history_events: List[NovedadEvent]


@dataclass
class MonthlyReport:
    month_value: str
    month_label: str
    sample_seed: int
    summary: Dict[str, Any]
    base_rows: List[Dict[str, Any]]
    first_response: List[Dict[str, Any]]
    transfer: List[Dict[str, Any]]
    end_to_end: List[Dict[str, Any]]
    end_to_end_by_final_status: List[Dict[str, Any]]
    legajos_sample: List[Dict[str, Any]]


@dataclass
class DatasetMeta:
    created_at: datetime
    effective_seed: int
    base_url: str
    per_day_max: int
    verify_ssl: bool
    month_values: List[str]


class EvaluateApiClient:
    def __init__(self, base_url: str, timeout: int = 60, verify_ssl: bool = False):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.verify_ssl = verify_ssl
        self.session = requests.Session()
        if not verify_ssl:
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    def _request(self, method: str, endpoint: str, payload: Dict[str, Any]) -> Any:
        response = self.session.request(
            method=method,
            url=f"{self.base_url}{endpoint}",
            json=payload,
            timeout=self.timeout,
            verify=self.verify_ssl,
            headers={"Content-Type": "application/json"},
        )
        response.raise_for_status()
        return response.json()

    def evaluate(self, cmd: str) -> Any:
        return self._request("GET", "/api/Empresa/Evaluate", {"cmd": cmd})

    def evaluate_list(self, cmd: str, tipo: str, campos: str, max_rows: int = 20000) -> List[list]:
        data = self._request(
            "POST",
            "/api/Empresa/EvaluateList",
            {"cmd": cmd, "tipo": tipo, "campos": campos, "max": max_rows},
        )
        if not isinstance(data, list):
            raise ValueError("EvaluateList devolvio un tipo inesperado.")
        return data


def run_manual_checks(client: EvaluateApiClient, month_value: str, max_preview: int) -> None:
    start, end = month_start_end(month_value)
    first_day = start.isoformat()
    print(f"Base URL: {client.base_url}")
    print(f"Mes de prueba: {start} a {end - timedelta(days=1)}")

    checks = [
        ("Count NovedadSolicitud", "[<PreSolicitud.Module.NovedadSolicitud>].Count()"),
        ("Count Solicitud", "[<PreSolicitud.Module.Solicitud>].Count()"),
        ("Count EstadoSolicitud", "[<PreSolicitud.Module.EstadoSolicitud>].Count()"),
    ]
    for label, expr in checks:
        print(f"- {label}: {client.evaluate(expr)}")

    estado_rows = client.evaluate_list(
        cmd="True",
        tipo="PreSolicitud.Module.EstadoSolicitud",
        campos="ID;Descripcion",
        max_rows=100,
    )
    print("\nEstados conocidos (ID, Descripcion):")
    for row in estado_rows:
        print(f"  {row[0]} -> {row[1]}")

    novedad_rows = client.evaluate_list(
        cmd=f"[Fecha] = #{first_day}#",
        tipo="PreSolicitud.Module.NovedadSolicitud",
        campos=NOVEDAD_FIELDS,
        max_rows=max_preview,
    )
    print(f"\nNovedades de muestra para {first_day} (max={max_preview}):")
    for row in novedad_rows:
        print(json.dumps(row, ensure_ascii=False))

    transfer_rows = client.evaluate_list(
        cmd=f"[Fecha] = #{first_day}# AND [Texto] Like '%Transferir%'",
        tipo="PreSolicitud.Module.NovedadSolicitud",
        campos="ID;Texto;Creado.Descripcion;Solicitud.Oid;Solicitud.LineaPrestamo.Descripcion",
        max_rows=max_preview,
    )
    print(f"\nEventos con 'Transferir' ({first_day}, max={max_preview}):")
    for row in transfer_rows:
        print(json.dumps(row, ensure_ascii=False))


def fetch_month_novedades(client: EvaluateApiClient, month_value: str, per_day_max: int) -> List[NovedadEvent]:
    start, end = month_start_end(month_value)
    events: List[NovedadEvent] = []

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


def find_closed_solicitudes(month_events: Sequence[NovedadEvent]) -> List[int]:
    closed: set[int] = set()
    for event in month_events:
        if normalize_text(event.parsed_state) in CLOSED_STATES:
            closed.add(event.solicitud_oid)
    return sorted(closed)


def fetch_full_history_for_solicitudes(
    client: EvaluateApiClient,
    solicitud_oids: Sequence[int],
    per_query_max: int,
    batch_size: int = 200,
) -> List[NovedadEvent]:
    if not solicitud_oids:
        return []

    all_rows: List[Sequence[Any]] = []

    def fetch_batch(batch_oids: List[int]) -> None:
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

        if len(rows) >= per_query_max and len(batch_oids) == 1:
            print(
                f"ADVERTENCIA: solicitud {batch_oids[0]} alcanzo max={per_query_max}. Podria faltar historial.",
                file=sys.stderr,
            )
        all_rows.extend(rows)

    for batch in _chunked(list(solicitud_oids), batch_size):
        fetch_batch(batch)

    dedup: Dict[int, NovedadEvent] = {}
    for row in all_rows:
        event = NovedadEvent.from_api_row(row)
        dedup[event.event_id] = event
    return list(dedup.values())


def fetch_month_dataset(
    client: EvaluateApiClient,
    month_value: str,
    *,
    sample_seed: int,
    per_day_max: int,
    log: LogFn = print,
) -> MonthDataset:
    month_label = format_month_label(month_value)
    log(f"\nExtrayendo {month_label} ({month_value})")
    month_events = fetch_month_novedades(client, month_value, per_day_max=per_day_max)
    log(f"- Novedades descargadas del mes: {len(month_events)}")

    closed_oids = find_closed_solicitudes(month_events)
    log(f"- Solicitudes cerradas en mes ({', '.join(sorted(CLOSED_STATES))}): {len(closed_oids)}")

    history_events = fetch_full_history_for_solicitudes(
        client,
        solicitud_oids=closed_oids,
        per_query_max=per_day_max,
    )
    log(f"- Novedades historicas descargadas: {len(history_events)}")

    return MonthDataset(
        month_value=month_value,
        month_label=month_label,
        sample_seed=sample_seed,
        month_events=month_events,
        closed_solicitud_oids=closed_oids,
        history_events=history_events,
    )
