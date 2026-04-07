import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from metamap_server.api import create_app
from metamap_server.config import AppSettings, BootstrapClient
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
            webhook_token="meta-token",
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
        self.assertEqual(response.json(), {"status": "ok"})

    def test_validador_then_transferencias_celesol_flow(self) -> None:
        ingest = self.client.post(
            "/api/v1/metamap/webhooks",
            headers=self._webhook_headers(),
            json={
                "event_name": "verification_completed",
                "verification_id": "verif-100",
                "user_id": "user-7",
                "payload": {"resource": "/v2/verifications/verif-100"},
            },
        )
        self.assertEqual(ingest.status_code, 200)
        self.assertEqual(
            ingest.json()["case"]["current_stage"],
            "pending_validador_review",
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
        self.client.post(
            "/api/v1/metamap/webhooks",
            headers=self._webhook_headers(),
            json={
                "event_name": "verification_completed",
                "verification_id": "verif-persist",
                "payload": {"resource": "/v2/verifications/verif-persist"},
            },
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

    def test_validador_rejects_case_and_transfer_queue_stays_empty(self) -> None:
        self.client.post(
            "/api/v1/metamap/webhooks",
            headers=self._webhook_headers(),
            json={
                "event_name": "verification_completed",
                "verification_id": "verif-200",
                "payload": {},
            },
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
        self.client.post(
            "/api/v1/metamap/webhooks",
            headers=self._webhook_headers(),
            json={
                "event_name": "verification_completed",
                "verification_id": "verif-300",
                "payload": {},
            },
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
        self.client.post(
            "/api/v1/metamap/webhooks",
            headers=self._webhook_headers(),
            json={
                "event_name": "verification_completed",
                "verification_id": "verif-400",
                "payload": {},
            },
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

    def test_webhook_and_bank_callbacks_require_tokens_when_configured(self) -> None:
        webhook_response = self.client.post(
            "/api/v1/metamap/webhooks",
            json={
                "event_name": "verification_completed",
                "verification_id": "verif-500",
                "payload": {},
            },
        )
        self.assertEqual(webhook_response.status_code, 401)

        self.client.post(
            "/api/v1/metamap/webhooks",
            headers=self._webhook_headers(),
            json={
                "event_name": "verification_completed",
                "verification_id": "verif-501",
                "payload": {},
            },
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

    def _webhook_headers(self) -> dict[str, str]:
        return {"X-Metamap-Webhook-Token": "meta-token"}

    def _bank_headers(self) -> dict[str, str]:
        return {"X-Bank-Callback-Token": "bank-token"}
