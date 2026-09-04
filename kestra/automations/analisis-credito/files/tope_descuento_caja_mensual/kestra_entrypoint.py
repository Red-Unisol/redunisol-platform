from __future__ import annotations

import json
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .caja_client import CajaSession
from .checkpoint import Checkpoint, ResultRow
from .report import atomic_publish, build_workbook, save_workbook
from .runner import run_candidates
from .sources import Candidate, SourceStats, collect_candidates

LOCAL_TIMEZONE = ZoneInfo("America/Argentina/Buenos_Aires")


def generate(now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(LOCAL_TIMEZONE)
    run_month = resolve_run_month(os.getenv("REPORT_RUN_MONTH", ""), now)
    pause_seconds = _float_env("REPORT_PAUSE_SECONDS", 3.0)
    limit = _optional_positive_int(os.getenv("REPORT_LIMIT", ""))
    rebuild_only = _bool_env("REPORT_REBUILD_ONLY", False)
    reports_root = Path(os.getenv("REPORTS_ROOT", "/reports"))
    report_dir = reports_root / "analisis-credito" / "tope-descuento-caja"
    checkpoint = Checkpoint(report_dir / ".state" / f"{run_month}.jsonl")

    print(json.dumps({"event": "caja_monthly_sources_started", "run_month": run_month}))
    candidates, stats = collect_candidates()
    minimum_candidates = _int_env("REPORT_MIN_CANDIDATES", 100)
    if len(candidates) < minimum_candidates:
        raise RuntimeError(
            f"El universo mensual tiene {len(candidates)} CUILs y el minimo de seguridad es "
            f"{minimum_candidates}; no se consulta Caja ni se publica el reporte."
        )
    print(
        json.dumps(
            {
                "event": "caja_monthly_sources_completed",
                "run_month": run_month,
                "candidate_count": len(candidates),
                **_stats_dict(stats),
            },
            ensure_ascii=True,
        )
    )

    if rebuild_only:
        if limit is not None:
            raise ValueError("REPORT_REBUILD_ONLY no admite REPORT_LIMIT.")
        result = _rebuild_report(
            candidates=candidates,
            checkpoint=checkpoint,
            stats=stats,
            now=now,
            reports_root=reports_root,
            run_month=run_month,
        )
        _set_kestra_outputs(result)
        print(json.dumps({"event": "caja_monthly_finished", **result}, ensure_ascii=True))
        return result

    caja = CajaSession.from_env()
    summary = run_candidates(
        candidates,
        checkpoint,
        caja=caja,
        now=lambda: datetime.now(LOCAL_TIMEZONE),
        pause_seconds=pause_seconds,
        limit=limit,
        max_consecutive_errors=_int_env("REPORT_MAX_CONSECUTIVE_ERRORS", 8),
    )

    status = "completed" if summary.complete else "limited" if summary.limited else "incomplete"
    latest_path = history_path = ""
    if summary.complete:
        latest_path, history_path = _publish_report(
            candidates,
            checkpoint.latest(),
            stats,
            now,
            reports_root,
            run_month,
        )

    result = {
        "ok": summary.complete or summary.limited,
        "status": status,
        "run_month": run_month,
        "candidate_count": len(candidates),
        "queried_count": summary.queried,
        "pending_count": summary.pending,
        "completed_count": summary.completed,
        "not_found_count": summary.not_found,
        "invalid_cuil_count": summary.invalid_cuils,
        "technical_error_count": summary.technical_errors,
        "session_open_count": summary.session_opens,
        "rebuild_only": False,
        "ignored_new_candidate_count": 0,
        "latest_path": latest_path,
        "history_path": history_path,
        "error": summary.stop_reason,
    }
    _set_kestra_outputs(result)
    print(json.dumps({"event": "caja_monthly_finished", **result}, ensure_ascii=True))
    if status == "incomplete":
        raise RuntimeError(
            summary.stop_reason
            or f"La corrida termino con {summary.pending} CUILs pendientes."
        )
    return result


def _rebuild_report(
    *,
    candidates: list[Candidate],
    checkpoint: Checkpoint,
    stats: SourceStats,
    now: datetime,
    reports_root: Path,
    run_month: str,
) -> dict[str, Any]:
    results = checkpoint.latest()
    if not results:
        raise RuntimeError(f"No existe checkpoint para reconstruir {run_month}.")
    unresolved = [row for row in results.values() if not row.resolved]
    if unresolved:
        raise RuntimeError(
            f"El checkpoint {run_month} tiene {len(unresolved)} resultados no resueltos; "
            "no se reconstruye ni se consulta Caja."
        )
    by_cuil = {candidate.cuil: candidate for candidate in candidates}
    missing_sources = sorted(set(results) - set(by_cuil))
    if missing_sources:
        raise RuntimeError(
            f"Hay {len(missing_sources)} CUILs del checkpoint que ya no estan en las "
            "fuentes; no se reconstruye ni se consulta Caja."
        )
    report_candidates = [by_cuil[cuil] for cuil in sorted(results)]
    ignored_new = len(set(by_cuil) - set(results))
    latest_path, history_path = _publish_report(
        report_candidates,
        results,
        stats,
        now,
        reports_root,
        run_month,
    )
    return {
        "ok": True,
        "status": "completed",
        "run_month": run_month,
        "candidate_count": len(report_candidates),
        "queried_count": 0,
        "pending_count": 0,
        "completed_count": sum(row.status == "completed" for row in results.values()),
        "not_found_count": sum(row.status == "not_found" for row in results.values()),
        "invalid_cuil_count": sum(
            row.status == "invalid_cuil" for row in results.values()
        ),
        "technical_error_count": 0,
        "session_open_count": 0,
        "rebuild_only": True,
        "ignored_new_candidate_count": ignored_new,
        "latest_path": latest_path,
        "history_path": history_path,
        "error": "",
    }


def _publish_report(
    candidates: list[Candidate],
    results: dict[str, ResultRow],
    stats: SourceStats,
    now: datetime,
    reports_root: Path,
    run_month: str,
) -> tuple[str, str]:
    with tempfile.TemporaryDirectory(prefix="tope-caja-mensual-") as directory:
        workbook_path = Path(directory) / "reporte.xlsx"
        workbook = build_workbook(candidates, results, stats, now)
        save_workbook(workbook, workbook_path)
        latest, history = atomic_publish(workbook_path, reports_root, run_month)
    return str(latest), str(history)


def resolve_run_month(value: str, now: datetime) -> str:
    run_month = value.strip() or now.strftime("%Y-%m")
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", run_month):
        raise ValueError("REPORT_RUN_MONTH debe tener formato YYYY-MM.")
    return run_month


def main() -> int:
    generate()
    return 0


def _set_kestra_outputs(values: dict[str, Any]) -> None:
    try:
        from kestra import Kestra
    except ImportError:
        return
    Kestra.outputs(values)


def _stats_dict(stats: SourceStats) -> dict[str, int]:
    return {
        "core_rows": stats.core_rows,
        "core_without_cuil": stats.core_without_cuil,
        "bitrix_jubilado_rows": stats.bitrix_jubilado_rows,
        "bitrix_pensionado_rows": stats.bitrix_pensionado_rows,
        "bitrix_without_direct_cuil": stats.bitrix_without_direct_cuil,
        "bitrix_contact_ids_checked": stats.bitrix_contact_ids_checked,
        "bitrix_contacts_recovered": stats.bitrix_contacts_recovered,
    }


def _float_env(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    value = float(raw) if raw else default
    if value < 0:
        raise ValueError(f"{name} no puede ser negativo.")
    return value


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    value = int(raw) if raw else default
    if value <= 0:
        raise ValueError(f"{name} debe ser mayor a cero.")
    return value


def _optional_positive_int(raw: str) -> int | None:
    if not raw.strip():
        return None
    value = int(raw)
    if value <= 0:
        raise ValueError("REPORT_LIMIT debe ser mayor a cero.")
    return value


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "si", "on"}


if __name__ == "__main__":
    raise SystemExit(main())
