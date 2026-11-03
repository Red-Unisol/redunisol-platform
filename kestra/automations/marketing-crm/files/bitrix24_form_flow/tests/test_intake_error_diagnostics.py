import io
import json
import runpy
import sys
from contextlib import redirect_stderr
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError


class IntakeErrorDiagnosticsTests(unittest.TestCase):
    def run_entrypoint(self, error):
        outputs = Mock()
        stderr = io.StringIO()
        with patch.dict(sys.modules, {"kestra": SimpleNamespace(Kestra=SimpleNamespace(outputs=outputs))}), \
                patch.dict("os.environ", {"TRIGGER_BODY_JSON": "{}"}), \
                patch("bitrix24_form_flow.form_processor.whatsapp_intake.process", side_effect=error), \
                redirect_stderr(stderr):
            runpy.run_module("bitrix24_form_flow.kestra_whatsapp_intake_entrypoint", run_name="__main__")
        return outputs.call_args.args[0], stderr.getvalue()

    def test_provider_failure_logs_safe_context_without_request_response_or_secret(self):
        error = RuntimeError("private-token customer@example.test +5493511234567 private-response")
        error.__cause__ = HTTPError("https://example.test/private-token", 503,
                                    "private-response", None, None)
        error.intake_crm_method = "crm.lead.get"
        error.intake_crm_attempts = 3
        error.intake_crm_write_attempted = False
        result, log = self.run_entrypoint(error)
        self.assertFalse(result["ok"])
        self.assertEqual((result["action"], result["reason"]), ("error", "intake_processing_uncertain"))
        diagnostic = json.loads(log[log.index("{"):])
        self.assertEqual(diagnostic["error_type"], "RuntimeError")
        self.assertEqual(diagnostic["cause_type"], "HTTPError")
        self.assertEqual(diagnostic["http_status"], 503)
        self.assertEqual(diagnostic["method"], "crm.lead.get")
        self.assertEqual(diagnostic["attempts"], 3)
        self.assertFalse(diagnostic["write_attempted"])
        self.assertTrue(diagnostic["function"])
        for private in ("private-token", "customer@example.test", "+5493511234567", "private-response"):
            self.assertNotIn(private, log)
            self.assertNotIn(private, json.dumps(result))

    def test_validation_failure_keeps_its_invalid_acknowledgement(self):
        from bitrix24_form_flow.form_processor.whatsapp_intake import InvalidIntake
        result, log = self.run_entrypoint(InvalidIntake("private-input"))
        self.assertEqual((result["action"], result["reason"]), ("invalid", "invalid_intake_response"))
        self.assertEqual(log, "")
