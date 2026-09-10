"""Observed evaluation activity flags exceptions; only confirmed closures deduct time."""
from collections import defaultdict
from datetime import date, timedelta

from reporte_evaluacion_report.core import (
    extract_state_from_text, month_start_end, normalize_text, parse_created_description,
)

VERSION = "evaluacion-jornadas-2026-09-10"
# Exploratory account roster: affects alerts, never creates automatic deductions.
# The replacement-character alias is present in legacy Core descriptions.
DEFAULT_USERS = ("aortega", "jmarin", "dmontaña", "dmonta\ufffda", "ssalguero")
DECISION_STATES = frozenset({"revisar", "rechazada", "preaprobado", "liquidada"})
CONFIRMED_CLOSURES = {
    date(2026, 7, 10): "Equipo de evaluación no trabajó. Confirmado por Santiago el 10/09/2026.",
}
FIELDS = "ID;Fecha;Texto;Creado.Descripcion;Solicitud.Oid;Creado.Usuario.UserName"


def verify_day(client, day, limit):
    """No zero can be inferred from API failure, truncation, or count changes."""
    cmd = f"[Fecha] >= #{day}# AND [Fecha] < #{day + timedelta(days=1)}#"
    expression = f"[<PreSolicitud.Module.NovedadSolicitud>][{cmd}].Count()"
    before = client.evaluate(expression)
    rows = client.evaluate_list(cmd, "PreSolicitud.Module.NovedadSolicitud", FIELDS, limit)
    after = client.evaluate(expression)
    if any(isinstance(n, bool) or not isinstance(n, int) or n < 0 for n in (before, after)):
        raise ValueError("Cantidad diaria no verificable.")
    if len(rows) >= limit or before != len(rows) or before != after:
        raise ValueError("Cobertura diaria incompleta o cambiante.")
    seen, records = set(), []
    for row in rows:
        if not isinstance(row, list) or len(row) != 6 or int(row[0]) in seen:
            raise ValueError("Esquema o IDs invalidos en actividad diaria.")
        seen.add(int(row[0]))
        stamp = parse_created_description(row[3])
        if stamp is None or stamp.date() != day or not row[5]:
            raise ValueError("Fecha o autor no verificable en actividad diaria.")
        records.append({"id": int(row[0]), "date": stamp.isoformat(), "user": row[5],
                        "state": extract_state_from_text(row[2]), "application": row[4]})
    return {"query": cmd, "count_before": before, "count_after": after, "records": records}


def detect_operational_calendar(client, datasets, national, *, today=None, limit=20000,
                                users=DEFAULT_USERS, confirmed=None):
    today = today or date.today()
    confirmed = CONFIRMED_CLOSURES if confirmed is None else confirmed
    if not datasets or not users:
        raise ValueError("Faltan meses o usuarios para detectar jornadas.")
    names = {normalize_text(u) for u in users}
    months = {d.month_value for d in datasets}
    start = month_start_end(min(months))[0]
    end = month_start_end(max(months))[1]
    events_by_day, malformed_months, seen = defaultdict(dict), set(), {}
    for dataset in datasets:
        for event in dataset.month_events:
            signature = (event.created_at, event.usuario_evento, event.parsed_state, event.solicitud_oid)
            if event.event_id in seen and seen[event.event_id] != signature:
                raise ValueError("Actividad inconsistente entre extracciones.")
            seen[event.event_id] = signature
            if event.created_at is None:
                malformed_months.add(dataset.month_value)
                continue
            events_by_day[event.created_at.date()][event.event_id] = {
                "id": event.event_id, "date": event.created_at.isoformat(), "user": event.usuario_evento,
                "state": event.parsed_state, "application": event.solicitud_oid,
            }

    def summarize(records):
        records = list(records)
        team = [e for e in records if normalize_text(e["user"]) in names]
        decisions = [e for e in team if normalize_text(e["state"]) in DECISION_STATES]
        unattributed = [e for e in records if normalize_text(e["state"]) in DECISION_STATES
                        and normalize_text(e["user"]) not in names]
        return {"events": len(records), "team_events": len(team), "decision_events": len(decisions),
                "decision_cases": len({e["application"] for e in decisions}),
                "actors": sorted({e["user"] for e in team}), "unattributed_decisions": len(unattributed)}

    rows, verifications = [], {}
    current = start
    while current < end:
        day = current.isoformat()
        is_closed = current in confirmed
        base = "Fin de semana" if current.weekday() >= 5 else national.get(current, "Laborable")
        values = summarize(events_by_day[current].values())
        missing = day[:7] not in months or day[:7] in malformed_months or current >= today
        coverage = "Sin datos completos" if missing else "Extracción mensual"
        if not missing and ((base == "Laborable" and values["team_events"] == 0) or is_closed):
            try:
                check = verify_day(client, current, limit)
                verifications[day] = check
                # Union retains records with creation on this day but another Fecha.
                combined = dict(events_by_day[current])
                combined.update({e["id"]: e for e in check["records"]})
                values = summarize(combined.values())
                coverage = "Count/List/Count OK"
            except Exception as exc:
                missing = True
                coverage = "Sin datos completos"
                verifications[day] = {"error_type": type(exc).__name__}
        if is_closed:
            status = "Cierre confirmado"
            reason = confirmed[current]
            if values["team_events"]:
                status = "Confirmación en conflicto"
                reason += " Hay actividad del equipo: revisar excepción."
        elif missing:
            status, reason = "Sin datos completos", "Se mantiene el calendario base; no inferir ausencia de trabajo."
        elif values["team_events"]:
            status, reason = "Con actividad", "Se observaron movimientos del equipo; no se infiere la extensión de la jornada."
        elif values["unattributed_decisions"]:
            status, reason = "Actividad por atribuir", "Hay decisiones de otros usuarios; revisar nómina antes de inferir cierre."
        elif base == "Laborable":
            status, reason = "Posible no trabajado", "Sin actividad observada del equipo. Requiere confirmación; no se descuentan minutos."
        else:
            status, reason = "Sin actividad en descanso", "Se conserva el descanso del calendario base."
        rows.append({"date": day, "base": base, "status": status, **values, "coverage": coverage,
                     "extra_excluded": is_closed and current < today,
                     "reason": reason, "sample_event_ids": sorted(events_by_day[current])[:10]})
        current += timedelta(days=1)
    # Confirmed closures also apply to intervals outside the detection window.
    extra_dates = {d for d in confirmed if d < today}
    return {"version": VERSION, "scope": "Solo primera respuesta; jornada fija lunes a viernes 08:00–17:00",
            "users": list(users), "roster_status": "Orientativo: validar nómina; las alertas no generan descuentos automáticos",
            "decision_states": sorted(DECISION_STATES), "from_date": start.isoformat(),
            "to_date": (end - timedelta(days=1)).isoformat(),
            "date_rule": "Consulta por Fecha; actividad agrupada por creación. Se unen eventos de todos los meses extraídos; la ausencia es indicio, no prueba.",
            "confirmed_closures": {d.isoformat(): reason for d, reason in confirmed.items()},
            "extra_excluded_dates": sorted(d.isoformat() for d in extra_dates),
            "days": rows, "verifications": verifications}
