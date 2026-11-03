from __future__ import annotations

import datetime as dt
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

FILES_ROOT = Path(__file__).resolve().parent.parent / "files"
if str(FILES_ROOT) not in sys.path:
    sys.path.insert(0, str(FILES_ROOT))

from analisis_credito_renovacion.renovacion import compute_metrics  # noqa: E402
from analisis_credito_renovacion import kestra_webhook_entrypoint as entrypoint  # noqa: E402
from analisis_credito_renovacion import renovacion  # noqa: E402


class NovemberDate(dt.date):
    @classmethod
    def today(cls):
        return cls(2026, 11, 1)


class RenovacionCruzDelEjeTests(unittest.TestCase):
    def loan_rows(self, loan_id=1, state=0, line="CRUZ DEL EJE especial"):
        return [
            {
                "Prestamo.ID": loan_id,
                "Prestamo.Cuenta.Estado": state,
                "Prestamo.Cuotas": 12,
                "Prestamo.LineaPrestamo.Descripcion": line,
                "NroCuota": number,
                "Fecha": due,
                "FechaCobro": paid,
                "SaldoCuota": balance,
                "Capital": capital,
            }
            for number, due, paid, balance, capital in [
                (6, "2026-11-10", "2026-11-02", 0.0, 1000.0),
                (7, "2026-12-10", None, 1300.0, 1000.0),
                (8, "2027-01-10", None, 2600.0, 2000.0),
            ]
        ]

    def evaluate_rows(self, rows):
        with (
            patch.object(renovacion, "fetch_cuotas_por_cuil", return_value=rows),
            patch.object(renovacion.dt, "date", NovemberDate),
        ):
            return renovacion.evaluar_socio("20123456786")

    def test_cancelled_loan_does_not_block_active_loan_or_add_debt(self):
        cancelled = self.loan_rows(loan_id=2, state=1)
        cancelled[0].update(Fecha="2026-01-10", FechaCobro=None, SaldoCuota=5000.0)
        result = self.evaluate_rows(self.loan_rows() + cancelled)

        self.assertTrue(result["puede_renovar"])
        self.assertEqual(result["saldo_renovacion"], 3000.0)

    def test_two_active_loans_still_block_renewal(self):
        result = self.evaluate_rows(self.loan_rows() + self.loan_rows(loan_id=2))

        self.assertFalse(result["puede_renovar"])
        self.assertEqual(result["motivo"], "tiene_mas_de_un_prestamo")

    def test_only_inactive_or_missing_account_state_is_not_eligible(self):
        for state in (1, 2, None):
            with self.subTest(state=state):
                result = self.evaluate_rows(self.loan_rows(state=state))
                self.assertFalse(result["puede_renovar"])
                self.assertEqual(result["motivo"], "no_tiene_prestamo_cruz_del_eje")

    def test_all_lines_use_future_capital_without_surcharge(self):
        for line in renovacion.LINEAS_PRESTAMO:
            with self.subTest(line=line):
                result = self.evaluate_rows(self.loan_rows(line=line))
                self.assertTrue(result["puede_renovar"])
                self.assertEqual(result["saldo_renovacion"], 3000.0)

    def test_halfway_installment_counts_from_start_of_due_month_without_payment(self):
        rows = self.loan_rows()
        rows[0].update(Fecha="2026-11-30", FechaCobro=None, SaldoCuota=1300.0)

        result = self.evaluate_rows(rows)

        self.assertTrue(result["puede_renovar"])
        self.assertEqual(result["saldo_renovacion"], 3000.0)

    def test_halfway_installment_in_next_month_does_not_count_even_if_paid(self):
        rows = self.loan_rows()
        rows[0].update(Fecha="2026-12-01", FechaCobro="2026-10-31")

        result = self.evaluate_rows(rows)

        self.assertFalse(result["puede_renovar"])
        self.assertEqual(result["motivo"], "menos_del_50_por_ciento")

    def test_previous_month_unallocated_payment_does_not_block(self):
        rows = self.loan_rows()
        rows[0].update(FechaCobro=None, SaldoCuota=1300.0)
        previous = dict(rows[0], NroCuota=5, Fecha="2026-10-01")

        result = self.evaluate_rows(rows + [previous])

        self.assertTrue(result["puede_renovar"])

    def test_debt_cutoff_includes_two_months_ago_and_keeps_per_installment_tolerance(self):
        for balance, eligible in [(100.0, True), (100.01, False)]:
            with self.subTest(balance=balance):
                rows = self.loan_rows()
                overdue = dict(
                    rows[0], NroCuota=4, Fecha="2026-09-30",
                    FechaCobro=None, SaldoCuota=balance,
                )
                result = self.evaluate_rows(rows + [overdue])
                self.assertEqual(result["puede_renovar"], eligible)
                if not eligible:
                    self.assertEqual(result["motivo"], "tiene_deuda")
                    self.assertEqual(result["saldo_renovacion"], 0.0)

    def test_odd_plan_rounds_halfway_installment_up(self):
        for number, eligible in [(7, False), (8, True)]:
            with self.subTest(number=number):
                rows = self.loan_rows()
                rows[0].update(NroCuota=number, FechaCobro=None)
                rows[1]["NroCuota"] = number + 1
                rows[2]["NroCuota"] = number + 2
                for row in rows:
                    row["Prestamo.Cuotas"] = 15
                result = self.evaluate_rows(rows)
                self.assertEqual(result["puede_renovar"], eligible)

    def test_month_boundaries_across_new_year(self):
        today = dt.date(2027, 1, 1)
        cutoff = renovacion.month_end_months_ago(today, 2)
        self.assertEqual(cutoff, dt.date(2026, 11, 30))
        metrics = compute_metrics(
            [
                {"NroCuota": 5, "Fecha": "2026-12-01", "SaldoCuota": 1300.0},
                {"NroCuota": 6, "Fecha": "2027-01-31", "SaldoCuota": 1300.0},
                {"NroCuota": 7, "Fecha": "2027-02-01", "FechaCobro": "2026-12-31"},
            ],
            hoy=today,
            corte_deuda=cutoff,
        )
        self.assertFalse(metrics["tiene_impagas"])
        self.assertEqual(metrics["max_nro_cuota_al_mes"], 6)

    def test_flow_uses_inputs_when_trigger_body_is_not_available(self) -> None:
        flow_source = (
            Path(__file__).resolve().parent.parent
            / "flows"
            / "renovacion_cruz_del_eje.yaml"
        ).read_text(encoding="utf-8")

        self.assertIn("trigger is defined and trigger.body is defined", flow_source)
        self.assertIn("{'cuil': inputs.cuil ?? ''} | toJson", flow_source)

    def test_compute_metrics_ignores_debt_up_to_one_hundred_pesos(self) -> None:
        metricas = compute_metrics(
            [
                {
                    "NroCuota": 3,
                    "Fecha": "2026-03-15",
                    "FechaCobro": None,
                    "SaldoCuota": 100.0,
                    "Capital": 0.0,
                    "CuentaEstado": 0,
                }
            ],
            hoy=dt.date(2026, 5, 26),
            corte_deuda=dt.date(2026, 3, 31),
        )

        self.assertFalse(metricas["tiene_impagas"])

    def test_compute_metrics_marks_debt_above_one_hundred_pesos(self) -> None:
        metricas = compute_metrics(
            [
                {
                    "NroCuota": 3,
                    "Fecha": "2026-03-15",
                    "FechaCobro": None,
                    "SaldoCuota": 100.01,
                    "Capital": 0.0,
                    "CuentaEstado": 0,
                }
            ],
            hoy=dt.date(2026, 5, 26),
            corte_deuda=dt.date(2026, 3, 31),
        )

        self.assertTrue(metricas["tiene_impagas"])

    def test_entrypoint_returns_success_for_invalid_request(self) -> None:
        with (
            patch.object(
                entrypoint,
                "_load_trigger_body",
                side_effect=entrypoint.InvalidRequestError("Missing request body."),
            ),
            patch.object(entrypoint, "_emit_outputs_if_available") as emit_outputs,
            patch.object(entrypoint, "_log_event"),
            patch("sys.stdout.write"),
        ):
            exit_code = entrypoint.main()

        self.assertEqual(exit_code, 0)
        self.assertEqual(emit_outputs.call_args.args[0], False)
        self.assertEqual(emit_outputs.call_args.args[1], "invalid_request")

    def test_entrypoint_returns_failed_for_technical_error(self) -> None:
        with (
            patch.object(entrypoint, "_load_trigger_body", return_value={"cuil": "20-12345678-3"}),
            patch.object(entrypoint, "normalize_cuil", return_value="20123456783"),
            patch.object(entrypoint, "validar_dv_cuil", return_value=True),
            patch.object(
                entrypoint,
                "evaluar_socio",
                side_effect=TimeoutError("Vimarx timeout."),
            ),
            patch.object(entrypoint, "_emit_outputs_if_available") as emit_outputs,
            patch.object(entrypoint, "_log_event"),
            patch("sys.stdout.write"),
        ):
            exit_code = entrypoint.main()

        self.assertEqual(exit_code, 1)
        self.assertEqual(emit_outputs.call_args.args[0], False)
        self.assertEqual(emit_outputs.call_args.args[1], "technical_error")


if __name__ == "__main__":
    unittest.main()
