import importlib.util
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

MODULE_PATH = Path(__file__).parents[1] / "files" / "management_form_report" / "generate.py"
SPEC = importlib.util.spec_from_file_location("management_form_report", MODULE_PATH)
REPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REPORT)
NS = "redunisol.prod.marketing-crm"


def execution(execution_id, *, outputs=None, body=None, state="SUCCESS", start="2026-04-06T10:00:00Z"):
    return {"id": execution_id, "namespace": NS, "flowId": REPORT.FLOW_ID,
            "flowRevision": 3, "state": {"current": state, "startDate": start},
            "outputs": outputs or {}, "trigger": {"variables": {"body": body or {}}}}


class ManagementFormReportTest(unittest.TestCase):
    def query(self, pages, **kwargs):
        with patch.object(REPORT, "api_get", side_effect=pages) as get:
            result = REPORT.executions(Mock(), "https://kestra", "main", NS, REPORT.FLOW_ID, **kwargs)
        return result, get

    def test_accumulated_query_has_correct_filters_and_no_lower_date_bound(self):
        rows, get = self.query([{"results": [execution("old")], "total": 1}])
        self.assertEqual(len(rows), 1)
        args = get.call_args.kwargs
        self.assertEqual(args["filters[namespace][EQUALS]"], NS)
        self.assertEqual(args["filters[flowId][EQUALS]"], REPORT.FLOW_ID)
        self.assertIn("filters[startDate][LESS_THAN_OR_EQUAL_TO]", args)
        self.assertNotIn("filters[startDate][GREATER_THAN_OR_EQUAL_TO]", args)
        self.assertNotIn("flowId", args)
        self.assertNotIn("namespace", args)

    def test_paginates_all_rows(self):
        rows, get = self.query([{"results": [execution("a")], "total": 2},
                                {"results": [execution("b")], "total": 2}])
        self.assertEqual([r["id"] for r in rows], ["a", "b"])
        self.assertEqual(get.call_count, 2)
        self.assertEqual(get.call_args_list[0].kwargs["filters[startDate][LESS_THAN_OR_EQUAL_TO]"],
                         get.call_args_list[1].kwargs["filters[startDate][LESS_THAN_OR_EQUAL_TO]"])

    def test_rejects_ignored_filters_excessive_counts_duplicates_and_incomplete_pages(self):
        wrong = {**execution("a"), "flowId": "another_flow"}
        cases = [
            ([{"results": [wrong], "total": 1}], {}),
            ([{"results": [execution("a")], "total": 3}], {"max_records": 2}),
            ([{"results": [execution("a")], "total": 2}, {"results": [execution("a")], "total": 2}], {}),
            ([{"results": [], "total": 2}], {}),
            ([{"results": [execution("a")], "total": 2}, {"results": [execution("b")], "total": 3}], {}),
        ]
        for pages, kwargs in cases:
            with self.subTest(pages=pages), self.assertRaises(RuntimeError):
                self.query(pages, **kwargs)

    def test_empty_history_is_valid(self):
        rows, _ = self.query([{"results": [], "total": 0}])
        self.assertEqual(rows, [])

    def test_output_lookup_uses_execution_id_and_never_legacy_flow(self):
        session = Mock(auth=("user", "password"), headers={})
        def get(client, url, **kwargs):
            self.assertIn("/outputs/executions/", url)
            return {"lead_id": "42" if url.endswith("old") else "43", "action": "ingested"}
        with patch.object(REPORT, "api_get", side_effect=get) as mocked:
            rows = REPORT.hydrate_outputs([execution("old"), execution("new")], session,
                                          "https://kestra", "main", workers=2)
        self.assertEqual([r["outputs"]["lead_id"] for r in rows], ["42", "43"])
        self.assertEqual(mocked.call_count, 2)

    def test_output_fetch_failure_is_not_replaced_by_empty_result(self):
        session = Mock(auth=("user", "password"), headers={})
        with patch.object(REPORT, "api_get", side_effect=RuntimeError("API failed")):
            with self.assertRaises(RuntimeError):
                REPORT.hydrate_outputs([execution("one")], session, "https://kestra", "main")

    def test_unavailable_prequalification_is_not_inferred_or_rejected(self):
        for body in [{}, {"prequalification_available": False, "prequalified": False},
                     {"prequalification_available": True}]:
            row = REPORT.normalized(execution("one", outputs={"lead_id": "42"}, body=body))
            self.assertEqual(row["category"], "Sin precalificación disponible")
        row = REPORT.normalized(execution("one"))
        self.assertEqual(row["category"], "Sin trazabilidad disponible")
        self.assertEqual(REPORT.normalized(execution("failed", state="FAILED"))["category"], "Error técnico")

    def test_embedded_prequalification_preserves_result(self):
        cases = [(True, "qualified", "Precalificado"),
                 (False, "external_referral", "Derivación a vendedor externo"),
                 (False, "rejected", "Rechazado en precalificación")]
        for qualified, reason, expected in cases:
            row = REPORT.normalized(execution("one", outputs={"lead_id": "42"}, body={
                "prequalification_available": True, "prequalified": qualified,
                "prequalification_reason": reason}))
            self.assertEqual(row["category"], expected)

    def test_dates_use_argentina_including_day_boundary(self):
        self.assertEqual(REPORT.iso("2026-09-15T01:00:00Z"), REPORT.datetime(2026, 9, 14, 22))
        self.assertEqual(REPORT.iso("2026-09-14T22:00:00-03:00"), REPORT.datetime(2026, 9, 14, 22))

    def test_workbook_totals_and_daily_chart_match_rows(self):
        rows = [REPORT.normalized(execution("one", outputs={"lead_id": "42"})),
                REPORT.normalized(execution("two", outputs={"lead_id": "42"})),
                REPORT.normalized(execution("three", outputs={"action": "rejected"}))]
        workbook = REPORT.build(rows)
        metrics = {row[0].value: row[1].value for row in workbook["Resumen Ejecutivo"].iter_rows()}
        self.assertEqual(metrics["Formularios recibidos"], 3)
        self.assertEqual(metrics["Leads confirmados en Bitrix"], 1)
        self.assertAlmostEqual(metrics["Conversión formulario → lead"], 1 / 3)
        daily = workbook["Evolución diaria"]
        self.assertEqual(daily.cell(2, 2).value, 3)
        self.assertEqual(daily.cell(2, 3).value, 1)
        self.assertEqual(len(daily._charts), 1)
        self.assertIn("Sin lead confirmado", workbook.sheetnames)

    def test_publish_is_atomic_and_preserves_historical_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old, old_dated = REPORT.publish(REPORT.build([]), root, REPORT.datetime(2026, 8, 5))
            old_bytes = old.read_bytes()
            latest, dated = REPORT.publish(REPORT.build([]), root, REPORT.datetime(2026, 9, 15))
            self.assertEqual(latest.read_bytes(), dated.read_bytes())
            self.assertEqual(old_dated.read_bytes(), old_bytes)

    def test_expired_deadline_or_save_failure_preserves_last_valid_workbook(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            latest, dated = REPORT.publish(REPORT.build([]), root, REPORT.datetime(2026, 9, 15))
            original = latest.read_bytes()
            with self.assertRaises(RuntimeError):
                REPORT.publish(REPORT.build([]), root, REPORT.datetime(2026, 9, 15), deadline=time.monotonic() - 1)
            self.assertEqual(latest.read_bytes(), original)
            broken = Mock()
            broken.save.side_effect = OSError("disk error")
            with self.assertRaises(OSError):
                REPORT.publish(broken, root, REPORT.datetime(2026, 9, 15))
            self.assertEqual(latest.read_bytes(), original)
            self.assertEqual(dated.read_bytes(), original)
            self.assertEqual([p.name for p in latest.parent.glob("*.xlsx")], ["ultimo.xlsx"])
            self.assertEqual(list(latest.parent.glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
