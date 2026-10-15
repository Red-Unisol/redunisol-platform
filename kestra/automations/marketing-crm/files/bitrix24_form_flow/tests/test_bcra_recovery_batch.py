from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from email.message import Message
from io import BytesIO
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, call, patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import test_business_logic as fixtures
from bitrix24_form_flow.form_processor.bcra_client import (
    BcraClient, deserialize_bcra_result, serialize_bcra_result,
)
from bitrix24_form_flow.form_processor.bcra_service import (
    BcraRetryState, _retry_delay, bcra_retry_state_from_lead, sync_lead_bcra,
)
from bitrix24_form_flow.form_processor.catamarca_deal_qualification import (
    process_pending_catamarca_deals, qualify_catamarca_deal,
)
from bitrix24_form_flow.form_processor.config import load_config

CLIENT = "bitrix24_form_flow.form_processor.bcra_client"
QUALIFIER = "bitrix24_form_flow.form_processor.catamarca_deal_qualification"
NOW = datetime.fromisoformat("2026-10-15T11:30:00-03:00")


def response():
    result = MagicMock()
    result.__enter__.return_value.read.return_value = json.dumps({
        "status": 200, "results": {"periodos": []},
    }).encode()
    return result


def http_error(code, retry_after=None):
    headers = Message()
    if retry_after is not None:
        headers["Retry-After"] = retry_after
    return HTTPError("https://example.test", code, "error", headers, BytesIO(b"{}"))


class BcraHttpRecoveryTests(unittest.TestCase):
    def setUp(self):
        sleeper = patch(CLIENT + ".sleep")
        self.sleep = sleeper.start()
        self.addCleanup(sleeper.stop)

    def test_connection_reset_and_500_recover_in_same_consultation(self):
        with patch(CLIENT + ".urlopen", side_effect=[
            ConnectionResetError("reset"), http_error(500), response(),
        ]) as request:
            result = BcraClient().consult_snapshot("27555555556")
        self.assertEqual(result.outcome, "ok")
        self.assertEqual(request.call_count, 3)
        self.assertEqual(self.sleep.call_args_list, [call(1), call(3)])

    def test_stops_after_three_failed_attempts(self):
        with patch(CLIENT + ".urlopen", side_effect=ConnectionResetError("reset")) as request:
            result = BcraClient().consult_snapshot("27555555556")
        self.assertEqual(result.outcome, "temporary_error")
        self.assertEqual(request.call_count, 3)

    def test_truncated_500_body_still_recovers(self):
        error = http_error(500)
        with patch.object(error, "read", side_effect=ConnectionResetError("body reset")), patch(
            CLIENT + ".urlopen", side_effect=[error, response()],
        ) as request:
            result = BcraClient().consult_snapshot("27555555556")
        self.assertEqual(result.outcome, "ok")
        self.assertEqual(request.call_count, 2)

    def test_does_not_retry_definitive_errors_or_rate_limits(self):
        for code, expected in [(400, "invalid_identification"), (404, "not_found"), (429, "rate_limited")]:
            with self.subTest(code=code), patch(CLIENT + ".urlopen", side_effect=http_error(code)) as request:
                result = BcraClient().consult_snapshot("27555555556")
                self.assertEqual(result.outcome, expected)
                request.assert_called_once()
        self.sleep.assert_not_called()

    def test_shared_timeout_budget_prevents_three_full_timeouts(self):
        with patch(CLIENT + ".monotonic", side_effect=[0, 20]), patch(
            CLIENT + ".urlopen", side_effect=TimeoutError("timeout"),
        ) as request:
            result = BcraClient().consult_snapshot("27555555556")
        self.assertEqual(result.outcome, "temporary_error")
        request.assert_called_once()
        self.sleep.assert_not_called()

    def test_retry_after_seconds_and_http_date_survive_serialization(self):
        for header in ["1200", "Thu, 15 Oct 2037 18:00:00 GMT"]:
            with self.subTest(header=header), patch(CLIENT + ".urlopen", side_effect=http_error(503, header)) as request:
                before = datetime.now(timezone.utc)
                result = BcraClient().consult_snapshot("27555555556")
                request.assert_called_once()
                self.assertGreater(datetime.fromisoformat(result.retry_not_before), before)
                self.assertEqual(deserialize_bcra_result(serialize_bcra_result(result)), result)
        self.sleep.assert_not_called()


class BcraScheduledRecoveryTests(unittest.TestCase):
    def test_business_backoff_is_one_five_fifteen_minutes(self):
        for attempt, minutes in [(1, 1), (2, 5), (3, 15), (4, 15), (8, 15)]:
            self.assertEqual(_retry_delay(attempt, NOW), timedelta(minutes=minutes))

    def test_outside_weekly_window_preserves_conservative_backoff(self):
        friday_close = datetime.fromisoformat("2026-10-16T17:00:00-03:00")
        for attempt, minutes in [(1, 5), (2, 30), (3, 120), (4, 360)]:
            self.assertEqual(_retry_delay(attempt, friday_close), timedelta(minutes=minutes))

    def test_legacy_six_hour_wait_is_shortened_without_resetting_attempts(self):
        state = BcraRetryState(
            outcome="temporary_error", attempts=6, first_failed_at=NOW - timedelta(hours=10),
            last_failed_at=NOW, next_retry_at=NOW + timedelta(hours=6),
            expires_at=NOW + timedelta(hours=14), message="reset",
        )
        self.assertFalse(state.is_due(NOW + timedelta(minutes=14)))
        self.assertTrue(state.is_due(NOW + timedelta(minutes=15)))
        self.assertEqual(state.attempts, 6)

    def test_provider_retry_after_takes_precedence_over_cap(self):
        state = BcraRetryState(
            outcome="rate_limited", attempts=4, first_failed_at=NOW,
            last_failed_at=NOW, next_retry_at=NOW + timedelta(minutes=45),
            expires_at=NOW + timedelta(hours=24), message="limit",
            not_before=NOW + timedelta(minutes=45),
        )
        self.assertFalse(state.is_due(NOW + timedelta(minutes=15)))
        self.assertTrue(state.is_due(NOW + timedelta(minutes=45)))


class DealBatchRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.fixtures = fixtures.BusinessLogicTests()
        self.fixtures.setUp()
        self.addCleanup(self.fixtures.doCleanups)
        self.env = self.fixtures.env
        self.client = fixtures.FakeBitrixClient()
        self.logger = fixtures.SilentLogger()

    def add_deal(self, deal_id):
        lead = self.fixtures._catamarca_enriched_lead(deal_id, bcra_entities=[])
        lead["UF_CRM_BCRA_CHECKED_AT"] = NOW.isoformat()
        self.client.leads[deal_id] = lead
        self.client.deals[deal_id] = self.fixtures._pending_deal(deal_id, deal_id)
        self.client.open_line_chats[("lead", deal_id)] = [deal_id + 1000]

    def batch(self):
        return process_pending_catamarca_deals(
            env=self.env, bitrix_client=self.client, logger=self.logger, now=NOW,
        )

    def temporary_result(self, outcome="temporary_error"):
        result = self.fixtures._deal_bcra_result(
            identification="27555555556", checked_at=NOW.isoformat(), entities=[],
        )
        return replace(result, outcome=outcome, http_status=429 if outcome == "rate_limited" else 500,
                       formatted_field_value=None, summary_field_value=None, raw_field_value=None)

    def test_processes_five_in_order_and_next_cycle_does_not_repeat_transfers(self):
        for deal_id in range(930, 937):
            self.add_deal(deal_id)
        first = self.batch()
        self.assertTrue(first["ok"])
        self.assertEqual([x["deal_id"] for x in json.loads(first["events_json"])], list(range(930, 935)))
        second = self.batch()
        self.assertEqual([x["deal_id"] for x in json.loads(second["events_json"])], [935, 936])
        self.assertEqual(len(self.client.chat_transfers), 7)
        self.assertEqual(len({x["CHAT_ID"] for x in self.client.chat_transfers}), 7)
        self.assertEqual(self.batch()["event_count"], 0)

    def test_pending_bcra_case_is_attempted_once_and_does_not_block_batch(self):
        for deal_id in range(930, 933):
            self.add_deal(deal_id)
        self.client.leads[930]["UF_CRM_BCRA_DATA_RAW"] = ""
        bcra = fixtures.FakeBcraClient({"27555555556": self.temporary_result()})
        result = process_pending_catamarca_deals(
            env=self.env, bitrix_client=self.client, bcra_client=bcra, logger=self.logger, now=NOW,
        )
        events = json.loads(result["events_json"])
        self.assertEqual([x["action"] for x in events], ["bcra_pending", "approved", "approved"])
        self.assertEqual(bcra.calls, ["27555555556"])
        self.assertEqual(self.client.deals[930]["stageId"], "C1:KESTRA_PENDING")

    def test_rate_limit_persists_retry_after_and_defers_remaining_batch(self):
        for deal_id in range(930, 933):
            self.add_deal(deal_id)
        self.client.leads[930]["UF_CRM_BCRA_DATA_RAW"] = ""
        retry_at = NOW + timedelta(minutes=45)
        bcra = fixtures.FakeBcraClient({"27555555556": replace(
            self.temporary_result("rate_limited"), retry_not_before=retry_at.isoformat(),
        )})
        result = process_pending_catamarca_deals(
            env=self.env, bitrix_client=self.client, bcra_client=bcra, logger=self.logger, now=NOW,
        )
        self.assertEqual(result["event_count"], 1)
        self.assertEqual(result["deferred_count"], 2)
        state = bcra_retry_state_from_lead(self.client.leads[930], load_config(self.env))
        self.assertEqual(state.next_retry_at, retry_at)
        self.assertFalse(state.is_due(NOW + timedelta(minutes=15)))
        self.assertFalse(self.client.chat_transfers)

    def test_three_http_failures_count_as_one_persisted_cycle(self):
        self.add_deal(930)
        lead = self.client.leads[930]
        lead["UF_CRM_BCRA_DATA_RAW"] = ""
        with patch(CLIENT + ".urlopen", side_effect=ConnectionResetError("reset")) as request, patch(CLIENT + ".sleep"):
            result = sync_lead_bcra(
                self.client, load_config(self.env), 930, "27555555556", self.logger,
                lead=lead, now=NOW,
            )
        state = bcra_retry_state_from_lead(lead, load_config(self.env))
        self.assertEqual(result.outcome, "temporary_error")
        self.assertEqual(request.call_count, 3)
        self.assertEqual(state.attempts, 1)
        self.assertEqual(state.first_failed_at, NOW)
        self.assertEqual(state.next_retry_at, NOW + timedelta(minutes=1))

    def test_time_budget_defers_remaining_cases(self):
        for deal_id in range(930, 933):
            self.add_deal(deal_id)
        with patch(QUALIFIER + ".monotonic", side_effect=[0, 51]):
            result = self.batch()
        self.assertEqual(result["event_count"], 1)
        self.assertEqual(result["deferred_count"], 2)

    def test_error_is_traced_and_next_case_still_runs(self):
        for deal_id in range(930, 933):
            self.add_deal(deal_id)
        def qualify(deal_id, **kwargs):
            if deal_id == 930:
                raise RuntimeError("Bitrix unavailable for this case")
            return qualify_catamarca_deal(deal_id, **kwargs)
        with patch(QUALIFIER + ".qualify_catamarca_deal", side_effect=qualify):
            result = self.batch()
        self.assertFalse(result["ok"])
        self.assertEqual([x["action"] for x in json.loads(result["events_json"])], ["error", "approved", "approved"])

    def test_rechecks_stage_after_selection_before_assigning(self):
        self.add_deal(930)
        with patch(QUALIFIER + ".qualify_catamarca_deal", wraps=qualify_catamarca_deal) as qualify:
            def move_stage(*args, **kwargs):
                self.client.deals[930]["stageId"] = "C1:NEW"
                return qualify_catamarca_deal(*args, **kwargs)
            qualify.side_effect = move_stage
            result = self.batch()
        self.assertEqual(json.loads(result["events_json"])[0]["action"], "skipped")
        self.assertFalse(self.client.chat_transfers)

    def test_selector_finishes_pagination_before_mutating_stages(self):
        for deal_id in range(930, 934):
            self.add_deal(deal_id)
        original = self.client.call_full
        def paged(method, payload):
            result = original(method, payload)
            if method == "crm.item.list":
                items = result["result"]["items"]
                start = payload.get("start", 0)
                result = {"result": {"items": items[start:start + 2]}}
                if start + 2 < len(items):
                    result["next"] = start + 2
            return result
        with patch.object(self.client, "call_full", side_effect=paged):
            result = self.batch()
        self.assertEqual(result["event_count"], 4)
        self.assertEqual(len(self.client.chat_transfers), 4)


if __name__ == "__main__":
    unittest.main()
