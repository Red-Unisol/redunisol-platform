import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parents[1] / "files"))
from reporting_kestra import client
from commercial_distribution_report import generate as commercial


def row(execution_id="one", state="SUCCESS", flow="bitrix24_form_webhook"):
    return {"id": execution_id, "namespace": "redunisol.prod.marketing-crm", "flowId": flow,
            "flowRevision": 1, "state": {"current": state, "startDate": "2026-09-01T10:00:00Z",
                                        "endDate": "2026-09-01T10:00:01Z"}}


class ReportingClientTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "cache.sqlite"
        self.cache = client.OutputCache(self.path, "https://kestra", "main")
        self.session = Mock(auth=("test", "test"), headers={})

    def tearDown(self):
        self.cache.close()
        self.directory.cleanup()

    def hydrate(self, rows):
        return client.hydrate_outputs(rows, self.session, "https://kestra", "main", cache=self.cache, workers=1)

    def test_second_run_uses_cache_but_retry_and_new_execution_fetch_again(self):
        with patch.object(client, "api_get", return_value={"action": "ingested", "lead_id": "42"}) as get:
            self.hydrate([row()])
            self.hydrate([row()])
            self.assertEqual(get.call_count, 1)
            retry = row()
            retry["state"]["endDate"] = "2026-09-02T10:00:01Z"
            self.hydrate([retry, row("two")])
            self.assertEqual(get.call_count, 3)

    def test_in_progress_is_never_cached_and_deleted_rows_do_not_reappear(self):
        with patch.object(client, "api_get", return_value={"action": "ingested", "lead_id": "42"}) as get:
            pending = self.hydrate([row(state="RUNNING")])
            self.assertEqual(pending[0]["outputs"], {})
            get.assert_not_called()
            self.hydrate([row()])
            self.assertEqual(self.hydrate([]), [])
            self.assertEqual(get.call_count, 1)

    def test_cache_isolated_by_origin_tenant_namespace_flow_and_revision(self):
        self.cache.put({**row(), "outputs": {"action": "ingested"}})
        self.cache.commit()
        for field, value in [("namespace", "redunisol.dev.marketing-crm"), ("flowId", "other"), ("flowRevision", 2)]:
            changed = {**row(), field: value}
            self.assertIsNone(self.cache.get(changed))
        other = client.OutputCache(self.path, "https://another-kestra", "main")
        try:
            self.assertIsNone(other.get(row()))
        finally:
            other.close()

    def test_failure_keeps_progress_for_resume_but_never_returns_partial_data(self):
        with patch.object(client, "api_get", side_effect=[{"action": "ingested"}, RuntimeError("upstream")]):
            with self.assertRaises(RuntimeError):
                self.hydrate([row("one"), row("two")])
        self.assertEqual(self.cache.get(row("one")), {"action": "ingested"})
        self.assertIsNone(self.cache.get(row("two")))

    def test_missing_success_outputs_abort_and_are_not_cached(self):
        for value in [{}, [], {"ok": True}, {"action": ""}]:
            with self.subTest(value=value), patch.object(client, "api_get", return_value=value):
                with self.assertRaises(RuntimeError):
                    self.hydrate([row()])
                self.assertIsNone(self.cache.get(row()))
        with patch.object(client, "api_get", return_value={}):
            self.assertEqual(self.hydrate([row(state="FAILED")])[0]["outputs"], {})

    def test_no_work_polls_remain_explicit_and_compact(self):
        with patch.object(client, "api_get", return_value={"action": "no_pending", "message": "No work", "deal_id": ""}):
            data = self.hydrate([row(flow="bitrix24_catamarca_deal_qualification")])
        self.assertEqual(data[0]["outputs"], {"action": "no_pending"})
        self.assertEqual(commercial.normalized_events(data[0]), [])

    def test_index_minimizes_request_data_and_enforces_cutoff(self):
        original = row()
        original["trigger"] = {"variables": {"headers": {"Authorization": "must-not-persist"},
            "body": {"province": "Cordoba", "submission_channel": "web", "utm_term": "test", "unknown_secret": "must-not-persist"}}}
        with patch.object(client, "api_get", return_value={"total": 1, "results": [original]}):
            data = client.executions(self.session, "https://kestra", "main", original["namespace"], original["flowId"], as_of="2026-09-02T00:00:00Z")
        self.assertNotIn("must-not-persist", json.dumps(data))
        self.assertEqual(data[0]["trigger"]["variables"]["body"], {"province": "Cordoba", "submission_channel": "web", "utm_term": "test"})
        with patch.object(client, "api_get", return_value={"total": 1, "results": [original]}):
            with self.assertRaisesRegex(RuntimeError, "posterior"):
                client.executions(self.session, "https://kestra", "main", original["namespace"], original["flowId"], as_of="2026-08-01T00:00:00Z")

    def test_invalid_scope_never_reaches_output_endpoint(self):
        wrong = {**row(), "flowId": "alerta_flow_fallos"}
        with patch.object(client, "api_get", return_value={"total": 1, "results": [wrong]}):
            with self.assertRaisesRegex(RuntimeError, "filtros"):
                client.executions(self.session, "https://kestra", "main", wrong["namespace"], "bitrix24_form_webhook")

    def test_bad_queue_payload_cannot_silently_disappear(self):
        for payload in ['not json', '{}', '[null]']:
            with self.subTest(payload=payload), self.assertRaises(RuntimeError):
                commercial.normalized_events({**row(), "outputs": {"events_json": payload}})

    def test_failure_without_deal_is_trace_not_a_negotiation(self):
        event = commercial.normalized({**row(state="FAILED", flow="bitrix24_deal_assignment_queue"), "outputs": {}})
        self.assertIsNotNone(event)
        self.assertEqual(commercial.latest_cases([event]), [])
        wb = commercial.build([event])
        summary = {r[0]: r[1] for r in wb["Resumen"].iter_rows(values_only=True)}
        self.assertEqual(summary["Negociaciones incluidas"], 0)
        self.assertEqual(summary["Ejecuciones fallidas sin negociación"], 1)
        self.assertEqual(wb["Trazabilidad técnica"].max_row, 2)

    def test_cancelled_and_logical_failures_without_deal_remain_visible(self):
        for state, outputs in [("CANCELLED", {}), ("SUCCESS", {"action": "error"})]:
            event = commercial.normalized({**row(state=state), "outputs": outputs})
            self.assertIsNotNone(event)
            self.assertEqual(event["distribution_status"], "Error técnico")
            self.assertEqual(commercial.latest_cases([event]), [])


class ManualExportTest(unittest.TestCase):
    def test_workbook_without_error_logs_and_cancelled_counts(self):
        path = Path(__file__).parents[3] / "tools" / "export_kestra_form_executions.py"
        spec = importlib.util.spec_from_file_location("manual_report_counts", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for state in ("SUCCESS", "CANCELLED"):
            with self.subTest(state=state):
                wb = module.build_workbook([row(state=state)], {}, "test", "bitrix24_form_webhook", module.datetime.now())
                expected = int(state == "CANCELLED")
                summary = {r[0]: r[1] for r in wb["Resumen"].iter_rows(values_only=True)}
                self.assertEqual(summary["Fallidas/Killed/Canceladas"], expected)
                self.assertEqual(wb["Análisis diario"].cell(2, 4).value, expected)
                self.assertEqual(wb["Logs errores"].max_row, 1)

    def test_manual_export_uses_same_scope_and_hydrated_outputs(self):
        path = Path(__file__).parents[3] / "tools" / "export_kestra_form_executions.py"
        spec = importlib.util.spec_from_file_location("manual_report_test", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        item = row()
        with patch.object(client, "api_get", side_effect=[{"total": 1, "results": [item]}, {"action": "ingested", "lead_id": "42"}]) as get:
            result = module.fetch_executions(Mock(auth=None, headers={}), "https://kestra", "main", item["namespace"], item["flowId"], as_of="2026-09-02T00:00:00Z")
        self.assertEqual(result[0]["outputs"]["lead_id"], "42")
        self.assertIn("filters[flowId][EQUALS]", get.call_args_list[0].kwargs)
        self.assertEqual(get.call_args_list[1].args[1], "https://kestra/api/v1/main/outputs/executions/one")


if __name__ == "__main__":
    unittest.main()
