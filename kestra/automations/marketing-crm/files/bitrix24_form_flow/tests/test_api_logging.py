from contextlib import redirect_stderr, redirect_stdout
import io
import json
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, Mock, patch

from bitrix24_form_flow import kestra_deal_chat_response_entrypoint as entrypoint
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

    def run_entrypoint(self, reconcile, *, verbose=False, config_error=None):
        outputs = Mock()
        stdout, stderr = io.StringIO(), io.StringIO()
        module = SimpleNamespace(Kestra=SimpleNamespace(outputs=outputs))
        with patch.dict(sys.modules, {"kestra": module}), \
                patch.dict("os.environ", {"BITRIX24_LOG_API_CALLS": "true" if verbose else ""}), \
                patch.object(entrypoint, "load_config", return_value=CONFIG, side_effect=config_error), \
                patch.object(entrypoint, "reconcile_sales_chats", side_effect=reconcile), \
                patch(CLIENT_MODULE + ".urlopen", return_value=response([])), \
                redirect_stdout(stdout), redirect_stderr(stderr):
            code = entrypoint.main()
        return code, outputs.call_args.args[0], stdout.getvalue(), stderr.getvalue()

    def test_many_calls_emit_one_summary_and_preserve_detailed_outputs(self):
        result = {"ok": True, "checked": 88, "counts": {"no_active_sales_session": 88},
                  "events": [{"deal_id": 123, "status": "no_active_sales_session"}]}

        def reconcile(client):
            for _ in range(265):
                client.client.call("imopenlines.crm.chat.get", {"CRM_ENTITY": "private"})
            return result

        code, outputs, stdout, stderr = self.run_entrypoint(reconcile)
        self.assertEqual(code, 0)
        self.assertEqual(outputs["ok"], True)
        self.assertEqual(json.loads(outputs["result_json"]), result)
        self.assertEqual(len(stdout.splitlines()), 1)
        summary = json.loads(stdout[stdout.index("{"):])
        self.assertEqual(summary["api_calls"], {"imopenlines.crm.chat.get": 265})
        self.assertEqual(summary["api_failed_attempts"], {})
        self.assertEqual(summary["checked"], 88)
        self.assertEqual(summary["counts"], result["counts"])
        self.assertGreaterEqual(summary["duration_seconds"], 0)
        self.assertNotIn("events", summary)
        for private in ("private-token", "CRM_ENTITY", "deal_id", "Invocando"):
            self.assertNotIn(private, stdout)
        self.assertEqual(stderr, "")

    def test_real_errors_remain_errors_with_full_events_in_outputs(self):
        result = {"ok": False, "checked": 1, "counts": {"error": 1},
                  "events": [{"deal_id": 123, "status": "error", "error_type": "RuntimeError"}]}
        code, outputs, stdout, stderr = self.run_entrypoint(lambda _: result)
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(outputs["result_json"]), result)
        self.assertEqual(stdout, "")
        self.assertEqual(len(stderr.splitlines()), 1)
        summary = json.loads(stderr[stderr.index("{"):])
        self.assertEqual(summary["error_types"], {"RuntimeError": 1})
        self.assertFalse(summary["ok"])

    def test_top_level_and_configuration_failures_are_sanitized(self):
        def failing(_):
            raise TimeoutError("private-token private-response")
        for reconcile, error, expected in (
            (failing, None, "TimeoutError"),
            (lambda _: None, ValueError("private-config"), "ValueError"),
        ):
            with self.subTest(error_type=expected):
                code, outputs, stdout, stderr = self.run_entrypoint(reconcile, config_error=error)
                self.assertEqual(code, 1)
                self.assertEqual(json.loads(outputs["result_json"]), {"ok": False, "error_type": expected})
                self.assertIn(expected, stderr)
                self.assertNotIn("private", stderr)
                self.assertEqual(stdout, "")

    def test_diagnostic_switch_restores_per_call_logs(self):
        def reconcile(client):
            client.call("crm.item.list", {})
            return {"ok": True, "checked": 0, "counts": {}, "events": []}
        code, _, stdout, stderr = self.run_entrypoint(reconcile, verbose=True)
        self.assertEqual(code, 0)
        self.assertIn("Invocando crm.item.list", stdout)
        self.assertIn("bitrix24_deal_chat_response_summary", stdout)
        self.assertEqual(stderr, "")


if __name__ == "__main__":
    unittest.main()
