import io
import json
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, Mock, patch
from urllib.error import HTTPError

from bitrix24_form_flow.form_processor.bitrix_client import BitrixClient


CLIENT_MODULE = "bitrix24_form_flow.form_processor.bitrix_client"
CONFIG = SimpleNamespace(base_url="https://crm.example.test", webhook_path="rest/test", timeout_seconds=20)
FIELD = "UF_SYNTHETIC_OWNER"
SCHEMA = {FIELD: {"type": "enumeration", "items": [{"ID": "2", "VALUE": "Kestra"}]}}


def response(body):
    opened = MagicMock()
    opened.__enter__.return_value.read.return_value = json.dumps(body).encode("utf-8")
    return opened


class MutableClock:
    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


class BitrixLeadFieldsCacheTests(unittest.TestCase):
    def test_opted_in_direct_and_helper_reads_share_one_metadata_dispatch(self):
        client = BitrixClient(CONFIG, Mock(), cache_lead_fields=True)
        with patch(CLIENT_MODULE + ".urlopen", return_value=response({"result": SCHEMA})) as opened:
            self.assertEqual(client.call_full("crm.lead.fields", {}), {"result": SCHEMA})
            self.assertEqual(client.get_lead_field(FIELD), SCHEMA[FIELD])
            self.assertEqual(client.call("crm.lead.fields", {}), SCHEMA)
        opened.assert_called_once()
        self.assertEqual(json.loads(opened.call_args.args[0].data), {})

    def test_default_and_explicitly_disabled_cache_preserve_each_read(self):
        for options in ({}, {"cache_lead_fields": False}):
            with self.subTest(options=options):
                client = BitrixClient(CONFIG, Mock(), **options)
                with patch(CLIENT_MODULE + ".urlopen", return_value=response({"result": SCHEMA})) as opened:
                    client.call_full("crm.lead.fields", {})
                    client.get_lead_field(FIELD)
                    client.call("crm.lead.fields", {})
                self.assertEqual(opened.call_count, 3)

    def test_http_failure_is_not_cached_and_later_success_is_reused(self):
        client = BitrixClient(CONFIG, Mock(), cache_lead_fields=True)
        failure = HTTPError("https://crm.example.test/fields", 503, "Unavailable", {}, io.BytesIO(b"unavailable"))
        with patch(CLIENT_MODULE + ".urlopen", side_effect=[failure, response({"result": SCHEMA})]) as opened:
            with self.assertRaisesRegex(RuntimeError, "HTTP 503"):
                client.call("crm.lead.fields", {})
            self.assertEqual(client.get_lead_field(FIELD), SCHEMA[FIELD])
            self.assertEqual(client.call("crm.lead.fields", {}), SCHEMA)
        self.assertEqual(opened.call_count, 2)

    def test_provider_error_is_not_cached(self):
        client = BitrixClient(CONFIG, Mock(), cache_lead_fields=True)
        with patch(CLIENT_MODULE + ".urlopen", side_effect=[
                response({"error": "QUERY_LIMIT_EXCEEDED", "error_description": "Read quota exceeded"}),
                response({"result": SCHEMA})]) as opened:
            with self.assertRaisesRegex(RuntimeError, "Read quota exceeded"):
                client.call_full("crm.lead.fields", {})
            self.assertEqual(client.call("crm.lead.fields", {}), SCHEMA)
            self.assertEqual(client.get_lead_field(FIELD), SCHEMA[FIELD])
        self.assertEqual(opened.call_count, 2)

    def test_mutating_first_response_and_helper_results_cannot_poison_the_cache(self):
        client = BitrixClient(CONFIG, Mock(), cache_lead_fields=True)
        with patch(CLIENT_MODULE + ".urlopen", return_value=response({"result": SCHEMA})) as opened:
            first = client.call_full("crm.lead.fields", {})
            first["result"][FIELD]["items"][0]["VALUE"] = "Changed by caller"
            field = client.get_lead_field(FIELD)
            self.assertEqual(field, SCHEMA[FIELD])
            field["items"].append({"ID": "3", "VALUE": "Another caller change"})
            replay = client.call("crm.lead.fields", {})
            self.assertEqual(replay, SCHEMA)
            replay.clear()
            self.assertEqual(client.call_full("crm.lead.fields", {}), {"result": SCHEMA})
        opened.assert_called_once()

    def test_cache_is_local_to_each_client_instance(self):
        first = BitrixClient(CONFIG, Mock(), cache_lead_fields=True)
        second = BitrixClient(CONFIG, Mock(), cache_lead_fields=True)
        changed = {FIELD: {"type": "enumeration", "items": [{"ID": "9", "VALUE": "Changed schema"}]}}
        with patch(CLIENT_MODULE + ".urlopen", side_effect=[response({"result": SCHEMA}), response({"result": changed})]) as opened:
            self.assertEqual(first.call("crm.lead.fields", {}), SCHEMA)
            self.assertEqual(second.call("crm.lead.fields", {}), changed)
            self.assertEqual(first.get_lead_field(FIELD), SCHEMA[FIELD])
            self.assertEqual(second.get_lead_field(FIELD), changed[FIELD])
        self.assertEqual(opened.call_count, 2)

    def test_nonempty_requests_and_other_endpoints_keep_their_own_dispatches(self):
        client = BitrixClient(CONFIG, Mock(), cache_lead_fields=True)
        with patch(CLIENT_MODULE + ".urlopen", return_value=response({"result": SCHEMA})) as opened:
            client.call("crm.lead.fields", {"filter": {"field": FIELD}})
            client.call("crm.lead.fields", {"filter": {"field": FIELD}})
            client.call("crm.lead.fields", {})
            client.call("crm.lead.fields", {})
            client.call("crm.contact.fields", {})
            client.call("crm.contact.fields", {})
        self.assertEqual(opened.call_count, 5)

    def test_pacing_separates_read_and_write_dispatch_starts_without_retrying(self):
        clock = MutableClock()
        starts = []

        def dispatch(*args, **kwargs):
            starts.append(clock())
            return response({"result": True})

        client = BitrixClient(CONFIG, Mock(), min_request_interval_seconds=1.0,
                              sleep=clock.sleep, clock=clock)
        with patch(CLIENT_MODULE + ".urlopen", side_effect=dispatch) as opened:
            client.call("crm.lead.list", {})
            client.call("crm.contact.get", {"id": "10"})
            client.call("crm.lead.update", {"id": "10", "fields": {"TITLE": "Synthetic intake"}})
        self.assertEqual(opened.call_count, 3)
        self.assertEqual(starts, [0.0, 1.0, 2.0])
        self.assertTrue(all(after - before >= 1.0 for before, after in zip(starts, starts[1:])))
        self.assertEqual(clock.sleeps, [1.0, 1.0])

    def test_metadata_cache_hits_neither_dispatch_nor_consume_pacing_sleeps(self):
        clock = MutableClock()
        starts = []

        def dispatch(*args, **kwargs):
            starts.append(clock())
            return response({"result": SCHEMA})

        client = BitrixClient(CONFIG, Mock(), cache_lead_fields=True,
                              min_request_interval_seconds=1.0, sleep=clock.sleep, clock=clock)
        with patch(CLIENT_MODULE + ".urlopen", side_effect=dispatch) as opened:
            client.call_full("crm.lead.fields", {})
            client.get_lead_field(FIELD)
            client.call("crm.lead.fields", {})
            self.assertEqual(opened.call_count, 1)
            self.assertEqual(clock.sleeps, [])
            self.assertEqual(clock(), 0.0)
            client.call("crm.contact.fields", {})
        self.assertEqual(opened.call_count, 2)
        self.assertEqual(starts, [0.0, 1.0])
        self.assertEqual(clock.sleeps, [1.0])

    def test_default_zero_interval_dispatches_without_sleeping(self):
        clock = MutableClock()
        client = BitrixClient(CONFIG, Mock(), sleep=clock.sleep, clock=clock)
        with patch(CLIENT_MODULE + ".urlopen", return_value=response({"result": True})) as opened:
            client.call("crm.lead.list", {})
            client.call("crm.contact.get", {"id": "10"})
            client.call("crm.lead.update", {"id": "10", "fields": {"TITLE": "Synthetic intake"}})
        self.assertEqual(opened.call_count, 3)
        self.assertEqual(clock.sleeps, [])
        self.assertEqual(clock(), 0.0)

    def test_a_successful_non_schema_result_is_not_cached(self):
        client = BitrixClient(CONFIG, Mock(), cache_lead_fields=True)
        with patch(CLIENT_MODULE + ".urlopen", return_value=response({"result": None})) as opened:
            self.assertIsNone(client.call("crm.lead.fields", {}))
            self.assertIsNone(client.call("crm.lead.fields", {}))
        self.assertEqual(opened.call_count, 2)


if __name__ == "__main__":
    unittest.main()
