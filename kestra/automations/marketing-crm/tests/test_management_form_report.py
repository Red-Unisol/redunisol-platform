import importlib.util
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "files" / "management_form_report" / "generate.py"
SPEC = importlib.util.spec_from_file_location("management_form_report", MODULE_PATH)
REPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REPORT)


def execution(execution_id, *, outputs=None, parent_id=None, task_runs=None):
    row = {
        "id": execution_id,
        "flowRevision": 3,
        "state": {"current": "SUCCESS", "startDate": "2026-08-05T10:00:00Z"},
        "outputs": outputs or {},
        "trigger": {"variables": {"body": {"cuil": "20-12345678-9", "province": "Córdoba"}}},
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
        self.assertEqual(row["category"], "Lead aprobado")

    def test_crosses_legacy_child_using_flow_task_output(self):
        parent = execution("parent", task_runs=[{"taskId": "persistir_bitrix", "outputs": {"executionId": "child"}}])
        child = execution("child", outputs={"action": "rejected", "lead_id": "84"})

        cross = REPORT.cross_children([parent], [child])
        row = REPORT.normalized(parent, cross["parent"])

        self.assertEqual(row["lead_id"], "84")
        self.assertEqual(row["category"], "Lead rechazado en Bitrix")

    def test_publishes_latest_and_dated_copy_atomically(self):
        with tempfile.TemporaryDirectory() as directory:
            latest, dated = REPORT.publish(REPORT.build([]), Path(directory), REPORT.datetime(2026, 8, 5, 7, 15))

            self.assertTrue(latest.exists())
            self.assertTrue(dated.exists())
            self.assertEqual(latest.read_bytes(), dated.read_bytes())


if __name__ == "__main__":
    unittest.main()
