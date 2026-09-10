from pathlib import Path
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[3]


class CredixsaFlowContractsTests(unittest.TestCase):
    def test_prefill_idle_uses_selector_outputs(self):
        flow = yaml.safe_load((ROOT / "kestra/automations/marketing-crm/flows/bitrix24_lead_prefill.yaml").read_text())
        tasks = {t["id"]: t for t in flow["tasks"]}
        # En Kestra 2 una tarea salteada sigue existiendo, asi que
        # "outputs.X is defined" siempre da verdadero y la rama inactiva corre
        # igual. El runIf tiene que mirar el dato, no la existencia de la tarea.
        #
        # No se compara contra un texto exacto a proposito: este flow difiere
        # entre main y dev -- dev todavia no tiene la tarea resolver_identidad,
        # y traer la version de main sin sus cambios de Python lo romperia. Lo
        # que hay que garantizar es el contrato, no la forma.
        self.assertNotRegex(
            tasks["consultar_arca"]["runIf"],
            "outputs[.][A-Za-z_0-9]+ is defined",
        )
        for output in flow["outputs"]:
            if "outputs.completar_backfill" in output["value"]:
                self.assertIn("outputs.completar_backfill.vars is defined", output["value"])
        for task in flow["tasks"]:
            for expression in task.get("env", {}).values():
                for subflow in ("consultar_arca", "consultar_credixsa"):
                    if "outputs." + subflow in expression:
                        self.assertIn("outputs." + subflow + ".outputs is defined", expression)

    def test_alerts_are_bounded_and_exclude_system_and_dev(self):
        flow = yaml.safe_load((ROOT / "kestra/platform/system/flows/alerta_flow_fallos.yaml").read_text())
        self.assertEqual(flow["concurrency"]["limit"], 1)
        self.assertEqual(flow["sla"][0]["duration"], "PT5M")
        self.assertEqual(flow["sla"][0]["behavior"], "CANCEL")
        for task in flow["tasks"]:
            if task["type"] == "io.kestra.plugin.core.http.Request":
                self.assertEqual(task["timeout"], "PT30S")
        for trigger in flow["triggers"]:
            self.assertNotIn("preconditions", trigger)
            self.assertIn("startsWith('redunisol.prod.')", trigger["when"])
            self.assertIn("flow.namespace != 'redunisol.prod.system'", trigger["when"])


if __name__ == "__main__":
    unittest.main()
