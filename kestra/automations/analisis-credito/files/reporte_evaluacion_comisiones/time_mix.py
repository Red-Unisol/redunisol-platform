"""Exact decomposition of changes in mean times; no causal claims about learning."""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from math import fsum, isclose, isfinite

from reporte_evaluacion_report.core import month_start_end, normalize_text
from .core import previous_months

TIME_METRICS = (
    ("first_response", "Primera respuesta"),
    ("transfer", "Transferencia"),
    ("end_to_end", "Punta a punta"),
)
MIX_VERSION = "mix-2026-09-base-anterior-primer-mes"
MAPPING_FIELDS = "Oid;LineaPrestamo.ID;LineaPrestamo.Descripcion;LineaPrestamo.Superior.ID;LineaPrestamo.Superior.Descripcion"


def fetch_line_context(client, reports, to_month, limit=20000):
    """Resolve by application ID, never by potentially duplicate product names.

    A missing application remains in totals as unclassified. Malformed, duplicate,
    truncated or conflicting API data abort publication rather than invent groups.
    """
    ids = sorted({int(row["solicitud_oid"]) for report in reports
                  for metric, _ in TIME_METRICS for row in getattr(report, metric)})
    applications, lines = {}, {}
    batch_size = min(200, limit - 1)
    if batch_size < 1:
        raise ValueError("Limite insuficiente para mapear lineas.")
    for start in range(0, len(ids), batch_size):
        batch = ids[start:start + batch_size]
        rows = client.evaluate_list(
            f"[Oid] In ({','.join(map(str, batch))})", "PreSolicitud.Module.Solicitud", MAPPING_FIELDS, limit,
        )
        if len(rows) >= limit:
            raise ValueError("Mapeo de lineas truncado.")
        for row in rows:
            if not isinstance(row, list) or len(row) != 5:
                raise ValueError("Esquema inesperado del mapeo de lineas.")
            oid, line_id, name, parent_id, parent_name = row
            oid = int(oid)
            if oid not in batch or oid in applications:
                raise ValueError("Solicitud duplicada o ajena al lote de lineas.")
            applications[oid] = int(line_id) if line_id is not None else None
            if line_id is None:
                continue
            line_id = int(line_id)
            info = {"id": line_id, "name": name or "Sin nombre", "parent_id": parent_id,
                    "parent_name": parent_name or "Sin superior", "first_activity": None}
            if line_id in lines and lines[line_id] != info:
                raise ValueError("La clasificacion de una linea cambio durante la extraccion.")
            lines[line_id] = info
    _, end = month_start_end(to_month)
    for index, (line_id, info) in enumerate(sorted(lines.items()), 1):
        # All available history, not the first month included in this workbook.
        expression = (
            f"[<PreSolicitud.Module.NovedadSolicitud>]"
            f"[[Solicitud.LineaPrestamo.ID] = {line_id} AND [Fecha] < #{end}#].Min([Fecha])"
        )
        value = client.evaluate(expression)
        if value is not None:
            try:
                first = date.fromisoformat(str(value)[:10])
            except ValueError as exc:
                raise ValueError("Fecha de primera actividad invalida.") from exc
            if first.year < 1900 or first >= end:
                raise ValueError("Primera actividad fuera de rango.")
            info["first_activity"] = first.isoformat()
        if index % 20 == 0:
            print(f"Contexto de lineas: {index}/{len(lines)}", flush=True)
    return {"applications": applications, "lines": lines, "version": MIX_VERSION,
            "first_activity_source": "NovedadSolicitud.Fecha.Min (historia disponible en Core)",
            "mapping_source": "Solicitud.LineaPrestamo.Superior (clasificacion actual del Core)",
            "new_line_rule": "Solo el mes calendario de primera actividad; no es fecha de alta ni prueba de aprendizaje"}


def classify(row, context, comparison_month):
    oid = int(row["solicitud_oid"])
    # JSON manifests stringify dictionary keys; accept a reloaded snapshot too.
    line_id = context["applications"].get(oid, context["applications"].get(str(oid)))
    info = context["lines"].get(line_id, context["lines"].get(str(line_id)))
    if info is None or normalize_text(info["name"]) != normalize_text(row.get("linea")):
        # Explicitly retain missing or drifting classifications in the denominator.
        return ("Sin clasificar", "Sin clasificar", "Sin clasificar", "Sin clasificar")
    first = info["first_activity"]
    age = "Antigüedad desconocida" if not first or first[:7] > comparison_month else (
        "Nueva · primer mes" if first[:7] == comparison_month else "Existente"
    )
    operation = "Cancelaciones" if "cancel" in normalize_text(info["name"]) else "Otras operaciones"
    # Stable ID avoids conflating different parents with the same label.
    parent_key = str(info["parent_id"]) if info["parent_id"] is not None else "Sin superior"
    return (parent_key, info["parent_name"], operation, age)


def aggregate(rows, context, comparison_month):
    groups = defaultdict(list)
    seen = set()
    for row in rows:
        oid = int(row["solicitud_oid"])
        value = float(row["minutos"])
        if oid in seen or not isfinite(value) or value < 0:
            raise ValueError("Caso duplicado o tiempo invalido en analisis de mix.")
        seen.add(oid)
        groups[classify(row, context, comparison_month)].append(value)
    return {key: {"count": len(values), "minutes": fsum(values)} for key, values in groups.items()}


def decompose(before, after):
    n0, n1 = sum(v["count"] for v in before.values()), sum(v["count"] for v in after.values())
    comparable = n0 > 0 and n1 > 0
    details = []
    for key in sorted(before.keys() | after.keys()):
        a, b = before.get(key, {"count": 0, "minutes": 0}), after.get(key, {"count": 0, "minutes": 0})
        p0, p1 = a["count"] / n0 if n0 else None, b["count"] / n1 if n1 else None
        u0 = a["minutes"] / a["count"] if a["count"] else None
        u1 = b["minutes"] / b["count"] if b["count"] else None
        status = "Comparable" if a["count"] and b["count"] else "Entrada" if b["count"] else "Salida"
        mix = performance = entry_exit = None
        if comparable:
            if u0 is not None and u1 is not None:
                # Same controlled contribution as the local reference workbook:
                # hold previous-month weights fixed, assign interaction to mix.
                mix = (p1 - p0) * u1
                performance = (u1 - u0) * p0
                entry_exit = 0.0
            else:
                mix = performance = 0.0
                entry_exit = b["minutes"] / n1 - a["minutes"] / n0
        details.append({"key": key, "count_before": a["count"], "count_after": b["count"],
                        "minutes_before": a["minutes"], "minutes_after": b["minutes"],
                        "share_before": p0, "share_after": p1, "mean_before": u0, "mean_after": u1,
                        "mix": mix, "performance": performance, "entry_exit": entry_exit,
                        "status": status if comparable else "Sin comparación"})
    mean0 = fsum(v["minutes"] for v in before.values()) / n0 if n0 else None
    mean1 = fsum(v["minutes"] for v in after.values()) / n1 if n1 else None
    totals = {field: fsum(d[field] for d in details) if comparable else None
              for field in ("mix", "performance", "entry_exit")}
    change = mean1 - mean0 if comparable else None
    if comparable and not isclose(fsum(totals.values()), change, abs_tol=1e-8, rel_tol=1e-10):
        raise ValueError("La descomposicion no concilia con la variacion total.")
    return {"count_before": n0, "count_after": n1, "mean_before": mean0, "mean_after": mean1,
            "change": change, **totals, "details": details}


def analyze_time_mix(reports, months, context):
    by_month = {report.month_value: report for report in reports}
    results = []
    for month in months:
        previous = previous_months(month)[-1]
        for metric, label in TIME_METRICS:
            # Fix the maturity label at the comparison month on BOTH sides. This
            # prevents automatic aging from fabricating entry/exit or mix effects.
            before_rows = getattr(by_month[previous], metric) if previous in by_month else []
            after_rows = getattr(by_month[month], metric)
            result = decompose(aggregate(before_rows, context, month), aggregate(after_rows, context, month))
            for period, calculated in [(previous, result["mean_before"]), (month, result["mean_after"])]:
                if period in by_month:
                    expected = by_month[period].summary[metric]["promedio_minutos"]
                    if (calculated is None) != (expected is None) or (
                        calculated is not None and not isclose(calculated, expected, abs_tol=1e-8)
                    ):
                        raise ValueError("El promedio de mix difiere del reporte original.")
            results.append({"month": month, "previous_month": previous, "metric": metric, "label": label, **result})
    return results
