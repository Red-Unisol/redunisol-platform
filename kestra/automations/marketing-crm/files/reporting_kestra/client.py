from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from threading import local
from typing import Any

import requests

TERMINAL_STATES = {"SUCCESS", "WARNING", "FAILED", "KILLED", "CANCELLED"}
BODY_FIELDS = {
    "full_name", "cuil", "email", "whatsapp", "province", "employment_status",
    "payment_bank", "lead_source", "submission_channel", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "landing_slug", "landing_url", "prequalification_available", "prequalified",
    "prequalification_reason", "prequalification_message", "prequalification_rule_version",
}


def check_deadline(deadline: float | None) -> None:
    if deadline is not None and time.monotonic() >= deadline:
        raise RuntimeError("Se agoto el tiempo del informe; se conserva la ultima publicacion.")


def api_get(session: requests.Session, url: str, *, deadline: float | None = None, **params: Any) -> Any:
    for attempt in range(3):
        check_deadline(deadline)
        response = None
        try:
            remaining = max(1, deadline - time.monotonic()) if deadline else 30
            response = session.get(url, params=params, timeout=(5, min(30, remaining)))
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError):
            status = getattr(response, "status_code", None)
            if attempt == 2 or (status and 400 <= status < 500 and status != 429):
                raise RuntimeError("Fallo la consulta del informe; no se publicaran datos incompletos.") from None
            time.sleep(2 ** attempt)
    raise AssertionError("unreachable")


def parse_date(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Las fechas de consulta deben incluir zona horaria")
    return parsed.astimezone(timezone.utc)


def executions(session: requests.Session, base: str, tenant: str, namespace: str, flow: str,
               *, max_records: int = 150_000, deadline: float | None = None,
               as_of: str | None = None) -> list[dict[str, Any]]:
    """Read a stable, complete index, including changes/retries to old executions.

    An explicit upper date disables the implicit recent-history window in Kestra 2.
    Do not send two operations for startDate: the 2.0 parser misreads that combination.
    Business lower cutoffs are applied after reading the index/outputs.
    """
    if max_records < 1:
        raise ValueError("max_records debe ser positivo")
    snapshot = as_of or datetime.now(timezone.utc).isoformat()
    cutoff = parse_date(snapshot)
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    expected_total = None
    context = local()
    sessions: list[requests.Session] = []

    def read_page(page_number: int) -> Any:
        if page_number == 1:
            client = session
        else:
            if not hasattr(context, "session"):
                context.session = requests.Session()
                context.session.auth = session.auth
                context.session.headers.update(session.headers)
                sessions.append(context.session)
            client = context.session
        return api_get(client, f"{base}/api/v1/{tenant}/executions/search", deadline=deadline,
            **{"filters[namespace][EQUALS]": namespace, "filters[flowId][EQUALS]": flow,
               "filters[startDate][LESS_THAN_OR_EQUAL_TO]": snapshot,
               "sort": ["state.startDate:asc", "id:asc"], "page": page_number, "size": 1000})

    page, page_size = 1, 1000
    pending = []
    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            while True:
                payload = pending.pop(0) if pending else read_page(page)
                if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
                    raise RuntimeError("Respuesta de ejecuciones invalida")
                total = payload.get("total")
                if not isinstance(total, int) or total < 0 or total > max_records:
                    raise RuntimeError(f"Total invalido o superior al limite de {max_records}; no se trunca ni publica.")
                if expected_total is None:
                    expected_total = total
                elif total != expected_total:
                    raise RuntimeError("El historial cambio durante la lectura; repetir para evitar un informe incompleto.")
                batch = payload["results"]
                if page == 1 and batch:
                    page_size = len(batch)
                for row in batch:
                    if row.get("namespace") != namespace or row.get("flowId") != flow:
                        raise RuntimeError("Kestra no respeto los filtros; se cancela el informe.")
                    execution_id = row.get("id")
                    if not execution_id or execution_id in seen:
                        raise RuntimeError("Paginacion duplicada o sin identificador")
                    if parse_date((row.get("state") or {}).get("startDate", "")) > cutoff:
                        raise RuntimeError("Kestra devolvio una ejecucion posterior al corte")
                    seen.add(execution_id)
                    # Keep only report fields; never cache headers or arbitrary webhook payloads.
                    body = ((row.get("trigger") or {}).get("variables") or {}).get("body") or {}
                    if isinstance(body, str):
                        try:
                            body = json.loads(body)
                        except ValueError:
                            body = {}
                    clean = {k: row[k] for k in ("id", "namespace", "flowId", "flowRevision", "state", "originalId") if k in row}
                    clean["trigger"] = {"variables": {"body": {k: v for k, v in body.items() if k in BODY_FIELDS} if isinstance(body, dict) else {}}}
                    result.append(clean)
                    if len(result) > expected_total:
                        raise RuntimeError("El numero de registros excede el total esperado")
                if len(result) == expected_total:
                    print(json.dumps({"event": "executions_loaded", "flow": flow, "count": len(result)}), flush=True)
                    return result
                if not batch:
                    raise RuntimeError("Paginacion incompleta; se conserva el ultimo informe.")
                if page % 10 == 0:
                    print(json.dumps({"event": "index_progress", "flow": flow, "count": len(result), "total": expected_total}), flush=True)
                if not pending:
                    remaining_pages = (expected_total - len(result) + page_size - 1) // page_size
                    pending = list(pool.map(read_page, range(page + 1, page + 1 + min(4, remaining_pages))))
                page += 1
    finally:
        for client in sessions:
            client.close()


class OutputCache:
    """Only outputs are persisted; identity/state changes invalidate cached data.

    The current index remains authoritative, so removed executions are not resurrected.
    Failed runs commit completed batches and can resume without publishing a partial file.
    """
    def __init__(self, path: Path | None, base: str, tenant: str):
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(str(path) if path else ":memory:", timeout=30)
        self.origin = base.rstrip("/") + "/" + tenant
        self.connection.execute("CREATE TABLE IF NOT EXISTS outputs_v1 (scope TEXT, id TEXT, fingerprint TEXT, value TEXT, PRIMARY KEY(scope, id))")
        self.connection.commit()
        if path is not None:
            path.chmod(0o600)

    def scope(self, row: dict[str, Any]) -> str:
        return hashlib.sha256(json.dumps([self.origin, row["namespace"], row["flowId"]]).encode()).hexdigest()

    @staticmethod
    def fingerprint(row: dict[str, Any]) -> str:
        return hashlib.sha256(json.dumps([row.get("flowRevision"), row.get("state")], sort_keys=True).encode()).hexdigest()

    def get(self, row: dict[str, Any]) -> dict[str, Any] | None:
        if (row.get("state") or {}).get("current") not in TERMINAL_STATES:
            return None
        found = self.connection.execute("SELECT value FROM outputs_v1 WHERE scope=? AND id=? AND fingerprint=?",
            (self.scope(row), row["id"], self.fingerprint(row))).fetchone()
        return json.loads(found[0]) if found else None

    def put(self, row: dict[str, Any]) -> None:
        if (row.get("state") or {}).get("current") in TERMINAL_STATES:
            self.connection.execute("INSERT OR REPLACE INTO outputs_v1 VALUES (?, ?, ?, ?)",
                (self.scope(row), row["id"], self.fingerprint(row), json.dumps(row["outputs"], ensure_ascii=False)))

    def commit(self) -> None:
        self.connection.commit()

    def close(self) -> None:
        self.connection.close()


def validate_outputs(row: dict[str, Any], outputs: Any) -> None:
    if not isinstance(outputs, dict):
        raise RuntimeError("Respuesta de resultados invalida")
    if (row.get("state") or {}).get("current") in {"SUCCESS", "WARNING"}:
        if not outputs or not (outputs.get("action") or "events_json" in outputs):
            raise RuntimeError(f"Faltan resultados de la ejecucion {row['id']}; no se publica un informe incompleto.")


def hydrate_outputs(rows: list[dict[str, Any]], session: requests.Session, base: str, tenant: str,
                    *, deadline: float | None = None, workers: int = 4,
                    cache: OutputCache | None = None) -> list[dict[str, Any]]:
    if not 1 <= workers <= 4:
        raise ValueError("workers debe estar entre uno y cuatro")
    context = local()
    sessions: list[requests.Session] = []
    hits = fetched = active = 0

    def hydrate(row: dict[str, Any]) -> dict[str, Any]:
        check_deadline(deadline)
        if not hasattr(context, "session"):
            context.session = requests.Session()
            context.session.auth = session.auth
            context.session.headers.update(session.headers)
            sessions.append(context.session)
        outputs = api_get(context.session, f"{base}/api/v1/{tenant}/outputs/executions/{row['id']}", deadline=deadline)
        validate_outputs(row, outputs)
        # Polls without work dominate the commercial history. Keep their meaning,
        # without hundreds of redundant empty fields per execution.
        if outputs.get("action") == "no_pending":
            outputs = {"action": "no_pending"}
        return {**row, "outputs": outputs}

    result = []
    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for start in range(0, len(rows), 100):
                check_deadline(deadline)
                pending = []
                batch = rows[start:start + 100]
                ready = {}
                for row in batch:
                    if (row.get("state") or {}).get("current") not in TERMINAL_STATES:
                        active += 1
                        ready[row["id"]] = {**row, "outputs": {}}
                        continue
                    value = cache.get(row) if cache else None
                    if value is not None:
                        validate_outputs(row, value)
                        ready[row["id"]] = {**row, "outputs": value}
                        hits += 1
                    else:
                        pending.append(row)
                # Consume results in order; commit progress even if a later item fails.
                try:
                    for item in pool.map(hydrate, pending):
                        ready[item["id"]] = item
                        fetched += 1
                        if cache:
                            cache.put(item)
                finally:
                    if cache:
                        cache.commit()
                result.extend(ready[row["id"]] for row in batch)
                if start % 1000 == 0 or len(result) == len(rows):
                    print(json.dumps({"event": "outputs_loaded", "count": len(result), "total": len(rows),
                                      "cache_hits": hits, "fetched": fetched, "in_progress": active}), flush=True)
    finally:
        for client in sessions:
            client.close()
    return result


def publish(workbook, root: Path, report: str, generated_at: datetime,
            *, deadline: float | None = None, metadata: dict[str, Any] | None = None) -> tuple[Path, Path]:
    report_dir = root / "marketing" / report
    history_dir = report_dir / "historico"
    history_dir.mkdir(parents=True, exist_ok=True)
    dated = history_dir / f"{generated_at:%Y-%m-%d}.xlsx"
    latest = report_dir / "ultimo.xlsx"
    temporary_paths = []
    destinations = [dated, latest]
    if metadata is not None:
        metadata_dir = report_dir / "metadata"
        metadata_dir.mkdir(exist_ok=True)
        destinations += [metadata_dir / f"{generated_at:%Y-%m-%d}.json", report_dir / "ultimo.json"]
    try:
        for _ in destinations:
            with tempfile.NamedTemporaryFile(dir=report_dir, suffix=".tmp", delete=False) as handle:
                temporary_paths.append(Path(handle.name))
        workbook.save(temporary_paths[0])
        shutil.copy2(temporary_paths[0], temporary_paths[1])
        for path in temporary_paths[2:]:
            path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        for path in temporary_paths:
            path.chmod(0o644)
        check_deadline(deadline)
        for source, destination in zip(temporary_paths, destinations):
            os.replace(source, destination)
    finally:
        for path in temporary_paths:
            path.unlink(missing_ok=True)
    return latest, dated
