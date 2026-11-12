"""Exercise the real Ansible Prometheus timestamp parser without an SSH target."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
PARSER = ROOT / "roles/monitoring/tasks/parse-health-timestamp.yml"
METRIC = "foundation_health_last_collection_timestamp_seconds"
NOW = 1793885050


@unittest.skipUnless(shutil.which("ansible-playbook"), "Linux Ansible controller required")
class PrometheusHealthTimestampTests(unittest.TestCase):
    def run_parser(self, content, max_age=180):
        play = [{
            "name": "Exercise the actual Prometheus timestamp parser locally",
            "hosts": "localhost",
            "gather_facts": False,
            "vars": {
                "foundation_monitoring_probe": {"content": content},
                "foundation_monitoring_now": {"stdout": str(NOW)},
                "foundation_monitoring_health_max_age_seconds": max_age,
            },
            "tasks": [{"ansible.builtin.import_tasks": str(PARSER)}],
        }]
        env = dict(os.environ, ANSIBLE_CONFIG=str(ROOT / "ansible.cfg"),
                   ANSIBLE_NOCOLOR="1")
        with tempfile.TemporaryDirectory(prefix="foundation-monitoring-") as temp:
            path = Path(temp) / "play.yml"
            path.write_text(yaml.safe_dump(play, sort_keys=False), encoding="utf-8")
            env["ANSIBLE_LOCAL_TEMP"] = str(Path(temp) / "ansible-tmp")
            return subprocess.run(
                ["ansible-playbook", "-i", "localhost,", "-c", "local",
                 str(path), "--check"],
                env=env, cwd=ROOT, capture_output=True, text=True, timeout=45,
            )

    def assert_parser_accepts(self, content, max_age=180):
        result = self.run_parser(content, max_age)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertRegex(result.stdout, r"changed=0")

    def assert_parser_rejects(self, content, max_age=180):
        result = self.run_parser(content, max_age)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("FAILED", result.stdout + result.stderr)

    def test_integer_decimal_and_exporter_scientific_forms_are_accepted(self):
        for value in ("1793885025", "1793885025.5", "1.793885025e+09"):
            with self.subTest(value=value):
                self.assert_parser_accepts(f"{METRIC} {value}\n")

    def test_absent_sample_is_rejected(self):
        self.assert_parser_rejects("# HELP unrelated A fixture\nunrelated 1\n")

    def test_duplicates_are_rejected_even_if_one_value_is_malformed(self):
        for other in ("1793885025", "NaN"):
            with self.subTest(other=other):
                self.assert_parser_rejects(
                    f"{METRIC} 1793885025\n{METRIC} {other}\n"
                )

    def test_nonfinite_and_overflow_samples_are_rejected(self):
        for value in ("NaN", "+Inf", "1e999"):
            with self.subTest(value=value):
                self.assert_parser_rejects(f"{METRIC} {value}\n")

    def test_stale_scientific_sample_is_rejected(self):
        self.assert_parser_rejects(f"{METRIC} 1.793884e+09\n")

    def test_future_fraction_is_rejected_without_integer_truncation(self):
        self.assert_parser_rejects(f"{METRIC} {NOW}.25\n")

    def test_nonpositive_timestamps_are_rejected(self):
        for value in ("0", "-1793885025"):
            with self.subTest(value=value):
                self.assert_parser_rejects(f"{METRIC} {value}\n")


if __name__ == "__main__":
    unittest.main()
