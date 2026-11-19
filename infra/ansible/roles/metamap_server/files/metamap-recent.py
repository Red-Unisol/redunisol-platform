#!/usr/bin/env python3
"""Bounded, read-only recent export and transactional import; Python 3.6+.

The export never creates a snapshot, temporary database or archive at source.
Run the importer only against an empty, separately initialized destination.
Payloads and client password hashes belong only in the encrypted SSH stream.
"""
import argparse
import datetime
import hashlib
import json
import os
import sqlite3
import sys

TABLES = ("clients", "validations", "transfer_trace_events")
LIMITS = {"clients": 100, "validations": 2000, "transfer_trace_events": 20000}
SCOPE = "metamap-recent-v1"
MAX_LINE = 16 * 1024 * 1024
MAX_STREAM = 64 * 1024 * 1024

def require(condition, message):
    if not condition:
        raise ValueError(message)

def cutoff(value):
    require(isinstance(value, str), "UTC cutoff required")
    datetime.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    return value[:19]

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")

def connection(path, readonly):
    require(os.path.isfile(path) and not os.path.islink(path), "Existing regular SQLite file required")
    db = sqlite3.connect("file:" + os.path.realpath(path) + ("?mode=ro" if readonly else "?mode=rw"), uri=True, timeout=5)
    db.execute("PRAGMA temp_store=MEMORY")
    db.execute("PRAGMA cache_size=-1024")
    if readonly:
        db.execute("PRAGMA query_only=ON")
    return db

def columns(db, table):
    require(table in TABLES, "Unexpected table")
    result = [row[1] for row in db.execute("PRAGMA table_info(" + table + ")")]
    require(result and all(name.replace("_", "").isalnum() for name in result), "Expected application schema required")
    return result

def export_recent(path, since, output):
    lower = cutoff(since)
    db = connection(path, True)
    try:
        db.execute("BEGIN")
        schema = {name: columns(db, name) for name in TABLES}
        dataset = {}
        for table in TABLES:
            where = "" if table == "clients" else " WHERE " + ("last_received_at" if table == "validations" else "occurred_at") + ">=?"
            order = "client_id" if table == "clients" else "verification_id" if table == "validations" else "event_id"
            args = () if table == "clients" else (lower,)
            rows = db.execute("SELECT * FROM " + table + where + " ORDER BY " + order + " LIMIT " + str(LIMITS[table] + 1), args).fetchall()
            require(len(rows) <= LIMITS[table], "Recent export exceeds reviewed row budget")
            dataset[table] = rows
        # Release the source read transaction before SSH/network backpressure.
        db.rollback()
    finally:
        db.close()
    digest = hashlib.sha256()
    size = 0
    counts = {}
    def send(record):
        nonlocal size
        line = encoded(record)
        require(len(line) <= MAX_LINE, "Row exceeds reviewed size budget")
        size += len(line)
        require(size <= MAX_STREAM, "Export exceeds reviewed byte budget")
        digest.update(line)
        output.write(line)
    send({"scope": SCOPE, "since": since, "columns": schema})
    for table in TABLES:
        counts[table] = len(dataset[table])
        for values in dataset[table]:
            send({"table": table, "values": list(values)})
    output.write(encoded({"end": True, "counts": counts, "sha256": digest.hexdigest(), "bytes": size}))

def import_recent(path, source):
    db = connection(path, False)
    digest = hashlib.sha256()
    size = 0
    counts = {name: 0 for name in TABLES}
    try:
        db.execute("BEGIN IMMEDIATE")
        expected = {name: columns(db, name) for name in TABLES}
        require(all(db.execute("SELECT COUNT(*) FROM " + name).fetchone()[0] == 0 for name in TABLES), "Import requires an empty staged database")
        first = source.readline(MAX_LINE + 1)
        require(first and len(first) <= MAX_LINE, "Missing or oversized header")
        header = json.loads(first.decode("utf-8"))
        require(header.get("scope") == SCOPE, "Unexpected migration scope")
        cutoff(header.get("since"))
        source_columns = header.get("columns")
        require(isinstance(source_columns, dict) and set(source_columns) == set(expected) and all(isinstance(source_columns[name], list) and len(source_columns[name]) == len(expected[name]) and set(source_columns[name]) == set(expected[name]) for name in TABLES), "Source/destination schemas differ")
        digest.update(first)
        size += len(first)
        completed = None
        while True:
            line = source.readline(MAX_LINE + 1)
            require(line and len(line) <= MAX_LINE, "Truncated or oversized migration stream")
            record = json.loads(line.decode("utf-8"))
            if record.get("end") is True:
                completed = record
                break
            table = record.get("table")
            require(table in TABLES and set(record) == {"table", "values"}, "Unexpected migration record")
            values = record["values"]
            require(isinstance(values, list) and len(values) == len(expected[table]), "Invalid row shape")
            counts[table] += 1
            require(counts[table] <= LIMITS[table], "Import exceeds reviewed row budget")
            quoted = ",".join('"' + name + '"' for name in source_columns[table])
            db.execute("INSERT INTO " + table + " (" + quoted + ") VALUES (" + ",".join("?" for unused in values) + ")", values)
            digest.update(line)
            size += len(line)
            require(size <= MAX_STREAM, "Import exceeds reviewed byte budget")
        require(source.read(1) == b"", "Trailing data after migration footer")
        require(completed.get("sha256") == digest.hexdigest() and completed.get("counts") == counts and completed.get("bytes") == size, "Migration counts or digest differ")
        require(db.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "Imported SQLite integrity check failed")
        db.commit()
        os.chmod(path, 0o600)
        return {"scope": SCOPE, "since": header["since"], "counts": counts, "sha256": digest.hexdigest(), "stream_bytes": size, "integrity": "ok"}
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("export", "import"))
    parser.add_argument("--database", required=True)
    parser.add_argument("--since")
    args = parser.parse_args()
    try:
        if args.operation == "export":
            export_recent(args.database, args.since, sys.stdout.buffer)
        else:
            print(json.dumps(import_recent(args.database, sys.stdin.buffer), sort_keys=True))
    except Exception as error:
        print(json.dumps({"accepted": False, "error": str(error) if isinstance(error, ValueError) else type(error).__name__}), file=sys.stderr)
        return 2
    return 0

if __name__ == "__main__":
    sys.exit(main())
