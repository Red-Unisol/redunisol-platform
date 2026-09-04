from __future__ import annotations

from contextlib import closing
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
from typing import Any, Iterable

from .core import CoreMember


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS mudon_report_runs (
    run_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    force_refresh INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT '',
    latest_path TEXT NOT NULL DEFAULT '',
    history_path TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS mudon_report_members (
    run_id TEXT NOT NULL,
    member_key TEXT NOT NULL,
    cuit TEXT NOT NULL DEFAULT '',
    dni TEXT NOT NULL DEFAULT '',
    full_name TEXT NOT NULL DEFAULT '',
    member_number TEXT NOT NULL DEFAULT '',
    loan_accounts_json TEXT NOT NULL DEFAULT '[]',
    loan_lines_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    lease_until TEXT NOT NULL DEFAULT '',
    credix_status TEXT NOT NULL DEFAULT '',
    checked_at TEXT NOT NULL DEFAULT '',
    result_source TEXT NOT NULL DEFAULT '',
    employers_json TEXT NOT NULL DEFAULT '[]',
    qualifies_issn INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, member_key),
    FOREIGN KEY (run_id) REFERENCES mudon_report_runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_mudon_members_status
ON mudon_report_members(run_id, status, attempts, member_number);

CREATE TABLE IF NOT EXISTS mudon_credix_results (
    cuit TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    checked_at TEXT NOT NULL,
    output_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mudon_credix_results_checked_at
ON mudon_credix_results(checked_at);
"""


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


class StateStore:
    def __init__(self, path: str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self.connect()) as connection:
            connection.executescript(SCHEMA_SQL)

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=30000")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def create_run(
        self,
        run_id: str,
        source: str,
        members: Iterable[CoreMember],
        *,
        force_refresh: bool,
    ) -> None:
        now = utc_now().isoformat()
        with closing(self.connect()) as connection:
            connection.execute(
                """
                INSERT INTO mudon_report_runs (
                    run_id, source, status, force_refresh, created_at, updated_at
                ) VALUES (?, ?, 'running', ?, ?, ?)
                """,
                (run_id, source, int(force_refresh), now, now),
            )
            connection.executemany(
                """
                INSERT INTO mudon_report_members (
                    run_id, member_key, cuit, dni, full_name, member_number,
                    loan_accounts_json, loan_lines_json, status, error, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        run_id,
                        member.member_key,
                        member.cuit,
                        member.dni,
                        member.full_name,
                        member.member_number,
                        json.dumps(sorted(member.loan_accounts), ensure_ascii=False),
                        json.dumps(sorted(member.loan_lines), ensure_ascii=False),
                        "pending" if len(member.cuit) == 11 else "error",
                        "" if len(member.cuit) == 11 else "CUIL ausente o invalido en el Core.",
                        now,
                    )
                    for member in members
                ],
            )
            connection.commit()

    def load_recent_result(self, cuit: str, max_age_days: int) -> dict[str, Any] | None:
        cutoff = (utc_now() - timedelta(days=max_age_days)).isoformat()
        with closing(self.connect()) as connection:
            row = connection.execute(
                """
                SELECT output_json FROM mudon_credix_results
                WHERE cuit = ? AND checked_at >= ?
                """,
                (cuit, cutoff),
            ).fetchone()
        if not row:
            return None
        try:
            value = json.loads(str(row["output_json"]))
        except json.JSONDecodeError:
            return None
        return value if isinstance(value, dict) else None

    def save_result(self, cuit: str, status: str, checked_at: str, output: dict[str, Any]) -> None:
        now = utc_now().isoformat()
        with closing(self.connect()) as connection:
            connection.execute(
                """
                INSERT INTO mudon_credix_results (cuit, status, checked_at, output_json, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(cuit) DO UPDATE SET
                    status = excluded.status,
                    checked_at = excluded.checked_at,
                    output_json = excluded.output_json,
                    updated_at = excluded.updated_at
                """,
                (
                    cuit,
                    status,
                    checked_at,
                    json.dumps(output, ensure_ascii=False, separators=(",", ":")),
                    now,
                ),
            )
            connection.commit()

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with closing(self.connect()) as connection:
            row = connection.execute(
                "SELECT * FROM mudon_report_runs WHERE run_id = ?", (run_id,)
            ).fetchone()
        return dict(row) if row else None

    def find_active_run(self) -> dict[str, Any] | None:
        with closing(self.connect()) as connection:
            row = connection.execute(
                """
                SELECT * FROM mudon_report_runs
                WHERE status IN ('running', 'ready_to_publish')
                ORDER BY created_at ASC LIMIT 1
                """
            ).fetchone()
        return dict(row) if row else None

    def latest_run(self) -> dict[str, Any] | None:
        with closing(self.connect()) as connection:
            row = connection.execute(
                "SELECT * FROM mudon_report_runs ORDER BY created_at DESC LIMIT 1"
            ).fetchone()
        return dict(row) if row else None

    def reopen_latest_errors(self) -> dict[str, Any] | None:
        run = self.latest_run()
        if not run or run["status"] not in {"completed_with_errors", "running"}:
            return None
        now = utc_now().isoformat()
        with closing(self.connect()) as connection:
            connection.execute(
                """
                UPDATE mudon_report_members
                SET status = 'pending', attempts = 0, lease_until = '', error = '', updated_at = ?
                WHERE run_id = ? AND status = 'error'
                """,
                (now, run["run_id"]),
            )
            connection.execute(
                "UPDATE mudon_report_runs SET status = 'running', completed_at = '', updated_at = ? WHERE run_id = ?",
                (now, run["run_id"]),
            )
            connection.commit()
        return self.get_run(str(run["run_id"]))

    def release_expired_leases(self, run_id: str) -> None:
        now = utc_now().isoformat()
        with closing(self.connect()) as connection:
            connection.execute(
                """
                UPDATE mudon_report_members
                SET status = 'pending', lease_until = '', updated_at = ?
                WHERE run_id = ? AND status = 'processing'
                  AND lease_until != '' AND lease_until < ?
                """,
                (now, run_id, now),
            )
            connection.commit()

    def claim_members(self, run_id: str, limit: int, lease_minutes: int = 20) -> list[dict[str, Any]]:
        now = utc_now()
        lease_until = (now + timedelta(minutes=lease_minutes)).isoformat()
        with closing(self.connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            rows = connection.execute(
                """
                SELECT * FROM mudon_report_members
                WHERE run_id = ? AND status = 'pending'
                ORDER BY
                    CASE WHEN member_number GLOB '[0-9]*' THEN CAST(member_number AS INTEGER) ELSE 2147483647 END,
                    member_key
                LIMIT ?
                """,
                (run_id, limit),
            ).fetchall()
            keys = [str(row["member_key"]) for row in rows]
            if keys:
                placeholders = ",".join("?" for _ in keys)
                connection.execute(
                    f"""
                    UPDATE mudon_report_members
                    SET status = 'processing', attempts = attempts + 1,
                        lease_until = ?, updated_at = ?
                    WHERE run_id = ? AND member_key IN ({placeholders})
                    """,
                    (lease_until, now.isoformat(), run_id, *keys),
                )
            connection.commit()
        return [dict(row) for row in rows]

    def complete_member(
        self,
        run_id: str,
        member_key: str,
        *,
        credix_status: str,
        checked_at: str,
        result_source: str,
        employers: list[dict[str, Any]],
        qualifies_issn: bool,
    ) -> None:
        now = utc_now().isoformat()
        with closing(self.connect()) as connection:
            connection.execute(
                """
                UPDATE mudon_report_members
                SET status = 'completed', lease_until = '', credix_status = ?,
                    checked_at = ?, result_source = ?, employers_json = ?,
                    qualifies_issn = ?, error = '', updated_at = ?
                WHERE run_id = ? AND member_key = ?
                """,
                (
                    credix_status,
                    checked_at,
                    result_source,
                    json.dumps(employers, ensure_ascii=False),
                    int(qualifies_issn),
                    now,
                    run_id,
                    member_key,
                ),
            )
            connection.commit()

    def fail_member(self, run_id: str, member_key: str, error: str, max_attempts: int) -> None:
        now = utc_now().isoformat()
        with closing(self.connect()) as connection:
            row = connection.execute(
                "SELECT attempts FROM mudon_report_members WHERE run_id = ? AND member_key = ?",
                (run_id, member_key),
            ).fetchone()
            terminal = not row or int(row["attempts"]) >= max_attempts
            connection.execute(
                """
                UPDATE mudon_report_members
                SET status = ?, lease_until = '', error = ?, updated_at = ?
                WHERE run_id = ? AND member_key = ?
                """,
                ("error" if terminal else "pending", error[:1000], now, run_id, member_key),
            )
            connection.commit()

    def members_for_report(self, run_id: str) -> list[dict[str, Any]]:
        with closing(self.connect()) as connection:
            rows = connection.execute(
                """
                SELECT * FROM mudon_report_members WHERE run_id = ?
                ORDER BY
                    CASE WHEN member_number GLOB '[0-9]*' THEN CAST(member_number AS INTEGER) ELSE 2147483647 END,
                    full_name
                """,
                (run_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def stats(self, run_id: str) -> dict[str, int]:
        with closing(self.connect()) as connection:
            rows = connection.execute(
                """
                SELECT status, result_source, qualifies_issn, COUNT(*) AS amount
                FROM mudon_report_members WHERE run_id = ?
                GROUP BY status, result_source, qualifies_issn
                """,
                (run_id,),
            ).fetchall()
        result = {
            "total": 0,
            "pending": 0,
            "processing": 0,
            "completed": 0,
            "errors": 0,
            "cache": 0,
            "online": 0,
            "qualifying": 0,
        }
        for row in rows:
            amount = int(row["amount"])
            result["total"] += amount
            status = str(row["status"])
            if status == "error":
                result["errors"] += amount
            elif status in result:
                result[status] += amount
            source = str(row["result_source"])
            if source in {"cache", "online"}:
                result[source] += amount
            if int(row["qualifies_issn"]):
                result["qualifying"] += amount
        return result

    def set_ready_to_publish(self, run_id: str) -> None:
        with closing(self.connect()) as connection:
            connection.execute(
                "UPDATE mudon_report_runs SET status = 'ready_to_publish', updated_at = ? WHERE run_id = ?",
                (utc_now().isoformat(), run_id),
            )
            connection.commit()

    def complete_run(self, run_id: str, latest_path: str, history_path: str, has_errors: bool) -> None:
        now = utc_now().isoformat()
        with closing(self.connect()) as connection:
            connection.execute(
                """
                UPDATE mudon_report_runs
                SET status = ?, completed_at = ?, updated_at = ?, latest_path = ?, history_path = ?
                WHERE run_id = ?
                """,
                (
                    "completed_with_errors" if has_errors else "completed",
                    now,
                    now,
                    latest_path,
                    history_path,
                    run_id,
                ),
            )
            connection.commit()
