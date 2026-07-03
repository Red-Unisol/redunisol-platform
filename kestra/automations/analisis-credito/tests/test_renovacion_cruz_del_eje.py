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


class RenovacionCruzDelEjeTests(unittest.TestCase):
    def test_flow_uses_inputs_when_trigger_body_is_not_available(self) -> None:
        flow_source = (
            Path(__file__).resolve().parent.parent
            / "flows"
            / "renovacion_cruz_del_eje.yaml"
        ).read_text(encoding="utf-8")

        self.assertIn("trigger is defined and trigger.body is defined", flow_source)
        self.assertIn("{'cuil': inputs.cuil ?? ''} | json", flow_source)

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
