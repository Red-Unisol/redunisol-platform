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


class AlertMachine:
    """Execute the deployed reducer; model KV persistence and HTTP acknowledgement."""

    def __init__(self):
        self.tasks = {t["id"]: t for t in load_flow("alerta_flow_fallos_gestionar.yaml")["tasks"]}
        self.states = {}
        self.receipts = {}
        self.open_alerts = set()
        self.messages = []
        self.timers = []

    def event(self, event, execution, *, namespace="redunisol.prod.analisis-credito",
              flow="consulta_quiebra_credix", generation=-1, delivery_ok=True):
        key = (namespace, flow)
        receipt_key = (*key, execution)
        emitted = []
        with patch.dict(os.environ, {
            "FLOW_STATE_JSON": json.dumps(self.states.get(key)),
            "EXECUTION_STATE_JSON": json.dumps(self.receipts.get(receipt_key)),
            "ALERT_OPEN_JSON": json.dumps(key in self.open_alerts),
            "SOURCE_EVENT": event,
            "SOURCE_EXECUTION_ID": execution,
            "SOURCE_NAMESPACE": namespace,
            "SOURCE_FLOW_ID": flow,
            "CONFIRM_GENERATION": str(generation),
        }), patch.dict(sys.modules, {
            "kestra": SimpleNamespace(Kestra=SimpleNamespace(outputs=emitted.append)),
        }):
            exec(self.tasks["evaluar_evento"]["script"], {})
        output, = emitted
        if output["state_changed"]:
            self.states[key] = json.loads(output["flow_state_json"])
        if output["execution_changed"]:
            self.receipts[receipt_key] = json.loads(output["execution_state_json"])
        if output["schedule_confirmation"]:
            self.timers.append((execution, namespace, flow, output["generation"]))
        if delivery_ok and (output["notify_failure"] or output["notify_recovery"]):
            self.messages.append(json.loads(output["notification_json"])["MESSAGE"])
            if output["notify_failure"]:
                self.open_alerts.add(key)
            else:
                self.open_alerts.remove(key)
        return output

    def confirm(self, timer, **kwargs):
        execution, namespace, flow, generation = timer
        return self.event("CONFIRM", execution, namespace=namespace, flow=flow,
                          generation=generation, **kwargs)

    @property
    def streak(self):
        return self.states[("redunisol.prod.analisis-credito", "consulta_quiebra_credix")]["failed_execution_ids"]


class CredixsaAlertStreakTests(unittest.TestCase):
    def setUp(self):
        self.machine = AlertMachine()

    def test_only_third_distinct_confirmed_failure_opens_alert(self):
        for execution in "abc":
            self.machine.event("FAILED", execution)
        self.assertEqual(self.machine.streak, [])
        for index, timer in enumerate(self.machine.timers):
            out = self.machine.confirm(timer)
            self.assertEqual(out["notify_failure"], index == 2)
        self.assertEqual(len(self.machine.messages), 1)
        self.assertIn("Fallos consecutivos: 3 o mas ejecuciones", self.machine.messages[0])
        self.assertIn("\n\nFlow:", self.machine.messages[0])

    def test_success_of_same_execution_invalidates_its_confirmation(self):
        self.machine.event("FAILED", "a", flow="otro")
        self.machine.event("SUCCESS", "a", flow="otro")
        self.machine.confirm(self.machine.timers[0])
        self.assertEqual(self.machine.messages, [])

    def test_success_of_another_execution_invalidates_old_failures(self):
        # Regression: F(a), S(b), F(c), F(d), delayed confirms(a,c,d).
        self.machine.event("FAILED", "a")
        self.machine.event("SUCCESS", "b")
        self.machine.event("FAILED", "c")
        self.machine.event("FAILED", "d")
        for timer in self.machine.timers:
            self.machine.confirm(timer)
        self.assertEqual(self.machine.streak, ["c", "d"])
        self.assertEqual(self.machine.messages, [])
        self.machine.event("FAILED", "e")
        self.assertTrue(self.machine.confirm(self.machine.timers[-1])["notify_failure"])

    def test_success_of_another_execution_also_suppresses_generic_flow_alert(self):
        self.machine.event("FAILED", "a", flow="otro")
        self.machine.event("SUCCESS", "b", flow="otro")
        self.machine.confirm(self.machine.timers[0])
        self.assertEqual(self.machine.messages, [])

    def test_duplicate_failures_and_confirmations_are_idempotent(self):
        for execution in ["a", "a", "b", "a", "b"]:
            self.machine.event("FAILED", execution)
        self.assertEqual(len(self.machine.timers), 2)
        for timer in self.machine.timers * 3:
            self.machine.confirm(timer)
        self.assertEqual(self.machine.streak, ["a", "b"])
        self.assertEqual(self.machine.messages, [])
        self.machine.event("FAILED", "c")
        for _ in range(3):
            self.machine.confirm(self.machine.timers[-1])
        self.assertEqual(len(self.machine.messages), 1)

    def test_duplicate_old_success_does_not_reset_new_streak(self):
        self.machine.event("SUCCESS", "a")
        self.machine.event("FAILED", "b")
        timer = self.machine.timers[-1]
        generation = timer[-1]
        duplicate = self.machine.event("SUCCESS", "a")
        self.assertEqual(duplicate["generation"], generation)
        self.machine.confirm(timer)
        self.assertEqual(self.machine.streak, ["b"])

    def test_replayed_failure_after_success_does_not_create_new_timer(self):
        self.machine.event("SUCCESS", "a")
        self.machine.event("FAILED", "a")
        self.assertEqual(self.machine.timers, [])
        self.assertEqual(self.machine.messages, [])

    def test_both_serial_orders_of_near_simultaneous_success_and_confirmation(self):
        for success_first in (True, False):
            with self.subTest(success_first=success_first):
                machine = AlertMachine()
                machine.event("FAILED", "a", flow="otro")
                timer = machine.timers[0]
                if success_first:
                    machine.event("SUCCESS", "b", flow="otro")
                    machine.confirm(timer)
                    self.assertEqual(machine.messages, [])
                else:
                    machine.confirm(timer)
                    machine.event("SUCCESS", "b", flow="otro")
                    self.assertEqual(len(machine.messages), 2)
                    self.assertIn("Flow fallido", machine.messages[0])
                    self.assertIn("Flow recuperado", machine.messages[1])
                machine.confirm(timer)
                self.assertFalse(machine.open_alerts)
                self.assertEqual(len(machine.messages), 0 if success_first else 2)

    def test_old_confirmation_cannot_erase_or_extend_new_generation(self):
        self.machine.event("FAILED", "a")
        old_timer = self.machine.timers[0]
        self.machine.event("SUCCESS", "b")
        self.machine.event("FAILED", "c")
        self.machine.confirm(self.machine.timers[-1])
        before = dict(self.machine.states)
        self.machine.confirm(old_timer)
        self.assertEqual(self.machine.states, before)
        self.assertEqual(self.machine.streak, ["c"])

    def test_missing_receipt_and_wrong_generation_do_not_alert(self):
        self.machine.event("CONFIRM", "missing", generation=0, flow="otro")
        self.machine.event("FAILED", "a", flow="otro")
        self.machine.event("CONFIRM", "a", generation=99, flow="otro")
        self.assertEqual(self.machine.messages, [])
        self.assertTrue(self.machine.confirm(self.machine.timers[0])["notify_failure"])

    def test_flows_and_namespaces_have_independent_generations(self):
        scopes = [("redunisol.prod.analisis-credito", "consulta_quiebra_credix"),
                  ("redunisol.prod.analisis-credito", "otro"),
                  ("redunisol.prod.otro", "consulta_quiebra_credix")]
        for namespace, flow in scopes:
            self.machine.event("FAILED", "same-id", namespace=namespace, flow=flow)
        self.machine.event("SUCCESS", "success")
        for timer in self.machine.timers:
            self.machine.confirm(timer)
        self.assertEqual(len(self.machine.messages), 2)
        self.assertEqual(self.machine.streak, [])

    def test_persistent_outage_is_bounded_and_does_not_repeat_notification(self):
        for index in range(100):
            self.machine.event("FAILED", str(index))
            self.machine.confirm(self.machine.timers[-1])
            self.assertLessEqual(len(self.machine.streak), 3)
        self.assertEqual(len(self.machine.messages), 1)
        for timer in self.machine.timers:
            self.machine.confirm(timer)
        self.assertEqual(len(self.machine.messages), 1)
        self.machine.event("SUCCESS", "healthy")
        self.assertEqual(len(self.machine.messages), 2)
        self.assertEqual(self.machine.streak, [])

    def test_failed_notification_keeps_streak_and_can_retry_without_recounting(self):
        for execution in "abc":
            self.machine.event("FAILED", execution)
            self.machine.confirm(self.machine.timers[-1], delivery_ok=False)
        self.assertEqual(self.machine.streak, list("abc"))
        self.assertFalse(self.machine.open_alerts)
        self.assertTrue(self.machine.confirm(self.machine.timers[-1])["notify_failure"])
        self.assertEqual(self.machine.streak, list("abc"))
        self.assertEqual(len(self.machine.messages), 1)

    def test_next_distinct_failure_can_retry_failed_notification(self):
        for execution in "abc":
            self.machine.event("FAILED", execution)
            self.machine.confirm(self.machine.timers[-1], delivery_ok=False)
        self.machine.event("FAILED", "d")
        self.assertTrue(self.machine.confirm(self.machine.timers[-1])["notify_failure"])
        self.assertEqual(len(self.machine.messages), 1)

    def test_success_closes_legacy_alert_but_does_not_notify_without_open_alert(self):
        self.machine.event("SUCCESS", "a")
        self.assertEqual(self.machine.messages, [])
        self.machine.open_alerts.add(("redunisol.prod.analisis-credito", "consulta_quiebra_credix"))
        self.machine.event("SUCCESS", "b")
        self.machine.event("SUCCESS", "b")
        self.assertEqual(len(self.machine.messages), 1)
        self.assertIn("Flow recuperado", self.machine.messages[0])

    def test_invalid_or_nonproduction_events_fail_before_changing_state(self):
        for kwargs in [{"event": "RUNNING"}, {"event": "FAILED", "namespace": "redunisol.dev.test"},
                       {"event": "FAILED", "namespace": "redunisol.prod.system"}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.machine.event(execution="x", **kwargs)
        self.assertEqual(self.machine.states, {})
        self.assertEqual(self.machine.messages, [])


class AlertFlowWiringTests(unittest.TestCase):
    def setUp(self):
        self.observer = load_flow("alerta_flow_fallos.yaml")
        self.timer = load_flow("alerta_flow_fallos_confirmar.yaml")
        self.manager = load_flow("alerta_flow_fallos_gestionar.yaml")
        self.tasks = {t["id"]: t for t in self.manager["tasks"]}

    def test_only_manager_writes_state_or_notifies_and_does_not_sleep(self):
        self.assertEqual(self.manager["concurrency"], {"limit": 1, "behavior": "QUEUE"})
        for flow in (self.observer, self.timer):
            for task in flow["tasks"]:
                self.assertNotIn(task["type"], ["io.kestra.plugin.core.kv.Set", "io.kestra.plugin.core.kv.Delete", "io.kestra.plugin.core.http.Request"])
        self.assertNotIn("triggers", self.manager)
        for task in self.manager["tasks"]:
            self.assertNotIn(task["type"], ["io.kestra.plugin.core.flow.Sleep", "io.kestra.plugin.core.flow.Subflow"])
        order = list(self.tasks)
        for task in ("guardar_estado_flow", "guardar_estado_ejecucion"):
            self.assertLess(order.index(task), order.index("enviar_notificacion"))
        for task in ("marcar_alerta_abierta", "limpiar_alerta_abierta"):
            self.assertLess(order.index("enviar_notificacion"), order.index(task))

    def test_parallel_timers_and_serial_original_events_have_no_subflow_cycle(self):
        self.assertNotIn("concurrency", self.timer)
        self.assertNotIn("triggers", self.timer)
        sleep, confirm = self.timer["tasks"]
        self.assertEqual(sleep["type"], "io.kestra.plugin.core.flow.Sleep")
        self.assertIn("PT45S", sleep["duration"])
        register, schedule = self.observer["tasks"]
        self.assertTrue(register["wait"])
        self.assertTrue(register["transmitFailed"])
        self.assertEqual(register["flowId"], self.manager["id"])
        self.assertEqual(register["inputs"]["evento"], "{{ trigger.state }}")
        self.assertEqual(schedule["flowId"], self.timer["id"])
        self.assertFalse(schedule["wait"])
        self.assertEqual(schedule["runIf"], "{{ outputs.registrar_evento.outputs.programar_confirmacion }}")
        self.assertEqual(schedule["inputs"]["generacion"], "{{ outputs.registrar_evento.outputs.generacion }}")
        self.assertEqual(confirm["flowId"], self.manager["id"])
        self.assertTrue(confirm["wait"])
        self.assertEqual(confirm["inputs"]["evento"], "CONFIRM")
        self.assertEqual(confirm["inputs"]["generacion"], "{{ inputs.generacion }}")
        for output in self.manager["outputs"]:
            self.assertIn(output["id"], ("programar_confirmacion", "generacion"))
        self.assertEqual(self.manager["outputs"][0]["type"], "BOOL")
        for flow in (self.observer, self.timer, self.manager):
            self.assertEqual(flow["sla"][0]["duration"], "PT5M")

    def test_kv_keys_guards_and_notification_acknowledgement_match_reducer(self):
        for suffix in ("flow", "ejecucion"):
            read, write = self.tasks["leer_estado_" + suffix], self.tasks["guardar_estado_" + suffix]
            self.assertEqual(read["key"], write["key"])
            self.assertIn("inputs.namespace_origen", write["key"])
            self.assertIn("inputs.flow_origen", write["key"])
            self.assertEqual(write["kvType"], "JSON")
            self.assertFalse(read["errorOnMissing"])
        self.assertNotIn("ttl", self.tasks["guardar_estado_flow"])
        self.assertIn("inputs.ejecucion", self.tasks["guardar_estado_ejecucion"]["key"])
        self.assertEqual(self.tasks["guardar_estado_ejecucion"]["ttl"], "P30D")
        self.assertEqual(self.tasks["guardar_estado_flow"]["runIf"], "{{ outputs.evaluar_evento.vars.state_changed }}")
        self.assertEqual(self.tasks["guardar_estado_ejecucion"]["runIf"], "{{ outputs.evaluar_evento.vars.execution_changed }}")
        self.assertEqual(self.tasks["enviar_notificacion"]["runIf"], "{{ outputs.evaluar_evento.vars.notify_failure or outputs.evaluar_evento.vars.notify_recovery }}")
        self.assertEqual(self.tasks["enviar_notificacion"]["timeout"], "PT30S")
        self.assertEqual(self.tasks["enviar_notificacion"]["body"], "{{ outputs.evaluar_evento.vars.notification_json }}")
        for task, flag in [("marcar_alerta_abierta", "notify_failure"), ("limpiar_alerta_abierta", "notify_recovery")]:
            self.assertEqual(self.tasks[task]["runIf"], "{{ outputs.evaluar_evento.vars." + flag + " }}")
            self.assertEqual(self.tasks[task]["key"], self.tasks["leer_alerta_abierta"]["key"])
        self.assertEqual(self.tasks["marcar_alerta_abierta"]["ttl"], "P30D")


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
