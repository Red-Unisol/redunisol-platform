"""Independent observer of Kestra CRM schedules, run from the dedicated host."""
import argparse
import base64
import hashlib
import http.client
import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

from barrido import CALENDARIOS_CRM, CRM, hubo_inicio_programado

BASE = "/api/v1/main"
PREFILL = "bitrix24_lead_prefill"
SCHEDULE = "io.kestra.plugin.core.trigger.Schedule"
FIRST_SCRIPT = "adcf509186374e4614a259816005e5c4c7a040dd64b5f2c603a11da01792b71a"
SELECTOR_COMMAND = "3eed86d1056d68e110493c49fcccc652a8b349c190511963b7a12220a37949ce"
LIST_URL = "{{ envs.bitrix24_base_url }}/{{ secret('BITRIX24_WEBHOOK_PATH') }}/crm.lead.list.json"
MIN_STALL, CONFIRM_AFTER, MAX_PROBE_GAP, COOLDOWN = 1800, 240, 420, 21600


def utc(ts):
    return datetime.fromtimestamp(ts, timezone.utc)


def timestamp(value):
    if not isinstance(value, str):
        return None
    date = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return date.timestamp() if date.tzinfo is not None else None


class Api:
    """No redirects, retries, or HTTP headers/bodies in logs."""
    def __init__(self, credential):
        cfg = json.loads(credential.read_text())
        token = base64.b64encode((cfg["username"] + ":" + cfg["password"]).encode()).decode()
        self.headers = {"Authorization": "Basic " + token, "User-Agent": "redunisol-crm-watchdog/1"}

    def __call__(self, method, path):
        kill = BASE + r"/executions/[A-Za-z0-9_-]{1,100}/actions/kill\?isOnKillCascade=false"
        if not path.startswith(BASE + "/") or not (method == "GET" or method == "DELETE" and re.fullmatch(kill, path)):
            raise ValueError("operation outside watchdog scope")
        conn = http.client.HTTPSConnection("kestra.redunisol.com.ar", timeout=10)
        try:
            conn.request(method, path, headers=self.headers)
            result = conn.getresponse()
            if result.status == 404 and method == "GET":
                return {}
            if result.status not in (200, 202, 204):
                raise RuntimeError("kestra_http_" + str(result.status))
            if method == "GET":
                return json.load(result)
        finally:
            conn.close()


def trigger(api, flow):
    query = urlencode({"filters[namespace][EQUALS]": CRM, "filters[flowId][EQUALS]": flow, "size": 100})
    data = api("GET", BASE + "/triggers/search?" + query)
    rows = data["results"]
    if data["total"] != len(rows):
        raise ValueError("partial_trigger_inventory")
    expected = (CRM, flow, CALENDARIOS_CRM[flow], CALENDARIOS_CRM[flow], SCHEDULE)
    exact = [row for row in rows if (row["state"].get("namespace"), row["state"].get("flowId"),
             row["state"].get("triggerId"), row["trigger"].get("id"), row["trigger"].get("type")) == expected]
    if len(exact) != 1:
        raise ValueError("missing_or_duplicate_trigger")
    return exact[0]


def decoded(value):
    # Kestra 2.0 serializes expression-capable maps and lists as JSON strings.
    return json.loads(value) if isinstance(value, str) else value


def reviewed_flow(api, revision):
    # The active revision must still be the reviewed revision of the frozen execution.
    path = BASE + "/flows/" + CRM + "/" + PREFILL
    flow = api("GET", path)
    if (flow.get("id"), flow.get("namespace"), flow.get("revision"), flow.get("disabled"),
            flow.get("deleted")) != (PREFILL, CRM, revision, False, False):
        return False
    if flow.get("concurrency") != {"limit": 1, "behavior": "CANCEL"}:
        return False
    tasks = flow["tasks"]
    if ([t["id"] for t in tasks] != ["hay_pendientes", "seleccionar_lote", "procesar_lote", "verificar_lote"]
            or any(flow.get(k) for k in ("afterExecution", "errors", "finally", "listeners"))):
        return False
    first, selector, process, verify = tasks
    env, commands = decoded(first["env"]), decoded(selector["commands"])
    if (selector["type"] != "io.kestra.plugin.scripts.python.Commands"
            or decoded(selector["env"]).get("PREFILL_EXECUTION_STARTED_AT") != "{{ execution.startDate }}"
            or any(t.get(k) for t in (first, selector) for k in ("beforeCommands", "afterCommands"))
            or not isinstance(commands, list) or len(commands) != 1
            or hashlib.sha256(commands[0].encode()).hexdigest() != SELECTOR_COMMAND):
        return False
    children = process.get("tasks", [])
    if (process["type"] != "io.kestra.plugin.core.flow.Parallel" or len(children) != 2
            or verify["type"] != "io.kestra.plugin.core.execution.Assert"):
        return False
    for index, child in enumerate(children):
        guard = "{{ (outputs.seleccionar_lote.vars.count ?? 0) > " + str(index) + " }}"
        if child["type"] != "io.kestra.plugin.core.flow.Subflow" or child.get("runIf") != guard:
            return False
    return (first["id"] == "hay_pendientes" and first["type"] == "io.kestra.plugin.scripts.python.Script"
            and first.get("taskRunner") == {"type": "io.kestra.plugin.core.runner.Process"}
            and env.get("BITRIX24_LIST_URL") == LIST_URL
            and hashlib.sha256(first["script"].encode()).hexdigest() == FIRST_SCRIPT)


def stalled_probe(api, row, ts):
    state, schedule = row["state"], row["trigger"]
    eid = state.get("executionId", "")
    if (state.get("disabled") is not False or state.get("locked") is not True
            or schedule.get("recoverMissedSchedules") != "NONE"
            or not isinstance(eid, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", eid)):
        return None
    ex = api("GET", BASE + "/executions/" + eid)
    source = ex.get("trigger", {})
    if (ex.get("id"), ex.get("flowId"), ex.get("namespace"), source.get("id"),
        source.get("type"), ex.get("state", {}).get("current")) != (
            eid, PREFILL, CRM, CALENDARIOS_CRM[PREFILL], SCHEDULE, "RUNNING"):
        return None
    runs = ex.get("taskRunList", [])
    if len(runs) != 1 or runs[0].get("taskId") != "hay_pendientes":
        return None
    task_state = runs[0]["state"]
    if task_state.get("current") != "SUCCESS":
        return None
    end, start = timestamp(task_state.get("endDate")), timestamp(ex["state"].get("startDate"))
    if start is None or end is None or not start <= end <= ts - MIN_STALL:
        return None
    rev = ex.get("flowRevision")
    if type(rev) is not int or not reviewed_flow(api, rev):
        return None
    return (eid, start, end, rev)


def scheduled(api, flow, ts, after=None):
    return hubo_inicio_programado(api, BASE, flow, CALENDARIOS_CRM[flow], utc(ts),
                                  despues_de=utc(after) if after is not None else None,
                                  solo_exitos=after is not None)


def open_state(path):
    db = sqlite3.connect(path)
    db.executescript("""
        CREATE TABLE IF NOT EXISTS mode (slot INTEGER PRIMARY KEY CHECK(slot=1), name TEXT, since REAL);
        CREATE TABLE IF NOT EXISTS sample (slot INTEGER PRIMARY KEY CHECK(slot=1), fingerprint TEXT,
            first_seen REAL, last_seen REAL);
        CREATE TABLE IF NOT EXISTS intent (id TEXT PRIMARY KEY, at REAL NOT NULL, outcome TEXT NOT NULL);
    """)
    return db


def remember(db, fingerprint, ts):
    prev = db.execute("SELECT fingerprint,first_seen,last_seen FROM sample WHERE slot=1").fetchone()
    first = prev[1] if prev and prev[0] == fingerprint and 0 <= ts - prev[2] <= MAX_PROBE_GAP else ts
    with db:
        db.execute("INSERT OR REPLACE INTO sample VALUES(1,?,?,?)", (fingerprint, first, ts))
    return ts - first >= CONFIRM_AFTER


def tick(api, db, mode, ts, activation_floor=0):
    if mode not in {"observe", "recover"}:
        raise ValueError("mode")
    with db:
        db.execute("""INSERT INTO mode VALUES(1,?,?) ON CONFLICT(slot) DO UPDATE SET
                      name=excluded.name,since=excluded.since WHERE name!=excluded.name""", (mode, ts))
    since = db.execute("SELECT since FROM mode WHERE slot=1").fetchone()[0]
    results = {}
    for flow in CALENDARIOS_CRM:
        try:
            row = trigger(api, flow)
            if row["state"].get("disabled") is True:
                results[flow] = "paused"
            else:
                results[flow] = "healthy" if scheduled(api, flow, ts) else "schedule_without_progress"
        except Exception as error:
            results[flow] = "read_error"
            results[flow + "_error_type"] = type(error).__name__
    if "read_error" in results.values():
        with db:
            db.execute("DELETE FROM sample")
        return results

    for eid, at in db.execute("SELECT id,at FROM intent WHERE outcome NOT IN ('verified','terminal_other')"):
        execution = api("GET", BASE + "/executions/" + eid)
        current = execution.get("state", {}).get("current")
        if current == "KILLED" and scheduled(api, PREFILL, ts, at):
            with db:
                db.execute("UPDATE intent SET outcome='verified' WHERE id=?", (eid,))
            results["recovery"] = "verified"
        elif current in {"SUCCESS", "FAILED", "WARNING", "CANCELLED"}:
            with db:
                db.execute("UPDATE intent SET outcome='terminal_other' WHERE id=?", (eid,))
            results["recovery"] = "ended_independently"
        else:
            results["recovery"] = "unverified"

    witness = any(results[f] == "healthy" for f in CALENDARIOS_CRM if f != PREFILL)
    candidate = None
    if witness and results[PREFILL] == "schedule_without_progress":
        candidate = stalled_probe(api, trigger(api, PREFILL), ts)
    if not candidate:
        with db:
            db.execute("DELETE FROM sample")
        return results
    eid, start, _, _ = candidate
    stable = remember(db, json.dumps(candidate), ts)
    if mode != "recover" or start < max(since, activation_floor) or not stable:
        results["prefill_probe"] = "observed_prewrite_stall"
        return results
    if (scheduled(api, PREFILL, ts)
            or not any(scheduled(api, f, ts) for f in CALENDARIOS_CRM if f != PREFILL)
            or stalled_probe(api, trigger(api, PREFILL), ts) != candidate):
        results["prefill_probe"] = "changed_on_recheck"
        return results
    # Commit the intent BEFORE network I/O. A timeout or crash must never replay it.
    with db:
        cur = db.execute("""INSERT OR IGNORE INTO intent SELECT ?,?,'requested' WHERE NOT EXISTS
            (SELECT 1 FROM intent WHERE at>? OR outcome NOT IN ('verified','terminal_other'))""",
                         (eid, ts, ts - COOLDOWN))
        if cur.rowcount != 1:
            results["prefill_probe"] = "recovery_fenced"
            return results
    results["execution_id"] = eid
    try:
        api("DELETE", BASE + "/executions/" + eid + "/actions/kill?isOnKillCascade=false")
        outcome = "acknowledged"
    except Exception:
        outcome = "unknown"
    with db:
        db.execute("UPDATE intent SET outcome=? WHERE id=?", (outcome, eid))
    results["recovery"] = outcome
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["observe", "recover"], required=True)
    args = parser.parse_args()
    state = Path(os.environ["STATE_DIRECTORY"])
    db = open_state(state / "watchdog.sqlite")
    ts = datetime.now(timezone.utc).timestamp()
    try:
        api = Api(Path(os.environ["CREDENTIALS_DIRECTORY"]) / "kestra.json")
        mode_file = Path("/opt/redunisol-kestra-crm-watchdog/mode")
        if mode_file.read_text().strip() != args.mode:
            raise ValueError("activation_mode_changed")
        results = tick(api, db, args.mode, ts, activation_floor=mode_file.stat().st_mtime)
    except Exception as error:
        # HTTP responses, task outputs and secrets never enter receipts or logs.
        results = {"read_error": type(error).__name__}
        with db:
            db.execute("DELETE FROM sample")
    finally:
        db.close()
    attention = ("read_error" in results or "read_error" in results.values() or "schedule_without_progress" in results.values()
                 or results.get("recovery") in {"unknown", "unverified", "ended_independently"})
    metrics = state / "watchdog.prom.tmp"
    metrics.write_text(f"redunisol_kestra_crm_watchdog_timestamp_seconds {int(ts)}\n"
                       f"redunisol_kestra_crm_watchdog_attention {int(attention)}\n")
    metrics.chmod(0o644)
    metrics.replace(state / "watchdog.prom")
    print(json.dumps({"timestamp": utc(ts).isoformat(), **results}, sort_keys=True))
    return int(attention)


if __name__ == "__main__":
    raise SystemExit(main())
