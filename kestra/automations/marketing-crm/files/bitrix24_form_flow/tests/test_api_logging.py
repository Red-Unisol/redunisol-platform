from contextlib import redirect_stderr, redirect_stdout
import io
import json
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, Mock, patch

from bitrix24_form_flow import kestra_chat_response_worker_entrypoint as entrypoint
from bitrix24_form_flow.form_processor.bitrix_client import ApiCallSummaryClient, BitrixClient
from bitrix24_form_flow.form_processor.deal_chat_response import PacedReadClient
from bitrix24_form_flow.form_processor.logger import create_logger


CONFIG = SimpleNamespace(
    base_url="https://example.test", webhook_path="rest/private-token", timeout_seconds=20
)
CLIENT_MODULE = "bitrix24_form_flow.form_processor.bitrix_client"


def response(result):
    opened = MagicMock()
    opened.__enter__.return_value.read.return_value = json.dumps({"result": result}).encode()
    return opened


class ApiLoggingTests(unittest.TestCase):
    def test_info_and_errors_use_the_correct_streams(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            create_logger().info("success")
            create_logger().error("failure")
        self.assertIn("INFO success", stdout.getvalue())
        self.assertNotIn("failure", stdout.getvalue())
        self.assertIn("ERROR failure", stderr.getvalue())
        self.assertNotIn("success", stderr.getvalue())

    def test_other_consumers_keep_per_call_logging_by_default(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch(CLIENT_MODULE + ".urlopen", return_value=response([])), \
                redirect_stdout(stdout), redirect_stderr(stderr):
            self.assertEqual(BitrixClient(CONFIG, create_logger()).call("crm.item.list", {}), [])
        self.assertIn("Invocando crm.item.list", stdout.getvalue())
        self.assertEqual(stderr.getvalue(), "")

    def test_summary_counts_actual_retries_and_preserves_write_failure(self):
        inner = Mock()
        summary = ApiCallSummaryClient(inner)
        paced = PacedReadClient(summary, sleep=lambda _: None)
        inner.call_full.side_effect = [
            TimeoutError("private"), RuntimeError("HTTP 503 private"), {"result": []},
            TimeoutError("private"),
        ]
        self.assertEqual(paced.call("crm.item.list", {"private": "payload"}), [])
        with self.assertRaises(TimeoutError):
            paced.call("crm.item.update", {"private": "payload"})
        self.assertEqual(summary.summary(), {
            "api_calls": {"crm.item.list": 3, "crm.item.update": 1},
            "api_failed_attempts": {"crm.item.list": 2, "crm.item.update": 1},
        })
        self.assertNotIn("private", json.dumps(summary.summary()))
        self.assertEqual(inner.call_full.call_count, 4)

    def run_entrypoint(self, result=None, failure=None):
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.dict("os.environ", {"CHAT_RESPONSE_QUEUE_URL": "https://queue.example.test",
                "CHAT_RESPONSE_QUEUE_TOKEN": "private-token", "CHAT_RESPONSE_SCOPE": "prod"}), \
                patch.object(entrypoint, "load_config", return_value=CONFIG), \
                patch.object(entrypoint, "QueueClient"), \
                patch.object(entrypoint, "run_worker", return_value=result, side_effect=failure), \
                redirect_stdout(stdout), redirect_stderr(stderr):
            code = entrypoint.main()
        directive = next(line for line in stdout.getvalue().splitlines() if line.startswith("::"))
        outputs = json.loads(directive[2:-2])["outputs"]
        return code, outputs, stdout.getvalue(), stderr.getvalue()

    def test_worker_summary_contains_counts_without_payloads(self):
        result = {"ok": True, "mode": "event", "counts": {"moved": 1},
                  "api_calls": {"imopenlines.crm.chat.get": 1}}
        code, outputs, stdout, stderr = self.run_entrypoint(result)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(outputs["result_json"]), result)
        self.assertIn("bitrix24_chat_response_worker_summary", stdout)
        self.assertNotIn("private-token", stdout)
        self.assertEqual(stderr, "")

    def test_failed_worker_produces_a_failed_execution_and_sanitized_error(self):
        code, outputs, stdout, stderr = self.run_entrypoint(failure=TimeoutError("private-response"))
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(outputs["result_json"]), {"ok": False, "error_type": "TimeoutError"})
        self.assertIn("TimeoutError", stderr)
        self.assertNotIn("private", stdout + stderr)

    def test_legacy_entrypoint_cannot_start_the_old_sweep(self):
        from bitrix24_form_flow import kestra_deal_chat_response_entrypoint as legacy
        with patch.object(entrypoint, "main", return_value=7) as bounded:
            self.assertEqual(legacy.main(), 7)
        bounded.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
