from __future__ import annotations

import random
import statistics
from datetime import datetime, time, timedelta
from typing import Any, Dict, List, Optional, Sequence

from .core import (
    ANALYSIS_EXCLUDED_LINE_KEYWORDS,
    CLOSED_STATES,
    EXCLUDED_LINE_KEYWORDS,
    TRANSFER_END_STATE,
    TRANSFER_START_STATE,
    LogFn,
    MonthDataset,
    MonthlyReport,
    NovedadEvent,
    normalize_text,
)


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


def sorted_state_events(items: Sequence[NovedadEvent]) -> List[NovedadEvent]:
    events = [event for event in items if event.created_at is not None and event.parsed_state]
    events.sort(key=lambda event: (event.created_at, event.event_id))
    return events


def find_final_closed_event(items: Sequence[NovedadEvent]) -> Optional[NovedadEvent]:
    closed_events = [
        event
        for event in sorted_state_events(items)
        if normalize_text(event.parsed_state) in CLOSED_STATES
    ]
    if not closed_events:
        return None
    return closed_events[-1]


def normalize_final_status_label(value: Optional[str]) -> str:
    normalized = normalize_text(value)
    return normalized or "sin_estado"


def display_final_status_label(value: Optional[str]) -> str:
    normalized = normalize_text(value)
    if not normalized:
        return "Sin estado"
    return normalized.title()


def compute_first_response_metrics(events_by_solicitud: Dict[int, List[NovedadEvent]]) -> List[Dict[str, Any]]:
    details: List[Dict[str, Any]] = []
    for solicitud_oid, items in events_by_solicitud.items():
        state_events = sorted_state_events(items)
        if not state_events:
            continue

        first_rr_index = None
        for index, event in enumerate(state_events):
            if normalize_text(event.parsed_state) == "revisionriesgo":
                first_rr_index = index
                break
        if first_rr_index is None:
            continue

        first_rr_event = state_events[first_rr_index]
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

        details.append(
            {
                "solicitud_oid": solicitud_oid,
                "nro_socio": first_rr_event.nro_socio,
                "linea": first_rr_event.linea_descripcion,
                "revision_riesgo_inicio": first_rr_event.created_at,
                "primera_respuesta": response_event.created_at,
                "estado_primera_respuesta": response_event.parsed_state,
                "minutos": business_seconds_between(first_rr_event.created_at, response_event.created_at) / 60.0,
            }
        )
    return details


def is_excluded_line(linea: Optional[str]) -> bool:
    normalized = normalize_text(linea)
    return any(keyword in normalized for keyword in EXCLUDED_LINE_KEYWORDS)


def is_analysis_excluded_line(linea: Optional[str]) -> bool:
    normalized = normalize_text(linea)
    return any(keyword in normalized for keyword in ANALYSIS_EXCLUDED_LINE_KEYWORDS)


def is_analysis_excluded_solicitud(items: Sequence[NovedadEvent]) -> bool:
    return any(is_analysis_excluded_line(event.linea_descripcion) for event in items)


def compute_transfer_metrics(events_by_solicitud: Dict[int, List[NovedadEvent]]) -> List[Dict[str, Any]]:
    details: List[Dict[str, Any]] = []
    for solicitud_oid, items in events_by_solicitud.items():
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
        if is_excluded_line(linea):
            continue

        transfer_events = [
            event
            for event in with_datetime
            if normalize_text(event.parsed_state) == TRANSFER_START_STATE
        ]
        paid_events = [
            event
            for event in with_datetime
            if normalize_text(event.parsed_state) == TRANSFER_END_STATE
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
        business_minutes = business_seconds_between(
            transfer_for_measure.created_at,
            last_paid.created_at,
        ) / 60.0
        if business_minutes < 0:
            continue

        details.append(
            {
                "solicitud_oid": solicitud_oid,
                "nro_socio": transfer_for_measure.nro_socio,
                "linea": linea,
                "a_transferir": transfer_for_measure.created_at,
                "pagada": last_paid.created_at,
                "minutos": business_minutes,
            }
        )
    return details


def compute_end_to_end_metrics(events_by_solicitud: Dict[int, List[NovedadEvent]]) -> List[Dict[str, Any]]:
    details: List[Dict[str, Any]] = []
    for solicitud_oid, items in events_by_solicitud.items():
        state_events = sorted_state_events(items)
        if not state_events:
            continue

        start_event = state_events[0]
        final_event = find_final_closed_event(items)
        if final_event is None or start_event.created_at is None or final_event.created_at is None:
            continue

        business_minutes = business_seconds_between(start_event.created_at, final_event.created_at) / 60.0
        if business_minutes < 0:
            continue

        details.append(
            {
                "solicitud_oid": solicitud_oid,
                "nro_socio": start_event.nro_socio or final_event.nro_socio,
                "linea": start_event.linea_descripcion or final_event.linea_descripcion,
                "inicio_proceso": start_event.created_at,
                "fin_proceso": final_event.created_at,
                "estado_final": display_final_status_label(final_event.parsed_state),
                "estado_final_norm": normalize_final_status_label(final_event.parsed_state),
                "minutos": business_minutes,
            }
        )
    return details


def build_legajos_sample(
    events_by_solicitud: Dict[int, List[NovedadEvent]],
    sample_size: int,
    seed: int,
) -> List[Dict[str, Any]]:
    paid_solicitudes: Dict[int, NovedadEvent] = {}
    for solicitud_oid, items in events_by_solicitud.items():
        paid = [
            event
            for event in items
            if normalize_text(event.solicitud_estado_descripcion) == TRANSFER_END_STATE
        ]
        if paid:
            paid_solicitudes[solicitud_oid] = paid[0]

    all_oids = sorted(paid_solicitudes.keys())
    random.Random(seed).shuffle(all_oids)
    selected = all_oids[: min(sample_size, len(all_oids))]

    return [
        {
            "solicitud_oid": oid,
            "nro_socio": paid_solicitudes[oid].nro_socio,
            "linea": paid_solicitudes[oid].linea_descripcion,
            "estado_actual": paid_solicitudes[oid].solicitud_estado_descripcion,
        }
        for oid in selected
    ]


def summarize_minutes(values: Sequence[float]) -> Dict[str, Optional[float]]:
    sorted_values = sorted(values)
    if not sorted_values:
        return {
            "promedio_minutos": None,
            "promedio_sin_extremos": None,
            "minimo_minutos": None,
            "p10_minutos": None,
            "q1_minutos": None,
            "mediana_minutos": None,
            "q3_minutos": None,
            "p90_minutos": None,
            "p95_minutos": None,
            "maximo_minutos": None,
        }

    trim_count = int(len(sorted_values) * 0.05)
    if trim_count * 2 >= len(sorted_values):
        trimmed = sorted_values
    else:
        trimmed = sorted_values[trim_count : len(sorted_values) - trim_count]
    if not trimmed:
        trimmed = sorted_values

    quantiles = {
        "minimo_minutos": sorted_values[0],
        "p10_minutos": statistics.quantiles(sorted_values, n=10, method="inclusive")[0]
        if len(sorted_values) > 1
        else sorted_values[0],
        "q1_minutos": statistics.quantiles(sorted_values, n=4, method="inclusive")[0]
        if len(sorted_values) > 1
        else sorted_values[0],
        "mediana_minutos": statistics.median(sorted_values),
        "q3_minutos": statistics.quantiles(sorted_values, n=4, method="inclusive")[2]
        if len(sorted_values) > 1
        else sorted_values[0],
        "p90_minutos": statistics.quantiles(sorted_values, n=10, method="inclusive")[8]
        if len(sorted_values) > 1
        else sorted_values[0],
        "p95_minutos": statistics.quantiles(sorted_values, n=20, method="inclusive")[18]
        if len(sorted_values) > 1
        else sorted_values[0],
        "maximo_minutos": sorted_values[-1],
    }

    return {
        "promedio_minutos": statistics.fmean(sorted_values),
        "promedio_sin_extremos": statistics.fmean(trimmed),
        **quantiles,
    }


def summarize_metric_rows_by_status(metric_rows: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    grouped: Dict[str, Dict[str, Any]] = {}
    for row in metric_rows:
        status_key = str(row.get("estado_final_norm") or "sin_estado")
        if status_key not in grouped:
            grouped[status_key] = {
                "estado_final": row.get("estado_final") or "Sin estado",
                "minutos": [],
            }
        grouped[status_key]["minutos"].append(float(row["minutos"]))

    summary_rows: List[Dict[str, Any]] = []
    for status_key in sorted(grouped.keys()):
        entry = grouped[status_key]
        summary_rows.append(
            {
                "estado_final": entry["estado_final"],
                "casos": len(entry["minutos"]),
                **summarize_minutes(entry["minutos"]),
            }
        )
    return summary_rows


def build_base_state_rows(events_by_solicitud: Dict[int, List[NovedadEvent]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for solicitud_oid in sorted(events_by_solicitud.keys()):
        state_events = [event for event in events_by_solicitud[solicitud_oid] if event.parsed_state]
        state_events.sort(key=lambda event: (event.created_at is None, event.created_at, event.event_id))

        previous: Optional[NovedadEvent] = None
        sequence = 1
        for event in state_events:
            delta_min: Optional[float] = None
            if previous and previous.created_at and event.created_at:
                delta_min = (event.created_at - previous.created_at).total_seconds() / 60.0

            rows.append(
                {
                    "solicitud_oid": event.solicitud_oid,
                    "nro_socio": event.nro_socio,
                    "linea": event.linea_descripcion,
                    "event_id": event.event_id,
                    "fecha": event.fecha,
                    "texto_original": event.texto,
                    "estado_detectado": event.parsed_state,
                    "estado_detectado_norm": normalize_text(event.parsed_state),
                    "created_raw": event.creado_descripcion,
                    "event_ts": event.created_at,
                    "usuario_evento": event.usuario_evento,
                    "seq_estado_en_solicitud": sequence,
                    "estado_anterior": previous.parsed_state if previous else None,
                    "event_ts_anterior": previous.created_at if previous else None,
                    "delta_min_desde_estado_anterior": delta_min,
                }
            )
            previous = event
            sequence += 1
    return rows


def _format_console_metric(value: Optional[float]) -> str:
    if value is None:
        return "sin datos"
    return f"{value:.2f}"


def _events_by_solicitud(events: Sequence[NovedadEvent]) -> Dict[int, List[NovedadEvent]]:
    grouped: Dict[int, List[NovedadEvent]] = {}
    for event in events:
        grouped.setdefault(event.solicitud_oid, []).append(event)
    return grouped


def build_month_report(dataset: MonthDataset, log: LogFn = print) -> MonthlyReport:
    all_events_by_solicitud = _events_by_solicitud(dataset.history_events)
    excluded_analysis_oids = {
        solicitud_oid
        for solicitud_oid, items in all_events_by_solicitud.items()
        if is_analysis_excluded_solicitud(items)
    }
    events_by_solicitud = {
        solicitud_oid: items
        for solicitud_oid, items in all_events_by_solicitud.items()
        if solicitud_oid not in excluded_analysis_oids
    }
    first_response = compute_first_response_metrics(events_by_solicitud)
    transfer = compute_transfer_metrics(events_by_solicitud)
    end_to_end = compute_end_to_end_metrics(events_by_solicitud)
    end_to_end_by_final_status = summarize_metric_rows_by_status(end_to_end)
    legajos_sample = build_legajos_sample(
        events_by_solicitud,
        sample_size=30,
        seed=dataset.sample_seed,
    )
    base_rows = build_base_state_rows(events_by_solicitud)

    first_summary = summarize_minutes([row["minutos"] for row in first_response])
    transfer_summary = summarize_minutes([row["minutos"] for row in transfer])
    end_to_end_summary = summarize_minutes([row["minutos"] for row in end_to_end])
    considered_closed_oids = set(dataset.closed_solicitud_oids) - excluded_analysis_oids
    considered_historical_count = sum(len(items) for items in events_by_solicitud.values())

    log(f"  Primera respuesta: {len(first_response)} casos | promedio={_format_console_metric(first_summary['promedio_minutos'])} min")
    log(f"  Transferencia: {len(transfer)} casos | promedio={_format_console_metric(transfer_summary['promedio_minutos'])} min")
    log(f"  Punta a punta: {len(end_to_end)} casos | promedio={_format_console_metric(end_to_end_summary['promedio_minutos'])} min")
    log(f"  Muestreo de legajos: {len(legajos_sample)} | seed={dataset.sample_seed}")
    log(f"  Excluidas del analisis por linea: {len(excluded_analysis_oids)}")

    summary = {
        "month": dataset.month_value,
        "month_label": dataset.month_label,
        "month_novedades_count": len(dataset.month_events),
        "closed_states": sorted(CLOSED_STATES),
        "first_response_rule": "desde primera RevisionRiesgo hasta primer cambio de estado posterior, excluyendo lineas Carlos Paz, solo horario laboral lunes a viernes 08:00-17:00",
        "transfer_rule": "ultimo Pagada y A Transferir inmediatamente anterior, excluyendo lineas Carlos Paz y Medica, solo horario laboral lunes a viernes 08:00-17:00",
        "closed_solicitudes_count": len(considered_closed_oids),
        "historical_novedades_count": considered_historical_count,
        "solicitudes_count": len(events_by_solicitud),
        "analysis_excluded_solicitudes_count": len(excluded_analysis_oids),
        "analysis_excluded_line_keywords": list(ANALYSIS_EXCLUDED_LINE_KEYWORDS),
        "first_response": {"cases": len(first_response), **first_summary},
        "transfer": {"cases": len(transfer), **transfer_summary},
        "end_to_end": {"cases": len(end_to_end), **end_to_end_summary},
        "end_to_end_by_final_status": end_to_end_by_final_status,
        "legajos_sample_count": len(legajos_sample),
        "sample_seed": dataset.sample_seed,
        "excluded_line_keywords_transfer": list(EXCLUDED_LINE_KEYWORDS),
    }

    return MonthlyReport(
        month_value=dataset.month_value,
        month_label=dataset.month_label,
        sample_seed=dataset.sample_seed,
        summary=summary,
        base_rows=base_rows,
        first_response=first_response,
        transfer=transfer,
        end_to_end=end_to_end,
        end_to_end_by_final_status=end_to_end_by_final_status,
        legajos_sample=legajos_sample,
    )
