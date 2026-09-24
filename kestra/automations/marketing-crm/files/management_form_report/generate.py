#!/usr/bin/env python3
"""Generate the private cumulative management report for form submissions to Bitrix."""

from __future__ import annotations

import json
import os
import time
from collections import Counter
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Any

import requests
from openpyxl import Workbook
from openpyxl.chart import BarChart, PieChart, Reference
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from reporting_kestra.client import OutputCache, check_deadline, executions, hydrate_outputs, publish as publish_report


NAVY, WHITE = "17365D", "FFFFFF"
GREEN, YELLOW, ORANGE, RED = "C6EFCE", "FFEB9C", "FCE4D6", "FFC7CE"


FLOW_ID = "bitrix24_form_webhook"
ARGENTINA = ZoneInfo("America/Argentina/Buenos_Aires")
MAX_RECORDS = 50_000
MAX_SECONDS = 840


def state(row: dict[str, Any]) -> str:
    return str((row.get("state") or {}).get("current") or "UNKNOWN")


def iso(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(ARGENTINA).replace(tzinfo=None)
    except ValueError:
        return None


def body(row: dict[str, Any]) -> dict[str, Any]:
    variables = (row.get("trigger") or {}).get("variables") or {}
    value = variables.get("body") or {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            value = {}
    return value if isinstance(value, dict) else {}


def normalized(row: dict[str, Any]) -> dict[str, Any]:
    request = body(row)
    outputs = row.get("outputs") or {}
    action = str(outputs.get("action") or "").lower()
    lead_id = str(outputs.get("lead_id") or "")
    technical_error = state(row) in {"FAILED", "KILLED", "CANCELLED"}
    reason = str(outputs.get("message") or outputs.get("reason") or "")
    available = request.get("prequalification_available") is True
    prequalified = request.get("prequalified") if available else None
    prequalification_reason = str(request.get("prequalification_reason") or "") if available else ""
    prequalification_message = str(request.get("prequalification_message") or "") if available else ""
    rule_version = str(request.get("prequalification_rule_version") or "") if available else ""
    if not lead_id and technical_error:
        category = "Error técnico"
    elif not lead_id and action == "rejected":
        category = "Rechazo antes de Bitrix"
    elif not lead_id and action == "error":
        category = "Error de datos"
    elif not lead_id and not outputs and state(row) == "SUCCESS":
        category = "Sin trazabilidad disponible"
    elif not lead_id:
        category = "Pendiente de verificación"
    elif available and prequalified is True:
        category = "Precalificado"
    elif available and prequalification_reason == "external_referral":
        category = "Derivación a vendedor externo"
    elif available and prequalified is False:
        category = "Rechazado en precalificación"
    elif lead_id:
        category = "Sin precalificación disponible"
    return {
        "date": iso((row.get("state") or {}).get("startDate")),
        "execution_id": str(row.get("id") or ""),
        "child_execution_id": "",
        "revision": row.get("flowRevision"),
        "technical_state": state(row),
        "action": action,
        "reason": reason,
        "category": category,
        "lead_id": lead_id,
        "prequalified": prequalified,
        "prequalification_reason": prequalification_reason,
        "prequalification_message": prequalification_message,
        "prequalification_rule_version": rule_version,
        "contact_id": str(outputs.get("contact_id") or ""),
        "name": request.get("full_name"),
        "cuil": request.get("cuil"),
        "email": request.get("email"),
        "whatsapp": request.get("whatsapp"),
        "province": request.get("province"),
        "employment": request.get("employment_status"),
        "bank": request.get("payment_bank"),
        "source": request.get("lead_source"),
        "utm_source": request.get("utm_source"),
        "utm_medium": request.get("utm_medium"),
        "utm_campaign": request.get("utm_campaign"),
        "landing": request.get("landing_slug") or request.get("landing_url"),
    }


def compact(ws, widths: dict[int, int] | None = None) -> None:
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(ws.max_column)}{ws.max_row}"
    ws.sheet_view.showGridLines = False
    for cell in ws[1]:
        cell.fill = PatternFill("solid", fgColor=NAVY)
        cell.font = Font(color=WHITE, bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 30
    # Integer row indexing recomputes max_column by scanning every populated
    # cell. Iterating once keeps formatting linear in the size of the sheet.
    body_alignment = Alignment(vertical="center", wrap_text=False)
    for number, cells in enumerate(ws.iter_rows(min_row=2), 2):
        ws.row_dimensions[number].height = 18
        for cell in cells:
            cell.alignment = body_alignment
    widths = widths or {}
    for index, column in enumerate(ws.columns, 1):
        longest = max(len(str(cell.value or "")) for cell in column) + 2
        ws.column_dimensions[get_column_letter(index)].width = min(longest, widths.get(index, 36))


def build(rows: list[dict[str, Any]]) -> Workbook:
    wb = Workbook()
    summary = wb.active
    summary.title = "Resumen Ejecutivo"
    counts = Counter(row["category"] for row in rows)
    leads = [row for row in rows if row["lead_id"]]
    summary.append(["INFORME FORMULARIO → BITRIX", "Valor"])
    dates = [row["date"] for row in rows if row["date"]]
    metrics = [
        ("Período", f"{min(dates):%d/%m/%Y} al {max(dates):%d/%m/%Y}" if dates else ""),
        ("Formularios recibidos", len(rows)),
        ("Leads confirmados en Bitrix", len({row["lead_id"] for row in leads})),
        ("Formularios precalificados", counts["Precalificado"]),
        ("Derivaciones a vendedor externo", counts["Derivación a vendedor externo"]),
        ("Formularios rechazados", counts["Rechazado en precalificación"]),
        ("Conversión formulario → lead", len({row["lead_id"] for row in leads}) / len(rows) if rows else 0),
        ("Rechazados antes de Bitrix", counts["Rechazo antes de Bitrix"]),
        ("Errores de datos", counts["Error de datos"]),
        ("Errores técnicos", counts["Error técnico"]),
        ("Pendientes de verificación", counts["Pendiente de verificación"]),
        ("Sin trazabilidad disponible", counts["Sin trazabilidad disponible"]),
        ("Sin precalificación disponible", counts["Sin precalificación disponible"]),
    ]
    for metric in metrics:
        summary.append(metric)
    compact(summary, {1: 38, 2: 28})
    summary.auto_filter.ref = None
    for number in range(2, summary.max_row + 1):
        summary.cell(number, 1).font = Font(bold=True, color=NAVY)
        if summary.cell(number, 1).value == "Conversión formulario → lead":
            summary.cell(number, 2).number_format = "0.00%"
    summary["D1"], summary["E1"] = "Resultado", "Cantidad"
    category_names = ("Precalificado", "Derivación a vendedor externo", "Rechazado en precalificación", "Sin precalificación disponible", "Rechazo antes de Bitrix", "Error de datos", "Error técnico", "Pendiente de verificación", "Sin trazabilidad disponible")
    categories = [(key, counts[key]) for key in category_names]
    for index, item in enumerate(categories, 2):
        summary.cell(index, 4, item[0])
        summary.cell(index, 5, item[1])
    summary.column_dimensions["D"].width = 38
    summary.column_dimensions["E"].width = 12
    pie = PieChart()
    pie.title = "Resultado de formularios"
    pie.add_data(Reference(summary, min_col=5, min_row=1, max_row=1 + len(category_names)), titles_from_data=True)
    pie.set_categories(Reference(summary, min_col=4, min_row=2, max_row=1 + len(category_names)))
    summary.add_chart(pie, "G2")

    daily_ws = wb.create_sheet("Evolución diaria")
    daily_ws.append(["Fecha", "Formularios", "Leads confirmados", "Conversión", *category_names])
    rows_by_day: dict[Any, list[dict[str, Any]]] = {}
    for row in rows:
        if row["date"]:
            rows_by_day.setdefault(row["date"].date(), []).append(row)
    for day, day_rows in sorted(rows_by_day.items()):
        day_counts = Counter(row["category"] for row in day_rows)
        day_leads = {row["lead_id"] for row in day_rows if row["lead_id"]}
        daily_ws.append([
            day,
            len(day_rows),
            len(day_leads),
            len(day_leads) / len(day_rows),
            *(day_counts[category] for category in category_names),
        ])
    compact(daily_ws, {1: 14, 2: 16, 3: 20, 4: 14})
    for number in range(2, daily_ws.max_row + 1):
        daily_ws.cell(number, 1).number_format = "dd/mm/yyyy"
        daily_ws.cell(number, 4).number_format = "0.00%"
    if daily_ws.max_row > 1:
        daily_chart = BarChart()
        daily_chart.type = "col"
        daily_chart.grouping = "stacked"
        daily_chart.overlap = 100
        daily_chart.title = "Resultados de formularios por día"
        daily_chart.y_axis.title = "Cantidad"
        daily_chart.x_axis.title = "Fecha"
        daily_chart.add_data(
            Reference(daily_ws, min_col=5, max_col=4 + len(category_names), min_row=1, max_row=daily_ws.max_row),
            titles_from_data=True,
        )
        daily_chart.set_categories(Reference(daily_ws, min_col=1, min_row=2, max_row=daily_ws.max_row))
        daily_chart.height = 9
        daily_chart.width = 20
        daily_ws.add_chart(daily_chart, "O2")

    lead_ws = wb.create_sheet("Leads en Bitrix")
    lead_ws.append(["fecha", "lead_id", "contact_id", "nombre", "cuil", "email", "whatsapp", "provincia", "situación laboral", "banco de cobro", "origen", "utm_source", "utm_medium", "utm_campaign", "landing", "precalificación", "motivo", "detalle", "versión reglas", "ejecución Kestra", "subejecución", "revisión"])
    for row in sorted(leads, key=lambda item: item["date"] or datetime.min):
        lead_ws.append([row[key] for key in ("date", "lead_id", "contact_id", "name", "cuil", "email", "whatsapp", "province", "employment", "bank", "source", "utm_source", "utm_medium", "utm_campaign", "landing", "category", "prequalification_reason", "prequalification_message", "prequalification_rule_version", "execution_id", "child_execution_id", "revision")])
    compact(lead_ws, {4: 28, 6: 32, 10: 38, 14: 42, 17: 62, 18: 28, 19: 28})

    rejected_ws = wb.create_sheet("Sin lead confirmado")
    rejected_ws.append(["fecha", "nombre", "cuil", "email", "whatsapp", "provincia", "origen", "resultado", "motivo", "acción recomendada", "estado Kestra", "ejecución Kestra", "revisión"])
    recommendations = {"Rechazado en precalificación": "Sin acción técnica", "Rechazo antes de Bitrix": "Sin acción técnica", "Error de datos": "Corregir validación o catálogo", "Error técnico": "Reintentar y revisar logs", "Pendiente de verificación": "Revisar manualmente", "Sin trazabilidad disponible": "Consultar el archivo histórico"}
    for row in sorted((item for item in rows if not item["lead_id"]), key=lambda item: item["date"] or datetime.min):
        rejected_ws.append([row["date"], row["name"], row["cuil"], row["email"], row["whatsapp"], row["province"], row["source"], row["category"], row["reason"], recommendations[row["category"]], row["technical_state"], row["execution_id"], row["revision"]])
    compact(rejected_ws, {2: 28, 4: 32, 8: 28, 9: 62, 10: 44, 12: 28})

    quality = wb.create_sheet("Motivos y Calidad")
    quality.append(["Resultado", "Motivo", "Cantidad", "% total", "Acción recomendada"])
    reason_counts = Counter((row["category"], row["prequalification_message"] or row["reason"]) for row in rows if row["category"] in recommendations)
    for (category, reason), count in reason_counts.most_common():
        quality.append([category, reason, count, count / len(rows) if rows else 0, recommendations[category]])
    compact(quality, {1: 28, 2: 72, 5: 48})
    for number in range(2, quality.max_row + 1):
        quality.cell(number, 4).number_format = "0.00%"
    if quality.max_row > 1:
        chart = BarChart()
        chart.type = "bar"
        chart.title = "Principales motivos"
        last = min(quality.max_row, 11)
        chart.add_data(Reference(quality, min_col=3, min_row=1, max_row=last), titles_from_data=True)
        chart.set_categories(Reference(quality, min_col=2, min_row=2, max_row=last))
        quality.add_chart(chart, "G2")
    return wb


def publish(workbook: Workbook, root: Path, generated_at: datetime,
            *, deadline: float | None = None, metadata: dict[str, Any] | None = None) -> tuple[Path, Path]:
    return publish_report(workbook, root, "formulario-bitrix", generated_at,
                          deadline=deadline, metadata=metadata)


def main() -> None:
    started = time.monotonic()
    deadline = started + MAX_SECONDS
    base = os.environ["REPORTS_KESTRA_URL"].rstrip("/")
    tenant = os.getenv("REPORTS_KESTRA_TENANT", "main")
    namespace = os.getenv("REPORTS_NAMESPACE", "redunisol.prod.marketing-crm")
    generated_at = datetime.now(ARGENTINA)
    as_of = generated_at.astimezone(timezone.utc).isoformat()
    root = Path(os.getenv("REPORTS_ROOT", "/reports"))
    cache = OutputCache(Path(os.getenv("REPORTS_CACHE_PATH", str(root / ".cache" / "formulario-bitrix.sqlite"))), base, tenant)
    with requests.Session() as session:
        session.auth = (os.environ["REPORTS_KESTRA_USERNAME"], os.environ["REPORTS_KESTRA_PASSWORD"])
        try:
            parents = executions(session, base, tenant, namespace, FLOW_ID, deadline=deadline,
                                 max_records=MAX_RECORDS, as_of=as_of)
            if not parents:
                raise RuntimeError("No se encontraron formularios; verificar la cobertura antes de publicar.")
            parents = hydrate_outputs(parents, session, base, tenant, deadline=deadline, cache=cache)
        finally:
            cache.close()
    rows = [normalized(row) for row in parents]
    check_deadline(deadline)
    workbook = build(rows)
    check_deadline(deadline)
    metadata = {"ok": True, "generated_at": generated_at.isoformat(), "as_of": as_of,
                "namespace": namespace, "flows": [FLOW_ID], "forms": len(rows),
                "leads": len({row["lead_id"] for row in rows if row["lead_id"]}),
                "first_form_at": min(row["date"] for row in rows if row["date"]).isoformat(),
                "categories": dict(Counter(row["category"] for row in rows))}
    methodology = workbook.create_sheet("Cobertura")
    for label, value in [("Origen", "Formularios recibidos por Kestra; no representa el estado actual del CRM."),
                         ("Fecha de corte", generated_at.replace(tzinfo=None)),
                         ("Formularios incluidos", len(rows)),
                         ("Criterio", "Acumulado disponible. Cada envio cuenta una vez; los leads se cuentan por ID unico."),
                         ("Precalificacion", "Se usa la respuesta incluida en el formulario. Sin respuesta no se presume rechazo."),
                         ("En curso", sum(row["technical_state"] not in {"SUCCESS", "WARNING", "FAILED", "KILLED", "CANCELLED"} for row in rows))]:
        methodology.append([label, value])
    compact(methodology, {1: 30, 2: 95})
    methodology.column_dimensions["B"].width = 95
    for cells in methodology.iter_rows(min_row=2):
        cells[1].alignment = Alignment(wrap_text=True, vertical="center")
        methodology.row_dimensions[cells[1].row].height = 32
    methodology["B2"].number_format = "dd/mm/yyyy hh:mm:ss"
    latest, dated = publish(workbook, root, generated_at, deadline=deadline, metadata=metadata)
    print(json.dumps({"ok": True, "forms": len(rows),
                      "leads": len({row["lead_id"] for row in rows if row["lead_id"]}),
                      "seconds": round(time.monotonic() - started, 2),
                      "latest": str(latest), "history": str(dated)}), flush=True)


if __name__ == "__main__":
    main()
