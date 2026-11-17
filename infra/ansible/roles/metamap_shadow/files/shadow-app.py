"""Isolated MetaMap shadow receiver; imports the unchanged digest-pinned application."""

from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
import re
import stat
from uuid import UUID

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import event, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from metamap_server.api import create_app as create_metamap_app
from metamap_server.config import AppSettings
from metamap_server.db import create_db_engine
from metamap_server.store_sql import SqlValidationStore


MAX_RAW_BYTES = 40_000
MAX_ENVELOPE_BYTES = 60_000
RECOMMENDED_TRIAL_DAYS = 7
FIELDS = frozenset({"version", "delivery_id", "body_base64", "body_sha256", "signature",
                    "content_type", "received_at", "primary_status"})
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
REVISION = re.compile(r"[0-9a-f]{40}\Z")


class InvalidEnvelope(ValueError):
    pass


def _json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise InvalidEnvelope("duplicate_field")
        result[key] = value
    return result


def validate_envelope(raw: bytes, secret: str) -> tuple[dict, bytes]:
    try:
        envelope = json.loads(raw, object_pairs_hook=_json_object,
                              parse_constant=lambda unused: (_ for _ in ()).throw(InvalidEnvelope("invalid_json")))
        if not isinstance(envelope, dict) or set(envelope) != FIELDS:
            raise InvalidEnvelope("invalid_fields")
        if type(envelope["version"]) is not int or envelope["version"] != 1:
            raise InvalidEnvelope("invalid_version")
        delivery_id = envelope["delivery_id"]
        identifier = UUID(delivery_id) if isinstance(delivery_id, str) else None
        if identifier is None or identifier.version != 4 or str(identifier) != delivery_id:
            raise InvalidEnvelope("invalid_delivery_id")
        for name in ("body_sha256", "signature"):
            if not isinstance(envelope[name], str) or HEX64.fullmatch(envelope[name]) is None:
                raise InvalidEnvelope("invalid_digest")
        encoded = envelope["body_base64"]
        if not isinstance(encoded, str) or len(encoded) > ((MAX_RAW_BYTES + 2) // 3) * 4:
            raise InvalidEnvelope("invalid_body")
        body = base64.b64decode(encoded, validate=True)
        if not body or len(body) > MAX_RAW_BYTES or base64.b64encode(body).decode("ascii") != encoded:
            raise InvalidEnvelope("invalid_body")
        if not hmac.compare_digest(hashlib.sha256(body).hexdigest(), envelope["body_sha256"]):
            raise InvalidEnvelope("body_hash_mismatch")
        if not hmac.compare_digest(hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest(), envelope["signature"]):
            raise InvalidEnvelope("invalid_signature")
        content_type = envelope["content_type"]
        if not isinstance(content_type, str) or len(content_type) > 256:
            raise InvalidEnvelope("invalid_content_type")
        if any(ord(character) < 32 or ord(character) > 126 for character in content_type):
            raise InvalidEnvelope("invalid_content_type")
        received_at = envelope["received_at"]
        if not isinstance(received_at, str) or len(received_at) > 40:
            raise InvalidEnvelope("invalid_received_at")
        received = datetime.fromisoformat(received_at.replace("Z", "+00:00"))
        if received.tzinfo is None or received.utcoffset().total_seconds() != 0:
            raise InvalidEnvelope("invalid_received_at")
        primary = envelope["primary_status"]
        if primary is not None and (type(primary) is not int or not 100 <= primary <= 599):
            raise InvalidEnvelope("invalid_primary_status")
        return envelope, body
    except (ValueError, TypeError, AttributeError, binascii.Error, UnicodeError, RecursionError) as exc:
        if isinstance(exc, InvalidEnvelope):
            raise
        raise InvalidEnvelope("invalid_envelope") from None


def _private_database(database_url: str) -> None:
    url = make_url(database_url)
    if url.drivername != "sqlite+pysqlite" or url.query or not url.database:
        raise ValueError("Shadow storage requires a private SQLite database.")
    path = Path(url.database)
    if not path.is_absolute() or path.name != "shadow.sqlite" or path.resolve() != path:
        raise ValueError("Shadow database must be an absolute canonical shadow.sqlite path.")
    if not path.parent.is_dir() or stat.S_IMODE(path.parent.stat().st_mode) & 0o077:
        raise ValueError("Shadow database parent must already be a private directory.")
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        current = path.lstat()
        if not stat.S_ISREG(current.st_mode) or current.st_uid != os.geteuid() or stat.S_IMODE(current.st_mode) != 0o600:
            raise ValueError("Existing shadow database must be an owned regular 0600 file.") from None
    else:
        os.close(descriptor)


class TransactionBoundStore(SqlValidationStore):
    def __init__(self, connection):
        super().__init__(connection.engine)
        # Original store commits only these SAVEPOINTs. The receiver alone commits
        # the explicit outer BEGIN IMMEDIATE, including its own delivery ledger.
        self._session_factory = sessionmaker(bind=connection, future=True, expire_on_commit=False,
                                            join_transaction_mode="create_savepoint")


async def invoke_original(application, body: bytes, content_type: str, signature: str) -> int:
    complete = asyncio.Event()
    delivered = False
    response_status = None

    async def receive():
        nonlocal delivered
        if not delivered:
            delivered = True
            return {"type": "http.request", "body": body, "more_body": False}
        await complete.wait()
        return {"type": "http.disconnect"}

    async def send(message):
        nonlocal response_status
        if message["type"] == "http.response.start":
            response_status = message["status"]
        elif message["type"] == "http.response.body" and not message.get("more_body", False):
            complete.set()

    headers = [(b"x-signature", signature.encode("ascii"))]
    if content_type:
        headers.append((b"content-type", content_type.encode("ascii")))
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST",
             "scheme": "http", "path": "/api/v1/metamap/webhooks", "raw_path": b"/api/v1/metamap/webhooks",
             "query_string": b"", "root_path": "", "server": ("shadow-internal", 80),
             "client": ("127.0.0.1", 0), "headers": headers}
    # HTTP scope deliberately does not enter the original lifespan (pending
    # enrichment recovery and receipt pruning are inappropriate for this cohort).
    await application(scope, receive, send)
    if type(response_status) is not int or not 200 <= response_status <= 499 or not complete.is_set():
        raise RuntimeError("Original ingest did not finish with a recordable response.")
    return response_status


class ShadowReceiver:
    def __init__(self, database_url: str, webhook_secret: str, delivery_token: str, revision: str):
        if len(webhook_secret.encode("utf-8")) < 16 or len(delivery_token.encode("utf-8")) < 32:
            raise ValueError("Shadow secrets do not meet the minimum lengths.")
        if REVISION.fullmatch(revision) is None:
            raise ValueError("Shadow revision must be a complete Git SHA.")
        _private_database(database_url)
        self.engine = create_db_engine(database_url)
        # Strong durability is needed before acknowledging a queue delivery.
        @event.listens_for(self.engine, "connect")
        def durable_connection(dbapi_connection, unused):
            dbapi_connection.execute("PRAGMA synchronous=FULL")

        try:
            with self.engine.connect() as connection:
                connection.exec_driver_sql("PRAGMA synchronous=FULL")
                tables = set(connection.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table' "
                                                       "AND name NOT LIKE 'sqlite_%'").scalars())
                if tables and "shadow_deliveries" not in tables:
                    raise ValueError("An existing unmarked database cannot be adopted as a shadow cohort.")
        except BaseException:
            self.engine.dispose()
            raise
        self.store = SqlValidationStore(self.engine)
        self.store.init_schema()
        with self.engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE IF NOT EXISTS shadow_deliveries (delivery_id TEXT PRIMARY KEY, "
                                       "body_sha256 TEXT NOT NULL, ingest_status INTEGER NOT NULL, received_at TEXT NOT NULL, "
                                       "primary_status INTEGER, stored_at TEXT NOT NULL, duplicate_count INTEGER NOT NULL DEFAULT 0)")
        self.settings = AppSettings(database_url=database_url, webhook_secret=webhook_secret,
                                    bootstrap_clients=[], git_sha=revision,
                                    metamap_client_id=None, metamap_client_secret=None, metamap_api_token=None,
                                    bank_callback_token=None)
        self.token = delivery_token.encode("utf-8")
        self.revision = revision
        self.lock = asyncio.Lock()
        self.rejections = 0
        self.processing_failures = 0
        # The original handler logs untrusted event identifiers on rejected input.
        # This isolated process reports only aggregate counters and fixed errors.
        logging.getLogger("metamap_server.api").disabled = True

    @staticmethod
    def _record_delivery(connection, envelope: dict, ingest_status: int) -> None:
        connection.execute(text("INSERT INTO shadow_deliveries "
                                "(delivery_id,body_sha256,ingest_status,received_at,primary_status,stored_at) "
                                "VALUES (:delivery_id,:body_sha256,:ingest_status,:received_at,:primary_status,:stored_at)"),
                           {**{key: envelope[key] for key in ("delivery_id", "body_sha256", "received_at", "primary_status")},
                            "ingest_status": ingest_status, "stored_at": datetime.now(timezone.utc).isoformat()})

    async def ingest(self, envelope: dict, body: bytes) -> tuple[dict, bool]:
        with self.engine.connect() as connection:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
            try:
                existing = connection.execute(text("SELECT body_sha256,ingest_status FROM shadow_deliveries "
                                                   "WHERE delivery_id=:identifier"),
                                              {"identifier": envelope["delivery_id"]}).mappings().first()
                if existing is not None:
                    if existing["body_sha256"] != envelope["body_sha256"]:
                        connection.rollback()
                        return {}, True
                    connection.execute(text("UPDATE shadow_deliveries SET duplicate_count=duplicate_count+1 "
                                            "WHERE delivery_id=:identifier"), {"identifier": envelope["delivery_id"]})
                    ingest_status = existing["ingest_status"]
                    duplicate = True
                else:
                    internal = create_metamap_app(settings=self.settings, store=TransactionBoundStore(connection))
                    try:
                        if internal.state.metamap_resource_fetcher is not None:
                            raise RuntimeError("Shadow enrichment must remain disabled.")
                        ingest_status = await invoke_original(internal, body, envelope["content_type"], envelope["signature"])
                        if type(ingest_status) is not int or not 200 <= ingest_status <= 499:
                            raise RuntimeError("Original ingest did not return a recordable HTTP status.")
                    finally:
                        internal.state.background_enricher.shutdown()
                    self._record_delivery(connection, envelope, ingest_status)
                    duplicate = False
                connection.commit()
                return {"delivery_id": envelope["delivery_id"], "body_sha256": envelope["body_sha256"],
                        "ingest_status": ingest_status, "duplicate": duplicate, "shadow_only": True}, False
            except BaseException:
                connection.rollback()
                raise

    def stats(self) -> dict:
        with self.engine.connect() as connection:
            totals = connection.execute(text("SELECT COUNT(*),COALESCE(SUM(duplicate_count),0),"
                                             "COALESCE(SUM(CASE WHEN ingest_status>=400 THEN 1 ELSE 0 END),0) "
                                             "FROM shadow_deliveries")).one()
            validations = connection.exec_driver_sql("SELECT COUNT(*) FROM validations").scalar_one()
            receipts = connection.exec_driver_sql("SELECT COUNT(*) FROM metamap_webhook_receipts").scalar_one()
        return {"deliveries": totals[0], "duplicates": totals[1], "rejections": self.rejections + totals[2],
                "processing_failures": self.processing_failures, "validations": validations, "receipts": receipts,
                "volatile_counters": ["envelope_rejections", "processing_failures"],
                "status": "ok", **self.health_metadata()}

    def health_metadata(self) -> dict:
        return {"shadow_only": True, "enrichment_enabled": False, "revision": self.revision,
                "recommended_trial_days": RECOMMENDED_TRIAL_DAYS, "automatic_retention": False}

    def health(self) -> dict:
        with self.engine.connect() as connection:
            connection.exec_driver_sql("SELECT delivery_id FROM shadow_deliveries LIMIT 1").first()
        return {"status": "ok", **self.health_metadata()}


def create_shadow_app(*, database_url: str, webhook_secret: str, delivery_token: str, revision: str) -> FastAPI:
    receiver = ShadowReceiver(database_url, webhook_secret, delivery_token, revision)

    @asynccontextmanager
    async def lifespan(unused):
        try:
            yield
        finally:
            receiver.engine.dispose()

    application = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    application.state.receiver = receiver

    @application.get("/health")
    async def health():
        try:
            return receiver.health()
        except Exception:
            return JSONResponse({"status": "degraded", **receiver.health_metadata()}, status_code=503)

    @application.get("/stats")
    async def stats():
        try:
            return receiver.stats()
        except Exception:
            return JSONResponse({"status": "degraded", **receiver.health_metadata()}, status_code=503)

    @application.post("/deliveries")
    async def deliveries(request: Request):
        authorization = request.headers.get("authorization", "").encode("utf-8")
        if not hmac.compare_digest(authorization, b"Bearer " + receiver.token):
            receiver.rejections += 1
            return JSONResponse({"error": "unauthorized", "shadow_only": True}, status_code=401)
        async with receiver.lock:
            raw = bytearray()
            async for chunk in request.stream():
                if len(raw) + len(chunk) > MAX_ENVELOPE_BYTES:
                    receiver.rejections += 1
                    return JSONResponse({"error": "envelope_too_large", "shadow_only": True}, status_code=413)
                raw.extend(chunk)
            try:
                envelope, body = validate_envelope(bytes(raw), receiver.settings.webhook_secret)
            except InvalidEnvelope:
                receiver.rejections += 1
                return JSONResponse({"error": "invalid_envelope", "shadow_only": True}, status_code=400)
            try:
                receipt, conflict = await receiver.ingest(envelope, body)
            except Exception:
                receiver.processing_failures += 1
                return JSONResponse({"error": "ingest_failed_retryable", "shadow_only": True}, status_code=503)
            if conflict:
                receiver.rejections += 1
                return JSONResponse({"error": "delivery_id_conflict", "shadow_only": True}, status_code=409)
            # Original 4xx is a durably recorded signed delivery, not a queue
            # transport failure. Its HTTP result remains in ingest_status.
            return JSONResponse(receipt, status_code=200)

    return application


class EnvironmentApplication:
    """Delay environment/database access until Uvicorn initializes this ASGI app."""

    def __init__(self):
        self.application = None

    async def __call__(self, scope, receive, send):
        if self.application is None:
            database_url = os.environ.get("METAMAP_SHADOW_DATABASE_URL", "")
            if database_url != "sqlite+pysqlite:////data/shadow.sqlite":
                raise ValueError("Shadow runtime database must be /data/shadow.sqlite.")
            self.application = create_shadow_app(database_url=database_url,
                                                 webhook_secret=os.environ.get("METAMAP_SHADOW_WEBHOOK_SECRET", ""),
                                                 delivery_token=os.environ.get("METAMAP_SHADOW_DELIVERY_TOKEN", ""),
                                                 revision=os.environ.get("METAMAP_SHADOW_REVISION", ""))
        await self.application(scope, receive, send)


app = EnvironmentApplication()
