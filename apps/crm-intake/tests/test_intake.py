import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

from crm_intake.capture import InvalidSubmission, capture
from crm_intake.normalize import normalize
from crm_intake.sample import sample


NOW = datetime(2026, 11, 19, tzinfo=timezone.utc)


def fields(envelope):
    return normalize(capture(envelope, now=NOW))["fields"]


class IntakeTest(unittest.TestCase):
    def test_common_values_preserve_distinct_evidence(self):
        web, wa = fields(sample()), fields(sample("whatsapp"))
        for key in ("province", "benefit_kind", "paying_organization", "payment_bank"):
            self.assertEqual(web[key]["value"], wa[key]["value"])
        self.assertEqual(web["paying_organization"]["status"], "inferred")
        self.assertEqual(wa["paying_organization"]["status"], "declared")
        self.assertEqual(wa["paying_organization"]["source_fields"], ["organismo_catamarca"])

    def test_original_is_unchanged_and_clock_does_not_refresh_declaration(self):
        original = sample()
        original["payload"]["untouched"] = {"tags": [1, None, False]}
        first = capture(original, now=NOW)
        second = capture(original, now=datetime(2026, 11, 20, tzinfo=timezone.utc))
        original["payload"]["province"] = "Córdoba"
        self.assertEqual(first.payload["province"], "Catamarca")
        self.assertEqual(first.payload["untouched"], {"tags": [1, None, False]})
        self.assertEqual(first.fingerprint, second.fingerprint)
        self.assertEqual(first.declared_at, second.declared_at)
        self.assertNotEqual(first.received_at, second.received_at)

    def test_grouped_legacy_keeps_ambiguity(self):
        envelope = sample("whatsapp") | {"form_version": "whatsapp-grouped-v1"}
        envelope["payload"]["situacion_catamarca"] = "jubilado_pensionado"
        result = fields(envelope)
        self.assertEqual(result["benefit_kind"]["status"], "ambiguous")
        self.assertEqual(result["benefit_kind"]["alternatives"], ["retirement", "pension"])
        self.assertEqual(result["paying_organization"]["value"], "anses")

    def test_pension_web_leaves_organization_missing(self):
        envelope = sample()
        envelope["payload"]["employment_status"] = "Pensionado"
        result = fields(envelope)
        self.assertEqual(result["benefit_kind"]["value"], "pension")
        self.assertEqual(result["paying_organization"]["status"], "missing")

    def test_bank_catalog_accepts_single_value_and_preserves_real_ambiguity(self):
        envelope = sample()
        envelope["payload"]["payment_bank"] = ["Banco Nación"]
        self.assertEqual(fields(envelope)["payment_bank"]["value"], "nacion")
        envelope["payload"]["payment_bank"].append("Bancor")
        self.assertEqual(fields(envelope)["payment_bank"]["alternatives"], ["bancor", "nacion"])
        envelope["payload"]["payment_bank"].append("Unknown")
        self.assertEqual(fields(envelope)["payment_bank"]["status"], "unmapped")

    def test_hidden_bank_from_unasked_branch_stays_out_of_interpretation(self):
        envelope = sample("whatsapp")
        envelope["payload"].update(
            provincia="cordoba", situacion_cordoba="jubilado", organismo="caja_cordoba", banco_jubilado="nacion",
        )
        self.assertEqual(fields(envelope)["payment_bank"]["status"], "not_applicable")

    def test_unseen_form_is_captured_without_speculative_interpretation(self):
        missing_contract = capture(sample() | {"form_version": "web-loan-v2"}, now=NOW)
        self.assertEqual(normalize(missing_contract)["status"], "unsupported_form_version")
        self.assertEqual(missing_contract.payload["employment_status"], "Jubilado Nacional")

    def test_invalid_envelopes_are_rejected(self):
        for change in (
            {"declared_at": "2026-09-14"}, {"declared_at": "2027-01-01T07:00:00Z"},
            {"payload": {"k": float("nan")}}, {"payload": {"k": "\0"}},
            {"source_id": ""}, {"payload": {"k": "x" * 33000}},
        ):
            with self.subTest(fields=list(change)), self.assertRaises(InvalidSubmission):
                capture(sample() | change, now=NOW)


@unittest.skipUnless(sys.platform.startswith("linux"), "Unix socket runtime is Linux-only")
class StatusTest(unittest.TestCase):
    def test_inactive_process_exposes_only_private_status(self):
        with tempfile.TemporaryDirectory() as directory:
            endpoint = Path(directory) / "status.sock"
            env = os.environ | {"CRM_INTAKE_STATUS_SOCKET": str(endpoint), "CRM_INTAKE_REVISION": "synthetic"}
            with subprocess.Popen([sys.executable, "-B", "-m", "crm_intake.server"], env=env) as app:
                try:
                    for _ in range(30):
                        if endpoint.is_socket():
                            break
                        time.sleep(0.05)
                    self.assertEqual(endpoint.stat().st_mode & 0o777, 0o600)
                    status, body = self.request(endpoint, b"GET /healthz HTTP/1.0\r\n\r\n")
                    self.assertIn("200", status)
                    self.assertFalse(body["capture_enabled"])
                    self.assertEqual(body["revision"], "synthetic")
                    status, body = self.request(endpoint, b"POST /v1/submissions HTTP/1.0\r\n\r\n")
                    self.assertIn("503", status)
                    self.assertEqual(body["error"], "capture_inactive")
                finally:
                    app.terminate()
                    app.wait(timeout=3)

    def request(self, endpoint, request):
        with socket.socket(socket.AF_UNIX) as client:
            client.settimeout(3)
            client.connect(str(endpoint))
            client.sendall(request)
            with client.makefile("rb") as response:
                status = response.readline().decode()
                while response.readline().strip():
                    pass
                return status, json.load(response)
