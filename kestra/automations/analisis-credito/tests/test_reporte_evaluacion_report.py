from __future__ import annotations

import stat
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path

from reporte_evaluacion_report.kestra_entrypoint import (
    atomic_publish,
    last_closed_month,
    parse_trigger_body,
    resolve_period,
)


class ReporteEvaluacionReportTests(unittest.TestCase):
    def test_last_closed_month_handles_year_boundary(self) -> None:
        self.assertEqual(last_closed_month(date(2026, 1, 1)), "2025-12")
        self.assertEqual(last_closed_month(date(2026, 8, 11)), "2026-07")

    def test_resolve_period_defaults_to_accumulated_closed_period(self) -> None:
        self.assertEqual(
            resolve_period(today=date(2026, 8, 1)),
            ("2025-10", "2026-07"),
        )

    def test_resolve_period_accepts_webhook_overrides(self) -> None:
        self.assertEqual(
            resolve_period(
                today=date(2026, 8, 11),
                payload={"from_month": "2026-05", "to_month": "2026-06"},
            ),
            ("2026-05", "2026-06"),
        )

    def test_resolve_period_rejects_open_month(self) -> None:
        with self.assertRaisesRegex(ValueError, "meses cerrados"):
            resolve_period(
                today=date(2026, 8, 11),
                payload={"to_month": "2026-08"},
            )

    def test_parse_trigger_body_accepts_object_and_encoded_object(self) -> None:
        expected = {"from_month": "2026-01", "to_month": "2026-02"}
        self.assertEqual(parse_trigger_body('{"from_month":"2026-01","to_month":"2026-02"}'), expected)
        self.assertEqual(
            parse_trigger_body('"{\\"from_month\\":\\"2026-01\\",\\"to_month\\":\\"2026-02\\"}"'),
            expected,
        )

    def test_atomic_publish_replaces_latest_and_creates_history(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.xlsx"
            source.write_bytes(b"first")
            latest, history = atomic_publish(source, root / "reports", datetime(2026, 8, 1, 7, 15))
            self.assertEqual(latest.read_bytes(), b"first")
            self.assertEqual(history.read_bytes(), b"first")
            self.assertEqual(stat.S_IMODE(latest.stat().st_mode) & 0o444, 0o444)
            self.assertEqual(stat.S_IMODE(history.stat().st_mode) & 0o444, 0o444)

            source.write_bytes(b"second")
            atomic_publish(source, root / "reports", datetime(2026, 8, 1, 8, 0))
            self.assertEqual(latest.read_bytes(), b"second")
            self.assertEqual(history.read_bytes(), b"second")


if __name__ == "__main__":
    unittest.main()
