import importlib.util
from pathlib import Path
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("deploy_log_defaults", ROOT / "kestra/tools/deploy_kestra.py")
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)


class LogDefaultsTests(unittest.TestCase):
    def normalize(self, definition, environment="prod"):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "flow.yaml"
            path.write_text(yaml.safe_dump(definition), encoding="utf-8")
            return yaml.safe_load(deploy.normalize_flow_source(path, "redunisol." + environment + ".system", environment))

    def test_nested_tasks_and_triggers_default_to_info(self):
        flow = {"id": "nested", "namespace": "redunisol", "tasks": [
            {"id": "branch", "type": "io.kestra.plugin.core.flow.If", "then": [
                {"id": "switch", "type": "io.kestra.plugin.core.flow.Switch", "cases": {"yes": [
                    {"id": "log", "type": "io.kestra.plugin.core.log.Log", "message": "hello"}]},
                 "defaults": [{"id": "default", "type": "io.kestra.plugin.core.log.Log"}]}],
             "else": [{"id": "other", "type": "io.kestra.plugin.core.log.Log", "logLevel": None}]}],
            "errors": [{"id": "error", "type": "io.kestra.plugin.core.log.Log"}],
            "finally": [{"id": "final", "type": "io.kestra.plugin.core.log.Log"}],
            "afterExecution": [{"id": "after", "type": "io.kestra.plugin.core.log.Log"}],
            "triggers": [{"id": "schedule", "type": "io.kestra.plugin.core.trigger.Schedule", "cron": "@daily"}]}
        for environment in ("dev", "prod"):
            result = self.normalize(flow, environment)
            branch = result["tasks"][0]
            nodes = [branch, branch["then"][0], branch["then"][0]["cases"]["yes"][0],
                     branch["then"][0]["defaults"][0], branch["else"][0], result["errors"][0],
                     result["finally"][0], result["afterExecution"][0], result["triggers"][0]]
            self.assertTrue(all(node["logLevel"] == "INFO" for node in nodes))
            self.assertNotIn("logLevel", result)

    def test_explicit_levels_and_user_data_are_preserved(self):
        data = {"id": "payload", "type": "io.kestra.plugin.custom.Data"}
        tasks = [{"id": level.lower(), "type": "io.kestra.plugin.core.log.Log", "logLevel": level,
                  "message": "hello", "inputs": {"nested": data}, "env": {"tasks": [data]}}
                 for level in ("WARN", "ERROR", "DEBUG", "TRACE")]
        result = self.normalize({"id": "explicit", "namespace": "redunisol", "tasks": tasks})
        self.assertEqual(result["tasks"], tasks)

    def test_listener_and_single_task_wrappers_are_covered(self):
        result = self.normalize({"id": "wrapped", "namespace": "redunisol", "tasks": [],
                                 "listeners": [{"tasks": [{"id": "listener", "type": "io.kestra.plugin.core.log.Log"}]}],
                                 "errors": [{"id": "wrapper", "type": "io.kestra.plugin.core.flow.Sequential",
                                             "task": {"id": "inner", "type": "io.kestra.plugin.core.log.Log"}}]})
        self.assertEqual(result["listeners"][0]["tasks"][0]["logLevel"], "INFO")
        self.assertEqual(result["errors"][0]["task"]["logLevel"], "INFO")

    def test_shared_default_changes_redeploy_every_target(self):
        for filename in ("deploy-prod.yml", "deploy-dev.yml"):
            workflow = yaml.safe_load((ROOT / ".github/workflows" / filename).read_text(encoding="utf-8"))
            steps = workflow["jobs"]["detect-changes"]["steps"]
            raw = next(step["with"]["filters"] for step in steps if step.get("id") == "filter")
            filters = yaml.safe_load(raw)
            for target in deploy.KNOWN_DEPLOY_TARGETS:
                with self.subTest(filename=filename, target=target):
                    self.assertIn("kestra/tools/deploy_kestra.py", filters[target])


    def test_ci_runs_logging_regression_tests(self):
        workflow = yaml.safe_load((ROOT / ".github/workflows/validate.yml").read_text(encoding="utf-8"))
        command = next(step["run"] for step in workflow["jobs"]["validate"]["steps"]
                       if step.get("name") == "Run deploy tooling tests")
        self.assertIn("kestra.tools.tests.test_deploy_log_defaults", command.split())


if __name__ == "__main__":
    unittest.main()
