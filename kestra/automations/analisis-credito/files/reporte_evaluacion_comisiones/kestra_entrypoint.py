from __future__ import annotations

import json
import os
import shutil
import tempfile
import uuid
from datetime import datetime
from functools import partial
from pathlib import Path

from reporte_evaluacion_report.analysis import build_month_report
from reporte_evaluacion_report.core import (
    DatasetMeta, build_month_sequence, derive_month_seed, fetch_month_dataset, month_start_end,
)
from reporte_evaluacion_report.excel import write_report_workbook
from reporte_evaluacion_report.kestra_entrypoint import (
    LOCAL_TIMEZONE, env, parse_trigger_body, resolve_period, set_kestra_outputs,
)
from reporte_evaluacion_report.storage import SQLiteDatasetStore

from .calendar import CALENDAR_DESCRIPTION, CALENDAR_VERSION, SOURCES, national_holidays
from .core import (
    RULE_VERSION, CommissionApiClient, evaluate_commissions, fetch_loans, loan_filter,
    loan_snapshot, previous_months,
)
from .excel import enrich_workbook

REPORT_DIRECTORY = "reporte-evaluacion-comisiones"


def atomic_publish(source: Path, dataset: Path, manifest: Path, reports_root: Path, now: datetime) -> tuple[Path, Path]:
    directory = reports_root / "analisis-credito" / REPORT_DIRECTORY
    history = directory / "historico"
    snapshots = directory / "datos"
    history.mkdir(parents=True, exist_ok=True)
    snapshots.mkdir(parents=True, exist_ok=True)
    run_id = f"{now:%Y-%m-%d_%H-%M-%S-%f}_{uuid.uuid4().hex[:8]}"
    latest = directory / "ultimo.xlsx"
    historical = history / f"{run_id}.xlsx"
    # Guardar evidencia y copia historica antes de hacer visible el nuevo ultimo.
    for source_path, destination in (
        (dataset, snapshots / f"{run_id}.sqlite"),
        (manifest, snapshots / f"{run_id}.json"),
        (source, historical),
        (source, latest),
    ):
        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as handle:
            temporary = Path(handle.name)
        try:
            shutil.copyfile(source_path, temporary)
            temporary.chmod(0o644)
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
    return latest, historical


def generate_report(now: datetime | None = None) -> dict:
    now = now or datetime.now(LOCAL_TIMEZONE)
    from_month, to_month = resolve_period(
        today=now.date(), payload=parse_trigger_body(env("TRIGGER_BODY_JSON", "{}")),
        input_from_month=env("REPORT_INPUT_FROM_MONTH"), input_to_month=env("REPORT_INPUT_TO_MONTH"),
        default_from_month=env("REPORT_DEFAULT_FROM_MONTH", "2025-10"),
    )
    months = build_month_sequence(from_month, to_month)
    extraction_months = build_month_sequence(previous_months(from_month)[0], to_month)
    first, _ = month_start_end(extraction_months[0])
    national_holidays(range(first.year, month_start_end(to_month)[0].year + 1))
    base_url = env("REPORTE_EVALUACION_BASE_URL")
    if not base_url:
        raise ValueError("Falta REPORTE_EVALUACION_BASE_URL.")
    limit = int(env("REPORTE_EVALUACION_PER_DAY_MAX", "20000"))
    if limit < 2:
        raise ValueError("Limite de extraccion invalido.")
    verify_ssl = env("REPORTE_EVALUACION_VERIFY_SSL", "false").lower() == "true"
    seed = int(env("REPORTE_EVALUACION_SAMPLE_SEED", "202510"))
    client = CommissionApiClient(base_url, timeout=int(env("REPORTE_EVALUACION_TIMEOUT_SECONDS", "60")), verify_ssl=verify_ssl)
    if token := env("REPORTE_EVALUACION_BEARER_TOKEN"):
        client.session.headers["Authorization"] = f"Bearer {token}"
    print(json.dumps({"event": "commissions_started", "from_month": from_month, "to_month": to_month}))
    with tempfile.TemporaryDirectory(prefix="reporte-comisiones-") as temporary:
        workspace = Path(temporary)
        dataset_path = workspace / "dataset.sqlite"
        manifest_path = workspace / "manifest.json"
        workbook_path = workspace / "reporte.xlsx"
        datasets = [
            fetch_month_dataset(client, month, sample_seed=derive_month_seed(seed, month), per_day_max=limit)
            for month in extraction_months
        ]
        # El historial puede empezar antes del periodo o cerrar despues: aplicar
        # el calendario a TODO intervalo medido, igual que el reporte original.
        years = set(range(first.year, month_start_end(to_month)[0].year + 1))
        for dataset in datasets:
            timestamps = [event.created_at for event in dataset.history_events if event.created_at is not None]
            if timestamps:
                years.update(range(min(timestamps).year, max(timestamps).year + 1))
        calendar = national_holidays(years)
        exclusions = frozenset(calendar)
        reports = [build_month_report(dataset, excluded_dates=exclusions) for dataset in datasets]
        selected_reports = [report for report in reports if report.month_value in months]
        loans = {month: fetch_loans(client, month, limit) for month in months}
        commissions = evaluate_commissions(reports, loans, months)
        # La URL no se almacena en el snapshot: el destino operativo vive en secretos.
        SQLiteDatasetStore(dataset_path).save_dataset(
            meta=DatasetMeta(now.replace(tzinfo=None), seed, "Core Evaluate API", limit, verify_ssl, extraction_months),
            months=datasets, replace=True,
        )
        manifest = {
            "rule_version": RULE_VERSION, "calendar_version": CALENDAR_VERSION,
            "calendar_description": CALENDAR_DESCRIPTION, "calendar_sources": SOURCES,
            "calendar": {day.isoformat(): name for day, name in calendar.items()},
            "extraction_started_at": now.isoformat(), "extraction_completed_at": datetime.now(LOCAL_TIMEZONE).isoformat(),
            "from_month": from_month, "to_month": to_month, "reference_months": extraction_months,
            "sample_seed": seed, "queries": {month: loan_filter(month) for month in months},
            "loans": loan_snapshot(loans), "commissions": commissions,
            "manual_commission": None, "manual_status": "Pendiente de revision humana",
        }
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, default=str), encoding="utf-8")
        write_report_workbook(
            workbook_path, month_reports=selected_reports, effective_seed=seed,
            run_started_at=now.replace(tzinfo=None), dataset_created_at=now.replace(tzinfo=None),
            excluded_dates=exclusions,
            workbook_enricher=partial(enrich_workbook, reports=reports, months=months, loans=loans, calendar=calendar, extracted_at=now),
        )
        latest, history = atomic_publish(workbook_path, dataset_path, manifest_path, Path(env("REPORTS_ROOT", "/reports")), now)
    result = {
        "ok": True, "status": "completed", "from_month": from_month, "to_month": to_month,
        "month_count": len(months), "latest_path": str(latest), "history_path": str(history),
        "manual_status": "Pendiente de revision humana", "error": "",
    }
    print(json.dumps({"event": "commissions_completed", **result}, ensure_ascii=True))
    return result


def main() -> int:
    try:
        set_kestra_outputs(generate_report())
        return 0
    except Exception as exc:
        # Los errores HTTP pueden contener URLs de acceso; no imprimirlos.
        message = str(exc) if isinstance(exc, ValueError) else f"Error tecnico: {type(exc).__name__}"
        set_kestra_outputs({"ok": False, "status": "technical_error", "error": message})
        print(json.dumps({"event": "commissions_failed", "error": message}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
