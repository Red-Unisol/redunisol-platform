#!/usr/bin/env python3
"""Replay only cutover-held webhooks from the isolated ledger to the local backend."""
import argparse
import datetime
import hashlib
import hmac
import json
import os
from pathlib import Path
import sqlite3
import urllib.request

SHADOW = Path("/srv/redunisol/state/metamap-shadow/data/shadow.sqlite")
ENV = Path("/etc/redunisol-metamap/runtime.env.full")
STATE = Path("/var/lib/redunisol-metamap-cutover")

def require(value, message):
    if not value:
        raise ValueError(message)

def held_deliveries(path, since):
    datetime.datetime.strptime(since, "%Y-%m-%dT%H:%M:%SZ")
    db = sqlite3.connect("file:" + str(path) + "?mode=ro", uri=True)
    try:
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        rows = db.execute("SELECT delivery_id,body_sha256,received_at FROM shadow_deliveries WHERE primary_status=202 AND received_at>=? ORDER BY received_at,delivery_id LIMIT 10001", (since[:19],)).fetchall()
        require(len(rows) <= 10000, "Held cohort exceeds reviewed budget")
        bodies = {}
        for body, in db.execute("SELECT raw_body FROM metamap_webhook_receipts WHERE received_at>=?", (since[:19],)):
            encoded = body.encode("utf-8")
            bodies[hashlib.sha256(encoded).hexdigest()] = encoded
        result = []
        for identifier, digest, received in rows:
            require(digest in bodies, "Held delivery has no matching durable raw receipt")
            result.append((identifier, bodies[digest], received))
        return result
    finally:
        db.close()

def secret():
    for line in ENV.read_text().splitlines():
        if line.startswith("METAMAP_SERVER_WEBHOOK_SECRET="):
            value = line.split("=", 1)[1].strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            require(len(value) >= 16, "Existing signing configuration required")
            return value
    raise ValueError("Signing configuration missing")

def execute(since):
    import fcntl
    require(os.geteuid() == 0 and SHADOW.is_file() and ENV.is_file(), "Prepared dedicated cutover layout required")
    STATE.mkdir(mode=0o700, exist_ok=True)
    STATE.chmod(0o700)
    name = "held-" + hashlib.sha256(since.encode()).hexdigest()[:16]
    path = STATE / (name + ".json")
    with (STATE / (name + ".lock")).open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        done = set(json.loads(path.read_text())["processed"]) if path.exists() else set()
        rows = held_deliveries(SHADOW, since)
        processed = 0
        key = secret().encode()
        for identifier, body, unused in rows:
            if identifier in done:
                continue
            signature = hmac.new(key, body, hashlib.sha256).hexdigest()
            request = urllib.request.Request("http://127.0.0.1:18083/api/v1/metamap/webhooks", data=body, method="POST", headers={"Content-Type": "application/json", "x-signature": signature})
            with urllib.request.urlopen(request, timeout=30) as response:
                acknowledgement = json.load(response)
                require(response.status == 200 and acknowledgement.get("processing_status") in ("stored", "logged_only"), "Held webhook was not durably accepted")
            done.add(identifier)
            staged = path.with_suffix(".stage")
            with staged.open("w") as stream:
                json.dump({"scope": "metamap-held-replay", "since": since, "processed": sorted(done)}, stream)
                stream.flush()
                os.fsync(stream.fileno())
            staged.chmod(0o600)
            os.replace(str(staged), str(path))
            processed += 1
        return {"scope": "metamap-held-replay", "since": since, "available": len(rows), "processed_now": processed, "processed_total": len(done)}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", required=True)
    parser.add_argument("--authorized", action="store_true")
    args = parser.parse_args()
    require(args.authorized, "Held webhook replay authorization required")
    print(json.dumps(execute(args.since), sort_keys=True))

if __name__ == "__main__":
    main()
