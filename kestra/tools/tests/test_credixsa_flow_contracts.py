from pathlib import Path
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[3]


class CredixsaFlowContractsTests(unittest.TestCase):
    def test_prefill_batch_is_serialized_and_children_are_bounded(self):
        root = ROOT / "kestra/automations/marketing-crm/flows"
        parent = yaml.safe_load((root / "bitrix24_lead_prefill.yaml").read_text())
        child = yaml.safe_load((root / "bitrix24_lead_prefill_one.yaml").read_text())
        self.assertEqual(parent["concurrency"]["limit"], 1)
        parallel = parent["tasks"][1]
        self.assertEqual(parallel["concurrent"], 2)
        self.assertEqual(len(parallel["tasks"]), 2)
        for i, task in enumerate(parallel["tasks"]):
            self.assertEqual(task["runIf"], "{{ outputs.seleccionar_lote.vars.count > " + str(i) + " }}")
            self.assertTrue(task["wait"])
            self.assertFalse(task["transmitFailed"])
            self.assertEqual(task["flowId"], child["id"])
        self.assertEqual(parent["tasks"][2]["id"], "verificar_lote")
        self.assertEqual(len(parent["tasks"][2]["conditions"]), 2)
        self.assertEqual(child["concurrency"]["limit"], 2)
        self.assertNotIn("triggers", child)
        for task in parent["tasks"] + child["tasks"]:
            if "containerImage" in task:
                self.assertNotIn("beforeCommands", task)
                self.assertIn("@sha256:", task["containerImage"])
                self.assertEqual(task["taskRunner"]["pullPolicy"], "IF_NOT_PRESENT")
        tasks = {t["id"]: t for t in child["tasks"]}
        self.assertEqual(tasks["consultar_arca"]["runIf"], "{{ (outputs.resolver_identidad.vars.effective_cuil ?? '') != '' }}")
        for task in child["tasks"]:
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
