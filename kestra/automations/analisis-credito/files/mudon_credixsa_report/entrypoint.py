from __future__ import annotations

from datetime import datetime
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from typing import Any
from zoneinfo import ZoneInfo

from consulta_quiebra_credix.service import CredixConfig

from .core import DEFAULT_MUDON_LINES, fetch_active_mudon_members
from .credix import load_shared_cache, process_output, query_online
from .excel import atomic_publish, write_workbook
from .state import StateStore


LOCAL_TZ = ZoneInfo("America/Argentina/Buenos_Aires")


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(env(name, str(default)))
    except ValueError:
        value = default
    return min(max(value, minimum), maximum)


def env_bool(name: str, default: bool = False) -> bool:
    value = env(name, "true" if default else "false").lower()
    return value in {"1", "true", "yes", "si"}


def parse_trigger_body(raw: str) -> dict[str, Any]:
    if not raw.strip():
        return {}
    value: Any = json.loads(raw)
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict):
        raise ValueError("El body del webhook debe ser un objeto JSON.")
    return value


def log_event(event: str, **fields: Any) -> None:
    print(json.dumps({"event": event, **fields}, ensure_ascii=True, separators=(",", ":")), flush=True)


def build_credix_config() -> CredixConfig:
    required = {
        "cliente": env("CREDIX_CLIENTE"),
        "usuario": env("CREDIX_USER"),
        "password": env("CREDIX_PASS"),
    }
    if not all(required.values()):
        raise ValueError("Faltan CREDIX_CLIENTE, CREDIX_USER o CREDIX_PASS.")
    return CredixConfig(
        cliente=required["cliente"],
        usuario=required["usuario"],
        password=required["password"],
        login_url=env("CREDIX_LOGIN_URL", "https://www.credixsa.com/nuevo/login.php"),
        timeout_ms=env_int("CREDIX_TIMEOUT_SECONDS", 90, 30, 300) * 1000,
        debug_enabled=env_bool("CREDIX_DEBUG", False),
        debug_dir=env("CREDIX_DEBUG_DIR"),
    )


def new_run_id(source: str, now: datetime) -> str:
    if source == "monthly":
        return f"mudon-{now:%Y-%m}"
    return f"mudon-manual-{now:%Y%m%dT%H%M%S}"


def public_run(run: dict[str, Any] | None, stats: dict[str, int] | None = None) -> dict[str, Any]:
    if not run:
        return {
            "ok": True,
            "status": "idle",
            "run_id": "",
            "total": 0,
            "completed": 0,
            "pending": 0,
            "errors": 0,
            "qualifying": 0,
            "latest_path": "",
            "history_path": "",
            "error": "",
        }
    stats = stats or {}
    return {
        "ok": True,
        "status": str(run.get("status") or ""),
        "run_id": str(run.get("run_id") or ""),
        "total": int(stats.get("total", 0)),
        "completed": int(stats.get("completed", 0)),
        "pending": int(stats.get("pending", 0)) + int(stats.get("processing", 0)),
        "errors": int(stats.get("errors", 0)),
        "qualifying": int(stats.get("qualifying", 0)),
        "latest_path": str(run.get("latest_path") or ""),
        "history_path": str(run.get("history_path") or ""),
        "error": "",
    }


def ensure_run(store: StateStore, trigger_id: str, payload: dict[str, Any], now: datetime) -> dict[str, Any] | None:
    active = store.find_active_run()
    if active:
        return active
    if bool(payload.get("retry_errors")):
        reopened = store.reopen_latest_errors()
        if reopened:
            return reopened
    if trigger_id == "reanudar_corrida":
        return None
    source = "monthly" if trigger_id == "primer_dia_del_mes" else "manual"
    run_id = new_run_id(source, now)
    existing = store.get_run(run_id)
    if existing:
        return existing

    core_url = env("MUDON_CORE_BASE_URL")
    if not core_url:
        raise ValueError("Falta MUDON_CORE_BASE_URL.")
    line_values = tuple(
        value.strip()
        for value in env("MUDON_LOAN_LINES", "|".join(DEFAULT_MUDON_LINES)).split("|")
        if value.strip()
    )
    members = fetch_active_mudon_members(
        base_url=core_url,
        bearer_token=env("MUDON_CORE_BEARER_TOKEN"),
        timeout_seconds=env_int("MUDON_CORE_TIMEOUT_SECONDS", 60, 10, 300),
        verify_tls=env_bool("MUDON_CORE_VERIFY_TLS", False),
        max_rows=env_int("MUDON_CORE_MAX_ROWS", 5000, 100, 20000),
        lines=line_values,
    )
    store.create_run(
        run_id,
        source,
        members,
        force_refresh=bool(payload.get("force_refresh")) or env_bool("MUDON_FORCE_REFRESH", False),
    )
    log_event("mudon_run_created", run_id=run_id, member_count=len(members), source=source)
    return store.get_run(run_id)


def publish_if_ready(store: StateStore, run: dict[str, Any], stats: dict[str, int], now: datetime) -> dict[str, Any]:
    run_id = str(run["run_id"])
    if stats["pending"] or stats["processing"]:
        return public_run(store.get_run(run_id), stats)
    store.set_ready_to_publish(run_id)
    members = store.members_for_report(run_id)
    reports_root = Path(env("REPORTS_ROOT", "/reports"))
    with tempfile.TemporaryDirectory(prefix="mudon-report-") as directory:
        workbook_path = Path(directory) / "mudon-jubilados.xlsx"
        write_workbook(workbook_path, store.get_run(run_id) or run, members, stats)
        latest, history = atomic_publish(workbook_path, reports_root, now)
    store.complete_run(run_id, str(latest), str(history), stats["errors"] > 0)
    completed = store.get_run(run_id)
    log_event(
        "mudon_report_published",
        run_id=run_id,
        total=stats["total"],
        qualifying=stats["qualifying"],
        errors=stats["errors"],
    )
    return public_run(completed, stats)


def run_batch(now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(LOCAL_TZ)
    payload = parse_trigger_body(env("TRIGGER_BODY_JSON", "{}"))
    trigger_id = env("TRIGGER_ID", "manual")
    store = StateStore(env("MUDON_STATE_DB_PATH", "/data/credixsa-cache/mudon-report.sqlite"))
    if str(payload.get("mode") or "").lower() == "status":
        latest = store.latest_run()
        return public_run(latest, store.stats(str(latest["run_id"])) if latest else None)

    run = ensure_run(store, trigger_id, payload, now)
    if not run:
        return public_run(None)
    run_id = str(run["run_id"])
    if str(run["status"]) in {"completed", "completed_with_errors"}:
        return public_run(run, store.stats(run_id))
    if str(run["status"]) == "ready_to_publish":
        return publish_if_ready(store, run, store.stats(run_id), now)

    store.release_expired_leases(run_id)
    batch_size = env_int("MUDON_CREDIXSA_BATCH_SIZE", 5, 1, 10)
    delay_seconds = env_int("MUDON_CREDIXSA_DELAY_SECONDS", 15, 0, 120)
    max_attempts = env_int("MUDON_CREDIXSA_MAX_ATTEMPTS", 3, 1, 5)
    cache_age_days = env_int("MUDON_CREDIXSA_CACHE_MAX_AGE_DAYS", 7, 1, 30)
    shared_cache = env("CREDIX_CACHE_SQLITE_PATH", "/data/credixsa-cache/credixsa.sqlite")
    force_refresh = bool(run.get("force_refresh"))
    claimed = store.claim_members(run_id, batch_size)
    credix_config: CredixConfig | None = None

    for index, member in enumerate(claimed):
        cuit = str(member.get("cuit") or "")
        member_key = str(member["member_key"])
        online_attempted = False
        log_event(
            "mudon_member_started",
            run_id=run_id,
            member_number=str(member.get("member_number") or ""),
            cuit_suffix=cuit[-4:],
            attempt=int(member.get("attempts") or 0) + 1,
        )
        try:
            output = None if force_refresh else store.load_recent_result(cuit, cache_age_days)
            source = "cache"
            if output is None and not force_refresh:
                output = load_shared_cache(shared_cache, cuit, cache_age_days)
            if output is None:
                online_attempted = True
                credix_config = credix_config or build_credix_config()
                output = query_online(cuit, credix_config, shared_cache)
                source = "online"
            processed = process_output(output, source=source)
            if not processed.ok and processed.status not in {"none", "multiple"}:
                raise RuntimeError(str(output.get("error") or processed.status or "CredixSA devolvio error."))
            store.save_result(cuit, processed.status, processed.checked_at, processed.output)
            store.complete_member(
                run_id,
                member_key,
                credix_status=processed.status,
                checked_at=processed.checked_at,
                result_source=processed.source,
                employers=processed.employers,
                qualifies_issn=processed.qualifies_issn,
            )
            log_event(
                "mudon_member_completed",
                run_id=run_id,
                member_number=str(member.get("member_number") or ""),
                source=processed.source,
                status=processed.status,
                qualifies_issn=processed.qualifies_issn,
            )
        except Exception as exc:
            store.fail_member(run_id, member_key, f"{type(exc).__name__}: {exc}", max_attempts)
            log_event(
                "mudon_member_error",
                run_id=run_id,
                member_number=str(member.get("member_number") or ""),
                error_type=type(exc).__name__,
                error=str(exc)[:300],
            )
        finally:
            if online_attempted and index + 1 < len(claimed) and delay_seconds:
                time.sleep(delay_seconds)

    stats = store.stats(run_id)
    result = publish_if_ready(store, store.get_run(run_id) or run, stats, now)
    log_event("mudon_batch_completed", run_id=run_id, **stats)
    return result


def set_kestra_outputs(values: dict[str, Any]) -> None:
    try:
        from kestra import Kestra
    except ImportError:
        return
    Kestra.outputs(values)


def main() -> int:
    try:
        result = run_batch()
        set_kestra_outputs(result)
        print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
        return 0
    except Exception as exc:
        result = {
            "ok": False,
            "status": "technical_error",
            "run_id": "",
            "total": 0,
            "completed": 0,
            "pending": 0,
            "errors": 0,
            "qualifying": 0,
            "latest_path": "",
            "history_path": "",
            "error": f"{type(exc).__name__}: {exc}",
        }
        set_kestra_outputs(result)
        print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
        return 1


if __name__ == "__main__":
    sys.exit(main())
