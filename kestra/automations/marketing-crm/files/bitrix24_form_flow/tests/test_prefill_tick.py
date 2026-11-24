"""Exercise the immutable command that the watchdog accepts in the deployed flow."""
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import unittest
from unittest.mock import patch

import yaml

from bitrix24_form_flow import kestra_lead_prefill_batch_select_entrypoint as selector


class PrefillTickTests(unittest.TestCase):
    now = datetime(2026, 11, 24, 12, tzinfo=timezone.utc)
    flow = Path(__file__).resolve().parents[3] / "flows" / "bitrix24_lead_prefill.yaml"

    def run_tick(self, start, ages):
        task = yaml.safe_load(self.flow.read_text(encoding="utf-8"))["tasks"][1]
        self.assertEqual(task["env"]["PREFILL_EXECUTION_STARTED_AT"], "{{ execution.startDate }}")
        lines = task["commands"][0].splitlines()
        self.assertEqual((lines[0], lines[-1]), ("python - <<'PY'", "PY"))
        with patch.dict(os.environ, {"PREFILL_EXECUTION_STARTED_AT": start}), \
                patch("datetime.datetime", wraps=datetime) as clock, \
                patch.object(selector, "select_batch", return_value=["current"]) as select, \
                patch.object(selector, "emit_batch") as emit:
            clock.now.side_effect = [self.now + timedelta(seconds=s) for s in ages]
            exec("\n".join(lines[1:-1]), {})
            return select.call_count, emit.call_args

    def test_expired_before_or_during_selection_emits_empty_batch(self):
        for elapsed, reads in [([1200, 1200], 0), ([1199, 1200], 1), ([-1, -1], 0)]:
            with self.subTest(elapsed=elapsed):
                count, emitted = self.run_tick(self.now.isoformat(), elapsed)
                self.assertEqual(count, reads)
                self.assertEqual(emitted.args, ([],))
                self.assertEqual(emitted.kwargs["action"], "expired_scheduler_tick")

    def test_timely_selection_proceeds_and_invalid_start_stops_before_selection(self):
        count, emitted = self.run_tick(self.now.isoformat(), [0, 4])
        self.assertEqual(count, 1)
        self.assertEqual(emitted.args, (["current"],))
        with self.assertRaises(ValueError):
            self.run_tick("2026-11-24T12:00:00", [0, 0])
