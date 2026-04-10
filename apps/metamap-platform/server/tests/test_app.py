import hashlib
import hmac
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
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
            git_sha="test-git-sha",
        )
        self._resource_payloads: dict[str, dict] = {}
        self.client = TestClient(
            create_app(
                settings=self.settings,
                metamap_resource_fetcher=self._fetch_resource_payload,
            )
        )

    def tearDown(self) -> None:
        self.client.close()
        self.client.app.state.validation_store.close()
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
                "git_sha": "test-git-sha",
            },
        )

    def test_validation_completed_is_persisted_and_normalized(self) -> None:
        self._resource_payloads["verif-100"] = self._metamap_resource_payload(
            request_number="241325",
            loan_number="1010477",
            amount_raw="223.456,78",
            requested_amount_raw="123.456,78",
            applicant_name="Ada Lovelace",
            document_number="30111222",
        )
        ingest = self._post_metamap_webhook(
            self._metamap_payload(
                event_name="validation_completed",
                verification_id="verif-100",
                metadata={"userId": "user-7"},
            )
        )
        self.assertEqual(ingest.status_code, 200)
        self.assertEqual(ingest.json()["processing_status"], "stored")
        self.assertEqual(ingest.json()["normalized_status"], "completed")
        self.assertEqual(
            ingest.json()["validation"]["verification_id"],
            "verif-100",
        )
        self.assertEqual(
            ingest.json()["validation"]["user_id"],
            "user-7",
        )
        self.assertEqual(
            ingest.json()["validation"]["resource_url"],
            "https://api.getmati.com/v2/verifications/verif-100",
        )
        self.assertEqual(ingest.json()["validation"]["request_number"], "241325")
        self.assertEqual(ingest.json()["validation"]["loan_number"], "1010477")
        self.assertEqual(ingest.json()["validation"]["amount_raw"], "223.456,78")
        self.assertEqual(ingest.json()["validation"]["amount_value"], "223456.78")
        self.assertEqual(
            ingest.json()["validation"]["requested_amount_raw"], "123.456,78"
        )
        self.assertEqual(
            ingest.json()["validation"]["requested_amount_value"], "123456.78"
        )
        self.assertEqual(ingest.json()["validation"]["applicant_name"], "Ada Lovelace")
        self.assertEqual(ingest.json()["validation"]["document_number"], "30111222")

        validations = self.client.get(
            "/api/v1/validations",
            headers=self._client_headers(ClientRole.TRANSFERENCIAS_CELESOL),
        )
        self.assertEqual(validations.status_code, 200)
        self.assertEqual(validations.json()["pagination"]["total"], 1)
        self.assertEqual(
            validations.json()["items"][0]["normalized_status"],
            "completed",
        )
        self.assertEqual(
            validations.json()["items"][0]["event_count"],
            1,
        )
        self.assertEqual(
            validations.json()["items"][0]["applicant_name"],
            "Ada Lovelace",
        )
        self.assertEqual(
            validations.json()["items"][0]["requested_amount_raw"],
            "123.456,78",
        )
        self.assertEqual(
            validations.json()["items"][0]["document_number"],
            "30111222",
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
            validation = restarted_client.get(
                "/api/v1/validations/verif-persist",
                headers=self._client_headers(ClientRole.TRANSFERENCIAS_CELESOL),
            )
            self.assertEqual(validation.status_code, 200)
            self.assertEqual(
                validation.json()["validation"]["verification_id"],
                "verif-persist",
            )
        finally:
            restarted_client.close()
            restarted_client.app.state.validation_store.close()

    def test_non_terminal_event_without_verification_id_is_logged_only(self) -> None:
        payload = {
            "eventName": "step_completed",
            "flowId": "flow-dev-1",
            "timestamp": "2026-04-07T15:00:00.000Z",
            "metadata": {"userId": "user-logged-only"},
            "step": {"status": 200, "id": "document-reading"},
        }
        response = self._post_metamap_webhook(payload)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["processing_status"], "logged_only")
        self.assertIsNone(response.json()["validation"])

        validations = self.client.get(
            "/api/v1/validations",
            headers=self._client_headers(ClientRole.TRANSFERENCIAS_CELESOL),
        )
        self.assertEqual(validations.status_code, 200)
        self.assertEqual(validations.json()["items"], [])

        receipts = self._webhook_receipts()
        self.assertEqual(len(receipts), 1)
        self.assertEqual(receipts[0].processing_status, "logged_only")
        self.assertEqual(receipts[0].event_name, "step_completed")

    def test_search_filters_validations(self) -> None:
        self._resource_payloads["verif-a"] = self._metamap_resource_payload(
            request_number="241325",
            loan_number="1010477",
            amount_raw="45000",
        )
        self._resource_payloads["verif-b"] = self._metamap_resource_payload(
            request_number="241326",
            loan_number="1010478",
            amount_raw="55000",
        )
        self._post_metamap_webhook(
            self._metamap_payload(
                event_name="verification_started",
                verification_id="verif-a",
                metadata={"userId": "user-a"},
            )
        )
        self._post_metamap_webhook(
            self._metamap_payload(
                event_name="verification_completed",
                verification_id="verif-b",
                metadata={"userId": "user-b"},
            )
        )

        filtered = self.client.get(
            "/api/v1/validations",
            params={"user_id": "user-b", "normalized_status": "completed"},
            headers=self._client_headers(ClientRole.VALIDADOR),
        )
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(filtered.json()["pagination"]["total"], 1)
        self.assertEqual(filtered.json()["items"][0]["verification_id"], "verif-b")

        search = self.client.get(
            "/api/v1/validations",
            params={"q": "verif-a"},
            headers=self._client_headers(ClientRole.TRANSFERENCIAS_CELESOL),
        )
        self.assertEqual(search.status_code, 200)
        self.assertEqual(search.json()["items"][0]["verification_id"], "verif-a")

        request_number_search = self.client.get(
            "/api/v1/validations",
            params={"request_number": "241326"},
            headers=self._client_headers(ClientRole.TRANSFERENCIAS_CELESOL),
        )
        self.assertEqual(request_number_search.status_code, 200)
        self.assertEqual(
            request_number_search.json()["items"][0]["verification_id"],
            "verif-b",
        )

        loan_number_search = self.client.get(
            "/api/v1/validations",
            params={"loan_number": "1010477"},
            headers=self._client_headers(ClientRole.TRANSFERENCIAS_CELESOL),
        )
        self.assertEqual(loan_number_search.status_code, 200)
        self.assertEqual(
            loan_number_search.json()["items"][0]["verification_id"],
            "verif-a",
        )

    def test_duplicate_completed_event_updates_same_validation(self) -> None:
        self._post_metamap_webhook(
            self._metamap_payload(
                event_name="verification_completed",
                verification_id="verif-dup",
            )
        )
        duplicate = self._post_metamap_webhook(
            self._metamap_payload(
                event_name="verification_completed",
                verification_id="verif-dup",
            )
        )
        self.assertEqual(duplicate.status_code, 200)

        validation = self.client.get(
            "/api/v1/validations/verif-dup",
            headers=self._client_headers(ClientRole.TRANSFERENCIAS_CELESOL),
        )
        self.assertEqual(validation.status_code, 200)
        self.assertEqual(
            validation.json()["validation"]["event_count"],
            2,
        )

    def test_completed_validation_remains_terminal_after_non_terminal_event(self) -> None:
        completed = self._post_metamap_webhook(
            self._metamap_payload(
                event_name="verification_completed",
                verification_id="verif-terminal",
                timestamp="2026-04-07T15:00:00.000Z",
            )
        )
        self.assertEqual(completed.status_code, 200)
        self.assertEqual(completed.json()["normalized_status"], "completed")

        later_event = self._post_metamap_webhook(
            self._metamap_payload(
                event_name="verification_inputs_completed",
                verification_id="verif-terminal",
                timestamp="2026-04-07T15:01:00.000Z",
            )
        )
        self.assertEqual(later_event.status_code, 200)
        self.assertEqual(later_event.json()["normalized_status"], "completed")
        self.assertEqual(
            later_event.json()["validation"]["normalized_status"],
            "completed",
        )
        self.assertEqual(
            later_event.json()["validation"]["latest_event_name"],
            "verification_completed",
        )
        self.assertEqual(
            later_event.json()["validation"]["latest_event_timestamp"],
            "2026-04-07T15:00:00.000Z",
        )
        self.assertEqual(
            later_event.json()["validation"]["completed_at"],
            "2026-04-07T15:00:00.000Z",
        )
        self.assertEqual(
            later_event.json()["validation"]["event_count"],
            2,
        )

        validation = self.client.get(
            "/api/v1/validations/verif-terminal",
            headers=self._client_headers(ClientRole.TRANSFERENCIAS_CELESOL),
        )
        self.assertEqual(validation.status_code, 200)
        self.assertEqual(
            validation.json()["validation"]["normalized_status"],
            "completed",
        )
        self.assertEqual(
            validation.json()["validation"]["latest_event_name"],
            "verification_completed",
        )

    def test_get_validation_backfills_missing_enrichment_from_resource(self) -> None:
        self._post_metamap_webhook(
            self._metamap_payload(
                event_name="verification_completed",
                verification_id="verif-backfill",
            )
        )
        self._resource_payloads["verif-backfill"] = self._metamap_resource_payload(
            request_number="241999",
            amount_raw="6543,00",
            requested_amount_raw="3210,00",
            applicant_name="Grace Hopper",
            document_number="27888999",
        )

        validation = self.client.get(
            "/api/v1/validations/verif-backfill",
            headers=self._client_headers(ClientRole.TRANSFERENCIAS_CELESOL),
        )
        self.assertEqual(validation.status_code, 200)
        self.assertEqual(validation.json()["validation"]["request_number"], "241999")
        self.assertEqual(validation.json()["validation"]["amount_value"], "6543.00")
        self.assertEqual(
            validation.json()["validation"]["requested_amount_value"], "3210.00"
        )
        self.assertEqual(validation.json()["validation"]["applicant_name"], "Grace Hopper")
        self.assertEqual(validation.json()["validation"]["document_number"], "27888999")

    def test_signed_document_details_exposes_requested_amount(self) -> None:
        self._resource_payloads["verif-signed-doc"] = {
            "signedDocumentDetails": [
                {
                    "customVariables": {
                        "variableKey": {"title": "Solicitud", "value": "241394"},
                        "variableKey2": {
                            "title": "Importe solicitado",
                            "value": "$ 1.500.000,00",
                        },
                        "variableKey9": {
                            "title": "NumeroPrestamo",
                            "value": "1010521",
                        },
                        "variableKey10": {
                            "title": "Importe liquidado",
                            "value": "$ 1.770.000,00",
                        },
                        "variableKey11": {
                            "title": "Importe total",
                            "value": "$ 2.580.681,70",
                        },
                    }
                }
            ],
            "applicantName": "Alan Turing",
        }
        ingest = self._post_metamap_webhook(
            self._metamap_payload(
                event_name="validation_completed",
                verification_id="verif-signed-doc",
            )
        )

        self.assertEqual(ingest.status_code, 200)
        self.assertEqual(
            ingest.json()["validation"]["requested_amount_raw"], "$ 1.500.000,00"
        )
        self.assertEqual(
            ingest.json()["validation"]["requested_amount_value"], "1500000.00"
        )
        self.assertEqual(ingest.json()["validation"]["amount_raw"], "$ 2.580.681,70")
        self.assertEqual(ingest.json()["validation"]["amount_value"], "2580681.70")

    def test_internal_webhook_receipts_endpoint_prunes_logs_older_than_one_week(self) -> None:
        self._post_metamap_webhook(
            self._metamap_payload(
                event_name="verification_started",
                verification_id="verif-old-receipt",
            )
        )
        self._post_metamap_webhook(
            self._metamap_payload(
                event_name="verification_completed",
                verification_id="verif-recent-receipt",
            )
        )

        old_timestamp = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()
        store = self.client.app.state.validation_store
        with store._session_factory() as session:
            old_receipt = session.execute(
                select(MetamapWebhookReceiptRow).where(
                    MetamapWebhookReceiptRow.verification_id == "verif-old-receipt"
                )
            ).scalar_one()
            old_receipt.received_at = old_timestamp
            session.commit()

        response = self.client.get(
            "/api/v1/internal/metamap/webhook-receipts",
            headers=self._client_headers(ClientRole.TRANSFERENCIAS_CELESOL),
        )
        self.assertEqual(response.status_code, 200)
        receipts = response.json()["receipts"]
        self.assertEqual(len(receipts), 1)
        self.assertEqual(receipts[0]["verification_id"], "verif-recent-receipt")
        self.assertEqual(receipts[0]["processing_status"], "stored")

    def test_validations_require_valid_client_auth(self) -> None:
        response = self.client.get("/api/v1/validations")
        self.assertEqual(response.status_code, 401)

        wrong_secret = self.client.get(
            "/api/v1/validations",
            headers={
                "X-Client-Id": "validador-dev-1",
                "X-Client-Secret": "secret-invalido",
            },
        )
        self.assertEqual(wrong_secret.status_code, 401)

    def test_webhook_signature_is_required_when_configured(self) -> None:
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
        store = self.client.app.state.validation_store
        with store._session_factory() as session:
            return session.execute(
                select(MetamapWebhookReceiptRow).order_by(MetamapWebhookReceiptRow.id)
            ).scalars().all()

    def _fetch_resource_payload(self, resource_url: str) -> dict:
        verification_id = resource_url.rstrip("/").rsplit("/", 1)[-1]
        return self._resource_payloads.get(verification_id, {})

    def _metamap_resource_payload(
        self,
        *,
        request_number: str | None = None,
        loan_number: str | None = None,
        amount_raw: str | None = None,
        requested_amount_raw: str | None = None,
        applicant_name: str | None = None,
        document_number: str | None = None,
    ) -> dict:
        fields = {}
        if request_number is not None:
            fields["variableKey1"] = {"title": "Solicitud", "value": request_number}
        if requested_amount_raw is None:
            requested_amount_raw = amount_raw
        if requested_amount_raw is not None:
            fields["variableKey2"] = {
                "title": "Importe solicitado",
                "value": requested_amount_raw,
            }
        if loan_number is not None:
            fields["variableKey9"] = {"title": "NumeroPrestamo", "value": loan_number}
        if amount_raw is not None:
            fields["variableKey10"] = {
                "title": "Importe total",
                "value": amount_raw,
            }
        if document_number is not None:
            fields["variableKey11"] = {
                "title": "Documento",
                "value": document_number,
            }
        payload = {"steps": [{"fields": fields}]}
        if applicant_name is not None:
            payload["applicantName"] = applicant_name
        return payload
