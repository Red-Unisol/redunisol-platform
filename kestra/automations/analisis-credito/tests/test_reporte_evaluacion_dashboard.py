from __future__ import annotations

from datetime import datetime
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

    def test_thresholds_match_commissions(self):
        for actual, expected in [(100, "verde"), (100.01, "amarillo"), (110, "amarillo"), (110.01, "rojo")]:
            self.assertEqual(classify_state(actual, 100), expected)
        self.assertEqual(classify_state(0, 0), "neutral")
        self.assertEqual(classify_state(None, 10), "neutral")

    def test_mandatory_holidays_but_not_optional_tourism_days(self):
        for start, end, expected in [
            (datetime(2026, 7, 8, 16), datetime(2026, 7, 10, 9), 120),
            (datetime(2026, 7, 10, 8), datetime(2026, 7, 10, 9), 60),
        ]:
            events = [make_event(event_id=i, solicitud_oid=1, linea="PROPIA", state=state, created_at=dt)
                      for i, state, dt in [(1, "RevisionRiesgo", start), (2, "Confirmada", end)]]
            self.assertEqual(compute_first_response_minutes(events), [expected])
            events = [make_event(event_id=i, solicitud_oid=1, linea="PROPIA", state=state, created_at=dt)
                      for i, state, dt in [(1, "A Transferir", start), (2, "Pagada", end)]]
            self.assertEqual(compute_transfer_minutes(events), [expected])

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
