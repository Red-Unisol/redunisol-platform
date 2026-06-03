from __future__ import annotations

from datetime import datetime
from pathlib import Path
import sys
import unittest

FILES_ROOT = Path(__file__).resolve().parent.parent / "files"
if str(FILES_ROOT) not in sys.path:
    sys.path.insert(0, str(FILES_ROOT))

from reporte_evaluacion_dashboard.generate_snapshot import (  # noqa: E402
    NovedadEvent,
    compute_first_response_minutes,
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


if __name__ == "__main__":
    unittest.main()
