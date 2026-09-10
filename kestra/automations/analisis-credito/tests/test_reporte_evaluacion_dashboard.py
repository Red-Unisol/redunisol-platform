from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

FILES_ROOT = Path(__file__).resolve().parent.parent / "files"
if str(FILES_ROOT) not in sys.path:
    sys.path.insert(0, str(FILES_ROOT))

from reporte_evaluacion_dashboard.generate_snapshot import (  # noqa: E402
    NovedadEvent,
    compute_first_response_minutes,
    main, metric_payload, classify_state, compute_transfer_minutes,
)
from reporte_evaluacion_comisiones.core import evaluate_commissions


def make_event(
    *,
    event_id: int,
    solicitud_oid: int,
    linea: str,
    state: str,
    created_at: datetime,
) -> NovedadEvent:
    return NovedadEvent(
        event_id=event_id,
        fecha=created_at.date().isoformat(),
        texto=f"[{state}]",
        creado_descripcion=created_at.strftime("%d/%m/%y %H:%M:%S"),
        solicitud_oid=solicitud_oid,
        solicitud_socio_nro_raw=solicitud_oid,
        solicitud_nro_socio_raw=solicitud_oid,
        linea_descripcion=linea,
        solicitud_estado_descripcion="Pagada",
        created_at=created_at,
        parsed_state=state,
        nro_socio=solicitud_oid,
    )


class ReporteEvaluacionDashboardTests(unittest.TestCase):
    def test_first_response_excludes_configured_lines(self) -> None:
        events = [
            make_event(
                event_id=1,
                solicitud_oid=100,
                linea="MUNIC. CARLOS PAZ 1-6  (2204)",
                state="RevisionRiesgo",
                created_at=datetime(2026, 6, 1, 9, 0, 0),
            ),
            make_event(
                event_id=2,
                solicitud_oid=100,
                linea="MUNIC. CARLOS PAZ 1-6  (2204)",
                state="Confirmada",
                created_at=datetime(2026, 6, 1, 10, 0, 0),
            ),
            make_event(
                event_id=3,
                solicitud_oid=200,
                linea="LINEA MEDICA ESPECIAL",
                state="RevisionRiesgo",
                created_at=datetime(2026, 6, 1, 9, 0, 0),
            ),
            make_event(
                event_id=4,
                solicitud_oid=200,
                linea="LINEA MEDICA ESPECIAL",
                state="Confirmada",
                created_at=datetime(2026, 6, 1, 9, 15, 0),
            ),
            make_event(
                event_id=5,
                solicitud_oid=300,
                linea="PROPIA RECURRENTE CBU",
                state="RevisionRiesgo",
                created_at=datetime(2026, 6, 1, 9, 0, 0),
            ),
            make_event(
                event_id=6,
                solicitud_oid=300,
                linea="PROPIA RECURRENTE CBU",
                state="Confirmada",
                created_at=datetime(2026, 6, 1, 9, 30, 0),
            ),
        ]

        self.assertEqual(compute_first_response_minutes(events), [15.0, 30.0])

    def test_target_weights_months_equally_and_requires_all_three(self):
        metric = metric_payload(metric_id="first_response", name="Respuesta", current_values=[25],
                                target_month_values=[[10] * 100, [20], [60]])
        self.assertEqual(metric["objetivo_min"], 30)
        self.assertEqual(metric["casos_objetivo"], 102)
        self.assertEqual(metric["estado"], "verde")
        missing = metric_payload(metric_id="transfer", name="Transferencia", current_values=[25],
                                 target_month_values=[[10], [], [60]])
        self.assertIsNone(missing["objetivo_min"])
        self.assertEqual(missing["estado"], "neutral")
        self.assertIsNone(missing["mediana"]["objetivo_min"])
        self.assertEqual(missing["mediana"]["estado"], "neutral")

    def test_median_uses_all_cases_and_mean_of_three_monthly_medians(self):
        for category in ("first_response", "transfer"):
            with self.subTest(category=category):
                metric = metric_payload(metric_id=category, name=category,
                                        current_values=[1, 2, 3, 100],
                                        target_month_values=[[1] * 100 + [1000], [20, 40], [59]])
                self.assertEqual(metric["actual_min"], 26.5)
                self.assertEqual(metric["mediana"]["actual_min"], 2.5)
                # (1 + 30 + 59) / 3; neither pooled median nor weighted by cases.
                self.assertEqual(metric["mediana"]["objetivo_min"], 30)
                self.assertEqual(metric["mediana"]["estado"], "verde")
                self.assertEqual(metric["casos"], 4)

    def test_median_missing_zero_and_thresholds_match_commissions(self):
        for current, history, expected in [
            ([], [[100], [100], [100]], "neutral"),
            ([0], [[0], [0], [0]], "neutral"),
            ([0], [[100], [100], [100]], "verde"),
            ([100], [[100], [100], [100]], "verde"),
            ([100.00001], [[100], [100], [100]], "amarillo"),
            ([110], [[100], [100], [100]], "amarillo"),
            ([110.00001], [[100], [100], [100]], "rojo"),
        ]:
            with self.subTest(current=current, history=history):
                metric = metric_payload(metric_id="transfer", name="Transferencia",
                                        current_values=current, target_month_values=history)
                self.assertEqual(metric["mediana"]["estado"], expected)
                if not current:
                    self.assertIsNone(metric["mediana"]["actual_min"])
                if expected == "neutral":
                    self.assertIsNone(metric["mediana"]["delta_pct"])

    def test_both_statistics_match_commission_evaluation(self):
        months = ("2026-06", "2026-07", "2026-08", "2026-09")
        samples = ([1, 5, 300], [8], [1, 2, 3, 30], [2, 5, 8, 200])
        # Explicit expected statistics also exercise skew and even sample sizes.
        means, medians = (102, 8, 9, 53.75), (5, 8, 2.5, 6.5)
        reports = [SimpleNamespace(month_value=month, summary={
            group: {"promedio_minutos": mean, "mediana_minutos": median}
            for group in ("first_response", "transfer")
        }) for month, mean, median in zip(months, means, medians)]
        commissions = evaluate_commissions(reports, {months[-1]: []}, [months[-1]])
        for group in ("first_response", "transfer"):
            metric = metric_payload(metric_id=group, name=group, current_values=samples[-1],
                                    target_month_values=samples[:-1])
            for statistic, payload in (("promedio_minutos", metric), ("mediana_minutos", metric["mediana"])):
                commission = next(row for row in commissions if row["group"] == group and row["statistic"] == statistic)
                self.assertEqual(Decimal(str(payload["actual_min"])), commission["result"])
                self.assertEqual(payload["objetivo_min"], float(commission["reference"]))
                self.assertEqual(payload["estado"], {Decimal("0.005"): "verde", Decimal("0.003"): "amarillo", Decimal("0.001"): "rojo"}[commission["rate"]])

    def test_thresholds_match_commissions(self):
        for actual, expected in [(100, "verde"), (100.01, "amarillo"), (110, "amarillo"), (110.01, "rojo")]:
            self.assertEqual(classify_state(actual, 100), expected)
        self.assertEqual(classify_state(0, 0), "neutral")
        self.assertEqual(classify_state(None, 10), "neutral")

    def test_holidays_and_confirmed_closure_only_deduct_first_response(self):
        for start, end, response_minutes, transfer_minutes in [
            (datetime(2026, 7, 8, 16), datetime(2026, 7, 10, 9), 60, 120),
            (datetime(2026, 7, 10, 8), datetime(2026, 7, 10, 9), 0, 60),
            (datetime(2026, 7, 8, 16), datetime(2026, 7, 13, 9), 120, 660),
            # Jueves Santo remains a working day; no confirmed evaluation closure.
            (datetime(2026, 4, 2, 8), datetime(2026, 4, 2, 9), 0, 0),
            (datetime(2025, 4, 17, 8), datetime(2025, 4, 17, 9), 60, 60),
        ]:
            events = [make_event(event_id=i, solicitud_oid=1, linea="PROPIA", state=state, created_at=dt)
                      for i, state, dt in [(1, "RevisionRiesgo", start), (2, "Confirmada", end)]]
            self.assertEqual(compute_first_response_minutes(events, today=date(2026, 9, 10)), [response_minutes])
            events = [make_event(event_id=i, solicitud_oid=1, linea="PROPIA", state=state, created_at=dt)
                      for i, state, dt in [(1, "A Transferir", start), (2, "Pagada", end)]]
            self.assertEqual(compute_transfer_minutes(events), [transfer_minutes])

    def test_main_emits_warning_outputs_when_snapshot_succeeds(self) -> None:
        with (
            patch(
                "reporte_evaluacion_dashboard.generate_snapshot.build_snapshot",
                return_value=(
                    Path("/tmp/latest.json"),
                    {"periodo_actual": "2026-07", "metricas": []},
                    ["warning-demo"],
                ),
            ),
            patch(
                "reporte_evaluacion_dashboard.generate_snapshot.atomic_write_json"
            ),
            patch(
                "reporte_evaluacion_dashboard.generate_snapshot.set_kestra_outputs"
            ) as set_outputs,
            patch(
                "reporte_evaluacion_dashboard.generate_snapshot._log_event"
            ),
        ):
            exit_code = main()

        self.assertEqual(exit_code, 0)
        payload = set_outputs.call_args.args[0]
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["status"], "completed")
        self.assertEqual(payload["warning_count"], 1)
        self.assertEqual(payload["warnings_json"], '["warning-demo"]')

    def test_main_emits_error_outputs_when_snapshot_fails(self) -> None:
        with (
            patch(
                "reporte_evaluacion_dashboard.generate_snapshot.build_snapshot",
                side_effect=RuntimeError("boom"),
            ),
            patch(
                "reporte_evaluacion_dashboard.generate_snapshot.set_kestra_outputs"
            ) as set_outputs,
            patch(
                "reporte_evaluacion_dashboard.generate_snapshot._log_event"
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "boom"):
                main()

        payload = set_outputs.call_args.args[0]
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["status"], "technical_error")
        self.assertEqual(payload["error"], "boom")


if __name__ == "__main__":
    unittest.main()
