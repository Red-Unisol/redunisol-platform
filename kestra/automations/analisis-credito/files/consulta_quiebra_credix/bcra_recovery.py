"""Recover BCRA fallbacks without re-running CredixSA or extending report freshness."""
from __future__ import annotations

from contextlib import closing
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
import json
import random
import re
import sqlite3
import time
from uuid import uuid4

from .bcra import consult_bcra
from .service import CACHE_MAX_AGE_DAYS, CACHE_VERSION, parse_datetime
from .sqlite_cache import preferred_cache_payload, read_cache_payload

RETRY_MINUTES = (2, 5, 15, 60)
MAX_ATTEMPTS = len(RETRY_MINUTES)
LEASE_SECONDS = 300
RUN_BUDGET_SECONDS = 90
SCHEMA = """
CREATE TABLE IF NOT EXISTS bcra_recovery (
    cuit TEXT PRIMARY KEY,
    cached_at TEXT NOT NULL,
    snapshot_hash TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    lease_token TEXT NOT NULL DEFAULT '',
    lease_until TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'pending',
    last_outcome TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_bcra_recovery_due ON bcra_recovery(state, next_attempt_at);
CREATE TABLE IF NOT EXISTS bcra_kv_sync (
    lookup_key TEXT PRIMARY KEY,
    snapshot_hash TEXT NOT NULL,
    next_attempt_at TEXT NOT NULL DEFAULT ''
);
"""


def utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0)


def snapshot_hash(payload):
    return sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def retry_at(now, index, jitter=random.uniform):
    seconds = RETRY_MINUTES[index] * 60
    return now + timedelta(seconds=seconds + jitter(0, seconds * 0.2))


def _connect(db_path):
    # Never silently create an empty DB inside an ephemeral task container.
    if not Path(db_path).is_file():
        raise RuntimeError("CredixSA cache database is missing; verify the shared volume mount.")
    return sqlite3.connect(db_path, timeout=5)


def _fresh(payload, now):
    cached = parse_datetime(payload.get("cached_at"))
    expires = parse_datetime(payload.get("expires_at"))
    return (payload.get("version") == CACHE_VERSION and cached is not None
            and expires is not None and cached <= now < expires
            and now - cached <= timedelta(days=CACHE_MAX_AGE_DAYS))


def _eligible(payload, cuit, now):
    result = payload.get("result") or {}
    normalized = result.get("normalized") or {}
    bcra = normalized.get("bcra") or {}
    identity = re.sub(r"\D", "", str((normalized.get("persona") or {}).get("cuit") or cuit))
    return (_fresh(payload, now) and re.fullmatch(r"\d{11}", cuit) is not None
            and result.get("cuit") == cuit and identity == cuit
            and result.get("status") == "single" and result.get("ok") is True
            and bcra.get("fuente") == "CredixSA"
            and bcra.get("consulta_directa_estado") in {"unavailable", "invalid_response", "processing_error"})


def enqueue_fallbacks(db_path, now, jitter=random.uniform):
    with closing(_connect(db_path)) as connection, connection:
        connection.executescript(SCHEMA)
        connection.execute("DELETE FROM bcra_recovery WHERE julianday(cached_at) < julianday(?)",
                           ((now - timedelta(days=CACHE_MAX_AGE_DAYS)).isoformat(),))
        # Use the existing expiry index, canonical CUIL key and compact metadata
        # filters before decoding financial payloads; aliases cannot duplicate work.
        rows = connection.execute("""
            SELECT cuit, payload_json FROM credixsa_cache
            WHERE expires_at > ? AND lookup_key = 'credixsa.cuil.' || cuit
              AND json_valid(payload_json)
              AND json_extract(payload_json, '$.result.normalized.bcra.fuente') = 'CredixSA'
              AND json_extract(payload_json, '$.result.normalized.bcra.consulta_directa_estado')
                  IN ('unavailable', 'invalid_response', 'processing_error')
        """, (now.isoformat(),)).fetchall()
        for cuit, raw in rows:
            payload = json.loads(raw)
            if not _eligible(payload, cuit, now):
                continue
            first_due = retry_at(parse_datetime(payload["cached_at"]), 0, jitter)
            connection.execute("""
                INSERT INTO bcra_recovery(cuit, cached_at, snapshot_hash, next_attempt_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(cuit) DO UPDATE SET
                    cached_at = excluded.cached_at, snapshot_hash = excluded.snapshot_hash,
                    next_attempt_at = excluded.next_attempt_at, attempt_count = 0,
                    lease_token = '', lease_until = '', state = 'pending', last_outcome = ''
                WHERE bcra_recovery.snapshot_hash != excluded.snapshot_hash
            """, (cuit, payload["cached_at"], snapshot_hash(payload), first_due.isoformat()))


def claim_next(db_path, now):
    with closing(_connect(db_path)) as connection, connection:
        connection.row_factory = sqlite3.Row
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("""
            UPDATE bcra_recovery SET state = 'exhausted', lease_token = '', lease_until = ''
            WHERE state = 'pending' AND attempt_count >= ? AND lease_until <= ?
        """, (MAX_ATTEMPTS, now.isoformat()))
        row = connection.execute("""
            SELECT * FROM bcra_recovery
            WHERE state = 'pending' AND attempt_count < ? AND next_attempt_at <= ? AND lease_until <= ?
            ORDER BY next_attempt_at, cuit LIMIT 1
        """, (MAX_ATTEMPTS, now.isoformat(), now.isoformat())).fetchone()
        if row is None:
            return None
        claim = dict(row)
        claim['lease_token'] = uuid4().hex
        claim['attempt_count'] += 1
        connection.execute("""
            UPDATE bcra_recovery SET lease_token = ?, lease_until = ?, attempt_count = ? WHERE cuit = ?
        """, (claim['lease_token'], (now + timedelta(seconds=LEASE_SECONDS)).isoformat(),
              claim['attempt_count'], claim['cuit']))
        return claim


def finish_claim(db_path, claim, direct, attempts, now, jitter=random.uniform):
    with closing(_connect(db_path)) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        state = connection.execute("""
            SELECT snapshot_hash FROM bcra_recovery
            WHERE cuit = ? AND lease_token = ? AND lease_until > ?
        """, (claim['cuit'], claim['lease_token'], now.isoformat())).fetchone()
        if state is None or state[0] != claim['snapshot_hash']:
            return 'superseded'
        key = 'credixsa.cuil.' + claim['cuit']
        row = connection.execute("SELECT payload_json FROM credixsa_cache WHERE lookup_key = ?", (key,)).fetchone()
        payload = json.loads(row[0]) if row else None
        if payload is None or snapshot_hash(payload) != claim['snapshot_hash'] or not _eligible(payload, claim['cuit'], now):
            outcome = 'superseded'
            next_due = now
        elif direct is not None:
            updated = deepcopy(payload)
            direct = deepcopy(direct)
            direct['consulta_directa_intentos'] = attempts
            direct['recuperacion'] = {'intentos': claim['attempt_count'], 'fecha': now.isoformat()}
            updated['result']['normalized']['bcra'] = direct
            value = json.dumps(updated, ensure_ascii=True, separators=(',', ':'))
            digest = snapshot_hash(updated)
            # BEGIN IMMEDIATE makes the check and updates atomic. Preserve every
            # field except BCRA; update only aliases of the exact same snapshot.
            aliases = connection.execute("SELECT lookup_key, payload_json FROM credixsa_cache WHERE cuit = ?",
                                         (claim['cuit'],)).fetchall()
            for alias, alias_raw in aliases:
                try:
                    same_snapshot = snapshot_hash(json.loads(alias_raw)) == claim['snapshot_hash']
                except (ValueError, TypeError):
                    same_snapshot = False
                if same_snapshot:
                    connection.execute("UPDATE credixsa_cache SET payload_json = ?, updated_at = CURRENT_TIMESTAMP WHERE lookup_key = ?",
                                       (value, alias))
                    connection.execute("""
                        INSERT INTO bcra_kv_sync(lookup_key, snapshot_hash, next_attempt_at) VALUES (?, ?, ?)
                        ON CONFLICT(lookup_key) DO UPDATE SET
                            snapshot_hash = excluded.snapshot_hash, next_attempt_at = excluded.next_attempt_at
                    """, (alias, digest, now.isoformat()))
            outcome = 'recovered'
            next_due = now
        else:
            outcome = 'exhausted' if claim['attempt_count'] >= MAX_ATTEMPTS else 'pending'
            next_due = now if outcome == 'exhausted' else retry_at(now, claim['attempt_count'], jitter)
        last = 'ok' if outcome == 'recovered' else ('failed' if outcome in {'pending', 'exhausted'} else outcome)
        connection.execute("""
            UPDATE bcra_recovery SET state = ?, next_attempt_at = ?, lease_token = '', lease_until = '', last_outcome = ?
            WHERE cuit = ? AND lease_token = ?
        """, (outcome, next_due.isoformat(), last, claim['cuit'], claim['lease_token']))
        return 'retry_scheduled' if outcome == 'pending' else outcome


def sync_kv(db_path, kv, *, limit=10, now=utc_now, within_budget=lambda: True):
    summary = {'kv_synced': 0, 'kv_errors': 0}
    with closing(_connect(db_path)) as connection:
        rows = connection.execute("""
            SELECT lookup_key, snapshot_hash FROM bcra_kv_sync WHERE next_attempt_at <= ?
            ORDER BY next_attempt_at, lookup_key LIMIT ?
        """, (now().isoformat(), limit)).fetchall()
    for key, digest in rows:
        if not within_budget():
            break
        try:
            payload = read_cache_payload(db_path, key)
            valid = payload is not None and snapshot_hash(payload) == digest and _fresh(payload, now())
            if valid:
                stored = kv.get(key)
                if stored is not None and stored.get('version') != CACHE_VERSION:
                    raise ValueError('Unsupported KV cache version')
                selected = preferred_cache_payload(payload, stored)
                if selected is payload:
                    # No distributed CAS is offered by KV. Recheck immediately
                    # before writing; readers always prefer newer SQLite snapshots
                    # and recovered blocks if another writer races with this PUT.
                    current = read_cache_payload(db_path, key)
                    if current is not None and snapshot_hash(current) == digest:
                        ttl = int((parse_datetime(payload['expires_at']) - now()).total_seconds())
                        if ttl > 0:
                            kv.put(key, payload, ttl)
                            summary['kv_synced'] += 1
            with closing(_connect(db_path)) as connection, connection:
                connection.execute('DELETE FROM bcra_kv_sync WHERE lookup_key = ? AND snapshot_hash = ?', (key, digest))
        except Exception:
            # Keep the durable outbox for the next run. Never log URLs, secrets,
            # identities, financial data or exception text.
            summary['kv_errors'] += 1
            with closing(_connect(db_path)) as connection, connection:
                connection.execute("""
                    UPDATE bcra_kv_sync SET next_attempt_at = ? WHERE lookup_key = ? AND snapshot_hash = ?
                """, ((now() + timedelta(minutes=2)).isoformat(), key, digest))
    return summary


def run_recovery(db_path, kv, *, max_per_run=5, now=utc_now, jitter=random.uniform,
                 consult=consult_bcra, monotonic=time.monotonic):
    if not 1 <= max_per_run <= 10:
        raise ValueError('BCRA recovery batch size must be between 1 and 10')
    started = monotonic()
    summary = dict(processed=0, recovered=0, retry_scheduled=0, exhausted=0, superseded=0)
    enqueue_fallbacks(db_path, now(), jitter)
    for _ in range(max_per_run):
        if monotonic() - started > RUN_BUDGET_SECONDS - 10:
            break
        claim = claim_next(db_path, now())
        if claim is None:
            break
        attempts = []
        direct = None
        payload = read_cache_payload(db_path, 'credixsa.cuil.' + claim['cuit'])
        if payload is not None and snapshot_hash(payload) == claim['snapshot_hash'] and _eligible(payload, claim['cuit'], now()):
            try:
                # One parallel round; long waits live in next_attempt_at, never sleep.
                direct = consult(claim['cuit'], attempts=attempts, max_attempts=1)
            except Exception:
                attempts.append({'result': 'processing_error'})
        outcome = finish_claim(db_path, claim, direct, attempts, now(), jitter)
        summary['processed'] += 1
        summary[outcome] += 1
    summary.update(sync_kv(db_path, kv, now=now,
                          within_budget=lambda: monotonic() - started < RUN_BUDGET_SECONDS - 10))
    with closing(_connect(db_path)) as connection:
        summary['remaining_due'] = connection.execute("""
            SELECT count(*) FROM bcra_recovery WHERE state = 'pending' AND next_attempt_at <= ?
        """, (now().isoformat(),)).fetchone()[0]
        summary['kv_pending'] = connection.execute('SELECT count(*) FROM bcra_kv_sync').fetchone()[0]
    return summary
