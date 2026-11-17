from __future__ import annotations

from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

import yaml

FILES_ROOT = Path(__file__).resolve().parents[1] / "files"
if str(FILES_ROOT) not in sys.path:
    sys.path.insert(0, str(FILES_ROOT))

from mudon_credixsa_report import _resume_gate as gate
from mudon_credixsa_report import entrypoint


class ResumeGateTests(unittest.TestCase):
    def test_only_known_idle_resume_skips_processing(self):
        self.assertFalse(gate.should_process("resume", "idle"))
        self.assertFalse(gate.should_process(" RESUME ", "idle"))
        for state in ("", "pending", "unknown", "false"):
            with self.subTest(state=state):
                self.assertTrue(gate.should_process("resume", state))

    def test_monthly_manual_and_unknown_modes_reach_authoritative_state(self):
        for mode in ("monthly", "manual", "", "unknown"):
            with self.subTest(mode=mode):
                self.assertTrue(gate.should_process(mode, "idle"))

    def test_retry_errors_and_status_requests_bypass_idle_checkpoint(self):
        for body in ({"retry_errors": True}, {"mode": "status"}):
            for raw in (json.dumps(body), json.dumps(json.dumps(body))):
                with self.subTest(raw=raw):
                    self.assertTrue(gate.should_process("resume", "idle", raw))
        self.assertFalse(gate.should_process("resume", "idle", '{"retry_errors":false}'))

    def test_invalid_requests_are_not_silently_skipped(self):
        for raw in ('{bad', '[]', 'null', '"not-json"'):
            with self.subTest(raw=raw):
                self.assertTrue(gate.should_process("resume", "idle", raw))
                self.assertEqual(gate.resume_state_for_result({"ok": True, "status": "idle", "pending": 0}, raw), "pending")

    def test_only_successful_terminal_results_clear_checkpoint(self):
        for status in ("idle", "completed", "completed_with_errors"):
            with self.subTest(status=status):
                self.assertEqual(gate.resume_state_for_result({"ok": True, "status": status, "pending": 0}), "idle")
        for result in ({}, {"ok": False, "status": "completed", "pending": 0},
                       {"ok": True, "status": "completed", "pending": 1},
                       {"ok": True, "status": "completed"},
                       {"ok": True, "status": "running", "pending": 0},
                       {"ok": True, "status": "ready_to_publish", "pending": 0}):
            with self.subTest(result=result):
                self.assertEqual(gate.resume_state_for_result(result), "pending")

    def test_status_query_cannot_disable_resume_of_an_older_active_run(self):
        result = {"ok": True, "status": "completed", "pending": 0}
        self.assertEqual(gate.resume_state_for_result(result, '{"mode":"status"}'), "pending")

    def test_process_cli_needs_no_site_packages_and_emits_only_boolean_output(self):
        env = dict(os.environ, RUN_MODE="resume", MUDON_RESUME_STATE="idle", TRIGGER_BODY_JSON="{}")
        process = subprocess.run([sys.executable, "-S", str(FILES_ROOT / "mudon_credixsa_report/_resume_gate.py")],
                                 env=env, capture_output=True, text=True, check=True)
        line = process.stdout.strip()
        self.assertTrue(line.startswith("::") and line.endswith("::"))
        self.assertEqual(json.loads(line[2:-2]), {"outputs": {"should_run": False}})
        self.assertEqual(process.stderr, "")


class EntrypointCheckpointTests(unittest.TestCase):
    def test_published_result_exposes_checkpoint_for_native_kv_task(self):
        result = {"ok": True, "status": "completed", "pending": 0}
        with patch.dict(os.environ, {"TRIGGER_BODY_JSON": "{}"}), patch.object(entrypoint, "run_batch", return_value=result), \
             patch.object(entrypoint, "set_kestra_outputs") as outputs, redirect_stdout(io.StringIO()):
            self.assertEqual(entrypoint.main(), 0)
        self.assertEqual(outputs.call_args.args[0]["resume_state"], "idle")

    def test_processing_error_never_exposes_idle_checkpoint(self):
        with patch.object(entrypoint, "run_batch", side_effect=RuntimeError("synthetic failure")), \
             patch.object(entrypoint, "set_kestra_outputs") as outputs, redirect_stdout(io.StringIO()):
            self.assertEqual(entrypoint.main(), 1)
        self.assertEqual(outputs.call_args.args[0]["resume_state"], "pending")


class FlowResumeContractTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).resolve().parents[1] / "flows/mudon_credixsa_report.yaml"
        self.flow = yaml.safe_load(path.read_text(encoding="utf-8"))

    def test_heavy_runner_is_inside_gate_after_pending_fence(self):
        read, check, branch = self.flow["tasks"]
        self.assertTrue(read["type"].endswith(".kv.Get"))
        self.assertFalse(read["errorOnMissing"])
        self.assertTrue(check["taskRunner"]["type"].endswith(".Process"))
        self.assertNotIn("containerImage", check)
        self.assertEqual(check["namespaceFiles"]["include"], ["mudon_credixsa_report/_resume_gate.py"])
        self.assertIn(check["id"], branch["condition"])
        before, batch, after = branch["then"]
        self.assertEqual(before["value"], "pending")
        self.assertEqual(batch["id"], "procesar_lote")
        self.assertTrue(batch["taskRunner"]["type"].endswith(".docker.Docker"))
        self.assertEqual(batch["taskRunner"]["pullPolicy"], "IF_NOT_PRESENT")
        self.assertIn("resume_state", after["value"])
        self.assertEqual({read["key"], before["key"], after["key"]}, {"mudon_credixsa_report.resume_state.v1"})
        self.assertTrue(before["overwrite"])
        self.assertTrue(after["overwrite"])
        self.assertEqual(before["ttl"], "P1D")
        self.assertEqual(after["ttl"], "P1D")
        self.assertNotIn("errors", branch)
        self.assertEqual(check["env"]["TRIGGER_BODY_JSON"], batch["env"]["TRIGGER_BODY_JSON"])

    def test_idle_branch_still_has_all_public_output_defaults(self):
        outputs = {item["id"]: item["value"] for item in self.flow["outputs"]}
        self.assertEqual(set(outputs), {"ok", "status", "run_id", "total", "completed", "pending", "errors", "qualifying", "latest_path", "history_path", "error"})
        for value in outputs.values():
            self.assertIn("??", value)
        self.assertIn("'idle'", outputs["status"])

    def test_schedule_and_manual_entrypoints_are_preserved(self):
        triggers = {item["id"]: item for item in self.flow["triggers"]}
        self.assertEqual(triggers["reanudar_corrida"]["cron"], "*/10 * * * *")
        self.assertEqual(triggers["reanudar_corrida"]["inputs"]["run_mode"], "resume")
        self.assertEqual(triggers["primer_dia_del_mes"]["cron"], "30 7 1 * *")
        self.assertEqual(triggers["primer_dia_del_mes"]["inputs"]["run_mode"], "monthly")
        self.assertEqual(triggers["webhook_manual"]["inputs"]["run_mode"], "manual")
        self.assertEqual(self.flow["concurrency"], {"limit": 1, "behavior": "QUEUE"})


if __name__ == "__main__":
    unittest.main()
