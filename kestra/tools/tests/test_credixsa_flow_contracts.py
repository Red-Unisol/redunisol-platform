from pathlib import Path
import json
import os
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import yaml

ROOT = Path(__file__).resolve().parents[3]


SYSTEM_FLOWS = ROOT / "kestra/platform/system/flows"


def load_flow(name):
    return yaml.safe_load((SYSTEM_FLOWS / name).read_text(encoding="utf-8"))


class CredixsaAlertStreakTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # La racha y el envio viven en la confirmacion, que corre despues de los
        # reintentos; el observador solo delega y registra recuperaciones.
        cls.flow = load_flow("alerta_flow_fallos_confirmar.yaml")
        cls.tasks = {task["id"]: task for task in cls.flow["tasks"]}
        cls.observer = load_flow("alerta_flow_fallos.yaml")
        cls.observer_tasks = {task["id"]: task for task in cls.observer["tasks"]}

    def evaluate(self, previous, execution_id, state):
        emitted = []
        with (
            patch.dict(os.environ, {
                "PREVIOUS_STREAK_JSON": json.dumps(previous),
                "SOURCE_EXECUTION_ID": execution_id,
                "SOURCE_STATE": state,
            }),
            patch.dict(sys.modules, {
                "kestra": SimpleNamespace(Kestra=SimpleNamespace(outputs=emitted.append)),
            }),
        ):
            exec(self.tasks["evaluar_racha_credixsa"]["script"], {})
        self.assertEqual(len(emitted), 1)
        output = emitted[0]
        return json.loads(output["streak_json"]), output["notify_failure"]

    def test_only_third_distinct_failed_execution_reaches_threshold(self):
        previous = None
        for execution_id, expected in [("a", False), ("b", False), ("c", True)]:
            previous, notify = self.evaluate(previous, execution_id, "FAILED")
            self.assertEqual(notify, expected)

    def test_repeated_execution_does_not_count_as_another_failure(self):
        previous = None
        for execution_id in ["a", "a", "b", "a", "b"]:
            previous, notify = self.evaluate(previous, execution_id, "FAILED")
            self.assertFalse(notify)
        previous, notify = self.evaluate(previous, "c", "FAILED")
        self.assertTrue(notify)
        self.assertEqual(previous["failed_execution_ids"], ["a", "b", "c"])

    def test_success_breaks_streak_before_or_after_threshold(self):
        for count in (1, 2, 3):
            with self.subTest(failures_before_success=count):
                previous = None
                for index in range(count):
                    previous, _ = self.evaluate(previous, f"before-{index}", "FAILED")
                previous, notify = self.evaluate(previous, "success", "SUCCESS")
                self.assertFalse(notify)
                self.assertEqual(previous["failed_execution_ids"], [])
                for index in range(3):
                    previous, notify = self.evaluate(previous, f"after-{index}", "FAILED")
                    self.assertEqual(notify, index == 2)

    def test_persistent_outage_stays_bounded_and_can_retry_failed_notification(self):
        previous = None
        for index in range(100):
            previous, notify = self.evaluate(previous, f"failure-{index}", "FAILED")
            self.assertEqual(notify, index >= 2)
            self.assertLessEqual(len(previous["failed_execution_ids"]), 3)

    def test_streak_scope_persistence_and_notification_guards(self):
        scope = "{{ ((outputs.leer_ejecucion_resuelta.value ?? null) is null) and inputs.namespace_origen == 'redunisol.prod.analisis-credito' and inputs.flow_origen == 'consulta_quiebra_credix' }}"
        for task_id in ("leer_racha_credixsa", "evaluar_racha_credixsa", "guardar_racha_credixsa"):
            self.assertEqual(self.tasks[task_id]["runIf"], scope)
        read = self.tasks["leer_racha_credixsa"]
        write = self.tasks["guardar_racha_credixsa"]
        self.assertEqual(read["key"], write["key"])
        self.assertIn("inputs.namespace_origen", write["key"])
        self.assertIn("inputs.flow_origen", write["key"])
        self.assertEqual(write["kvType"], "JSON")
        self.assertNotIn("ttl", write)
        failure_guard = self.tasks["enviar_alerta_fallo"]["runIf"]
        self.assertEqual(failure_guard, self.tasks["marcar_alerta_abierta"]["runIf"])
        self.assertIn("outputs.evaluar_racha_credixsa.vars.notify_failure ?? false", failure_guard)
        self.assertIn("inputs.flow_origen != 'consulta_quiebra_credix'", failure_guard)
        self.assertIn("inputs.namespace_origen != 'redunisol.prod.analisis-credito'", failure_guard)
        # Un exito del flow corta la racha, como la politica anterior.
        self.assertEqual(self.observer_tasks["limpiar_racha_credixsa"]["key"], read["key"].replace("inputs.namespace_origen", "trigger.namespace").replace("inputs.flow_origen", "trigger.flowId"))
        for task_id in ("enviar_alerta_clear", "limpiar_alerta_abierta"):
            self.assertEqual(self.observer_tasks[task_id]["runIf"],
                "{{ trigger.state == 'SUCCESS' and ((outputs.leer_alerta_abierta.value ?? null) is not null) }}")
        order = list(self.tasks)
        self.assertLess(order.index("guardar_racha_credixsa"), order.index("enviar_alerta_fallo"))
        self.assertLess(order.index("enviar_alerta_fallo"), order.index("marcar_alerta_abierta"))

    def test_retry_transitions_are_confirmed_before_alerting(self):
        confirm = self.tasks
        order = list(confirm)
        # La espera va primero: recien despues se lee si la ejecucion se resolvio.
        self.assertEqual(order[0], "esperar_reintentos")
        self.assertEqual(confirm["esperar_reintentos"]["type"], "io.kestra.plugin.core.flow.Sleep")
        self.assertIn("PT45S", confirm["esperar_reintentos"]["duration"])
        self.assertLess(order.index("leer_ejecucion_resuelta"), order.index("enviar_alerta_fallo"))
        resolved_key = confirm["leer_ejecucion_resuelta"]["key"]
        self.assertIn("inputs.ejecucion", resolved_key)
        self.assertFalse(confirm["leer_ejecucion_resuelta"]["errorOnMissing"])
        for task_id, task in confirm.items():
            if task_id != "esperar_reintentos" and task_id != "leer_ejecucion_resuelta":
                self.assertIn("(outputs.leer_ejecucion_resuelta.value ?? null) is null", task["runIf"])
        self.assertNotIn("triggers", self.flow)
        self.assertEqual(self.flow["concurrency"]["limit"], 1)
        self.assertEqual(self.flow["sla"][0]["duration"], "PT5M")
        for task in self.flow["tasks"]:
            if task["type"] == "io.kestra.plugin.core.http.Request":
                self.assertEqual(task["timeout"], "PT30S")

    def test_observer_only_delegates_failures_and_records_recoveries(self):
        delegate = self.observer_tasks["confirmar_fallo"]
        self.assertEqual(delegate["type"], "io.kestra.plugin.core.flow.Subflow")
        self.assertEqual(delegate["flowId"], self.flow["id"])
        self.assertEqual(delegate["runIf"], "{{ trigger.state == 'FAILED' }}")
        self.assertFalse(delegate["wait"])
        self.assertEqual(delegate["inputs"], {
            "ejecucion": "{{ trigger.executionId }}",
            "namespace_origen": "{{ trigger.namespace }}",
            "flow_origen": "{{ trigger.flowId }}",
        })
        # El observador no manda alertas de fallo: solo recuperaciones.
        mensajes = [task for task in self.observer["tasks"] if task["type"] == "io.kestra.plugin.core.http.Request"]
        self.assertEqual([task["id"] for task in mensajes], ["enviar_alerta_clear"])
        # El SUCCESS del reintento llega con el mismo executionId que su FAILED.
        resolved = self.observer_tasks["marcar_ejecucion_resuelta"]
        self.assertEqual(resolved["runIf"], "{{ trigger.state == 'SUCCESS' }}")
        self.assertIn("trigger.executionId", resolved["key"])
        self.assertEqual(resolved["ttl"], "PT1H")
        self.assertEqual(
            resolved["key"].replace("trigger.executionId", "inputs.ejecucion"),
            self.tasks["leer_ejecucion_resuelta"]["key"],
        )
        self.assertLess(
            list(self.observer_tasks).index("marcar_ejecucion_resuelta"),
            list(self.observer_tasks).index("enviar_alerta_clear"),
        )


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
