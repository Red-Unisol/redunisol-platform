from copy import deepcopy
from pathlib import Path
import sys
from concurrent.futures import ThreadPoolExecutor
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "files"))
from pago360.worker import Executor, UnverifiedVimarx, Reconcile


class MemoryPortal:
    # HTTP/SQL boundaries are tested against real PostgreSQL in the portal PR.
    def __init__(self):
        from threading import Lock
        self.lock = Lock()
        self.state = "pendiente"
        self.token = 0
        self.fail = None
        self.items = [{"cuota_id": str(n), "prestamo_id": "900000001", "nro_cuota": str(n),
                       "saldo": "100.00", "estado": "pendiente"} for n in [1, 2]]
        self.actions = []

    def call(self, action, operation_id=None, token=None, quota_id=None, data=None):
        with self.lock:
            self.actions.append(action)
            if self.fail == action:
                self.fail = None
                raise RuntimeError("synthetic portal failure")
            if action == "tomar":
                if self.state not in ["pendiente"]:
                    return {"resultado": "occupied"}
                if any(i["estado"] == "escribiendo" for i in self.items):
                    self.state = "conciliacion"
                    return {"resultado": "conciliacion"}
                self.state = "procesando"
                self.token += 1
            else:
                if token != self.token or self.state != "procesando":
                    raise RuntimeError("fenced")
                item = next((i for i in self.items if i["cuota_id"] == quota_id), None)
                if action == "iniciar":
                    assert item["estado"] == "pendiente"
                    item.update(estado="escribiendo", intencion=data)
                elif action == "respuesta":
                    item.update(estado="respondido", respuesta=data)
                elif action == "confirmar":
                    item.update(estado="confirmado", evidencia=data)
                elif action == "conciliar":
                    self.state = "conciliacion"
                elif action == "liberar":
                    self.state = "pendiente"
                elif action == "finalizar":
                    assert all(i["estado"] == "confirmado" for i in self.items)
                    self.state = "aplicado"
            return {"resultado": "ok", "token": self.token, "estado": self.state,
                    "cuotas": deepcopy(self.items), "total": 200, "proveedorRef": "123"}


class FakeVimarx:
    enabled = True
    def __init__(self, portal):
        self.portal = portal
        self.writes = []
        self.bad_debt = False
        self.timeout_on = None
        self.verify_failure = False
        self.wrong_link = False

    def inspect(self, item):
        return {"prestamoId": item["prestamo_id"], "nroCuota": item["nro_cuota"],
                "idCuota": str(99000000 + int(item["cuota_id"])), "vencida": True,
                "pagada": self.bad_debt, "saldo": 0 if self.bad_debt else 100}

    def write(self, intent):
        assert self.portal.items[int(intent["nroCuota"]) - 1]["estado"] == "escribiendo"
        self.writes.append(intent)
        if intent["nroCuota"] == self.timeout_on:
            raise TimeoutError("possibly committed")
        return {"cobroId": str(700 + int(intent["nroCuota"])), "importe": 100}

    def verify(self, intent, response):
        if self.verify_failure:
            self.verify_failure = False
            raise TimeoutError("read failure")
        return {"operacionId": "another" if self.wrong_link else intent["operacionId"],
                "idCuota": intent["idCuota"], "cobroId": response["cobroId"],
                "importe": 100, "saldo": 0, "vinculoVerificado": True}


class ExecutorTests(unittest.TestCase):
    def setUp(self):
        self.portal = MemoryPortal()
        self.vimarx = FakeVimarx(self.portal)
        self.executor = Executor(self.portal, self.vimarx)

    def test_default_gateway_cannot_write_or_claim(self):
        self.assertEqual(Executor(self.portal, UnverifiedVimarx()).process("op"), "writes_disabled")
        self.assertEqual(self.portal.actions, [])

    def test_duplicate_event_and_concurrent_workers_only_write_once(self):
        with ThreadPoolExecutor(max_workers=5) as pool:
            results = list(pool.map(self.executor.process, ["op"] * 5))
        self.assertEqual(results.count("aplicado"), 1)
        self.assertEqual(len(self.vimarx.writes), 2)
        self.assertEqual(self.portal.state, "aplicado")
        self.executor.process("op")
        self.assertEqual(len(self.vimarx.writes), 2)

    def test_paid_by_another_method_goes_to_reconciliation(self):
        self.vimarx.bad_debt = True
        self.assertEqual(self.executor.process("op"), "conciliacion")
        self.assertEqual(self.vimarx.writes, [])

    def test_changed_amount_never_writes(self):
        self.portal.items[0]["saldo"] = "99.00"
        self.assertEqual(self.executor.process("op"), "conciliacion")
        self.assertEqual(self.vimarx.writes, [])

    def test_partial_success_and_timeout_preserve_confirmed_quota(self):
        self.vimarx.timeout_on = "2"
        self.assertEqual(self.executor.process("op"), "conciliacion")
        self.assertEqual(self.portal.items[0]["estado"], "confirmado")
        self.executor.process("op")
        self.assertEqual(len(self.vimarx.writes), 2)

    def test_failed_portal_response_persistence_leaves_intent_uncertain(self):
        self.portal.fail = "respuesta"
        with self.assertRaises(RuntimeError): self.executor.process("op")
        self.portal.state = "pendiente"  # expiry
        self.assertEqual(self.executor.process("op"), "conciliacion")
        self.assertEqual(len(self.vimarx.writes), 1)

    def test_failed_portal_confirmation_recovers_response_without_rewrite(self):
        self.portal.fail = "confirmar"
        with self.assertRaises(RuntimeError): self.executor.process("op")
        self.portal.state = "pendiente"  # expiry
        self.assertEqual(self.executor.process("op"), "aplicado")
        self.assertEqual(len(self.vimarx.writes), 2)

    def test_post_write_read_failure_recovers_only_verification(self):
        self.vimarx.verify_failure = True
        with self.assertRaises(TimeoutError): self.executor.process("op")
        self.assertEqual(self.executor.process("op"), "aplicado")
        self.assertEqual(len(self.vimarx.writes), 2)

    def test_zero_balance_without_operation_link_is_insufficient(self):
        self.vimarx.wrong_link = True
        self.assertEqual(self.executor.process("op"), "conciliacion")
        self.assertEqual(len(self.vimarx.writes), 1)

    def test_both_flows_and_triggers_ship_disabled(self):
        import yaml
        root = Path(__file__).resolve().parents[1]
        for file in ["pago360_imputar.yaml", "pago360_recuperar.yaml"]:
            flow = yaml.safe_load((root / "flows" / file).read_text())
            self.assertIs(flow["disabled"], True)
            self.assertTrue(all(t["disabled"] is True for t in flow["triggers"]))


if __name__ == "__main__":
    unittest.main()
