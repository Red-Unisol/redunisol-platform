#!/usr/bin/env python3
"""Consistent recent SQLite + signed updates backup on the dedicated, never the VPS."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import time
import uuid
import urllib.request

STATE = Path("/srv/redunisol/state/metamap-server")
DATABASE = STATE / "data/metamap_platform_server.db"
UPDATES = STATE / "updates"
STAGE = STATE / "backup-current"
REPOSITORY = Path("/srv/redunisol-backups/restic/metamap")
PASSWORD = Path("/etc/redunisol-metamap/restic-password")
MOUNT_UUID = "df29bb35-b77f-4355-a93c-c53a32580267"

def require(condition, message):
    if not condition:
        raise ValueError(message)

def run(arguments, timeout=180):
    result = subprocess.run(arguments, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    require(result.returncode == 0, "Backup command failed: " + arguments[0])
    return result.stdout

def restic(arguments):
    return run(["restic", "--repo", str(REPOSITORY), "--password-file", str(PASSWORD)] + arguments)

def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()

def database_proof(path):
    db = sqlite3.connect("file:" + str(path) + "?mode=ro", uri=True)
    try:
        require(db.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "Backup SQLite integrity failed")
        return {name: db.execute("SELECT COUNT(*) FROM " + name).fetchone()[0] for name in ("clients", "validations", "transfer_trace_events")}
    finally:
        db.close()

def execute(revision, verify_restore):
    require(os.geteuid() == 0 and re.fullmatch(r"[0-9a-f]{40}", revision), "Root and Git revision required")
    for path in (STATE, UPDATES, REPOSITORY, DATABASE, PASSWORD):
        require(path.exists() and not path.is_symlink() and path.resolve() == path, "Canonical existing backup layout required")
    require(PASSWORD.stat().st_uid == 0 and PASSWORD.stat().st_mode & 0o077 == 0, "Private existing repository key required")
    require(run(["findmnt", "--noheadings", "--output", "UUID", "--target", str(REPOSITORY)]).decode().strip() == MOUNT_UUID, "Dedicated backup disk identity differs")
    config = json.loads(restic(["cat", "config"]))
    STAGE.mkdir(mode=0o700, exist_ok=True)
    STAGE.chmod(0o700)
    with (STAGE / "backup.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        temporary = STAGE / ("sqlite-" + uuid.uuid4().hex + ".db")
        source = sqlite3.connect("file:" + str(DATABASE) + "?mode=ro", uri=True, timeout=10)
        target = sqlite3.connect(str(temporary))
        try:
            source.backup(target, pages=128, sleep=0.02)
        finally:
            source.close()
            target.close()
        temporary.chmod(0o600)
        proof = database_proof(temporary)
        final = STAGE / "metamap_platform_server.db"
        os.replace(str(temporary), str(final))
        application = {"status": "unavailable"}
        try:
            with urllib.request.urlopen("http://127.0.0.1:18083/health", timeout=3) as response:
                application = json.load(response)
        except Exception:
            pass
        image = run(["docker", "inspect", "--format", "{{.Config.Image}}", "metamap-server-server-1"]).decode().strip()
        report = {"scope": "metamap-recent-live-backup", "revision": revision, "created_at": int(time.time()), "counts": proof, "sqlite_sha256": digest(final), "repository_id": config["id"], "offsite": False, "application": application, "image": image}
        (STAGE / "manifest.json").write_text(json.dumps(report, sort_keys=True))
        (STAGE / "manifest.json").chmod(0o600)
        output = restic(["backup", "--json", "--tag", "metamap-recent-live", "--tag", "revision:" + revision, "--exclude", str(STAGE / "backup.lock"), "--", str(STAGE), str(UPDATES)])
        summaries = [row for row in map(json.loads, output.decode().splitlines()) if row.get("message_type") == "summary"]
        require(len(summaries) == 1, "Restic snapshot acknowledgement missing")
        snapshot = summaries[0]["snapshot_id"]
        require(re.fullmatch(r"[0-9a-f]{8,64}", snapshot), "Unexpected snapshot identity")
        report.update({"snapshot_id": snapshot, "data_added": summaries[0].get("data_added"), "restore_verified": False})
        if verify_restore:
            destination = STATE / "restores" / ("recent-" + uuid.uuid4().hex)
            destination.mkdir(mode=0o700)
            restic(["restore", snapshot, "--target", str(destination), "--verify"])
            restored = destination / str(final).lstrip("/")
            require(digest(restored) == report["sqlite_sha256"] and database_proof(restored) == proof, "Restored recent database differs")
            latest = UPDATES / "transferencias/latest.json"
            restored_latest = destination / str(latest).lstrip("/")
            require(digest(latest) == digest(restored_latest), "Restored updater pointer differs")
            restic(["check", "--read-data"])
            report.update({"restore_verified": True, "restored_database": str(restored), "repository_integrity": "ok"})
        (STAGE / "last-receipt.json").write_text(json.dumps(report, sort_keys=True))
        (STAGE / "last-receipt.json").chmod(0o600)
        return report

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--verify-restore", action="store_true")
    args = parser.parse_args()
    print(json.dumps(execute(args.revision, args.verify_restore), sort_keys=True))

if __name__ == "__main__":
    main()
