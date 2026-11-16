#!/usr/bin/env python3
"""Bounded BCRA volume evidence and destination-only SQLite verification.

The caller must stop both service instances and hold the scheduler gate. The
explicit CLI confirmations declare that precondition; this tool does not inspect
Docker or claim to enforce a distributed lock. It never runs rsync or refresh.
Inventory/compare must happen before starting the copied application: startup
legitimately changes refresh.json, and SQLite recovery changes pending files.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import sqlite3
import stat
import sys
import time


KINDS = {"current", "history", "corrections", "normal", "padron"}
SCHEMA_COLUMNS = {
    "metadata": {"value"}, "import_checkpoint": {"id", "value"},
    "debts": {"identification", "entity", "period", "situation", "amount_tenths", "days", "observation", "refinancing", "recategorization", "legal", "technical", "origin"},
    "entities": {"code", "name"}, "names": {"identification", "name"},
    "history": {"identification", "entity", "data"},
    "normal_since": {"identification", "since"},
    "corrections": {"identification", "entity", "period", "situation", "amount_tenths"},
}
SCHEMA_TABLES = {"current": {"debts", "entities", "names", "metadata"},
                 "history": {"history", "metadata", "import_checkpoint"},
                 "padron": {"names", "metadata", "import_checkpoint"},
                 "normal": {"normal_since", "metadata", "import_checkpoint"},
                 "corrections": {"corrections", "metadata", "import_checkpoint"}}
HASH = r"[0-9a-f]{64}"
ARCHIVE = r"(?:[0-9]{6}(?:DEUDORES|INFRET|INFRETPA)|(?:24DSF|1DSF)[0-9]{6}|[0-9]{8}PADRON)\.7Z"
RAW_KIND = r"(?:DEUDORES|INFRET|INFRETPA|24DSF|1DSF|PADRON)"
COMPONENT = r"(?:current|history|corrections|normal|padron)"
TEMP = r"refresh-[a-z0-9_]{8}"
FILE_PATTERNS = [
    r"(?:current\.json|active\.json|refresh\.json|current\.json\.tmp|active\.json\.tmp|refresh\.tmp)",
    r"snapshot\.sqlite(?:-journal)?",
    rf"components/{COMPONENT}/{HASH}\.sqlite(?:-journal)?",
    rf"pending/{COMPONENT}-{HASH}\.sqlite(?:-journal)?",
    rf"raw/{RAW_KIND}/{HASH}/{ARCHIVE}",
    rf"archives/{HASH}/{ARCHIVE}",
    rf"{TEMP}/(?:{ARCHIVE}|snapshot\.sqlite(?:-journal)?)",
]
DIRECTORY_PATTERNS = [
    r"\.", r"components", rf"components/{COMPONENT}", r"pending", r"raw",
    rf"raw/{RAW_KIND}", rf"raw/{RAW_KIND}/{HASH}", r"archives", rf"archives/{HASH}", TEMP,
]


class DataError(Exception):
    """Only fixed reason codes may cross the CLI boundary; never file contents."""


def now() :
    return datetime.now(timezone.utc).isoformat()


def canonical(value) :
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def allowed_path(value, kind) :
    if not isinstance(value, str) or "\\" in value or value.startswith("/"):
        return False
    if value != "." and any(part in ("", ".", "..") for part in value.split("/")):
        return False
    patterns = DIRECTORY_PATTERNS if kind == "directory" else FILE_PATTERNS
    return any(re.fullmatch(pattern, value) for pattern in patterns)


def root_directory(value) :
    absolute = value.absolute()
    if absolute.is_symlink() or absolute.resolve() != absolute or not absolute.is_dir():
        raise DataError("invalid_volume_root")
    if absolute == Path(absolute.anchor):
        raise DataError("filesystem_root_forbidden")
    return absolute


def within(path, root):
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def signature(info) :
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_nlink)


def inspect_tree(root) :
    """Validate every name/type before reading or exporting any file content."""
    rows = [(".", root.lstat())]

    def visit(directory) :
        for path in sorted(directory.iterdir(), key=lambda item: item.name):
            info = path.lstat()
            relative = path.relative_to(root).as_posix()
            if stat.S_ISLNK(info.st_mode):
                raise DataError("symlink_forbidden")
            kind = "directory" if stat.S_ISDIR(info.st_mode) else "file"
            if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                raise DataError("special_file_forbidden")
            if not allowed_path(relative, kind):
                raise DataError("unexpected_volume_entry")
            rows.append((relative, info))
            if kind == "directory":
                visit(path)

    visit(root)
    return sorted(rows, key=lambda row: row[0])


class ReadLimiter:
    def __init__(self, bytes_per_second, *, clock = time.monotonic,
                 sleeper = time.sleep) :
        if not math.isfinite(bytes_per_second) or bytes_per_second <= 0:
            raise DataError("positive_read_limit_required")
        self.rate, self.clock, self.sleeper = bytes_per_second, clock, sleeper
        self.next_read = clock()
        self.bytes = 0

    def consume(self, count) :
        self.bytes += count
        self.next_read = max(self.next_read, self.clock()) + count / self.rate
        wait = self.next_read - self.clock()
        if wait > 0:
            self.sleeper(wait)


def hash_file(path, expected, limiter) :
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
    descriptor = os.open(path, flags)
    digest = hashlib.sha256()
    with os.fdopen(descriptor, "rb") as handle:
        if signature(os.fstat(handle.fileno())) != signature(expected):
            raise DataError("volume_changed_during_inventory")
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            limiter.consume(len(chunk))
        if signature(os.fstat(handle.fileno())) != signature(expected):
            raise DataError("volume_changed_during_inventory")
    return digest.hexdigest()


def inventory(root, max_read_mib_per_sec = 4, *, limiter = None) :
    root = root_directory(root)
    limit = limiter or ReadLimiter(max_read_mib_per_sec * 1024 ** 2)
    initial = inspect_tree(root)
    identities = {}
    for relative, info in initial:
        if stat.S_ISREG(info.st_mode):
            identities.setdefault((info.st_dev, info.st_ino), []).append(relative)
    for relative, info in initial:
        if stat.S_ISREG(info.st_mode) and info.st_nlink != len(identities[(info.st_dev, info.st_ino)]):
            raise DataError("hardlink_outside_volume")
    digests = {}
    entries = []
    for relative, info in initial:
        kind = "directory" if stat.S_ISDIR(info.st_mode) else "file"
        entry = {"path": relative, "kind": kind, "uid": info.st_uid, "gid": info.st_gid,
                 "mode": format(stat.S_IMODE(info.st_mode), "04o")}
        if kind == "file":
            identity = (info.st_dev, info.st_ino)
            if identity not in digests:
                digests[identity] = hash_file(root / relative, info, limit)
            paths = identities[identity]
            entry.update(size=info.st_size, sha256=digests[identity],
                         hardlink_to=paths[0] if len(paths) > 1 and relative != paths[0] else None)
        entries.append(entry)
    final = inspect_tree(root)
    if [(path, signature(info)) for path, info in initial] != [(path, signature(info)) for path, info in final]:
        raise DataError("volume_changed_during_inventory")
    return {"version": 1, "status": "inventoried", "generated_at": now(),
            "stopped_precondition": "declared_by_operator", "read_limit_bytes_per_second": limit.rate,
            "unique_bytes_read": limit.bytes, "tree_sha256": hashlib.sha256(canonical(entries)).hexdigest(),
            "entries": entries}


def read_metadata_bytes(path, limit = 16 * 1024 ** 2) :
    with path.open("rb") as handle:
        raw = handle.read(limit + 1)
    if len(raw) > limit:
        raise DataError("metadata_size_limit")
    return raw


def read_json(path, limit = 16 * 1024 ** 2) :
    raw = read_metadata_bytes(path, limit)
    try:
        return json.loads(raw)
    except (ValueError, UnicodeError):
        raise DataError("invalid_metadata_json") from None


def checked_manifest(path) :
    raw = read_metadata_bytes(path)
    try:
        payload = json.loads(raw)
    except (ValueError, UnicodeError):
        raise DataError("invalid_inventory_manifest") from None
    if not isinstance(payload, dict) or payload.get("version") != 1 or payload.get("status") != "inventoried":
        raise DataError("invalid_inventory_manifest")
    entries = payload.get("entries")
    if not isinstance(entries, list) or not entries:
        raise DataError("invalid_inventory_entries")
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict) or entry.get("kind") not in ("file", "directory"):
            raise DataError("invalid_inventory_entries")
        kind, relative = entry["kind"], entry.get("path")
        required = {"path", "kind", "uid", "gid", "mode"}
        if kind == "file":
            required.update({"size", "sha256", "hardlink_to"})
        if set(entry) != required:
            raise DataError("invalid_inventory_entries")
        if not allowed_path(relative, kind) or relative in seen:
            raise DataError("invalid_inventory_entries")
        seen.add(relative)
        if any(type(entry.get(field)) is not int or entry[field] < 0 for field in ("uid", "gid")):
            raise DataError("invalid_inventory_entries")
        if not re.fullmatch(r"[0-7]{4}", entry.get("mode", "")):
            raise DataError("invalid_inventory_entries")
        if kind == "file":
            if type(entry.get("size")) is not int or entry["size"] < 0 or not re.fullmatch(HASH, entry.get("sha256", "")):
                raise DataError("invalid_inventory_entries")
            link = entry.get("hardlink_to")
            if link is not None and (link == relative or not allowed_path(link, "file")):
                raise DataError("invalid_inventory_hardlinks")
    entries_by_path = {entry["path"]: entry for entry in entries}
    for entry in entries:
        parent = PurePosixPath(entry["path"]).parent.as_posix()
        if entry["path"] != "." and entries_by_path.get(parent, {}).get("kind") != "directory":
            raise DataError("invalid_inventory_entries")
        target = entries_by_path.get(entry.get("hardlink_to"))
        if entry.get("hardlink_to") is not None and (
            target is None or target.get("kind") != "file" or target.get("hardlink_to") is not None
            or any(target.get(field) != entry.get(field) for field in ("size", "sha256", "uid", "gid", "mode"))
        ):
            raise DataError("invalid_inventory_hardlinks")
    if entries != sorted(entries, key=lambda entry: entry["path"]) or entries_by_path.get(".", {}).get("kind") != "directory":
        raise DataError("invalid_inventory_entries")
    tree_hash = hashlib.sha256(canonical(entries)).hexdigest()
    if tree_hash != payload.get("tree_sha256"):
        raise DataError("inventory_manifest_hash_mismatch")
    return payload, hashlib.sha256(raw).hexdigest()


def compare(expected, actual) :
    source, source_hash = checked_manifest(expected)
    destination, destination_hash = checked_manifest(actual)
    first = {entry["path"]: entry for entry in source["entries"]}
    second = {entry["path"]: entry for entry in destination["entries"]}
    differences = []
    for relative in sorted(first.keys() | second.keys()):
        a, b = first.get(relative), second.get(relative)
        fields = ["presence"] if a is None or b is None else sorted(key for key in a.keys() | b.keys() if a.get(key) != b.get(key))
        if fields:
            differences.append({"path": relative, "fields": fields})
    return {"version": 1, "status": "mismatch" if differences else "verified", "checked_at": now(),
            "copy_verified": not differences, "source_manifest_sha256": source_hash,
            "destination_manifest_sha256": destination_hash, "tree_sha256": source["tree_sha256"],
            "differences": differences}


def sqlite_metadata(connection) :
    exists = connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='metadata'").fetchone()
    if not exists:
        return None
    rows = connection.execute("SELECT value FROM metadata LIMIT 2").fetchall()
    if not rows:
        return None
    if len(rows) != 1 or not isinstance(rows[0][0], str) or len(rows[0][0]) > 16 * 1024 ** 2:
        raise DataError("invalid_sqlite_metadata")
    try:
        value = json.loads(rows[0][0])
    except ValueError:
        raise DataError("invalid_sqlite_metadata") from None
    if not isinstance(value, dict):
        raise DataError("invalid_sqlite_metadata")
    return value


def sql_deadline(connection, deadline) :
    connection.set_progress_handler(lambda: int(time.monotonic() > deadline), 10_000)


def metadata_identity(metadata, version, period = None) :
    if not isinstance(version, str) or not re.fullmatch(HASH, version) or not valid_month(metadata.get("period")):
        raise DataError("invalid_sqlite_metadata")
    if metadata.get("version") != version or (period is not None and metadata.get("period") != period):
        raise DataError("sqlite_publication_identity_mismatch")
    if type(metadata.get("rows")) is not int or metadata["rows"] < 0:
        raise DataError("invalid_sqlite_metadata")


def valid_month(value) :
    return isinstance(value, str) and re.fullmatch(r"[0-9]{6}", value) is not None and 1 <= int(value[4:]) <= 12


def check_schema(connection, kind) :
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not SCHEMA_TABLES[kind].issubset(tables):
        raise DataError("sqlite_schema_mismatch")
    for table in SCHEMA_TABLES[kind]:
        columns = {row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')}
        if not SCHEMA_COLUMNS[table].issubset(columns):
            raise DataError("sqlite_schema_mismatch")


def verify_sqlite(root, timeout_seconds = 3600) :
    """May recover pending hot journals. Only call on the stopped DESTINATION."""
    root = root_directory(root)
    if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
        raise DataError("positive_sqlite_timeout_required")
    tree = inspect_tree(root)
    files = {relative for relative, info in tree if stat.S_ISREG(info.st_mode)}
    if any(relative.endswith("-journal") and not relative.startswith("refresh-") and relative[:-8] not in files for relative in files):
        raise DataError("orphan_sqlite_journal")
    deadline = time.monotonic() + timeout_seconds
    publications, published, pending = [], {}, []
    for name, schema, required in [("current.json", 1, {"current"}), ("active.json", 2, KINDS)]:
        if not (root / name).exists():
            continue
        manifest = read_json(root / name)
        if not isinstance(manifest, dict) or manifest.get("schema_version") != schema or not isinstance(manifest.get("components"), dict) or set(manifest["components"]) != required:
            raise DataError("invalid_publication_manifest")
        if not re.fullmatch(HASH, manifest.get("version", "")) or not valid_month(manifest.get("period")):
            raise DataError("invalid_publication_manifest")
        for kind, component in manifest["components"].items():
            if not isinstance(component, dict):
                raise DataError("invalid_publication_manifest")
            relative = component.get("path", "")
            if not re.fullmatch(rf"components/{kind}/{HASH}\.sqlite", relative):
                raise DataError("invalid_publication_component_path")
            if component.get("version") != PurePosixPath(relative).stem:
                raise DataError("invalid_publication_component_version")
            if relative in published and published[relative] != (kind, component):
                raise DataError("inconsistent_publication_component")
            published[relative] = (kind, component)
        capabilities = manifest.get("capabilities")
        if not isinstance(capabilities, dict) or set(capabilities) != {"current", "history", "padron", "normal_since"} or any(type(value) is not bool for value in capabilities.values()):
            raise DataError("invalid_publication_capabilities")
        try:
            stamp = manifest["checked_at"]
            if not isinstance(stamp, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})", stamp):
                raise ValueError
            stamp = stamp.replace("Z", "+00:00")
            stamp = stamp[:-3] + stamp[-2:]
            datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%S.%f%z" if "." in stamp else "%Y-%m-%dT%H:%M:%S%z")
        except (KeyError, AttributeError, ValueError, TypeError):
            raise DataError("invalid_publication_timestamp") from None
        publications.append({"manifest": name, "version": manifest["version"], "period": manifest["period"],
                             "checked_at": manifest.get("checked_at"), "capabilities": capabilities})
    checked = []
    for relative, (kind, component) in sorted(published.items()):
        path = root / relative
        if not path.is_file() or (root / (relative + "-journal")).exists():
            raise DataError("published_component_missing_or_has_journal")
        connection = sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)
        try:
            sql_deadline(connection, deadline)
            check_schema(connection, kind)
            if connection.execute("PRAGMA quick_check(1)").fetchall() != [("ok",)]:
                raise DataError("sqlite_integrity_failed")
            metadata = sqlite_metadata(connection)
            if metadata is None:
                raise DataError("published_component_missing_metadata")
            metadata_identity(metadata, component.get("version"), component.get("period"))
            if metadata["rows"] != component.get("rows") or path.stat().st_size != component.get("bytes"):
                raise DataError("sqlite_publication_metadata_mismatch")
            checked.append({"path": relative, "kind": kind, "version": metadata["version"],
                            "period": metadata.get("period"), "rows": metadata["rows"], "quick_check": "ok"})
        finally:
            connection.close()
    legacy = root / "snapshot.sqlite"
    if legacy.exists():
        connection = sqlite3.connect(legacy.as_uri() + "?mode=ro", uri=True)
        try:
            sql_deadline(connection, deadline)
            check_schema(connection, "current")
            if connection.execute("PRAGMA quick_check(1)").fetchall() != [("ok",)]:
                raise DataError("legacy_sqlite_integrity_failed")
            metadata = sqlite_metadata(connection)
            if not metadata or not re.fullmatch(HASH, metadata.get("version", "")):
                raise DataError("legacy_sqlite_missing_metadata")
            metadata_identity(metadata, metadata["version"])
            checked.append({"path": "snapshot.sqlite", "kind": "legacy", "version": metadata["version"],
                            "period": metadata.get("period"), "rows": metadata["rows"], "quick_check": "ok"})
        finally:
            connection.close()
    for path in sorted((root / "pending").glob("*.sqlite")):
        match = re.fullmatch(rf"({COMPONENT})-({HASH})\.sqlite", path.name)
        if not match:
            raise DataError("invalid_pending_component_path")
        kind, version = match.groups()
        journal = Path(str(path) + "-journal")
        had_journal = journal.exists()
        # mode=rw, never immutable: first schema read performs hot-journal rollback.
        connection = sqlite3.connect(path.as_uri() + "?mode=rw", uri=True, timeout=10)
        try:
            sql_deadline(connection, deadline)
            connection.execute("PRAGMA schema_version").fetchone()
            metadata = sqlite_metadata(connection)
            checkpoint_table = connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='import_checkpoint'").fetchone()
            checkpoint = None
            if checkpoint_table:
                rows = connection.execute("SELECT value FROM import_checkpoint WHERE id=1 LIMIT 2").fetchall()
                try:
                    checkpoint = json.loads(rows[0][0]) if len(rows) == 1 else None
                except (ValueError, TypeError):
                    raise DataError("invalid_pending_checkpoint") from None
            if kind != "current":
                check_schema(connection, kind)
                if not isinstance(checkpoint, dict) or any(checkpoint.get(key) != value for key, value in {"schema_version": 1, "kind": kind, "version": version}.items()):
                    raise DataError("invalid_pending_checkpoint")
                period = checkpoint.get("period")
                if not ((kind == "padron" and period == "") or (kind != "padron" and valid_month(period))):
                    raise DataError("invalid_pending_checkpoint")
                if any(type(checkpoint.get(key)) is not int or checkpoint[key] < 0 for key in ("source_rows", "rows", "member_index", "line")):
                    raise DataError("invalid_pending_checkpoint")
            if metadata is not None:
                metadata_identity(metadata, version)
            pending.append({"path": path.relative_to(root).as_posix(), "kind": kind, "version": version,
                            "complete": metadata is not None, "journal_present_before": had_journal,
                            "journal_present_after": journal.exists(),
                            "checkpoint": {key: checkpoint[key] for key in ("kind", "period", "version", "source_rows", "rows", "member_index", "line")} if checkpoint else None})
        finally:
            connection.close()
    if not checked:
        raise DataError("no_validated_publication_or_legacy_database")
    return {"version": 1, "status": "verified", "sqlite_verified": True, "verified_at": now(),
            "destination_only": True, "publications": publications, "published_components": checked,
            "pending_recovered": pending, "freshness_refreshed": False,
            "limitations": ["Capabilities and checked_at are reported as stored, not upgraded.",
                            "Pending components are recovered and checkpoints inspected, not declared complete."]}


def rsync_plan(source, destination, bwlimit_kib, ssh_port = None) :
    if type(bwlimit_kib) is not int or bwlimit_kib <= 0:
        raise DataError("positive_copy_bandwidth_required")
    for value in (source, destination):
        if not value or not re.fullmatch(r"[A-Za-z0-9_./:@-]+", value) or value.startswith("-"):
            raise DataError("unsafe_copy_endpoint")
        part = value.split(":", 1)[-1]
        if not part.startswith("/") or PurePosixPath(part) == PurePosixPath("/") or ".." in part.split("/"):
            raise DataError("unsafe_copy_endpoint")
    remote = [":" in value for value in (source, destination)]
    if all(remote) or source.rstrip("/") == destination.rstrip("/"):
        raise DataError("invalid_copy_topology")
    command = ["rsync", "-aH", "--numeric-ids", f"--bwlimit={bwlimit_kib}"]
    if any(remote):
        if type(ssh_port) is not int or not 1 <= ssh_port <= 65535:
            raise DataError("explicit_ssh_port_required")
        command.extend(["--rsh", f"ssh -p {ssh_port} -o StrictHostKeyChecking=yes"])
    command.extend(["--", source.rstrip("/") + "/", destination.rstrip("/") + "/"])
    return {"version": 1, "status": "planned", "executed": False, "argv": command,
            "shell_display": " ".join(shlex.quote(part) for part in command), "delete_enabled": False,
            "preconditions": ["Both BCRA services stopped and scheduler held.",
                              "Source inventory complete; destination dedicated to this copy.",
                              "Compare destination inventory before application startup."]}


def write_report(path, report, volume = None) :
    if volume is not None and within(path.absolute().resolve(), volume.absolute().resolve()):
        raise DataError("report_must_be_outside_volume")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, sort_keys=True, indent=2)
        handle.write("\n")
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def main(argv = None) :
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command")
    sub.required = True
    inv = sub.add_parser("inventory", help="Read/hash a stopped volume with an explicit I/O cap")
    inv.add_argument("--root", type=Path, required=True)
    inv.add_argument("--output", type=Path, required=True)
    inv.add_argument("--max-read-mib-per-sec", type=float, default=4)
    inv.add_argument("--stopped-confirmed", action="store_true", required=True)
    layout = sub.add_parser("layout", help="Validate generated names, file types and numeric owners without reading data")
    layout.add_argument("--root", type=Path, required=True)
    layout.add_argument("--expected-uid", type=int, default=10001)
    layout.add_argument("--expected-gid", type=int, default=10001)
    layout.add_argument("--stopped-confirmed", action="store_true", required=True)
    comp = sub.add_parser("compare", help="Compare source/destination manifests before first startup")
    comp.add_argument("--expected", type=Path, required=True)
    comp.add_argument("--actual", type=Path, required=True)
    comp.add_argument("--report", type=Path, required=True)
    sql = sub.add_parser("verify-sqlite", help="Recover pending journals and verify published SQLite on destination only")
    sql.add_argument("--root", type=Path, required=True)
    sql.add_argument("--report", type=Path, required=True)
    sql.add_argument("--destination-confirmed", action="store_true", required=True)
    sql.add_argument("--stopped-confirmed", action="store_true", required=True)
    sql.add_argument("--timeout-seconds", type=float, default=3600)
    plan = sub.add_parser("rsync-plan", help="Emit a bounded copy command; never executes it")
    plan.add_argument("--source", required=True)
    plan.add_argument("--destination", required=True)
    plan.add_argument("--bwlimit-kib", type=int, required=True)
    plan.add_argument("--ssh-port", type=int)
    plan.add_argument("--report", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "layout":
            rows = inspect_tree(root_directory(args.root))
            if any(info.st_uid != args.expected_uid or info.st_gid != args.expected_gid for _, info in rows):
                raise DataError("unexpected_numeric_owner")
            report = {"version": 1, "status": "validated", "file_count": sum(stat.S_ISREG(info.st_mode) for _, info in rows),
                      "directory_count": sum(stat.S_ISDIR(info.st_mode) for _, info in rows),
                      "uid": args.expected_uid, "gid": args.expected_gid}
            print(json.dumps(report))
            return 0
        if args.command == "inventory":
            report_path, volume = args.output, args.root
            if within(report_path.absolute().resolve(), volume.absolute().resolve()):
                raise DataError("report_must_be_outside_volume")
            report = inventory(volume, args.max_read_mib_per_sec)
        elif args.command == "compare":
            report_path, volume = args.report, None
            report = compare(args.expected, args.actual)
        elif args.command == "verify-sqlite":
            report_path, volume = args.report, args.root
            if within(report_path.absolute().resolve(), volume.absolute().resolve()):
                raise DataError("report_must_be_outside_volume")
            report = verify_sqlite(volume, args.timeout_seconds)
        else:
            report_path, volume = args.report, None
            report = rsync_plan(args.source, args.destination, args.bwlimit_kib, args.ssh_port)
        write_report(report_path, report, volume)
        print(json.dumps({"version": 1, "status": report["status"], **{key: report[key] for key in ("tree_sha256", "copy_verified", "sqlite_verified", "executed") if key in report}}))
        return 0 if report["status"] != "mismatch" else 1
    except (DataError, OSError, sqlite3.Error, ValueError, TypeError, KeyError) as error:
        reason = str(error) if isinstance(error, DataError) else "operation_failed"
        print(json.dumps({"version": 1, "status": "failed", "reason": reason}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
