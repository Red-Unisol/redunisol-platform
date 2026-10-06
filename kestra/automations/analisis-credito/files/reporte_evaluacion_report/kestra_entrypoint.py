from __future__ import annotations

import json
import os
import shutil
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Mapping
from zoneinfo import ZoneInfo

from .analysis import build_month_report
from .core import (
    DatasetMeta,
    EvaluateApiClient,
    build_month_sequence,
    derive_month_seed,
    fetch_month_dataset,
    month_start_end,
)
from .excel import write_report_workbook
from .storage import SQLiteDatasetStore

LOCAL_TIMEZONE = ZoneInfo("America/Argentina/Buenos_Aires")
DEFAULT_FROM_MONTH = "2025-10"


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def parse_trigger_body(raw: str) -> dict[str, Any]:
    if not raw.strip():
        return {}
    value: Any = json.loads(raw)
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict):
        raise ValueError("El body del webhook debe ser un objeto JSON.")
    return value


def last_closed_month(today: date) -> str:
    first_of_current_month = today.replace(day=1)
    return (first_of_current_month - timedelta(days=1)).strftime("%Y-%m")


def resolve_period(
    *,
    today: date,
    payload: Mapping[str, Any] | None = None,
    input_from_month: str = "",
    input_to_month: str = "",
    default_from_month: str = DEFAULT_FROM_MONTH,
) -> tuple[str, str]:
    payload = payload or {}
    from_month = str(payload.get("from_month") or input_from_month or default_from_month).strip()
    to_month = str(payload.get("to_month") or input_to_month or last_closed_month(today)).strip()

    start, _ = month_start_end(from_month)
    end, _ = month_start_end(to_month)
    closed_end, _ = month_start_end(last_closed_month(today))
    if end < start:
        raise ValueError("El mes final no puede ser anterior al mes inicial.")
    if end > closed_end:
        raise ValueError("El reporte solo admite meses cerrados.")
    return from_month, to_month


def atomic_publish(source: Path, reports_root: Path, now: datetime) -> tuple[Path, Path]:
    report_dir = reports_root / "analisis-credito" / "reporte-evaluacion"
    history_dir = report_dir / "historico"
    history_dir.mkdir(parents=True, exist_ok=True)

    latest = report_dir / "ultimo.xlsx"
    dated = history_dir / f"{now:%Y-%m-%d}.xlsx"
    for destination in (latest, dated):
        with tempfile.NamedTemporaryFile(dir=destination.parent, suffix=".xlsx", delete=False) as handle:
            temporary = Path(handle.name)
        try:
            shutil.copyfile(source, temporary)
            os.replace(temporary, destination)
            destination.chmod(0o644)
        finally:
            temporary.unlink(missing_ok=True)
    return latest, dated


def set_kestra_outputs(values: dict[str, Any]) -> None:
    try:
        from kestra import Kestra
    except ImportError:
        return
    Kestra.outputs(values)


def generate_report(now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(LOCAL_TIMEZONE)
    payload = parse_trigger_body(env("TRIGGER_BODY_JSON", "{}"))
    from_month, to_month = resolve_period(
        today=now.date(),
        payload=payload,
        input_from_month=env("REPORT_INPUT_FROM_MONTH"),
        input_to_month=env("REPORT_INPUT_TO_MONTH"),
        default_from_month=env("REPORT_DEFAULT_FROM_MONTH", DEFAULT_FROM_MONTH),
    )
    month_values = build_month_sequence(from_month, to_month)
    base_url = env("REPORTE_EVALUACION_BASE_URL")
    if not base_url:
        raise ValueError("Falta REPORTE_EVALUACION_BASE_URL.")

    timeout = int(env("REPORTE_EVALUACION_TIMEOUT_SECONDS", "60"))
    per_day_max = int(env("REPORTE_EVALUACION_PER_DAY_MAX", "20000"))
    verify_ssl = env("REPORTE_EVALUACION_VERIFY_SSL", "false").lower() == "true"
    effective_seed = int(env("REPORTE_EVALUACION_SAMPLE_SEED", "202510"))
    client = EvaluateApiClient(base_url=base_url, timeout=timeout, verify_ssl=verify_ssl)

    print(json.dumps({"event": "report_started", "from_month": from_month, "to_month": to_month}))
    with tempfile.TemporaryDirectory(prefix="reporte-evaluacion-") as directory:
        workspace = Path(directory)
        db_path = workspace / "dataset.sqlite"
        workbook_path = workspace / "reporte.xlsx"
        months = [
            fetch_month_dataset(
                client,
                month_value,
                sample_seed=derive_month_seed(effective_seed, month_value),
                per_day_max=per_day_max,
            )
            for month_value in month_values
        ]
        meta = DatasetMeta(
            created_at=now.replace(tzinfo=None),
            effective_seed=effective_seed,
            base_url=base_url,
            per_day_max=per_day_max,
            verify_ssl=verify_ssl,
            month_values=month_values,
        )
        store = SQLiteDatasetStore(db_path)
        store.save_dataset(meta=meta, months=months, replace=True)
        loaded_meta, loaded_months = store.load_dataset()
        reports = [build_month_report(month) for month in loaded_months]
        write_report_workbook(
            workbook_path,
            month_reports=reports,
            effective_seed=loaded_meta.effective_seed,
            run_started_at=now.replace(tzinfo=None),
            dataset_created_at=loaded_meta.created_at,
        )
        latest, dated = atomic_publish(
            workbook_path,
            Path(env("REPORTS_ROOT", "/reports")),
            now,
        )

    result = {
        "ok": True,
        "status": "completed",
        "from_month": from_month,
        "to_month": to_month,
        "month_count": len(month_values),
        "latest_path": str(latest),
        "history_path": str(dated),
        "error": "",
    }
    print(json.dumps({"event": "report_completed", **result}, ensure_ascii=True))
    return result


def main() -> int:
    try:
        set_kestra_outputs(generate_report())
        return 0
    except Exception as exc:
        set_kestra_outputs(
            {
                "ok": False,
                "status": "technical_error",
                "from_month": "",
                "to_month": "",
                "month_count": 0,
                "latest_path": "",
                "history_path": "",
                "error": str(exc),
            }
        )
        print(
            json.dumps(
                {"event": "report_failed", "error_type": type(exc).__name__, "error": str(exc)},
                ensure_ascii=True,
            )
        )
        raise


if __name__ == "__main__":
    raise SystemExit(main())
