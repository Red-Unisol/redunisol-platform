from __future__ import annotations

from datetime import datetime
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

    with sqlite3.connect(path, timeout=30) as connection:
        connection.executescript(SCHEMA_SQL)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=30000")
        connection.executemany(
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
            rows,
        )
        connection.commit()
    return len(rows)
