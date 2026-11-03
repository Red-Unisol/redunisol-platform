import copy
from collections import Counter
from contextlib import contextmanager
import unittest
from unittest.mock import Mock, call, patch

from bitrix24_form_flow.form_processor.intake_crm_client import IntakeCrmClient
from bitrix24_form_flow.form_processor.whatsapp_intake import process
from test_whatsapp_intake import CONFIG, IntakeCrm, PHONE, payload


class IntakeCrmClientTests(unittest.TestCase):
    def test_transient_record_reads_retry_twice_and_return_the_provider_result(self):
        result = {"ID": "10"}
        api = Mock()
        api.call.side_effect = [TimeoutError("timed out"),
                                RuntimeError("Error de red contra Bitrix24: timed out"), result]
        sleep = Mock()
        client = IntakeCrmClient(api, sleep=sleep, clock=lambda: 0)

        self.assertIs(client.call("crm.lead.get", {"id": "10"}), result)
        self.assertEqual(api.call.call_args_list, [call("crm.lead.get", {"id": "10"})] * 3)
        self.assertEqual(sleep.call_args_list, [call(1), call(2)])

    def test_duplicate_identity_lookup_retries_only_the_read(self):
        api = Mock()
        api.call.side_effect = [RuntimeError("QUERY_LIMIT_EXCEEDED"), {"LEAD": ["10"]}]
        sleep = Mock()
        client = IntakeCrmClient(api, sleep=sleep, clock=lambda: 0)
        request = {"entity_type": "LEAD", "type": "PHONE", "values": [PHONE]}

        self.assertEqual(client.call("crm.duplicate.findbycomm", request), {"LEAD": ["10"]})
        self.assertEqual(api.call.call_args_list, [call("crm.duplicate.findbycomm", request)] * 2)
        sleep.assert_called_once_with(1)

    def test_transient_http_failures_can_retry_a_safe_read(self):
        for status in (429, 500, 502, 503, 504):
            with self.subTest(status=status):
                api = Mock()
                api.call.side_effect = [RuntimeError(f"Bitrix24 devolvio HTTP {status}: unavailable"), []]
                sleep = Mock()
                client = IntakeCrmClient(api, sleep=sleep, clock=lambda: 0)
                self.assertEqual(client.call("crm.contact.list", {"filter": {}}), [])
                self.assertEqual(api.call.call_count, 2)
                sleep.assert_called_once_with(1)

    def test_nontransient_identity_or_permission_failures_are_not_retried(self):
        for error in (ValueError("CRM identity does not match"),
                      RuntimeError("Bitrix24 devolvio HTTP 403: access denied"),
                      RuntimeError("Bitrix24 devolvio HTTP 400: invalid filter")):
            with self.subTest(error=type(error).__name__, message=str(error)):
                api = Mock()
                api.call.side_effect = error
                sleep = Mock()
                client = IntakeCrmClient(api, sleep=sleep, clock=lambda: 0)
                with self.assertRaises(type(error)) as caught:
                    client.call("crm.lead.get", {"id": "10"})
                self.assertIs(caught.exception, error)
                self.assertEqual(error.intake_crm_method, "crm.lead.get")
                self.assertEqual(error.intake_crm_attempts, 1)
                self.assertFalse(error.intake_crm_write_attempted)
                api.call.assert_called_once()
                sleep.assert_not_called()

    def test_uncertain_write_acknowledgements_never_resend_the_write(self):
        for method in ("crm.contact.add", "crm.contact.update", "crm.lead.add", "crm.lead.update"):
            with self.subTest(method=method):
                api = Mock()
                error = TimeoutError("provider may have accepted the write")
                api.call.side_effect = error
                sleep = Mock()
                client = IntakeCrmClient(api, sleep=sleep, clock=lambda: 0)
                request = {"id": "10", "fields": {"TITLE": "Synthetic intake"}}
                with self.assertRaises(TimeoutError) as caught:
                    client.call(method, request)
                self.assertIs(caught.exception, error)
                self.assertEqual(error.intake_crm_method, method)
                self.assertEqual(error.intake_crm_attempts, 1)
                self.assertTrue(error.intake_crm_write_attempted)
                api.call.assert_called_once_with(method, request)
                sleep.assert_not_called()

    def test_an_unlisted_operation_is_not_assumed_safe_to_retry(self):
        api = Mock()
        error = TimeoutError("uncertain operation")
        api.call.side_effect = error
        sleep = Mock()
        client = IntakeCrmClient(api, sleep=sleep, clock=lambda: 0)
        with self.assertRaises(TimeoutError) as caught:
            client.call("batch", {"cmd": {}})
        self.assertIs(caught.exception, error)
        api.call.assert_called_once()
        sleep.assert_not_called()

    def test_exhaustion_preserves_the_last_original_exception_and_attempt_count(self):
        failures = [TimeoutError(f"read attempt {attempt}") for attempt in (1, 2, 3)]
        api = Mock()
        api.call.side_effect = failures
        sleep = Mock()
        client = IntakeCrmClient(api, sleep=sleep, clock=lambda: 0)
        with self.assertRaises(TimeoutError) as caught:
            client.call("crm.lead.get", {"id": "10"})
        self.assertIs(caught.exception, failures[-1])
        self.assertEqual(caught.exception.intake_crm_method, "crm.lead.get")
        self.assertEqual(caught.exception.intake_crm_attempts, 3)
        self.assertFalse(caught.exception.intake_crm_write_attempted)
        self.assertEqual(api.call.call_count, 3)
        self.assertEqual(sleep.call_args_list, [call(1), call(2)])

    def test_retry_window_is_shared_from_client_creation(self):
        elapsed = {"seconds": 0}
        api = Mock()
        error = TimeoutError("budget already consumed by earlier reads")
        api.call.side_effect = [[], error]
        sleep = Mock()
        client = IntakeCrmClient(api, sleep=sleep, clock=lambda: elapsed["seconds"],
                                 retry_window_seconds=15)
        self.assertEqual(client.call("crm.status.list", {}), [])
        elapsed["seconds"] = 16
        with self.assertRaises(TimeoutError) as caught:
            client.call("crm.lead.get", {"id": "10"})
        self.assertIs(caught.exception, error)
        self.assertEqual(error.intake_crm_attempts, 1)
        self.assertEqual(api.call.call_count, 2)
        sleep.assert_not_called()

    def test_retry_delay_cannot_overrun_the_global_window(self):
        elapsed = {"seconds": 0}
        api = Mock()
        error = TimeoutError("not enough time for another retry")
        api.call.side_effect = error
        sleep = Mock()
        client = IntakeCrmClient(api, sleep=sleep, clock=lambda: elapsed["seconds"],
                                 retry_window_seconds=15)
        elapsed["seconds"] = 14.5
        with self.assertRaises(TimeoutError) as caught:
            client.call("crm.lead.get", {"id": "10"})
        self.assertIs(caught.exception, error)
        self.assertEqual(error.intake_crm_attempts, 1)
        api.call.assert_called_once()
        sleep.assert_not_called()

    def test_a_read_finishing_at_fourteen_seconds_cannot_start_a_retry_at_the_deadline(self):
        elapsed = {"seconds": 0}
        error = TimeoutError("initial read consumed fourteen seconds")

        def operation(method, request):
            # The in-flight request keeps its transport timeout; the shared
            # window only determines whether another attempt may start.
            elapsed["seconds"] = 14
            raise error

        api = Mock()
        api.call.side_effect = operation
        sleep = Mock()
        client = IntakeCrmClient(api, sleep=sleep, clock=lambda: elapsed["seconds"],
                                 retry_window_seconds=15)
        with self.assertRaises(TimeoutError) as caught:
            client.call("crm.lead.get", {"id": "10"})
        self.assertIs(caught.exception, error)
        self.assertEqual(error.intake_crm_attempts, 1)
        api.call.assert_called_once_with("crm.lead.get", {"id": "10"})
        sleep.assert_not_called()

    def test_read_failure_remembers_an_earlier_write_attempt_in_the_same_client(self):
        api = Mock()
        failures = [TimeoutError(f"verification attempt {attempt}") for attempt in (1, 2, 3)]
        api.call.side_effect = ["100", *failures]
        sleep = Mock()
        client = IntakeCrmClient(api, sleep=sleep, clock=lambda: 0)
        self.assertEqual(client.call("crm.contact.add", {"fields": {}}), "100")
        with self.assertRaises(TimeoutError) as caught:
            client.call("crm.lead.get", {"id": "10"})
        self.assertIs(caught.exception, failures[-1])
        self.assertEqual(caught.exception.intake_crm_method, "crm.lead.get")
        self.assertEqual(caught.exception.intake_crm_attempts, 3)
        self.assertTrue(caught.exception.intake_crm_write_attempted)
        self.assertEqual(api.call.call_count, 4)
        self.assertEqual(sleep.call_args_list, [call(1), call(2)])

    def test_metadata_helper_retries_the_injected_clients_own_lookup(self):
        api = Mock()
        metadata = {"type": "enumeration", "items": [{"ID": "2", "VALUE": "Kestra"}]}
        api.get_lead_field.side_effect = [TimeoutError("metadata timeout"), metadata]
        sleep = Mock()
        client = IntakeCrmClient(api, sleep=sleep, clock=lambda: 0)
        self.assertIs(client.get_lead_field("UF_SYNTHETIC_OWNER"), metadata)
        self.assertEqual(api.get_lead_field.call_args_list, [call("UF_SYNTHETIC_OWNER")] * 2)
        api.call.assert_not_called()
        sleep.assert_called_once_with(1)


class IntakeIdentityRetryIntegrationTests(unittest.TestCase):
    @contextmanager
    def retry_one_lookup(self, api, *, foreign_phone=False):
        original = api.call
        methods = []
        failures = []
        sleep = Mock()

        def flaky(method, request):
            methods.append(method)
            if method == "crm.lead.get" and not failures:
                self.assertIn("crm.duplicate.findbycomm", methods)
                failures.append(method)
                raise TimeoutError("synthetic identity read timeout")
            result = original(method, request)
            if foreign_phone and method == "crm.lead.get":
                result["PHONE"] = [{"VALUE": "+5493519999999"}]
            return result

        factory = lambda inner: IntakeCrmClient(inner, sleep=sleep, clock=lambda: 0)
        with patch.object(api, "call", side_effect=flaky), patch(
                "bitrix24_form_flow.form_processor.whatsapp_intake_crm.IntakeCrmClient", side_effect=factory):
            yield sleep, failures

    def test_retry_after_creation_keeps_one_contact_one_lead_and_uuid_replay_does_not_write(self):
        api = IntakeCrm()
        with self.retry_one_lookup(api) as (sleep, failures):
            first = process(payload(), env=CONFIG, client=api)
            self.assertEqual(first["action"], "queued")
            self.assertEqual((len(api.contacts), len(api.leads)), (1, 1))
            writes = copy.deepcopy(api.writes)
            second = process(payload(), env=CONFIG, client=api)
        self.assertEqual(Counter(method for method, _ in writes),
                         {"crm.contact.add": 1, "crm.lead.add": 1})
        self.assertEqual((second["action"], second["lead_id"], second["contact_id"]),
                         ("already_processed", first["lead_id"], first["contact_id"]))
        self.assertEqual(api.writes, writes)
        self.assertEqual(failures, ["crm.lead.get"])
        sleep.assert_called_once_with(1)

    def test_retry_reading_an_empty_guest_preserves_its_identity_and_reuses_its_lead(self):
        api = IntakeCrm(lead={"ID": "10", "STATUS_SEMANTIC_ID": "P", "STATUS_ID": "UC_PWTVG6",
                             "NAME": "Guest", "PHONE": [{"VALUE": PHONE}]})
        with self.retry_one_lookup(api) as (sleep, failures):
            first = process(payload(), env=CONFIG, client=api)
            writes = copy.deepcopy(api.writes)
            second = process(payload(), env=CONFIG, client=api)
        self.assertEqual((first["action"], first["lead_id"]), ("queued", "10"))
        self.assertEqual((len(api.contacts), len(api.leads)), (1, 1))
        self.assertEqual(Counter(method for method, _ in writes),
                         {"crm.contact.add": 1, "crm.lead.update": 1})
        self.assertEqual(second["action"], "already_processed")
        self.assertEqual(second["lead_id"], "10")
        self.assertEqual(api.writes, writes)
        self.assertEqual(failures, ["crm.lead.get"])
        sleep.assert_called_once_with(1)

    def test_retry_never_bypasses_the_phone_identity_guard(self):
        api = IntakeCrm(lead={"ID": "10", "STATUS_SEMANTIC_ID": "P", "STATUS_ID": "UC_PWTVG6",
                             "NAME": "Guest", "PHONE": [{"VALUE": PHONE}]})
        before = copy.deepcopy(api.leads)
        with self.retry_one_lookup(api, foreign_phone=True) as (sleep, failures):
            with self.assertRaisesRegex(ValueError, "another channel"):
                process(payload(), env=CONFIG, client=api)
        self.assertEqual(api.writes, [])
        self.assertEqual(api.leads, before)
        self.assertEqual(api.contacts, {})
        self.assertEqual(failures, ["crm.lead.get"])
        sleep.assert_called_once_with(1)


if __name__ == "__main__":
    unittest.main()
