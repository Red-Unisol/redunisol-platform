from pathlib import Path
import unittest
import yaml

from kestra.tools.deploy_kestra import normalize_flow_source

ROOT = Path(__file__).resolve().parents[3]
FLOWS = ROOT / "kestra/automations/analisis-credito/flows"


class BcraPocDeploymentTests(unittest.TestCase):
    def test_direct_api_is_loopback_only_and_reuses_the_existing_volume(self):
        compose = yaml.safe_load((ROOT / "apps/bcra-file-api/deploy/docker-compose.yml").read_text(encoding="utf-8"))
        service = compose["services"]["bcra-file-api-poc"]
        self.assertEqual(service["ports"], ["127.0.0.1:18082:8080"])
        self.assertEqual(compose["volumes"]["bcra-file-data"]["name"], "bcra-file-poc_bcra-file-data")
        self.assertIn("bcra-file-data:/data", service["volumes"])
        self.assertEqual(service["logging"]["options"]["max-size"], "10m")

    def test_poc_triggers_exist_only_in_prod(self):
        for name in ("bcra_archivo_actualizar_poc", "bcra_archivo_consultar_poc"):
            with self.subTest(flow=name):
                path = FLOWS / (name + ".yaml")
                dev = yaml.safe_load(normalize_flow_source(path, "redunisol.dev.analisis-credito", "dev"))
                prod = yaml.safe_load(normalize_flow_source(path, "redunisol.prod.analisis-credito", "prod"))
                self.assertNotIn("triggers", dev)
                self.assertIn("triggers", prod)

    def test_query_is_one_native_http_task_without_a_container_runner(self):
        flow = yaml.safe_load((FLOWS / "bcra_archivo_consultar_poc.yaml").read_text(encoding="utf-8"))
        self.assertEqual(len(flow["tasks"]), 1)
        task = flow["tasks"][0]
        self.assertEqual(task["type"], "io.kestra.plugin.core.http.Request")
        self.assertNotIn("taskRunner", task)
        self.assertNotIn("containerImage", task)
        self.assertNotIn("api.bcra.gob.ar", str(flow))
        self.assertEqual(task["options"]["logs"], [])
        self.assertTrue(flow["triggers"][0]["wait"])

    def test_daily_schedule_has_an_explicit_manual_test_and_no_business_tasks(self):
        flow = yaml.safe_load((FLOWS / "bcra_archivo_actualizar_poc.yaml").read_text(encoding="utf-8"))
        self.assertEqual(flow["triggers"][0]["cron"], "0 21 * * *")
        self.assertEqual(flow["triggers"][0]["timezone"], "America/Argentina/Buenos_Aires")
        self.assertFalse(flow["inputs"][0]["defaults"])
        self.assertIn("inputs.run_now", flow["tasks"][0]["condition"])
        self.assertNotIn("bitrix", str(flow).lower())
        self.assertNotIn("vimarx", str(flow).lower())


if __name__ == "__main__":
    unittest.main()
