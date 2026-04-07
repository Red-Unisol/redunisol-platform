import hashlib
import hmac
import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from metamap_server import __version__
from metamap_server.api import create_app
from metamap_server.config import AppSettings, BootstrapClient
from metamap_server.store_sql import MetamapWebhookReceiptRow
from metamap_server.workflow import ClientRole


class MetaMapServerApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_path = Path(self._tmpdir.name) / "metamap-server.sqlite3"
        self.settings = AppSettings(
            database_url=f"sqlite+pysqlite:///{self.database_path.as_posix()}",
            bootstrap_clients=[
                BootstrapClient(
                    client_id="validador-dev-1",
                    client_secret="secret-validador",
                    role=ClientRole.VALIDADOR,
                    display_name="Validador Dev 1",
                ),
                BootstrapClient(
                    client_id="transferencias-dev-1",
                    client_secret="secret-transferencias",
                    role=ClientRole.TRANSFERENCIAS_CELESOL,
                    display_name="Transferencias Dev 1",
                ),
            ],
            webhook_secret="MetaSecret1234Ab",
            bank_callback_token="bank-token",
        )
        self.client = TestClient(create_app(settings=self.settings))

    def tearDown(self) -> None:
        self.client.close()
        self.client.app.state.workflow_store.close()
        self._tmpdir.cleanup()

    def test_healthcheck(self) -> None:
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "status": "ok",
                "service": "metamap-platform-server",
                "version": __version__,
            },
        )

    def test_validador_then_transferencias_celesol_flow(self) -> None:
        ingest = self._post_metamap_webhook(
            self._metamap_payload(
                event_name="verification_completed",
                verification_id="verif-100",
                metadata={"userId": "user-7"},
            )
        )
        self.assertEqual(ingest.status_code, 200)
        self.assertEqual(ingest.json()["processing_status"], "enqueued")
        self.assertEqual(
            ingest.json()["case"]["current_stage"],
            "pending_validador_review",
        )
        self.assertEqual(
            ingest.json()["case"]["resource_url"],
            "https://api.getmati.com/v2/verifications/verif-100",
        )

        queue_validador = self.client.get(
            "/api/v1/queues/validador",
            headers=self._client_headers(ClientRole.VALIDADOR),
        )
        self.assertEqual(queue_validador.status_code, 200)
        self.assertEqual(len(queue_validador.json()["cases"]), 1)
        self.assertEqual(
            queue_validador.json()["cases"][0]["pending_roles"],
            ["validador"],
        )
        self.assertEqual(
            queue_validador.json()["cases"][0]["queue_payload"],
            {
                "verification_id": "verif-100",
                "resource_url": "https://api.getmati.com/v2/verifications/verif-100",
            },
        )

        approve = self.client.post(
            "/api/v1/cases/verif-100/actions",
            headers=self._client_headers(ClientRole.VALIDADOR),
            json={
                "role": "validador",
                "action": "approved",
                "actor": "operador_b",
                "notes": "Aprobado para transferencias.",
            },
        )
        self.assertEqual(approve.status_code, 200)
        self.assertEqual(
            approve.json()["case"]["current_stage"],
            "approved_by_validador",
        )

        queue_transferencias = self.client.get(
            "/api/v1/queues/transferencias_celesol",
            headers=self._client_headers(ClientRole.TRANSFERENCIAS_CELESOL),
        )
        self.assertEqual(queue_transferencias.status_code, 200)
        self.assertEqual(len(queue_transferencias.json()["cases"]), 1)
        self.assertEqual(
            queue_transferencias.json()["cases"][0]["pending_roles"],
            ["transferencias_celesol"],
        )

        transfer = self.client.post(
            "/api/v1/cases/verif-100/actions",
            headers=self._client_headers(ClientRole.TRANSFERENCIAS_CELESOL),
            json={
                "role": "transferencias_celesol",
                "action": "transfer_submitted",
                "actor": "operador_a",
                "external_transfer_id": "trx-001",
            },
        )
        self.assertEqual(transfer.status_code, 200)
        self.assertEqual(
            transfer.json()["case"]["current_stage"],
            "transfer_submitted",
        )

        callback = self.client.post(
            "/api/v1/bank/callbacks/aviso-transferencia-cbu",
            headers=self._bank_headers(),
            json={
                "payload": {
                    "IdAviso": "cb-001",
                    "external_transfer_id": "trx-001",
                }
            },
        )
        self.assertEqual(callback.status_code, 200)
        self.assertFalse(callback.json()["duplicate"])
        self.assertEqual(
            callback.json()["case"]["current_stage"],
            "bank_confirmed",
        )

    def test_state_persists_across_app_restarts(self) -> None:
        self._post_metamap_webhook(
            self._metamap_payload(
                event_name="verification_completed",
                verification_id="verif-persist",
            )
        )

        restarted_client = TestClient(create_app(settings=self.settings))
        try:
            queue_validador = restarted_client.get(
                "/api/v1/queues/validador",
                headers=self._client_headers(ClientRole.VALIDADOR),
            )
            self.assertEqual(queue_validador.status_code, 200)
            self.assertEqual(len(queue_validador.json()["cases"]), 1)
            self.assertEqual(
                queue_validador.json()["cases"][0]["verification_id"],
                "verif-persist",
            )
        finally:
            restarted_client.close()
            restarted_client.app.state.workflow_store.close()

    def test_non_completed_event_is_logged_but_not_enqueued(self) -> None:
        response = self._post_metamap_webhook(
            self._metamap_payload(
                event_name="step_completed",
                verification_id="verif-step",
                step={
                    "status": 200,
                    "id": "document-reading",
                },
            )
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["processing_status"], "ignored")
        self.assertIsNone(response.json()["case"])

        queue_validador = self.client.get(
            "/api/v1/queues/validador",
            headers=self._client_headers(ClientRole.VALIDADOR),
        )
        self.assertEqual(queue_validador.status_code, 200)
        self.assertEqual(queue_validador.json()["cases"], [])

        receipts = self._webhook_receipts()
        self.assertEqual(len(receipts), 1)
        self.assertEqual(receipts[0].processing_status, "ignored")
        self.assertEqual(receipts[0].event_name, "step_completed")
        self.assertEqual(receipts[0].verification_id, "verif-step")

    def test_validador_rejects_case_and_transfer_queue_stays_empty(self) -> None:
        self._post_metamap_webhook(
            self._metamap_payload(
                event_name="verification_completed",
                verification_id="verif-200",
            )
        )

        reject = self.client.post(
            "/api/v1/cases/verif-200/actions",
            headers=self._client_headers(ClientRole.VALIDADOR),
            json={
                "role": "validador",
                "action": "rejected",
                "actor": "operador_b",
                "notes": "No cumple criterios.",
            },
        )
        self.assertEqual(reject.status_code, 200)
        self.assertEqual(
            reject.json()["case"]["current_stage"],
            "rejected_by_validador",
        )

        queue_transferencias = self.client.get(
            "/api/v1/queues/transferencias_celesol",
            headers=self._client_headers(ClientRole.TRANSFERENCIAS_CELESOL),
        )
        self.assertEqual(queue_transferencias.status_code, 200)
        self.assertEqual(queue_transferencias.json()["cases"], [])

    def test_duplicate_bank_callback_is_idempotent(self) -> None:
        self._post_metamap_webhook(
            self._metamap_payload(
                event_name="verification_completed",
                verification_id="verif-300",
            )
        )
        self.client.post(
            "/api/v1/cases/verif-300/actions",
            headers=self._client_headers(ClientRole.VALIDADOR),
            json={
                "role": "validador",
                "action": "approved",
                "actor": "operador_b",
            },
        )
        self.client.post(
            "/api/v1/cases/verif-300/actions",
            headers=self._client_headers(ClientRole.TRANSFERENCIAS_CELESOL),
            json={
                "role": "transferencias_celesol",
                "action": "transfer_submitted",
                "actor": "operador_a",
                "external_transfer_id": "trx-300",
            },
        )

        first = self.client.post(
            "/api/v1/bank/callbacks/aviso-transferencia-cbu",
            headers=self._bank_headers(),
            json={"payload": {"IdAviso": "dup-1", "external_transfer_id": "trx-300"}},
        )
        second = self.client.post(
            "/api/v1/bank/callbacks/aviso-transferencia-cbu",
            headers=self._bank_headers(),
            json={"payload": {"IdAviso": "dup-1", "external_transfer_id": "trx-300"}},
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertFalse(first.json()["duplicate"])
        self.assertTrue(second.json()["duplicate"])
        self.assertEqual(second.json()["case"]["current_stage"], "bank_confirmed")

    def test_transferencias_celesol_cannot_run_before_validador_approval(self) -> None:
        self._post_metamap_webhook(
            self._metamap_payload(
                event_name="verification_completed",
                verification_id="verif-400",
            )
        )
        response = self.client.post(
            "/api/v1/cases/verif-400/actions",
            headers=self._client_headers(ClientRole.TRANSFERENCIAS_CELESOL),
            json={
                "role": "transferencias_celesol",
                "action": "transfer_submitted",
                "actor": "operador_a",
                "external_transfer_id": "trx-400",
            },
        )
        self.assertEqual(response.status_code, 409)
        self.assertIn("no esta habilitado", response.json()["detail"])

    def test_duplicate_verification_completed_does_not_reopen_validador_queue(self) -> None:
        self._post_metamap_webhook(
            self._metamap_payload(
                event_name="verification_completed",
                verification_id="verif-410",
            )
        )
        self.client.post(
            "/api/v1/cases/verif-410/actions",
            headers=self._client_headers(ClientRole.VALIDADOR),
            json={
                "role": "validador",
                "action": "approved",
                "actor": "operador_b",
            },
        )

        duplicate = self._post_metamap_webhook(
            self._metamap_payload(
                event_name="verification_completed",
                verification_id="verif-410",
            )
        )
        self.assertEqual(duplicate.status_code, 200)

        queue_validador = self.client.get(
            "/api/v1/queues/validador",
            headers=self._client_headers(ClientRole.VALIDADOR),
        )
        self.assertEqual(queue_validador.status_code, 200)
        self.assertEqual(queue_validador.json()["cases"], [])

    def test_queue_requires_valid_client_auth(self) -> None:
        response = self.client.get("/api/v1/queues/validador")
        self.assertEqual(response.status_code, 401)

        wrong_secret = self.client.get(
            "/api/v1/queues/validador",
            headers={
                "X-Client-Id": "validador-dev-1",
                "X-Client-Secret": "secret-invalido",
            },
        )
        self.assertEqual(wrong_secret.status_code, 401)

    def test_role_mismatch_is_forbidden(self) -> None:
        response = self.client.get(
            "/api/v1/queues/validador",
            headers=self._client_headers(ClientRole.TRANSFERENCIAS_CELESOL),
        )
        self.assertEqual(response.status_code, 403)

    def test_webhook_signature_and_bank_callbacks_require_auth_when_configured(self) -> None:
        payload = self._metamap_payload(
            event_name="verification_completed",
            verification_id="verif-500",
        )
        webhook_response = self._post_metamap_webhook(payload, include_signature=False)
        self.assertEqual(webhook_response.status_code, 401)

        receipts = self._webhook_receipts()
        self.assertEqual(len(receipts), 1)
        self.assertEqual(receipts[0].processing_status, "invalid_signature")
        self.assertFalse(receipts[0].signature_valid)

        self._post_metamap_webhook(
            self._metamap_payload(
                event_name="verification_completed",
                verification_id="verif-501",
            )
        )
        self.client.post(
            "/api/v1/cases/verif-501/actions",
            headers=self._client_headers(ClientRole.VALIDADOR),
            json={
                "role": "validador",
                "action": "approved",
                "actor": "operador_b",
            },
        )
        self.client.post(
            "/api/v1/cases/verif-501/actions",
            headers=self._client_headers(ClientRole.TRANSFERENCIAS_CELESOL),
            json={
                "role": "transferencias_celesol",
                "action": "transfer_submitted",
                "actor": "operador_a",
                "external_transfer_id": "trx-501",
            },
        )

        callback_response = self.client.post(
            "/api/v1/bank/callbacks/aviso-transferencia-cbu",
            json={"payload": {"IdAviso": "cb-501", "external_transfer_id": "trx-501"}},
        )
        self.assertEqual(callback_response.status_code, 401)

    def _client_headers(self, role: ClientRole) -> dict[str, str]:
        if role == ClientRole.VALIDADOR:
            return {
                "X-Client-Id": "validador-dev-1",
                "X-Client-Secret": "secret-validador",
            }
        return {
            "X-Client-Id": "transferencias-dev-1",
            "X-Client-Secret": "secret-transferencias",
        }

    def _bank_headers(self) -> dict[str, str]:
        return {"X-Bank-Callback-Token": "bank-token"}

    def _metamap_payload(
        self,
        *,
        event_name: str,
        verification_id: str,
        metadata: dict | None = None,
        **extra: object,
    ) -> dict:
        payload = {
            "eventName": event_name,
            "resource": f"https://api.getmati.com/v2/verifications/{verification_id}",
            "flowId": "flow-dev-1",
            "timestamp": "2026-04-07T15:00:00.000Z",
            "metadata": metadata or {},
        }
        payload.update(extra)
        return payload

    def _post_metamap_webhook(
        self,
        payload: dict,
        *,
        include_signature: bool = True,
    ):
        body = json.dumps(payload, separators=(",", ":"), sort_keys=True)
        headers = {
            "Content-Type": "application/json",
        }
        if include_signature:
            headers["x-signature"] = hmac.new(
                self.settings.webhook_secret.encode("utf-8"),
                body.encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()
        return self.client.post(
            "/api/v1/metamap/webhooks",
            content=body,
            headers=headers,
        )

    def _webhook_receipts(self) -> list[MetamapWebhookReceiptRow]:
        store = self.client.app.state.workflow_store
        with store._session_factory() as session:
            return session.execute(
                select(MetamapWebhookReceiptRow).order_by(MetamapWebhookReceiptRow.id)
            ).scalars().all()
