"""Integration of the two disabled Kestra flows with the Pago360 processor."""
from contextlib import redirect_stdout
from dataclasses import replace
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import ANY, Mock, call, patch

import yaml

DOMAIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DOMAIN / "files"))

from pago360 import entrypoint
from pago360_cuotas.processor import Processor
from kestra.automations.cobranzas.tests import test_pago360_cuotas as fixtures


OPERATION_ID = "ad9f33c9-ea14-4406-bca3-1873856970a1"
SECOND_ID = "3f061711-41ac-44e4-b2f7-16d39c361b37"
EXECUTION_ID = "kestra-test-execution"


def run_entrypoint(*arguments, **env):
    output = io.StringIO()
    environment = {"KESTRA_EXECUTION_ID": EXECUTION_ID, **env}
    with patch.dict(os.environ, environment, clear=True), \
            patch.object(sys, "argv", ["pago360.entrypoint", *arguments]), \
            redirect_stdout(output):
        entrypoint.main()
    return [json.loads(line) for line in output.getvalue().splitlines()]


class Pago360FlowTests(unittest.TestCase):
    def setUp(self):
        # Even a regression that bypasses the disabled processor must stay offline.
        self.http = self.enterContext(patch(
            "requests.sessions.Session.request",
            side_effect=AssertionError("Unexpected HTTP request"),
        ))

    def test_verified_mode_requires_all_ports(self):
        with self.assertRaises(ValueError):
            Processor(contracts_verified=True)
        for port in ("repository", "provider", "legacy"):
            with self.subTest(missing=port):
                ports = {"repository": Mock(), "provider": Mock(), "legacy": Mock()}
                del ports[port]
                with self.assertRaises(ValueError):
                    Processor(**ports, contracts_verified=True)

    def test_manual_webhook_and_recovery_use_real_blocked_processor(self):
        envs = [
            {"OPERATION_ID": OPERATION_ID},
            {"TRIGGER_BODY_JSON": json.dumps({"operacion_id": OPERATION_ID})},
        ]
        with patch.object(Processor, "run", autospec=True, side_effect=Processor.run) as run, \
                patch("pago360.pending.pending_operations", return_value=[OPERATION_ID, SECOND_ID]) as pending:
            logged = []
            for env in envs:
                logged.extend(run_entrypoint(**env))
            pending.assert_not_called()
            logged.extend(run_entrypoint("recover"))
            pending.assert_called_once_with()
        operation_ids = [OPERATION_ID, OPERATION_ID, OPERATION_ID, SECOND_ID]
        self.assertEqual(run.call_args_list, [call(ANY, op, EXECUTION_ID) for op in operation_ids])
        self.assertEqual([line["operation_id"] for line in logged], operation_ids)
        for line in logged:
            self.assertEqual(line["result"], "BLOCKED")
            self.assertEqual(line["reason"], "CONTRACTS_NOT_VERIFIED")
        self.http.assert_not_called()

    def test_recovery_continues_after_invalid_pending_item_and_reports_failure(self):
        with patch.object(Processor, "run", autospec=True, side_effect=Processor.run) as run, \
                patch("pago360.pending.pending_operations", return_value=["invalid", SECOND_ID]), \
                self.assertRaises(RuntimeError):
            run_entrypoint("recover")
        run.assert_called_once_with(ANY, SECOND_ID, EXECUTION_ID)
        self.http.assert_not_called()

    def test_recovery_and_late_webhook_share_the_same_journal(self):
        # The first notification was lost. Recovery sees the pending operation
        # before a delayed webhook; neither a successful nor an uncertain write repeats.
        for timeout, expected_status in [(False, "APPLIED"), (True, "RECONCILIATION")]:
            with self.subTest(timeout=timeout):
                operation = replace(fixtures.operation(), operation_id=OPERATION_ID)
                repo = fixtures.MemoryRepository(operation)
                legacy = fixtures.FakeLegacy(repo)
                if timeout:
                    legacy.fail_at = 1
                provider = Mock()
                provider.verify.return_value = fixtures.payment(operation)
                processor = Processor(repo, provider, legacy, contracts_verified=True)
                with patch.object(entrypoint, "Processor", return_value=processor), \
                        patch("pago360.pending.pending_operations", return_value=[OPERATION_ID]):
                    recovered = run_entrypoint("recover")
                    delayed = run_entrypoint(TRIGGER_BODY_JSON=json.dumps({"operacion_id": OPERATION_ID}))
                self.assertEqual(recovered[0]["result"], expected_status)
                self.assertEqual(delayed[0]["result"], expected_status)
                if timeout:
                    self.assertEqual(recovered[0]["reason"], "WRITE_UNCERTAIN")
                expected_quota = operation.installments[0].installment_id
                self.assertEqual(legacy.calls, [expected_quota])
                self.assertEqual(provider.verify.call_count, 1)
        self.http.assert_not_called()

    def test_flows_and_triggers_ship_disabled_with_both_packages(self):
        flows = {"pago360_imputar": "python -m pago360.entrypoint",
                 "pago360_recuperar": "python -m pago360.entrypoint recover"}
        for flow_id, command in flows.items():
            with self.subTest(flow_id=flow_id):
                flow_file = DOMAIN / "flows" / f"{flow_id}.yaml"
                flow = yaml.safe_load(flow_file.read_text(encoding="utf-8"))
                self.assertIs(flow["disabled"], True)
                self.assertTrue(flow["triggers"])
                for trigger in flow["triggers"]:
                    self.assertIs(trigger["disabled"], True)
                task, = flow["tasks"]
                self.assertTrue(task["namespaceFiles"]["enabled"])
                self.assertIn("pago360/**", task["namespaceFiles"]["include"])
                self.assertIn("pago360_cuotas/**", task["namespaceFiles"]["include"])
                self.assertEqual(task["commands"], [command])
                self.assertEqual(task["env"]["KESTRA_EXECUTION_ID"], "{{ execution.id }}")


if __name__ == "__main__":
    unittest.main()
