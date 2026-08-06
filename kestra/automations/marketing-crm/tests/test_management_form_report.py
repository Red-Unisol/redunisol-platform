import importlib.util
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "files" / "management_form_report" / "generate.py"
SPEC = importlib.util.spec_from_file_location("management_form_report", MODULE_PATH)
REPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REPORT)


def execution(execution_id, *, outputs=None, parent_id=None, task_runs=None, body=None, start="2026-08-05T10:00:00Z"):
    row = {
        "id": execution_id,
        "flowRevision": 3,
        "state": {"current": "SUCCESS", "startDate": start},
        "outputs": outputs or {},
        "trigger": {"variables": {"body": body or {"cuil": "20-12345678-9", "province": "Córdoba"}}},
        "taskRunList": task_runs or [],
    }
    if parent_id:
        row["parentId"] = parent_id
    return row


class ManagementFormReportTest(unittest.TestCase):
    def test_crosses_legacy_child_using_parent_id(self):
        parent = execution("parent")
        child = execution("child", parent_id="parent", outputs={"action": "qualified", "lead_id": "42"})

        cross = REPORT.cross_children([parent], [child])
        row = REPORT.normalized(parent, cross["parent"])

        self.assertEqual(row["lead_id"], "42")
        self.assertEqual(row["category"], "Sin precalificación histórica")

    def test_crosses_legacy_child_using_flow_task_output(self):
        parent = execution("parent", task_runs=[{"taskId": "persistir_bitrix", "outputs": {"executionId": "child"}}])
        child = execution("child", outputs={"action": "rejected", "lead_id": "84"})

        cross = REPORT.cross_children([parent], [child])
        row = REPORT.normalized(parent, cross["parent"])

        self.assertEqual(row["lead_id"], "84")
        self.assertEqual(row["category"], "Sin precalificación histórica")

    def test_publishes_latest_and_dated_copy_atomically(self):
        with tempfile.TemporaryDirectory() as directory:
            latest, dated = REPORT.publish(REPORT.build([]), Path(directory), REPORT.datetime(2026, 8, 5, 7, 15))

            self.assertTrue(latest.exists())
            self.assertTrue(dated.exists())
            self.assertEqual(latest.read_bytes(), dated.read_bytes())

    def test_crosses_historical_prequalification_and_treats_external_referral_as_rejected(self):
        fields = {"province": "Santa Fe", "employment_status": "Policia", "payment_bank": "Otro"}
        prequalification = execution("pre", body=fields, start="2026-08-05T09:59:58Z", outputs={"prequalified": False, "reason": "external_referral", "message": "Derivación externa."})
        parent = execution("parent", body=fields, outputs={"action": "ingested", "lead_id": "42"})

        crossed = REPORT.cross_prequalifications([parent], [prequalification])
        row = REPORT.normalized(parent, None, crossed["parent"])

        self.assertEqual(row["category"], "Rechazado en precalificación")
        self.assertEqual(row["prequalification_reason"], "external_referral")

    def test_uses_prequalification_embedded_in_new_submissions(self):
        parent = execution("parent", body={"prequalification_available": True, "prequalified": True, "prequalification_reason": "qualified"}, outputs={"lead_id": "42"})
        row = REPORT.normalized(parent, None)
        self.assertEqual(row["category"], "Precalificado")

    def test_builds_daily_breakdown_with_chart(self):
        rows = [
            REPORT.normalized(execution("one", outputs={"action": "created", "lead_id": "42"}), None),
            REPORT.normalized(execution("two", outputs={"action": "rejected"}), None),
        ]

        workbook = REPORT.build(rows)
        sheet = workbook["Evolución diaria"]

        self.assertEqual(sheet.cell(2, 1).value, REPORT.datetime(2026, 8, 5).date())
        self.assertEqual(sheet.cell(2, 2).value, 2)
        self.assertEqual(sheet.cell(2, 3).value, 1)
        self.assertEqual(sheet.cell(2, 4).value, 0.5)
        headers = {cell.value: cell.column for cell in sheet[1]}
        self.assertEqual(sheet.cell(2, headers["Sin precalificación histórica"]).value, 1)
        self.assertEqual(sheet.cell(2, headers["Rechazo antes de Bitrix"]).value, 1)
        self.assertEqual(len(sheet._charts), 1)


if __name__ == "__main__":
    unittest.main()
