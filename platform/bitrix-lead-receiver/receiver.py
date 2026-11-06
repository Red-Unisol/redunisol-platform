"""Durable, coalescing Bitrix ingress. Business decisions remain in Kestra."""
from __future__ import annotations

import contextlib
import base64
import hmac
import json
import logging
import os
import signal
import sqlite3
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen

LOG = logging.getLogger("receiver")
TERMINAL = {"SUCCESS", "FAILED", "KILLED", "CANCELLED", "WARNING"}
WAITING_FOR_UPDATE = "waiting_for_update"
REVIEW_REQUIRED = "review_required"
RECEIPT_TERMINAL = {"done", "failed", WAITING_FOR_UPDATE}


class ReadFailure(RuntimeError):
    """Only fixed reason codes cross the HTTP/privacy boundary."""
    def __init__(self, reason, http_status=None, shared=False):
        super().__init__(reason)
        self.reason, self.http_status, self.shared = reason, http_status, shared


def classify_read_failure(status, payload):
    payload = payload if isinstance(payload, dict) else {}
    code = str(payload.get("error") or "").upper()
    description = str(payload.get("error_description") or "").strip().lower().rstrip(".")
    if status in (401, 403) or code in {"INVALID_CREDENTIALS", "INVALID_TOKEN", "EXPIRED_TOKEN", "NO_AUTH_FOUND", "ACCESS_DENIED", "ERROR_ACCESS_DENIED", "INSUFFICIENT_SCOPE"}:
        return ReadFailure("authentication", status, shared=True)
    if status == 429 or code == "QUERY_LIMIT_EXCEEDED":
        return ReadFailure("rate_limited", status, shared=True)
    if status in (200, 400, 404) and (code in {"NOT_FOUND", "ERROR_NOT_FOUND", "LEAD_NOT_FOUND"}
            or description in {"not found", "lead not found", "the lead is not found"}):
        return ReadFailure("not_found", status)
    if status == 400:
        return ReadFailure("invalid_request", status)
    return ReadFailure("service_unavailable" if status >= 500 or status == 404 else "invalid_response", status, shared=True)


class Store:
    def __init__(self, path, clock=time.time):
        self.path, self.clock = str(path), clock
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                INSERT OR IGNORE INTO settings VALUES ('mode','paused');
                CREATE TABLE IF NOT EXISTS jobs (
                    lead TEXT PRIMARY KEY, version INTEGER NOT NULL, finished INTEGER NOT NULL DEFAULT 0,
                    state TEXT NOT NULL DEFAULT 'pending', available REAL NOT NULL, lease REAL,
                    receipt TEXT, last_status TEXT, events INTEGER NOT NULL DEFAULT 1,
                    created REAL NOT NULL, updated REAL NOT NULL, error TEXT);
                CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(state,available);
                CREATE TABLE IF NOT EXISTS receipts (
                    id TEXT PRIMARY KEY, lead TEXT NOT NULL, version INTEGER NOT NULL,
                    status TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'created',
                    execution TEXT, attempts INTEGER NOT NULL DEFAULT 0,
                    last_submit REAL NOT NULL DEFAULT 0, created REAL NOT NULL, updated REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
            """)
            # Additive migration: existing jobs/receipts and their versions survive.
            columns = {row[1] for row in db.execute("PRAGMA table_info(jobs)")}
            for name, definition in {"read_attempts": "INTEGER NOT NULL DEFAULT 0",
                    "not_found_attempts": "INTEGER NOT NULL DEFAULT 0",
                    "read_failed_at": "REAL"}.items():
                if name not in columns:
                    db.execute("ALTER TABLE jobs ADD COLUMN "+name+" "+definition)

    @contextlib.contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA synchronous=FULL")
        db.execute("BEGIN IMMEDIATE")
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def count(db, name, amount=1):
        db.execute("INSERT INTO counters VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=value+excluded.value", (name, amount))

    def enqueue(self, lead):
        self.enqueue_many([lead])

    def enqueue_many(self, leads):
        """Commit a migration batch atomically, rather than fsync once per lead."""
        now = self.clock()
        with self.db() as db:
            for lead in leads:
                old = db.execute("SELECT state FROM jobs WHERE lead=?", (lead,)).fetchone()
                db.execute("""INSERT INTO jobs(lead,version,available,created,updated) VALUES (?,1,?,?,?)
                    ON CONFLICT(lead) DO UPDATE SET version=version+1, events=events+1, updated=excluded.updated,
                    read_attempts=0,not_found_attempts=0,read_failed_at=NULL,
                    state=CASE WHEN jobs.state IN ('done','shadow','waiting_for_update','review_required') THEN 'pending' ELSE jobs.state END,
                    available=CASE WHEN jobs.state IN ('done','shadow','waiting_for_update','review_required') THEN excluded.available ELSE jobs.available END""", (lead, now, now, now))
                self.count(db, "events_received")
                if old and old["state"] not in ("done", "shadow", WAITING_FOR_UPDATE, REVIEW_REQUIRED):
                    self.count(db, "events_coalesced")

    def mode(self, value=None):
        with self.db() as db:
            if value is not None:
                if value not in {"paused", "shadow", "active"}:
                    raise ValueError("Invalid mode")
                db.execute("UPDATE settings SET value=? WHERE key='mode'", (value,))
                if value == "active":
                    db.execute("UPDATE jobs SET state='pending',available=? WHERE state='shadow'", (self.clock(),))
            return db.execute("SELECT value FROM settings WHERE key='mode'").fetchone()[0]

    def take(self):
        now = self.clock()
        with self.db() as db:
            pause = db.execute("SELECT value FROM settings WHERE key='read_pause_until'").fetchone()
            if pause and float(pause[0]) > now:
                return None
            db.execute("UPDATE jobs SET state='pending' WHERE state='checking' AND lease<?", (now,))
            row = db.execute("SELECT * FROM jobs WHERE state='pending' AND available<=? ORDER BY available,created LIMIT 1", (now,)).fetchone()
            if row:
                db.execute("UPDATE jobs SET state='checking',lease=? WHERE lead=?", (now+120, row["lead"]))
            return dict(row) if row else None

    def defer(self, job, error, delay=30):
        with self.db() as db:
            db.execute("UPDATE jobs SET state='pending',available=?,lease=NULL,error=? WHERE lead=? AND state='checking'", (self.clock()+delay, error, job["lead"]))
            self.count(db, "read_errors" if error != "capacity" else "capacity_deferrals")

    def fail_read(self, job, failure):
        now = self.clock()
        with self.db() as db:
            row = db.execute("SELECT * FROM jobs WHERE lead=? AND state='checking'", (job['lead'],)).fetchone()
            if not row:
                return None
            self.count(db, "read_errors")
            self.count(db, "read_error_"+failure.reason)
            circuit_opened = False
            if failure.shared:
                previous = db.execute("SELECT value FROM settings WHERE key='read_pause_until'").fetchone()
                previous_until = float(previous[0]) if previous else 0
                pause = 300 if failure.reason == 'authentication' else 60
                circuit_opened = previous_until <= now
                db.execute("INSERT INTO settings VALUES ('read_pause_until',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(max(previous_until, now+pause)),))
                db.execute("INSERT INTO settings VALUES ('read_pause_reason',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (failure.reason,))
                if circuit_opened:
                    self.count(db, 'read_circuit_opened')
            # An error from an older read must not park a newer incoming event.
            if row['version'] != job['version']:
                db.execute("UPDATE jobs SET state='pending',available=?,lease=NULL,error=NULL,read_attempts=0,not_found_attempts=0,read_failed_at=NULL WHERE lead=?", (now,job['lead']))
                return {'state':'pending','reason':failure.reason,'attempts':0,'delay':0,'circuit_opened':circuit_opened}
            attempts = row['read_attempts']+1
            missing = row['not_found_attempts']+1 if failure.reason == 'not_found' else 0
            review = (failure.reason == 'not_found' and missing >= 2) or failure.reason == 'invalid_request' or (attempts >= 6 and failure.reason not in {'authentication','rate_limited'})
            delay = 60 if failure.reason == 'not_found' else min(1800,30 * 2**min(attempts-1,6))
            state = REVIEW_REQUIRED if review else 'pending'
            db.execute("UPDATE jobs SET state=?,available=?,lease=NULL,error=?,read_attempts=?,not_found_attempts=?,read_failed_at=coalesce(read_failed_at,?) WHERE lead=?",
                       (state,now+delay,failure.reason,attempts,missing,now,job['lead']))
            if review:
                self.count(db,'read_review_required')
            return {'state':state,'reason':failure.reason,'attempts':attempts,'delay':delay,'circuit_opened':circuit_opened}

    def finish_check(self, job, status, shadow=False):
        with self.db() as db:
            # A new event arriving during the API read must get another read.
            db.execute("""UPDATE jobs SET finished=?,last_status=?,lease=NULL,error=NULL,read_attempts=0,not_found_attempts=0,read_failed_at=NULL,
                state=CASE WHEN version>? THEN 'pending' ELSE ? END,available=?
                WHERE lead=? AND state='checking'""",
                (job["version"], status if not shadow else job["last_status"], job["version"], "shadow" if shadow else "done", self.clock(), job["lead"]))
            self.count(db, "shadow_checked" if shadow else "filtered")

    def dispatch(self, job, status, limit=2):
        now = self.clock()
        with self.db() as db:
            if db.execute("SELECT count(*) FROM jobs WHERE state='waiting'").fetchone()[0] >= limit:
                return None
            token = uuid.uuid4().hex
            db.execute("INSERT INTO receipts(id,lead,version,status,created,updated) VALUES (?,?,?,?,?,?)", (token, job["lead"], job["version"], status, now, now))
            db.execute("UPDATE jobs SET state='waiting',receipt=?,lease=NULL,error=NULL,read_attempts=0,not_found_attempts=0,read_failed_at=NULL WHERE lead=? AND state='checking'", (token, job["lead"]))
            self.count(db, "business_requested")
            return token

    def claim(self, token, lead, execution):
        with self.db() as db:
            r = db.execute("SELECT * FROM receipts WHERE id=? AND lead=?", (token, lead)).fetchone()
            if not r or r["state"] in RECEIPT_TERMINAL:
                return False
            if r["execution"] and r["execution"] != execution:
                return False
            db.execute("UPDATE receipts SET execution=?,state='running',updated=? WHERE id=?", (execution, self.clock(), token))
            return True

    def complete(self, token, execution, ok, action=""):
        if not isinstance(ok, bool) or not isinstance(action, str):
            raise ValueError("Boolean result and string action required")
        if ok and action == WAITING_FOR_UPDATE:
            raise ValueError("Waiting for an update is not a completed business result")
        with self.db() as db:
            r = db.execute("SELECT * FROM receipts WHERE id=?", (token,)).fetchone()
            if not r or r["execution"] != execution:
                return False
            if r["state"] in RECEIPT_TERMINAL:
                return True
            now = self.clock()
            waiting = action == WAITING_FOR_UPDATE
            state = WAITING_FOR_UPDATE if waiting else ("done" if ok else "failed")
            db.execute("UPDATE receipts SET state=?,updated=? WHERE id=?", (state, now, token))
            if waiting:
                # Consume only this version. An event received while the flow ran
                # must be checked even when it leaves the commercial status unchanged.
                db.execute("""UPDATE jobs SET finished=?,last_status=NULL,receipt=NULL,error=NULL,
                    state=CASE WHEN version>? THEN 'pending' ELSE 'waiting_for_update' END,available=?
                    WHERE lead=? AND receipt=?""", (r["version"], r["version"], now, r["lead"], token))
            elif ok:
                db.execute("""UPDATE jobs SET finished=?,last_status=?,receipt=NULL,error=NULL,
                    state=CASE WHEN version>? THEN 'pending' ELSE 'done' END,available=?
                    WHERE lead=? AND receipt=?""", (r["version"], r["status"], r["version"], now, r["lead"], token))
            else:
                db.execute("UPDATE jobs SET state='pending',receipt=NULL,available=?,error='business_failed' WHERE lead=? AND receipt=?", (now+60, r["lead"], token))
            self.count(db, "business_waiting_for_update" if waiting else ("business_ok" if ok else "business_failed"))
            return True

    def submissions(self):
        now = self.clock()
        with self.db() as db:
            rows = db.execute("SELECT * FROM receipts WHERE state='created' AND attempts<3 AND last_submit<? ORDER BY created LIMIT 2", (now-60,)).fetchall()
            for r in rows:
                # Commit before POST. An ambiguous POST retries this SAME receipt;
                # the first Kestra task grants ownership to only one execution.
                db.execute("UPDATE receipts SET attempts=attempts+1,last_submit=? WHERE id=?", (now, r["id"]))
            return [dict(r) for r in rows]

    def reconcilable(self):
        with self.db() as db:
            return [dict(r) for r in db.execute("SELECT * FROM receipts WHERE state='running' AND updated<? LIMIT 2", (self.clock()-60,))]

    def stats(self):
        with self.db() as db:
            states = dict(db.execute("SELECT state,count(*) FROM jobs GROUP BY state").fetchall())
            oldest = db.execute("SELECT min(created) FROM jobs WHERE state IN ('pending','checking','waiting')").fetchone()[0]
            uncertain = db.execute("SELECT count(*) FROM receipts WHERE state='created' AND attempts>=3 AND last_submit<?", (self.clock()-60,)).fetchone()[0]
            stale = db.execute("SELECT count(*) FROM receipts WHERE state='running' AND updated<?", (self.clock()-600,)).fetchone()[0]
            pause = dict(db.execute("SELECT key,value FROM settings WHERE key IN ('read_pause_until','read_pause_reason')"))
            review = dict(db.execute("SELECT error,count(*) FROM jobs WHERE state='review_required' GROUP BY error"))
            failed_since = db.execute("SELECT min(read_failed_at) FROM jobs WHERE state IN ('pending','checking','review_required')").fetchone()[0]
            return {"mode": db.execute("SELECT value FROM settings WHERE key='mode'").fetchone()[0],
                    "jobs": states, "counters": dict(db.execute("SELECT * FROM counters").fetchall()),
                    "oldest_pending_seconds": round(self.clock()-oldest, 1) if oldest else 0,
                    "unconfirmed_submissions": uncertain, "stale_business_receipts": stale,
                    "read_circuit": {"active":float(pause.get('read_pause_until',0))>self.clock(),
                                     "until":float(pause.get('read_pause_until',0)),"reason":pause.get('read_pause_reason')},
                    "review_by_reason":review,
                    "oldest_read_error_seconds":round(self.clock()-failed_since,1) if failed_since is not None else 0}


class Client:
    def __init__(self, bitrix_url, kestra_url, token, actionable, kestra_api=None, kestra_auth=None):
        self.bitrix_url, self.kestra_url, self.token = bitrix_url, kestra_url, token
        self.actionable = set(actionable)
        self.kestra_api, self.kestra_auth = kestra_api, kestra_auth
        self.read_lock = threading.Lock()
        self.next_read = 0.0

    @staticmethod
    def post(url, body, timeout=20, classify_read=False):
        request = Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=timeout) as response:
                result = json.load(response)
                if classify_read and (not isinstance(result,dict) or 'error' in result):
                    raise classify_read_failure(200,result)
                return result
        except ReadFailure:
            raise
        except HTTPError as exc:
            if classify_read:
                try:
                    payload=json.loads(exc.read(65536))
                except Exception:
                    payload={}
                raise classify_read_failure(exc.code,payload) from None
            # Do not include request URL, authentication, or response data in logs.
            raise RuntimeError("http_"+str(exc.code)) from None
        except Exception as exc:
            if classify_read:
                reason = 'invalid_response' if isinstance(exc,(ValueError,TypeError)) else 'transport_error'
                raise ReadFailure(reason,shared=True) from None
            raise RuntimeError(type(exc).__name__) from None

    def status(self, lead):
        # Bound aggregate API pressure across both consumers. Business flows
        # share the portal, so two threads must not imply unlimited reads.
        with self.read_lock:
            delay = self.next_read-time.monotonic()
            if delay > 0:
                time.sleep(delay)
            self.next_read = time.monotonic()+0.75
        result = self.post(self.bitrix_url.rstrip('/')+'/crm.lead.get.json', {"id": lead},classify_read=True)
        item = result.get('result')
        status = item.get('STATUS_ID') if isinstance(item,dict) else None
        if not isinstance(status, str) or not status:
            raise ReadFailure("invalid_response",shared=True)
        return status

    def submit(self, receipt):
        return self.post(self.kestra_url, {"event": "ONCRMLEADUPDATE", "data": {"FIELDS": {"ID": receipt["lead"]}},
                                          "auth": {"application_token": self.token}, "receipt": receipt["id"]})

    def result(self, execution):
        """Recover a missed callback using persisted Kestra task outputs.

        None means still running or an ambiguous result: never guess success.
        """
        if not self.kestra_api or not self.kestra_auth:
            return None
        def get(path):
            authorization = base64.b64encode((':'.join(self.kestra_auth)).encode()).decode()
            request = Request(self.kestra_api.rstrip('/')+path, headers={'Authorization':'Basic '+authorization})
            try:
                with urlopen(request, timeout=15) as response:
                    return json.load(response)
            except Exception as exc:
                raise RuntimeError(type(exc).__name__) from None
        state = get('/executions/'+execution)
        if state.get('state', {}).get('current') not in TERMINAL:
            return None
        tasks = [t for t in state.get('taskRunList', []) if t.get('taskId') == 'procesar_actualizacion_lead']
        if not tasks:
            return {"ok": False, "action": ""}
        task = tasks[-1]
        if task.get('state', {}).get('current') != 'SUCCESS':
            return {"ok": False, "action": ""}
        output = get('/outputs/tasks/'+execution+'/'+task['id'])
        ok = output.get('vars', {}).get('ok')
        action = output.get('vars', {}).get('action', '')
        if not isinstance(ok, bool) or not isinstance(action, str):
            return None
        return {"ok": ok, "action": action}


class Engine:
    def __init__(self, store, client):
        self.store, self.client = store, client

    def step(self):
        mode = self.store.mode()
        if mode == "paused":
            return False
        job = self.store.take()
        if not job:
            return False
        try:
            status = self.client.status(job["lead"])
            if mode == "shadow" or status not in self.client.actionable or status == job["last_status"]:
                self.store.finish_check(job, status, shadow=mode == "shadow")
            elif self.store.mode() != "active":
                self.store.defer(job, "mode_changed", 1)
            elif not self.store.dispatch(job, status):
                self.store.defer(job, "capacity", 30)
        except Exception as exc:
            failure = exc if isinstance(exc,ReadFailure) else ReadFailure('unexpected_read_error')
            result = self.store.fail_read(job,failure)
            if result:
                log = LOG.error if result['state']==REVIEW_REQUIRED or result['circuit_opened'] else LOG.warning
                log("lead_read_failed lead=%s reason=%s http=%s attempts=%s state=%s retry_seconds=%s circuit_opened=%s exception_type=%s",
                    job['lead'],failure.reason,failure.http_status,result['attempts'],result['state'],result['delay'] if result['state']=='pending' else None,result['circuit_opened'],type(exc).__name__)
        return True

    def send(self):
        if self.store.mode() != "active":
            return
        for r in self.store.submissions():
            try:
                self.client.submit(r)
            except Exception as exc:
                LOG.warning("submission_unconfirmed receipt=%s type=%s", r["id"], type(exc).__name__)

    def reconcile(self):
        for r in self.store.reconcilable():
            try:
                result = self.client.result(r['execution'])
                if result is not None:
                    self.store.complete(r['id'], r['execution'], **result)
            except Exception as exc:
                LOG.warning('reconciliation_failed receipt=%s type=%s', r['id'], type(exc).__name__)


def normalize_payload(body):
    if isinstance(body, str):
        body = {k: v[-1] for k, v in parse_qs(body, keep_blank_values=True).items()}
    if not isinstance(body, dict):
        raise ValueError("Invalid payload")
    token = body.get("auth[application_token]") or body.get("auth", {}).get("application_token")
    lead = body.get("data[FIELDS][ID]") or body.get("data", {}).get("FIELDS", {}).get("ID")
    if body.get("event") != "ONCRMLEADUPDATE" or not str(lead or "").isdigit() or int(lead) <= 0:
        raise ValueError("Invalid lead event")
    return str(int(lead)), str(token or "")


def make_handler(store, app_token, admin_token, webhook_key):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # HTTP paths may contain the existing webhook secret.

        def reply(self, status, payload):
            raw = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            if self.path == "/health":
                return self.reply(200, {"status": "UP"})
            if self.path == "/internal/stats" and hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer "+admin_token):
                return self.reply(200, store.stats())
            return self.reply(404, {"error": "not_found"})

        def do_POST(self):
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 1 or length > 65536:
                    return self.reply(413, {"error": "body_size"})
                self.connection.settimeout(10)
                raw = self.rfile.read(length).decode()
                body = json.loads(raw) if "application/json" in self.headers.get("Content-Type", "") else raw
                path = urlsplit(self.path).path
                if path.startswith('/internal/'):
                    expected = admin_token if path in ('/internal/mode', '/internal/enqueue') else app_token
                    if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer "+expected):
                        return self.reply(403, {"error": "forbidden"})
                    if not isinstance(body, dict):
                        raise ValueError("JSON required")
                    if path == '/internal/mode':
                        return self.reply(200, {"mode": store.mode(body["mode"])})
                    if path == '/internal/enqueue':
                        leads = body['leads']
                        if not isinstance(leads, list) or len(leads) > 1000 or any(not str(x).isdigit() or int(x)<=0 for x in leads):
                            raise ValueError("Invalid leads")
                        store.enqueue_many(set(map(str, leads)))
                        return self.reply(200, {"accepted": len(set(map(str, leads)))})
                    if path == '/internal/claim':
                        granted = store.claim(str(body['receipt']), str(body['lead_id']), str(body['execution_id']))
                        return self.reply(200, {"granted": granted})
                    if path == '/internal/complete':
                        if not isinstance(body.get('ok'), bool):
                            raise ValueError("Boolean result required")
                        accepted = store.complete(str(body['receipt']), str(body['execution_id']),
                                                  body['ok'], body.get('action', ''))
                        return self.reply(200 if accepted else 409, {"accepted": accepted})
                    return self.reply(404, {"error": "not_found"})
                prefixes = ('/api/v1/main/executions/webhook/', '/api/v1/executions/webhook/')
                suffix = 'redunisol.prod.marketing-crm/bitrix24_lead_won_deal_webhook/'
                prefix = next((p+suffix for p in prefixes if path.startswith(p+suffix)), None)
                if prefix is None or not hmac.compare_digest(path[len(prefix):], webhook_key):
                    return self.reply(404, {"error": "not_found"})
                lead, token = normalize_payload(body)
                if not hmac.compare_digest(token, app_token):
                    return self.reply(403, {"error": "forbidden"})
                store.enqueue(lead)  # Durable commit BEFORE acknowledging Bitrix.
                return self.reply(200, {"ok": True, "queued": True, "lead_id": lead})
            except (ValueError, KeyError, TypeError, AttributeError):
                return self.reply(400, {"error": "invalid_request"})
            except Exception as exc:
                LOG.error("request_failed type=%s", type(exc).__name__)
                return self.reply(503, {"error": "temporarily_unavailable"})
    return Handler


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    token = os.environ['BITRIX_APPLICATION_TOKEN']
    admin = os.environ['RECEIVER_ADMIN_TOKEN']
    key = os.environ['BITRIX_WEBHOOK_KEY']
    if not all((token, admin, key)):
        raise ValueError('Required secrets are empty')
    store = Store(os.environ.get('RECEIVER_DB', '/data/receiver.sqlite'))
    client = Client(os.environ['BITRIX_REST_URL'], os.environ['KESTRA_DISPATCH_URL'], token,
                    os.environ['ACTIONABLE_STATUSES'].split(','), os.environ.get('KESTRA_API_URL'),
                    (os.environ['KESTRA_USERNAME'], os.environ['KESTRA_PASSWORD'])
                    if os.environ.get('KESTRA_USERNAME') else None)
    engine = Engine(store, client)
    stop = threading.Event()
    def consume():
        while not stop.is_set():
            try:
                if not engine.step():
                    stop.wait(.25)
            except Exception as exc:
                LOG.error('consumer_error type=%s', type(exc).__name__)
                stop.wait(1)
    def send():
        next_reconcile = 0
        while not stop.is_set():
            try:
                engine.send()
                if time.monotonic() >= next_reconcile:
                    engine.reconcile()
                    next_reconcile = time.monotonic()+30
            except Exception as exc:
                LOG.error('sender_error type=%s', type(exc).__name__)
            stop.wait(2)
    for target in (consume, consume, send):
        threading.Thread(target=target, daemon=True).start()
    server = ThreadingHTTPServer(('0.0.0.0', 8092), make_handler(store, token, admin, key))
    def shutdown(*args):
        stop.set()
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    LOG.info('receiver_started mode=%s', store.mode())
    server.serve_forever()
    server.server_close()


if __name__ == '__main__':
    main()
