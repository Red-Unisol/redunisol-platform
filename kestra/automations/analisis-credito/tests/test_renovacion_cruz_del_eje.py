from __future__ import annotations

import datetime as dt
from pathlib import Path
import sys
import unittest

FILES_ROOT = Path(__file__).resolve().parent.parent / "files"
if str(FILES_ROOT) not in sys.path:
    sys.path.insert(0, str(FILES_ROOT))

from analisis_credito_renovacion.renovacion import compute_metrics  # noqa: E402


class RenovacionCruzDelEjeTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
