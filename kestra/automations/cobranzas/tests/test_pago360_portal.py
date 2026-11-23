"""Portal API wire tests with doubles; no deployment, provider or financial writes."""
from decimal import Decimal
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "files"))
from pago360.portal import PortalClient, PortalError, normalize_operation
from pago360_cuotas.domain import ContractError

OP = "10000000-0000-4000-8000-000000000001"
ITEM = "20000000-0000-4000-8000-000000000001"
TOKEN = "30000000-0000-4000-8000-000000000001"
ATTEMPT = "40000000-0000-4000-8000-000000000001"
BASE = "https://portal.test/functions/v1/kestra-imputaciones/v1"


def snapshot():
    return {
        "operacion": {"id": OP, "tipo_operacion": "cuotas_vencidas", "imputacion_manual": False,
                      "ambiente": "live", "proveedor_ref": "816", "monto_total": "1500.00"},
        "cuotas": [{"pago_cuota_id": ITEM, "cuota_prestamo_id": "700", "prestamo_id": "900",
                    "nro_cuenta": "12345", "nro_cuota": "3", "fecha_vencimiento": "2026-10-01",
                    "importe": "1500.00", "estado": "pendiente"}],
    }


class PortalTests(unittest.TestCase):
    def setUp(self):
        patcher = patch("pago360.portal.requests.request")
        self.request = patcher.start()
        self.addCleanup(patcher.stop)
        self.client = PortalClient(BASE, "x" * 40)
        self.respond({"version": 1})

    def respond(self, data, status=200):
        self.request.return_value = Mock(status_code=status, text=json.dumps(data))

    def test_read_preserves_decimal_precision_and_does_not_claim(self):
        data = snapshot()
        data["operacion"]["monto_total"] = 1500.01
        self.respond({"version": 1, "snapshot": data})
        result = self.client.snapshot(OP)
        self.assertEqual(result["operacion"]["monto_total"], Decimal("1500.01"))
        self.request.assert_called_once()
        args, kwargs = self.request.call_args
        self.assertEqual(args, ("GET", BASE + "/trabajos/" + OP))
        self.assertIsNone(kwargs["json"])
        self.assertFalse(kwargs["allow_redirects"])
        self.assertTrue(kwargs["verify"])

    def test_wrong_operation_or_version_does_not_pass_as_a_snapshot(self):
        for data in ({"version": 2}, {"version": 1},
                     {"version": 1, "snapshot": {"operacion": {"id": ITEM}}}):
            self.respond(data)
            with self.assertRaises(PortalError):
                self.client.snapshot(OP)

    def test_wire_normalization_distinguishes_loan_id_account_and_item_uuid(self):
        op = normalize_operation(snapshot())
        self.assertEqual(op.environment, "production")
        self.assertEqual(op.total_cents, 150000)
        self.assertEqual(op.installments[0].loan_id, "900")
        self.assertEqual(op.installments[0].installment_id, "700")
        self.assertNotEqual(op.installments[0].loan_id, "12345")

    def test_historical_without_real_installment_ids_is_not_silently_reconstructed(self):
        for field, value in (("cuota_prestamo_id", None), ("importe", "1500.001"),
                             ("nro_cuota", "3 OR 1=1")):
            data = snapshot()
            data["cuotas"][0][field] = value
            with self.assertRaises(ContractError):
                normalize_operation(data)

    def test_manual_and_other_operation_kinds_do_not_enter_automatic_processing(self):
        for field, value in (("imputacion_manual", True), ("imputacion_manual", None),
                             ("tipo_operacion", "cancelacion_anticipada"), ("ambiente", "unknown")):
            data = snapshot()
            data["operacion"][field] = value
            with self.assertRaises(ContractError):
                normalize_operation(data)

    def test_claim_and_begin_use_different_ids_and_fencing(self):
        self.client.claim(OP, "execution-real-id")
        self.assertEqual(self.request.call_args.kwargs["json"],
                         {"executor_id": "execution-real-id", "lease_segundos": 300})
        self.client.begin(OP, ITEM, TOKEN, 7)
        self.assertEqual(self.request.call_args.args[1], BASE + f"/trabajos/{OP}/cuotas/{ITEM}/begin")
        self.assertEqual(self.request.call_args.kwargs["json"], {"token": TOKEN, "fencing": 7})

    def test_release_is_the_pending_path_finish_is_terminal_only(self):
        with self.assertRaises(ContractError):
            self.client.finish(OP, "pendiente", TOKEN, 7)
        self.request.assert_not_called()
        self.client.release(OP, TOKEN, 7, "consulta_deuda_fallida")
        self.assertTrue(self.request.call_args.args[1].endswith("/release"))
        self.client.finish(OP, "a_conciliar", TOKEN, 7, "deuda_distinta")
        self.assertEqual(self.request.call_args.kwargs["json"]["estado"], "a_conciliar")

    def test_verified_requires_an_explicit_proof_not_automatic_snapshot_copy(self):
        with self.assertRaises(ContractError):
            self.client.record(OP, ATTEMPT, "verified", TOKEN, 7)
        self.request.assert_not_called()
        proof = {"cuota_prestamo_id": "700", "importe": "1500.00", "referencia": "123456"}
        self.client.record(OP, ATTEMPT, "verified", TOKEN, 7, proof=proof)
        self.assertEqual(self.request.call_args.kwargs["json"]["verificacion"], proof)
        self.assertNotIn("recibo", self.request.call_args.kwargs["json"])

    def test_receipts_reject_numeric_or_inexact_amounts(self):
        for amount in (1500, "1500", "1500.001"):
            with self.assertRaises(ContractError):
                self.client.record(OP, ATTEMPT, "received", TOKEN, 7,
                                   proof={"cuota_prestamo_id": "700", "importe": amount, "referencia": "123"})
        self.request.assert_not_called()

    def test_claim_conflicts_preserve_portal_business_codes(self):
        for result, status in (("ocupado", 409), ("terminal", 409), ("no_existe", 404)):
            self.respond({"version": 1, "resultado": result}, status)
            with self.assertRaises(PortalError) as error:
                self.client.claim(OP, "exec")
            self.assertEqual(error.exception.code, result)
            self.assertFalse(error.exception.uncertain)

    def test_write_timeouts_are_uncertain_and_not_retried(self):
        import requests
        self.request.side_effect = requests.Timeout("private token in exception")
        with self.assertRaises(PortalError) as error:
            self.client.begin(OP, ITEM, TOKEN, 7)
        self.assertTrue(error.exception.uncertain)
        self.assertNotIn("private", str(error.exception))
        self.request.assert_called_once()

    def test_bad_and_redirected_responses_are_not_success_or_secret_leaks(self):
        for status, body in ((302, "private redirect"), (500, '{"error":"private secret"}'),
                             (200, '{"error":[]}')):
            self.request.return_value = Mock(status_code=status, text=body)
            with self.assertRaises(PortalError) as error:
                self.client.claim(OP, "exec")
            self.assertTrue(error.exception.uncertain)
            self.assertNotIn("private", str(error.exception))

    def test_base_credentials_path_injection_and_boolean_fencing_rejected_before_request(self):
        for url in ("http://portal.test/functions/v1/kestra-imputaciones/v1", BASE + "?secret=x",
                    "https://user:secret@portal.test/functions/v1/kestra-imputaciones/v1",
                    "https://portal.test/functions/v1/another/v1"):
            with self.assertRaises(ContractError):
                PortalClient(url, "x" * 40)
        with self.assertRaises(ContractError):
            self.client.snapshot("../../secret")
        with self.assertRaises(ContractError):
            self.client.begin(OP, ITEM, TOKEN, True)
        self.request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
