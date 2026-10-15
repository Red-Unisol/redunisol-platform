from __future__ import annotations

from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
import json
import sqlite3
from typing import Any


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS credixsa_cache (
    lookup_key TEXT PRIMARY KEY,
    cuit TEXT NOT NULL DEFAULT '',
    nombre TEXT NOT NULL DEFAULT '',
    cached_at TEXT NOT NULL,
    expires_at TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_credixsa_cache_cuit
ON credixsa_cache(cuit);

CREATE INDEX IF NOT EXISTS idx_credixsa_cache_nombre
ON credixsa_cache(nombre);

CREATE INDEX IF NOT EXISTS idx_credixsa_cache_expires_at
ON credixsa_cache(expires_at);
"""


def _date(value: Any) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    except (ValueError, TypeError):
        return datetime.min.replace(tzinfo=timezone.utc)


def preferred_cache_payload(incoming: dict | None, stored: dict | None) -> dict | None:
    """Choose the report generation first, then its successful BCRA enrichment."""
    def order(payload):
        if not isinstance(payload, dict):
            return (_date(None), False, _date(None))
        bcra = ((payload.get("result") or {}).get("normalized") or {}).get("bcra") or {}
        direct = bcra.get("fuente") == "BCRA" and bcra.get("consulta_directa_estado") == "ok"
        return (_date(payload.get("cached_at")), direct, _date(bcra.get("consultado_en")) if direct else _date(None))

    return stored if order(stored) > order(incoming) else incoming


def read_cache_payload(db_path: str, key: str) -> dict | None:
    if not db_path or not key or not Path(db_path).is_file():
        return None
    with closing(sqlite3.connect(Path(db_path).resolve().as_uri() + "?mode=ro", uri=True, timeout=5)) as connection:
        row = connection.execute("SELECT payload_json FROM credixsa_cache WHERE lookup_key = ?", (key,)).fetchone()
    if row is None:
        return None
    try:
        payload = json.loads(row[0])
        return payload if isinstance(payload, dict) else None
    except (ValueError, TypeError):
        return None


def write_cache_entries(db_path: str, entries: list[dict[str, str]]) -> int:
    path = Path(db_path)
    # The shared directory is provisioned by Compose, not by an ephemeral task.
    # Do not hide a missing Docker bind mount by creating a disposable database.
    if not path.parent.is_dir():
        raise RuntimeError("CredixSA cache directory is missing; verify the shared volume mount.")

    rows = []
    for entry in entries:
        key = str(entry.get("key") or "").strip()
        value = str(entry.get("value") or "").strip()
        if not key or not value:
            continue
        try:
            payload = json.loads(value)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        result = payload.get("result")
        if not isinstance(result, dict):
            continue
        rows.append(
            (
                key,
                str(result.get("cuit") or ""),
                str(result.get("nombre") or ""),
                str(payload.get("cached_at") or ""),
                str(payload.get("expires_at") or ""),
                value,
            )
        )

    if not rows:
        return 0

    with closing(sqlite3.connect(path, timeout=30)) as connection, connection:
        connection.executescript(SCHEMA_SQL)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=30000")
        connection.execute("BEGIN IMMEDIATE")
        # KV reads and delayed writers can replay the original fallback with the
        # same cached_at. They must not undo a recovered BCRA block.
        for row in rows:
            existing = connection.execute("SELECT payload_json FROM credixsa_cache WHERE lookup_key = ?", (row[0],)).fetchone()
            incoming = json.loads(row[5])
            try:
                stored = json.loads(existing[0]) if existing else None
            except (ValueError, TypeError):
                stored = None
            if preferred_cache_payload(incoming, stored) is not incoming:
                continue
            connection.execute(
                """
                INSERT INTO credixsa_cache (
                    lookup_key,
                    cuit,
                    nombre,
                    cached_at,
                    expires_at,
                    payload_json,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(lookup_key) DO UPDATE SET
                    cuit = excluded.cuit,
                    nombre = excluded.nombre,
                    cached_at = excluded.cached_at,
                    expires_at = excluded.expires_at,
                    payload_json = excluded.payload_json,
                    updated_at = CURRENT_TIMESTAMP
                WHERE julianday(excluded.cached_at) >= julianday(credixsa_cache.cached_at)
                   OR julianday(credixsa_cache.cached_at) IS NULL
                """,
                row,
            )
        connection.commit()
    return len(rows)
