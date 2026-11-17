#!/usr/bin/env python3
"""Activate the reviewed, recently seeded MetaMap backend on the dedicated only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import time
import urllib.request

BASE = Path("/srv/redunisol/platform/metamap-server")
DATA = Path("/srv/redunisol/state/metamap-server/data")
APACHE = Path("/etc/redunisol-metamap-origin/apache.conf")
IMAGE = "ghcr.io/red-unisol/metamap-platform-server@sha256:f7ecf3631daf2ee5dddf7a4f1772ef6fd71fa0eb00c43add4152de4d7f7b54a5"
COMPOSE = ["docker", "compose", "--project-name", "metamap-server", "--file", str(BASE / "compose.yml"), "--profile", "activation"]

def require(value, message):
    if not value:
        raise ValueError(message)

def run(command):
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90)
    require(result.returncode == 0, "Command failed: " + command[0])
    return result.stdout

def atomic(path, data, mode=0o600):
    temporary = path.with_name(path.name + ".cutover-stage")
    require(not temporary.exists() and not temporary.is_symlink(), "Unexpected staged file")
    descriptor = os.open(str(temporary), os.O_CREAT | os.O_EXCL | os.O_WRONLY, mode)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(str(temporary), str(path))

def active_apache(configuration):
    if "# Active recent MetaMap backend" in configuration:
        return configuration
    block = re.compile(r"(?ms)^    # A non-3xx status.*?^    </LocationMatch>\n")
    require(len(block.findall(configuration)) == 1, "Unknown preparation origin configuration")
    replacement = """    # Active recent MetaMap backend; controlled by metamap-active.py.
    ProxyRequests Off
    ProxyPreserveHost On
    ProxyTimeout 300
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port "443"
    ProxyPass "/metamap-platform/" "http://127.0.0.1:18083/" nocanon
    ProxyPassReverse "/metamap-platform/" "http://127.0.0.1:18083/"
    <Location "/metamap-platform/">
        Require all granted
    </Location>
"""
    candidate = block.sub(lambda unused: replacement, configuration)
    marker = hashlib.sha256(candidate.encode()).hexdigest()
    return re.sub(r'X-Redunisol-Origin-Config "[0-9a-f]{64}"', 'X-Redunisol-Origin-Config "' + marker + '"', candidate)

def health():
    for attempt in range(15):
        try:
            with urllib.request.urlopen("http://127.0.0.1:18083/health", timeout=3) as response:
                result = json.load(response)
            require(result.get("status") == "ok" and result.get("service") == "metamap-platform-server", "Unexpected backend health")
            return result
        except Exception:
            if attempt == 14:
                raise
            time.sleep(1)

def seal_database(path):
    db = sqlite3.connect("file:" + str(path) + "?mode=rw", uri=True, timeout=5)
    try:
        require(db.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0] == 0, "SQLite checkpoint is busy")
        require(db.execute("PRAGMA journal_mode=DELETE").fetchone()[0] == "delete", "SQLite journal is still active")
    finally:
        db.close()

def prove_database(path):
    require(path.is_file() and not path.is_symlink() and path.resolve().parent == DATA, "Unexpected staged database")
    db = sqlite3.connect("file:" + str(path) + "?mode=ro", uri=True)
    try:
        require(db.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "SQLite integrity failed")
        return {name: db.execute("SELECT COUNT(*) FROM " + name).fetchone()[0] for name in ("clients", "validations", "transfer_trace_events")}
    finally:
        db.close()

def execute(args):
    require(os.geteuid() == 0 and BASE.is_dir() and DATA.is_dir(), "Only the prepared dedicated layout is allowed")
    require(re.fullmatch(r"[0-9a-f]{40}", args.revision), "Git revision required")
    require(args.authorized, "Activation authorization required")
    compose = (BASE / "compose.yml").read_text()
    require(IMAGE in compose and "127.0.0.1:18083:8000" in compose and "profiles: [activation]" in compose, "Prepared immutable Compose differs")
    if args.operation == "stop":
        run(COMPOSE + ["stop", "--timeout", "60"])
        return {"stopped": True}
    if args.operation == "origin":
        backend = health()
        original = APACHE.read_text()
        candidate = active_apache(original)
        backup = APACHE.with_name("apache.conf.before-recent-cutover")
        if not backup.exists():
            with backup.open("xb") as stream:
                stream.write(original.encode())
            backup.chmod(0o600)
        staged = APACHE.with_name("apache.conf.checked")
        atomic(staged, candidate.encode(), 0o644)
        run(["/usr/sbin/apache2", "-t", "-f", str(staged)])
        os.replace(str(staged), str(APACHE))
        run(["systemctl", "reload", "metamap-origin.service"])
        health_path = Path("/var/www/redunisol-metamap-origin/health.json")
        document = json.loads(health_path.read_text())
        document.update({"backend_enabled": True, "activation_revision": args.revision})
        atomic(health_path, json.dumps(document).encode(), 0o644)
        return {"origin_enabled": True, "configuration_sha256": hashlib.sha256(candidate.encode()).hexdigest(), "backend": backend}
    require(re.fullmatch(r"[A-Za-z0-9_.-]+\.db", args.basename or ""), "Active database basename required")
    destination = DATA / args.basename
    if args.operation == "production-env":
        full = Path("/etc/redunisol-metamap/runtime.env.full")
        require(full.is_file() and not full.is_symlink(), "Full private runtime environment missing")
        atomic(BASE / "runtime.env", full.read_bytes())
        return {"production_environment_staged": True}
    stage = Path(args.database or "")
    counts = prove_database(stage)
    require(counts["clients"] > 0 and counts["validations"] > 0, "Seeded clients and recent validations required")
    ids = run(["docker", "ps", "-q", "--filter", "label=com.docker.compose.project=metamap-server"]).strip()
    require(not ids, "Stop the dedicated backend before replacing its database")
    if destination.exists():
        seal_database(destination)
        require(not (DATA / (args.basename + "-wal")).exists() and not (DATA / (args.basename + "-journal")).exists(), "Close SQLite cleanly before replacement")
        previous = destination.with_name(destination.name + ".before-" + str(int(time.time())))
        require(not previous.exists(), "Recovery copy already exists")
        os.replace(str(destination), str(previous))
    os.replace(str(stage), str(destination))
    destination.chmod(0o600)
    run(COMPOSE + ["up", "--detach", "--pull", "never", "--no-build"])
    result = {"backend": health(), "counts_before_start": counts, "revision": args.revision, "database": str(destination), "image": IMAGE}
    atomic(BASE / "activation.json", json.dumps(result, sort_keys=True).encode())
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("start", "stop", "origin", "production-env"))
    parser.add_argument("--revision", required=True)
    parser.add_argument("--authorized", action="store_true")
    parser.add_argument("--database")
    parser.add_argument("--basename")
    args = parser.parse_args()
    print(json.dumps(execute(args), sort_keys=True))

if __name__ == "__main__":
    main()
