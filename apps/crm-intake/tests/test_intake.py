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


def add_answers(envelope, **changes):
    answers = json.loads(envelope["original_body"])
    return envelope | {"original_body": json.dumps(answers | changes, ensure_ascii=False)}


class IntakeTest(unittest.TestCase):
    def test_common_values_preserve_distinct_evidence(self):
        web, wa = fields(sample()), fields(sample("whatsapp"))
        for key in ("province", "benefit_kind", "paying_organization", "payment_bank"):
            self.assertEqual(web[key]["value"], wa[key]["value"])
        self.assertEqual(web["paying_organization"]["status"], "inferred")
        self.assertEqual(wa["paying_organization"]["status"], "declared")

    def test_original_text_metadata_and_form_are_independent_of_the_input_object(self):
        envelope = add_answers(sample(), untouched={"tags": [1, None, False]})
        envelope["original_body"] = " " + envelope["original_body"] + "\r\n"
        first = capture(envelope, now=NOW)
        again = capture(envelope, now=datetime(2026, 11, 20, tzinfo=timezone.utc))
        envelope["source_metadata"]["example"] = False
        envelope["form"]["definition"]["title"] = "Edited"
        self.assertEqual(first.original_body, envelope["original_body"])
        self.assertEqual(first.payload["untouched"], {"tags": [1, None, False]})
        self.assertTrue(json.loads(first.source_metadata_json)["example"])
        self.assertEqual(json.loads(first.form.definition_json)["title"], "Synthetic request")
        self.assertEqual(first.fingerprint, again.fingerprint)
        self.assertEqual(first.declared_at, again.declared_at)
        self.assertNotEqual(first.received_at, again.received_at)

    def test_edna_nested_response_interprets_only_the_designated_answers(self):
        envelope = sample("whatsapp")
        previous_answers = envelope["original_body"]
        envelope["answers_path"] = ["messages", 0, "interactive", "response_json"]
        envelope["original_body"] = json.dumps({
            "provincia": "cordoba",
            "messages": [{"interactive": {"response_json": previous_answers}}],
        })
        self.assertEqual(fields(envelope)["province"]["value"], "catamarca")
        self.assertEqual(fields(envelope)["paying_organization"]["source_fields"], ["organismo_catamarca"])
        envelope["answers_path"] = ["unavailable"]
        self.assertEqual(normalize(capture(envelope, now=NOW))["status"], "unsupported_response_shape")

    def test_grouped_legacy_keeps_ambiguity(self):
        envelope = sample("whatsapp") | {"form_version": "whatsapp-grouped-v1"}
        result = fields(add_answers(envelope, situacion_catamarca="jubilado_pensionado"))
        self.assertEqual(result["benefit_kind"]["alternatives"], ["retirement", "pension"])
        self.assertEqual(result["paying_organization"]["value"], "anses")

    def test_pension_web_leaves_organization_missing(self):
        result = fields(add_answers(sample(), employment_status="Pensionado"))
        self.assertEqual(result["benefit_kind"]["value"], "pension")
        self.assertEqual(result["paying_organization"]["status"], "missing")

    def test_bank_catalog_accepts_single_value_and_preserves_real_ambiguity(self):
        result = fields(add_answers(sample(), payment_bank=["Banco Nación"]))
        self.assertEqual(result["payment_bank"]["value"], "nacion")
        result = fields(add_answers(sample(), payment_bank=["Banco Nación", "Bancor"]))
        self.assertEqual(result["payment_bank"]["alternatives"], ["bancor", "nacion"])
        result = fields(add_answers(sample(), payment_bank=["Banco Nación", "Unknown"]))
        self.assertEqual(result["payment_bank"]["status"], "unmapped")

    def test_hidden_bank_from_unasked_branch_stays_out_of_interpretation(self):
        envelope = add_answers(sample("whatsapp"),
            provincia="cordoba", situacion_cordoba="jubilado", organismo="caja_cordoba", banco_jubilado="nacion")
        self.assertEqual(fields(envelope)["payment_bank"]["status"], "not_applicable")

    def test_municipal_retirement_without_invented_paying_organization(self):
        web = add_answers(sample(), province="Córdoba", employment_status="Jubilado Municipal")
        wa = add_answers(sample("whatsapp"),
            provincia="cordoba", situacion_cordoba="jubilado_municipal", banco_cordoba="nacion")
        for result in fields(web), fields(wa):
            self.assertEqual(result["benefit_kind"]["value"], "retirement")
            self.assertEqual(result["benefit_regime"]["value"], "municipal")
            self.assertEqual(result["paying_organization"]["status"], "missing")

    def test_whatsapp_transport_phone_is_not_a_form_answer(self):
        envelope = add_answers(sample("whatsapp"), whatsapp="synthetic transport phone")
        self.assertEqual(fields(envelope)["phone"]["status"], "not_in_form")
        self.assertEqual(capture(envelope, now=NOW).payload["whatsapp"], "synthetic transport phone")

    def test_unseen_form_is_captured_without_speculative_interpretation(self):
        envelope = sample() | {"form_version": "web-loan-v7"}
        submission = capture(envelope, now=NOW)
        self.assertEqual(normalize(submission)["status"], "unsupported_form_version")
        self.assertEqual(submission.original_body, envelope["original_body"])

    def test_invalid_envelopes_are_rejected(self):
        for change in (
            {"declared_at": "2026-09-14"}, {"declared_at": "2027-01-01T07:00:00Z"},
            {"original_body": '{"k": NaN}'}, {"original_body": '{"k":"\u0000"}'},
            {"original_body": '{"k":1,"k":2}'}, {"source_id": ""},
            {"original_body": json.dumps({"k": "x" * (256 * 1024 + 1)})},
            {"form": {"id": "unspecified"}}, {"answers_path": [True]},
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
                    self.assertFalse(body["normalization_worker_enabled"])
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
