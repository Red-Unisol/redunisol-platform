import importlib.util
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = (
    Path(__file__).parents[1]
    / "files"
    / "commercial_distribution_report"
    / "generate.py"
)
SPEC = importlib.util.spec_from_file_location("commercial_distribution_report", MODULE_PATH)
REPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REPORT)


def execution(*, action="approved", strategy="round_robin", state="SUCCESS"):
    return {
        "id": "exec-123",
        "flowRevision": 8,
        "state": {"current": state, "startDate": "2026-08-11T13:15:00Z"},
        "outputs": {
            "action": action,
            "deal_id": "930",
            "deal_title": "Negociación de prueba",
            "lead_id": "920",
            "contact_id": "101",
            "stage_before": "C1:KESTRA_PENDING",
            "stage_id": "C1:NEW",
            "reason": "amejuca_premium",
            "assigned_by_id": "68579",
            "assigned_by_name": "Daniel Carrera",
            "previous_assigned_by_id": "57",
            "routing_bucket": "catamarca_general",
            "commercial_line": "AMEJUCA Premium",
            "processed_at": "2026-08-11T10:15:00-03:00",
            "province": "Catamarca",
            "employment_status": "Docente",
            "payment_bank": "Banco de la Nación Argentina",
            "within_business_hours": True,
            "assignment_strategy": strategy,
            "configured_pool": "68579,10451",
            "online_pool": "68579,10451",
            "linked_activity_count": "1",
            "transferred_chat_count": "1",
            "rule_version": "2026-08-11",
        },
    }


class CommercialDistributionReportTests(unittest.TestCase):
    def test_keeps_only_events_at_or_after_audit_cutoff(self):
        before = REPORT.normalized(execution())
        before["processed_at"] = REPORT.datetime(2026, 8, 11, 12, 59, 59)
        at_cutoff = REPORT.normalized(execution())
        at_cutoff["processed_at"] = REPORT.datetime(2026, 8, 11, 13, 0, 0)

        rows = REPORT.events_from(
            [before, at_cutoff],
            REPORT.datetime(2026, 8, 11, 13, 0, 0),
        )

        self.assertEqual(rows, [at_cutoff])

    def test_shows_audit_cutoff_in_summary(self):
        cutoff = REPORT.datetime(2026, 8, 11, 13, 0, 0)

        workbook = REPORT.build([], audit_from=cutoff)

        self.assertEqual(workbook["Resumen"].cell(2, 1).value, "Eventos incluidos desde")
        self.assertEqual(workbook["Resumen"].cell(2, 2).value, cutoff)
        self.assertEqual(
            workbook["Resumen"].cell(2, 2).number_format,
            "dd/mm/yyyy hh:mm:ss",
        )

    def test_normalizes_complete_distribution_event(self):
        row = REPORT.normalized(execution())

        self.assertEqual(row["distribution_status"], "Distribuido")
        self.assertEqual(row["assigned_by_name"], "Daniel Carrera")
        self.assertEqual(row["assignment_strategy"], "round_robin")
        self.assertEqual(
            row["assignment_reason"],
            "Siguiente vendedor del round-robin",
        )
        self.assertEqual(row["transferred_chat_count"], 1)

    def test_marks_outside_hours_as_manual_with_maru(self):
        row = REPORT.normalized(
            execution(action="manual_review", strategy="outside_hours_manual")
        )

        self.assertEqual(row["distribution_status"], "Gestión manual con Maru")

    def test_omits_scheduler_runs_without_pending_deal(self):
        row = execution(action="no_pending", strategy="")
        row["outputs"]["deal_id"] = ""

        self.assertIsNone(REPORT.normalized(row))

    def test_separates_legacy_events_from_real_exceptions(self):
        legacy_execution = execution(strategy="")
        legacy_execution["outputs"]["rule_version"] = ""
        legacy_execution["outputs"]["processed_at"] = ""
        legacy = REPORT.normalized(legacy_execution)
        manual = REPORT.normalized(
            execution(action="manual_review", strategy="outside_hours_manual")
        )

        workbook = REPORT.build([legacy, manual])

        self.assertEqual(workbook["Histórico incompleto"].max_row, 2)
        self.assertEqual(workbook["Excepciones"].max_row, 2)

    def test_builds_event_exception_and_seller_sheets_with_links(self):
        distributed = REPORT.normalized(execution())
        manual = REPORT.normalized(
            execution(action="manual_review", strategy="outside_hours_manual")
        )
        workbook = REPORT.build(
            [distributed, manual],
            "https://example.bitrix24.com/rest",
        )

        self.assertEqual(workbook["Eventos"].max_row, 3)
        self.assertEqual(workbook["Excepciones"].max_row, 2)
        self.assertEqual(workbook["Histórico incompleto"].max_row, 1)
        self.assertEqual(workbook["Por vendedor"].max_row, 2)
        self.assertEqual(
            workbook["Eventos"].cell(2, 5).hyperlink.target,
            "https://example.bitrix24.com/crm/deal/details/930/",
        )

    def test_publishes_latest_and_historical_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            latest, dated = REPORT.publish(
                REPORT.build([]),
                Path(directory),
                REPORT.datetime(2026, 8, 11, 7, 25),
            )

            self.assertTrue(latest.exists())
            self.assertTrue(dated.exists())
            self.assertEqual(latest.read_bytes(), dated.read_bytes())


if __name__ == "__main__":
    unittest.main()
