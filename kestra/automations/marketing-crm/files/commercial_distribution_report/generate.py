#!/usr/bin/env python3
"""Generate the private commercial classification and distribution audit report."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import time
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests
from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter


NAVY, WHITE = "17365D", "FFFFFF"
FLOW_ID = "bitrix24_catamarca_deal_qualification"
ARGENTINA_TIMEZONE = ZoneInfo("America/Argentina/Buenos_Aires")
ASSIGNMENT_STRATEGY_LABELS = {
    "contact_history": "Continuidad con vendedor anterior del contacto",
    "legacy_contact_history": "Continuidad con vendedor histórico del contacto",
    "round_robin": "Siguiente vendedor del round-robin",
    "legacy_round_robin": "Round-robin calculado con negociaciones históricas",
    "round_robin_initial": "Primer vendedor online por falta de antecedentes",
    "single_seller": "Único vendedor configurado para el bucket",
    "outside_hours_manual": "Fuera de horario laboral; gestión manual con Maru",
    "commercial_rejection_manual": "Rechazo comercial; gestión manual con Maru",
    "no_matching_bucket": "No existe un bucket aplicable",
    "not_applicable": "La negociación ya no estaba pendiente",
    "technical_error": "La ejecución terminó con un error técnico",
}


def api_get(session: requests.Session, url: str, **params: Any) -> Any:
    error: Exception | None = None
    for attempt in range(5):
        try:
            response = session.get(url, params=params, timeout=(10, 90))
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as exc:
            error = exc
            if attempt < 4:
                time.sleep(2**attempt)
    raise RuntimeError(f"No se pudo consultar Kestra: {error}")


def executions(
    session: requests.Session,
    base: str,
    tenant: str,
    namespace: str,
    flow: str,
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    page = 1
    while True:
        payload = api_get(
            session,
            f"{base}/api/v1/{tenant}/executions/search",
            namespace=namespace,
            flowId=flow,
            page=page,
            size=100,
        )
        batch = payload.get("results", [])
        result.extend(batch)
        if not batch or len(result) >= int(payload.get("total", len(result))):
            return result
        page += 1


def execution_state(row: dict[str, Any]) -> str:
    return str((row.get("state") or {}).get("current") or "UNKNOWN")


def parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(ARGENTINA_TIMEZONE)
    return parsed.replace(tzinfo=None)


def parse_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    normalized = str(value or "").strip().lower()
    if normalized in {"true", "1", "yes", "si"}:
        return True
    if normalized in {"false", "0", "no"}:
        return False
    return None


def parse_int(value: Any) -> int:
    try:
        return int(str(value or "0"))
    except ValueError:
        return 0


def distribution_status(action: str, strategy: str, technical_state: str) -> str:
    if technical_state in {"FAILED", "KILLED"} or action == "error":
        return "Error técnico"
    if strategy in {"outside_hours_manual", "commercial_rejection_manual"}:
        return "Gestión manual con Maru"
    if strategy == "no_matching_bucket" or action == "routing_review":
        return "Sin bucket"
    if action == "skipped":
        return "Omitido"
    if strategy in {
        "contact_history",
        "legacy_contact_history",
        "round_robin",
        "legacy_round_robin",
        "round_robin_initial",
        "single_seller",
    }:
        return "Distribuido"
    if action == "manual_review":
        return "Revisión manual"
    return "Sin distribución"


def normalized(row: dict[str, Any]) -> dict[str, Any] | None:
    outputs = row.get("outputs") or {}
    action = str(outputs.get("action") or "").strip().lower()
    technical_state = execution_state(row)
    deal_id = str(outputs.get("deal_id") or "").strip()
    if action == "no_pending" or (not deal_id and technical_state not in {"FAILED", "KILLED"}):
        return None

    strategy = str(outputs.get("assignment_strategy") or "").strip()
    rule_version = str(outputs.get("rule_version") or "").strip()
    assigned_by_id = str(outputs.get("assigned_by_id") or "").strip()
    assigned_by_name = str(outputs.get("assigned_by_name") or "").strip()
    if assigned_by_id and not assigned_by_name:
        assigned_by_name = f"Usuario {assigned_by_id}"
    processed_at = parse_datetime(outputs.get("processed_at")) or parse_datetime(
        (row.get("state") or {}).get("startDate")
    )
    status = distribution_status(action, strategy, technical_state)
    if not strategy and not rule_version and technical_state == "SUCCESS":
        status = "Histórico incompleto"
    return {
        "processed_at": processed_at,
        "execution_id": str(row.get("id") or ""),
        "revision": row.get("flowRevision"),
        "technical_state": technical_state,
        "action": action,
        "distribution_status": status,
        "reason": str(outputs.get("reason") or ""),
        "message": str(outputs.get("message") or ""),
        "rule_version": rule_version,
        "deal_id": deal_id,
        "deal_title": str(outputs.get("deal_title") or ""),
        "lead_id": str(outputs.get("lead_id") or ""),
        "contact_id": str(outputs.get("contact_id") or ""),
        "province": str(outputs.get("province") or ""),
        "employment_status": str(outputs.get("employment_status") or ""),
        "payment_bank": str(outputs.get("payment_bank") or ""),
        "stage_before": str(outputs.get("stage_before") or ""),
        "stage_after": str(outputs.get("stage_id") or ""),
        "commercial_line": str(outputs.get("commercial_line") or ""),
        "routing_bucket": str(outputs.get("routing_bucket") or ""),
        "previous_assigned_by_id": str(outputs.get("previous_assigned_by_id") or ""),
        "assigned_by_id": assigned_by_id,
        "assigned_by_name": assigned_by_name,
        "assignment_strategy": strategy,
        "assignment_reason": ASSIGNMENT_STRATEGY_LABELS.get(strategy, strategy),
        "configured_pool": str(outputs.get("configured_pool") or ""),
        "online_pool": str(outputs.get("online_pool") or ""),
        "within_business_hours": parse_bool(outputs.get("within_business_hours")),
        "linked_activity_count": parse_int(outputs.get("linked_activity_count")),
        "transferred_chat_count": parse_int(outputs.get("transferred_chat_count")),
    }


def compact(ws, widths: dict[int, int] | None = None) -> None:
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(ws.max_column)}{ws.max_row}"
    ws.sheet_view.showGridLines = False
    for cell in ws[1]:
        cell.fill = PatternFill("solid", fgColor=NAVY)
        cell.font = Font(color=WHITE, bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center")
    widths = widths or {}
    for index, column in enumerate(ws.columns, 1):
        longest = max(len(str(cell.value or "")) for cell in column) + 2
        ws.column_dimensions[get_column_letter(index)].width = min(
            longest, widths.get(index, 38)
        )


def portal_base(api_base_url: str) -> str:
    base = api_base_url.strip().rstrip("/")
    return base[:-5] if base.lower().endswith("/rest") else base


def add_link(cell, url: str) -> None:
    if not cell.value or not url:
        return
    cell.hyperlink = url
    cell.style = "Hyperlink"


def build(rows: list[dict[str, Any]], bitrix_base_url: str = "") -> Workbook:
    wb = Workbook()
    summary = wb.active
    summary.title = "Resumen"
    status_counts = Counter(row["distribution_status"] for row in rows)
    summary.append(["AUDITORÍA COMERCIAL Y DISTRIBUCIÓN", "Valor"])
    summary_rows = (
        ("Eventos procesados", len(rows)),
        ("Distribuidos", status_counts["Distribuido"]),
        ("Gestión manual con Maru", status_counts["Gestión manual con Maru"]),
        ("Sin bucket", status_counts["Sin bucket"]),
        ("Errores técnicos", status_counts["Error técnico"]),
        ("Chats transferidos", sum(row["transferred_chat_count"] for row in rows)),
    )
    for item in summary_rows:
        summary.append(item)
    compact(summary, {1: 38, 2: 20})
    summary.auto_filter.ref = None
    for row_number in range(2, summary.max_row + 1):
        summary.cell(row_number, 1).font = Font(bold=True, color=NAVY)

    by_seller = wb.create_sheet("Por vendedor")
    by_seller.append(["Responsable ID", "Responsable", "Eventos", "Distribuidos", "Chats"])
    seller_rows: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in rows:
        key = (row["assigned_by_id"], row["assigned_by_name"])
        if key[0]:
            seller_rows.setdefault(key, []).append(row)
    for (seller_id, seller_name), items in sorted(
        seller_rows.items(), key=lambda item: (-len(item[1]), item[0][1])
    ):
        by_seller.append([
            seller_id,
            seller_name,
            len(items),
            sum(item["distribution_status"] == "Distribuido" for item in items),
            sum(item["transferred_chat_count"] for item in items),
        ])
    compact(by_seller, {2: 30})
    if by_seller.max_row > 1:
        chart = BarChart()
        chart.type = "bar"
        chart.title = "Distribuciones por responsable"
        chart.add_data(
            Reference(by_seller, min_col=4, min_row=1, max_row=by_seller.max_row),
            titles_from_data=True,
        )
        chart.set_categories(
            Reference(by_seller, min_col=2, min_row=2, max_row=by_seller.max_row)
        )
        by_seller.add_chart(chart, "G2")

    headers = [
        "fecha_hora", "estado_distribución", "acción", "motivo", "negociación",
        "título", "lead", "contacto", "provincia", "situación_laboral",
        "banco_cobro", "etapa_anterior", "etapa_nueva", "línea", "bucket",
        "responsable_anterior", "responsable_id", "responsable", "motivo_asignación",
        "estrategia_técnica",
        "pool_configurado", "pool_online", "horario_laboral", "chats_transferidos",
        "actividades_vinculadas", "versión_reglas", "ejecución_kestra",
        "revisión_flujo", "estado_técnico", "mensaje",
    ]
    keys = [
        "processed_at", "distribution_status", "action", "reason", "deal_id",
        "deal_title", "lead_id", "contact_id", "province", "employment_status",
        "payment_bank", "stage_before", "stage_after", "commercial_line",
        "routing_bucket", "previous_assigned_by_id", "assigned_by_id",
        "assigned_by_name", "assignment_reason", "assignment_strategy",
        "configured_pool", "online_pool",
        "within_business_hours", "transferred_chat_count", "linked_activity_count",
        "rule_version", "execution_id", "revision", "technical_state", "message",
    ]
    events = wb.create_sheet("Eventos")
    events.append(headers)
    exceptions = wb.create_sheet("Excepciones")
    exceptions.append(headers)
    base = portal_base(bitrix_base_url)
    for item in sorted(rows, key=lambda row: row["processed_at"] or datetime.min):
        values = [item[key] for key in keys]
        events.append(values)
        if item["distribution_status"] != "Distribuido":
            exceptions.append(values)
        for sheet in (events, exceptions):
            if sheet is exceptions and item["distribution_status"] == "Distribuido":
                continue
            row_number = sheet.max_row
            if item["processed_at"]:
                sheet.cell(row_number, 1).number_format = "dd/mm/yyyy hh:mm:ss"
            add_link(sheet.cell(row_number, 5), f"{base}/crm/deal/details/{item['deal_id']}/" if base else "")
            add_link(sheet.cell(row_number, 7), f"{base}/crm/lead/details/{item['lead_id']}/" if base else "")
    compact(events, {4: 42, 6: 34, 10: 30, 11: 38, 19: 48, 30: 60})
    compact(exceptions, {4: 42, 6: 34, 10: 30, 11: 38, 19: 48, 30: 60})
    return wb


def publish(
    workbook: Workbook,
    root: Path,
    generated_at: datetime,
) -> tuple[Path, Path]:
    report_dir = root / "marketing" / "distribucion-negociaciones"
    history_dir = report_dir / "historico"
    history_dir.mkdir(parents=True, exist_ok=True)
    dated = history_dir / f"{generated_at:%Y-%m-%d}.xlsx"
    latest = report_dir / "ultimo.xlsx"
    with tempfile.NamedTemporaryFile(dir=report_dir, suffix=".xlsx", delete=False) as handle:
        temporary = Path(handle.name)
    try:
        workbook.save(temporary)
        os.replace(temporary, dated)
        dated.chmod(0o644)
        with tempfile.NamedTemporaryFile(dir=report_dir, suffix=".xlsx", delete=False) as handle:
            latest_temporary = Path(handle.name)
        shutil.copy2(dated, latest_temporary)
        os.replace(latest_temporary, latest)
        latest.chmod(0o644)
    finally:
        temporary.unlink(missing_ok=True)
    return latest, dated


def main() -> None:
    base = os.environ["REPORTS_KESTRA_URL"].rstrip("/")
    tenant = os.getenv("REPORTS_KESTRA_TENANT", "main")
    namespace = os.getenv("REPORTS_NAMESPACE", "redunisol.prod.marketing-crm")
    session = requests.Session()
    session.auth = (
        os.environ["REPORTS_KESTRA_USERNAME"],
        os.environ["REPORTS_KESTRA_PASSWORD"],
    )
    raw = executions(session, base, tenant, namespace, FLOW_ID)
    rows = [event for row in raw if (event := normalized(row)) is not None]
    latest, dated = publish(
        build(rows, os.getenv("REPORTS_BITRIX_BASE_URL", "")),
        Path(os.getenv("REPORTS_ROOT", "/reports")),
        datetime.now(ARGENTINA_TIMEZONE).replace(tzinfo=None),
    )
    print(json.dumps({
        "ok": True,
        "events": len(rows),
        "latest": str(latest),
        "history": str(dated),
    }))


if __name__ == "__main__":
    main()
