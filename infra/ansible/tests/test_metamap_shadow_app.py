"""Exercise the shadow adapter against the real pinned MetaMap Python source."""

import asyncio
import base64
from contextlib import closing
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "apps/metamap-platform/server/src"))
MODULE_FILE = ROOT / "infra/ansible/roles/metamap_shadow/files/shadow-app.py"
try:
    import httpx
except ImportError:
    httpx = None


@unittest.skipUnless(httpx is not None, "MetaMap server dev dependencies required")
class ShadowApplicationTests(unittest.IsolatedAsyncioTestCase):
    SECRET = "synthetic-webhook-secret-for-tests"
    TOKEN = "synthetic-delivery-token-for-tests-only"

    async def asyncSetUp(self):
        spec = importlib.util.spec_from_file_location("metamap_shadow_test_app", MODULE_FILE)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.directory = tempfile.TemporaryDirectory(prefix="metamap-shadow-test-")
        self.database = Path(self.directory.name) / "shadow.sqlite"
        # Ambient production credentials must never be inherited by AppSettings.
        with mock.patch.dict(os.environ, {"METAMAP_SERVER_METAMAP_API_TOKEN": "unused-ambient-token",
                                          "METAMAP_SERVER_BOOTSTRAP_CLIENTS_JSON": "invalid-ambient-json"}):
            self.app = self.module.create_shadow_app(database_url="sqlite+pysqlite:///" + str(self.database),
                                                      webhook_secret=self.SECRET, delivery_token=self.TOKEN,
                                                      revision="a" * 40)
        self.receiver = self.app.state.receiver
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://shadow")

    async def asyncTearDown(self):
        await self.client.aclose()
        self.receiver.engine.dispose()
        self.directory.cleanup()

    def envelope(self, body=None, **changes):
        if body is None:
            body = json.dumps({"eventName": "verification_completed", "verificationId": "shadow-fixture-1",
                               "resource": "https://example.invalid/v2/verifications/shadow-fixture-1",
                               "metadata": {"name": "Prueba ñ 漢字", "requestNumber": "123"}},
                              ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        value = {"version": 1, "delivery_id": str(uuid4()), "body_base64": base64.b64encode(body).decode(),
                 "body_sha256": hashlib.sha256(body).hexdigest(),
                 "signature": hmac.new(self.SECRET.encode(), body, hashlib.sha256).hexdigest(),
                 "content_type": "application/json; charset=utf-8", "received_at": "2026-11-13T12:00:00.000Z",
                 "primary_status": 200}
        value.update(changes)
        return value

    async def deliver(self, envelope=None, **request_options):
        return await self.client.post("/deliveries", json=envelope or self.envelope(),
                                      headers={"Authorization": "Bearer " + self.TOKEN}, **request_options)

    def scalar(self, sql):
        with self.receiver.engine.connect() as connection:
            return connection.exec_driver_sql(sql).scalar_one()

    async def test_real_schema_projection_receipt_utf8_and_aggregate_stats(self):
        envelope = self.envelope()
        response = await self.deliver(envelope)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"delivery_id": envelope["delivery_id"], "body_sha256": envelope["body_sha256"],
                                           "ingest_status": 200, "duplicate": False, "shadow_only": True})
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM validations"), 1)
        self.assertEqual(self.scalar("SELECT event_count FROM validations"), 1)
        self.assertEqual(self.scalar("SELECT normalized_status FROM validations"), "completed")
        self.assertEqual(self.scalar("SELECT raw_body FROM metamap_webhook_receipts"),
                         base64.b64decode(envelope["body_base64"]).decode("utf-8"))
        headers = json.loads(self.scalar("SELECT headers FROM metamap_webhook_receipts"))
        self.assertEqual(headers["x-signature"], envelope["signature"])
        self.assertNotIn("authorization", headers)
        stats = (await self.client.get("/stats")).json()
        self.assertEqual([stats[key] for key in ("deliveries", "duplicates", "rejections", "validations", "receipts")],
                         [1, 0, 0, 1, 1])
        self.assertNotIn("shadow-fixture", json.dumps(stats))
        self.assertNotIn("Prueba", json.dumps(stats))

    async def test_concurrent_duplicates_increment_event_and_receipt_once(self):
        envelope = self.envelope()
        responses = await asyncio.gather(*(self.deliver(envelope) for unused in range(6)))
        self.assertTrue(all(response.status_code == 200 for response in responses))
        self.assertEqual(sum(not response.json()["duplicate"] for response in responses), 1)
        self.assertEqual(self.scalar("SELECT event_count FROM validations"), 1)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM metamap_webhook_receipts"), 1)
        self.assertEqual(self.scalar("SELECT duplicate_count FROM shadow_deliveries"), 5)

    async def test_uuid_conflict_does_not_change_projection_or_receipts(self):
        envelope = self.envelope()
        self.assertEqual((await self.deliver(envelope)).status_code, 200)
        other = self.envelope(b'{"eventName":"verification_started","verificationId":"different"}',
                              delivery_id=envelope["delivery_id"])
        self.assertEqual((await self.deliver(other)).status_code, 409)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM validations"), 1)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM metamap_webhook_receipts"), 1)

    async def test_lost_ack_survives_restart_without_pruning_old_receipts(self):
        envelope = self.envelope()
        first = await self.deliver(envelope)
        self.assertEqual(first.status_code, 200)
        with self.receiver.engine.begin() as connection:
            connection.exec_driver_sql("UPDATE metamap_webhook_receipts SET received_at='2000-01-01T00:00:00+00:00'")
        self.receiver.engine.dispose()
        other = self.module.create_shadow_app(database_url="sqlite+pysqlite:///" + str(self.database),
                                               webhook_secret=self.SECRET, delivery_token=self.TOKEN,
                                               revision="b" * 40)
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=other), base_url="http://shadow") as client:
                response = await client.post("/deliveries", json=envelope,
                                             headers={"Authorization": "Bearer " + self.TOKEN})
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["duplicate"])
            self.assertEqual(response.json()["ingest_status"], first.json()["ingest_status"])
            self.assertEqual(self.scalar("SELECT event_count FROM validations"), 1)
            self.assertEqual(self.scalar("SELECT COUNT(*) FROM metamap_webhook_receipts"), 1)
        finally:
            other.state.receiver.engine.dispose()

    async def test_failure_after_original_session_commits_rolls_back_projection_receipt_and_ledger(self):
        envelope = self.envelope()
        original = self.receiver._record_delivery

        def fail_after_ledger(*arguments):
            original(*arguments)
            raise RuntimeError("simulated failure before outer commit")

        with mock.patch.object(self.receiver, "_record_delivery", side_effect=fail_after_ledger):
            response = await self.deliver(envelope)
        self.assertEqual(response.status_code, 503)
        for table in ("validations", "metamap_webhook_receipts", "shadow_deliveries"):
            self.assertEqual(self.scalar("SELECT COUNT(*) FROM " + table), 0)
        response = await self.deliver(envelope)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()["duplicate"])
        self.assertEqual(self.scalar("SELECT event_count FROM validations"), 1)

    async def test_failure_between_projection_and_original_receipt_rolls_back_and_retries(self):
        envelope = self.envelope()
        with mock.patch.object(self.module.TransactionBoundStore, "record_metamap_webhook_receipt",
                               side_effect=RuntimeError("synthetic receipt failure")):
            self.assertEqual((await self.deliver(envelope)).status_code, 503)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM validations"), 0)
        self.assertEqual((await self.deliver(envelope)).status_code, 200)
        self.assertEqual(self.scalar("SELECT event_count FROM validations"), 1)

    async def test_original_signed_invalid_payload_is_recorded_once_and_acknowledged(self):
        envelope = self.envelope(b'{"eventName":"verification_completed"}')
        first = await self.deliver(envelope)
        second = await self.deliver(envelope)
        self.assertEqual((first.status_code, second.status_code), (200, 200))
        self.assertEqual(first.json()["ingest_status"], 400)
        self.assertTrue(second.json()["duplicate"])
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM validations"), 0)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM metamap_webhook_receipts"), 1)
        self.assertEqual((await self.client.get("/stats")).json()["rejections"], 1)

    async def test_original_5xx_is_retryable_without_durable_receipt(self):
        with mock.patch.object(self.module, "invoke_original", return_value=500):
            # The adapter also validates returned statuses, rather than trusting
            # the integration boundary to be infallible.
            response = await self.deliver()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM shadow_deliveries"), 0)

    async def test_authentication_is_checked_before_body_and_never_persists_raw(self):
        response = await self.client.post("/deliveries", content=b"sensitive" * 10_000)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM metamap_webhook_receipts"), 0)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM shadow_deliveries"), 0)

    async def test_invalid_envelope_signature_hash_schema_and_bounds_never_reach_original(self):
        cases = [self.envelope(signature="0" * 64), self.envelope(body_sha256="0" * 64),
                 self.envelope(version=True), self.envelope(delivery_id=str(uuid4()).upper()),
                 self.envelope(body_base64="not-base64"), self.envelope(primary_status=True),
                 self.envelope(content_type="application/json\r\nAuthorization: hidden"),
                 self.envelope(received_at="2026-11-13T12:00:00"), self.envelope(extra="not-allowed"),
                 self.envelope(b"x" * 40_001)]
        with mock.patch.object(self.module, "invoke_original", side_effect=AssertionError("must not ingest")):
            for envelope in cases:
                with self.subTest(fields=list(envelope)):
                    response = await self.deliver(envelope)
                    self.assertEqual(response.status_code, 400, response.text)
            response = await self.client.post("/deliveries", content=b"x" * 60_001,
                                              headers={"Authorization": "Bearer " + self.TOKEN})
            self.assertEqual(response.status_code, 413)
            response = await self.client.post("/deliveries", content=b"[" * 1_100 + b"]" * 1_100,
                                              headers={"Authorization": "Bearer " + self.TOKEN})
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM metamap_webhook_receipts"), 0)

    async def test_internal_application_routes_are_not_exposed(self):
        for path in ("/api/v1/metamap/webhooks", "/api/v1/validations", "/api/v1/updates/latest",
                     "/metrics", "/docs", "/openapi.json"):
            self.assertEqual((await self.client.get(path)).status_code, 404)
        self.assertEqual((await self.client.post("/api/v1/metamap/webhooks", json={})).status_code, 404)

    async def test_health_no_bootstrap_enrichment_pruning_or_network_side_effects(self):
        health = (await self.client.get("/health")).json()
        self.assertEqual(health, {"status": "ok", "shadow_only": True, "enrichment_enabled": False,
                                  "revision": "a" * 40, "recommended_trial_days": 7, "automatic_retention": False})
        self.assertEqual(self.receiver.settings.bootstrap_clients, [])
        self.assertIsNone(self.receiver.settings.metamap_api_token)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM clients"), 0)
        with mock.patch.object(self.module.SqlValidationStore, "prune_old_metamap_webhook_receipts",
                               side_effect=AssertionError("pruning forbidden")), \
             mock.patch("socket.socket.connect", side_effect=AssertionError("network egress forbidden")):
            self.assertEqual((await self.deliver()).status_code, 200)

    async def test_health_probes_ledger_and_reports_storage_failure_without_exception_details(self):
        with self.receiver.engine.begin() as connection:
            connection.exec_driver_sql("DROP TABLE shadow_deliveries")
        response = await self.client.get("/health")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "degraded")
        self.assertNotIn("shadow_deliveries", response.text)
        with mock.patch.object(self.receiver.engine, "connect", side_effect=RuntimeError("synthetic-private-secret")):
            for route in ("/health", "/stats"):
                response = await self.client.get(route)
                self.assertEqual(response.status_code, 503)
                self.assertNotIn("synthetic-private-secret", response.text)
                self.assertFalse(response.json()["automatic_retention"])

    async def test_stats_share_health_metadata_without_recursive_probing(self):
        health = (await self.client.get("/health")).json()
        with mock.patch.object(self.receiver, "health", side_effect=AssertionError("stats must not call health")):
            response = await self.client.get("/stats")
        self.assertEqual(response.status_code, 200)
        for key, value in health.items():
            self.assertEqual(response.json()[key], value)

    async def test_content_type_accepts_256_ascii_bytes_but_rejects_larger_or_controls(self):
        self.assertEqual((await self.deliver(self.envelope(content_type="x" * 256))).status_code, 200)
        for value in ("x" * 257, "application/json\x7f", "application/json\x00"):
            self.assertEqual((await self.deliver(self.envelope(content_type=value))).status_code, 400)

    async def test_missing_content_type_keeps_exact_signed_body_without_inventing_a_header(self):
        envelope = self.envelope(content_type="")
        response = await self.deliver(envelope)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["ingest_status"], 200)
        self.assertEqual(self.scalar("SELECT processing_status FROM metamap_webhook_receipts"), "stored")
        self.assertEqual(self.scalar("SELECT raw_body FROM metamap_webhook_receipts"),
                         base64.b64decode(envelope["body_base64"]).decode("utf-8"))
        headers = json.loads(self.scalar("SELECT headers FROM metamap_webhook_receipts"))
        self.assertEqual(headers["x-signature"], envelope["signature"])
        self.assertNotIn("content-type", headers)

    async def test_database_permissions_durability_and_schema_reuse(self):
        self.assertEqual(self.database.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.scalar("PRAGMA synchronous"), 2)
        self.receiver.engine.dispose()
        self.assertEqual(self.scalar("PRAGMA synchronous"), 2)
        other = self.module.create_shadow_app(database_url="sqlite+pysqlite:///" + str(self.database),
                                               webhook_secret=self.SECRET, delivery_token=self.TOKEN,
                                               revision="b" * 40)
        other.state.receiver.engine.dispose()

    async def test_unmarked_or_symlink_database_is_not_adopted(self):
        with tempfile.TemporaryDirectory(prefix="metamap-shadow-invalid-") as directory:
            target = Path(directory) / "shadow.sqlite"
            with closing(sqlite3.connect(target)) as connection:
                connection.execute("CREATE TABLE private_production_data (value TEXT)")
            target.chmod(0o600)
            arguments = dict(database_url="sqlite+pysqlite:///" + str(target), webhook_secret=self.SECRET,
                             delivery_token=self.TOKEN, revision="a" * 40)
            with self.assertRaisesRegex(ValueError, "unmarked"):
                self.module.create_shadow_app(**arguments)
            target.unlink()
            target.symlink_to(self.database)
            with self.assertRaisesRegex(ValueError, "canonical"):
                self.module.create_shadow_app(**arguments)


if __name__ == "__main__":
    unittest.main()
