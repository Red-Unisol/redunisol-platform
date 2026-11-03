from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from bitrix24_form_flow.form_processor.catamarca_deal_qualification import qualify_catamarca_deal, process_distribution_queue
from bitrix24_form_flow.form_processor.deal_service import resolve_round_robin_assignee
import test_expanded_deals as fixtures
from test_business_logic import SilentLogger

WEEKEND = datetime.fromisoformat("2026-10-31T12:00:00-03:00")


class SingleSellerDistributionTests(unittest.TestCase):
    seed = fixtures.ExpandedDealTests.seed

    def setUp(self):
        fixtures.ExpandedDealTests.setUp(self)
        self.env["BITRIX24_DISTRIBUTION_BUSINESS_HOURS_ONLY"] = "true"
        self.client.online_user_ids.clear()

    def qualify_at(self, now=WEEKEND):
        return qualify_catamarca_deal(960, env=self.env, bitrix_client=self.client, logger=SilentLogger(), now=now)

    def pool(self, key, sellers):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({key: sellers}).encode()
        return patch("bitrix24_form_flow.form_processor.config.urlopen", return_value=response)

    def test_singleton_does_not_require_presence_history_or_compensation(self):
        client = MagicMock()
        with patch("bitrix24_form_flow.form_processor.deal_service.apply_volume_compensation") as compensation:
            assignment = resolve_round_robin_assignee(client, self.config, contact_id=101, deal_id=960,
                lead_id=950, bucket_key="neuquen", bucket_field=self.config.deal.routing_bucket_field,
                pool=(58913,), legacy_province_label=None, logger=SilentLogger())
        self.assertEqual(assignment.assigned_by_id, 58913)
        self.assertEqual(assignment.strategy, "single_seller")
        self.assertEqual(assignment.configured_pool, (58913,))
        self.assertEqual(assignment.online_pool, ())  # Presence was not checked.
        client.call.assert_not_called()
        compensation.assert_not_called()

    def test_offline_singleton_is_assigned_on_friday_cutoff_weekend_and_old_creation_time(self):
        for now in (datetime.fromisoformat("2026-10-30T17:00:00-03:00"), WEEKEND):
            with self.subTest(now=now):
                self.seed(province="213")
                self.client.deals[960]["createdTime"] = "2026-10-24T12:00:00-03:00"
                result = self.qualify_at(now)
                self.assertEqual(result["distribution_action"], "assigned")
                self.assertEqual(result["assigned_by_id"], 58913)
                self.assertEqual(result["commercial_line"], "MUDON")
                self.assertFalse(result["within_business_hours"])
                self.assertEqual(self.client.deals[960]["stageId"], "C1:NEW")
                self.assertEqual(self.client.leads[950]["ASSIGNED_BY_ID"], 58913)

    def test_panel_reduced_pool_of_one_gets_the_general_exception(self):
        self.seed(province="279")
        self.env["BITRIX24_ROUTING_CONFIG_URL"] = "https://example.test/pools"
        with self.pool("santa_fe_anses", [29]):
            result = self.qualify_at()
        self.assertEqual(result["distribution_action"], "assigned")
        self.assertEqual(result["assigned_by_id"], 29)
        self.assertEqual(result["commercial_line"], "Haberes Premium")

    def test_multiple_configured_sellers_with_one_online_still_obey_hours(self):
        self.seed(province="279")
        self.client.online_user_ids = {29}
        result = self.qualify_at()
        self.assertEqual(result["distribution_action"], "manual_owner")
        self.assertEqual(result["distribution_reason"], "outside_business_hours")
        self.assertEqual(result["assigned_by_id"], 57)

    def test_empty_paused_pool_never_assigns_a_seller(self):
        self.seed(province="213")
        self.client.online_user_ids = {58913}
        self.env["BITRIX24_ROUTING_CONFIG_URL"] = "https://example.test/pools"
        with self.pool("neuquen", []):
            result = self.qualify_at(fixtures.NOW)
        self.assertEqual(result["distribution_action"], "queued")
        self.assertEqual(result["distribution_reason"], "routing_pool_paused")
        self.assertEqual(self.client.deals[960]["assignedById"], 57)

    def test_commercial_rejection_is_not_overridden_by_singleton(self):
        self.seed(province="279", count=8)
        self.env["BITRIX24_ROUTING_CONFIG_URL"] = "https://example.test/pools"
        with self.pool("santa_fe_anses", [29]):
            result = self.qualify_at()
        self.assertEqual(result["commercial_action"], "rejected")
        self.assertEqual(result["distribution_action"], "not_applicable")
        self.assertEqual(result["assigned_by_id"], 57)
        self.assertEqual(self.client.deals[960]["stageId"], "C1:5")

    def test_failed_chat_transfer_does_not_fail_or_postpone_ownership(self):
        for chats, expected_status, expected_count in (([77], "transfer_failed", 0),
                                                      ([77, 78], "partially_transferred", 1)):
            with self.subTest(chats=chats):
                self.seed(province="213")
                self.client.open_line_chats[("deal", 960)] = chats
                original_call = self.client.call
                def call(method, payload):
                    if method == "imopenlines.operator.transfer" and payload["CHAT_ID"] == 77:
                        raise RuntimeError("Offline seller cannot accept this chat")
                    return original_call(method, payload)
                with patch.object(self.client, "call", side_effect=call):
                    result = self.qualify_at()
                self.assertTrue(result["ok"])
                self.assertEqual(result["distribution_action"], "assigned")
                self.assertEqual(result["chat_transfer_status"], expected_status)
                self.assertEqual(result["transferred_chat_count"], expected_count)
                self.assertEqual(self.client.deals[960]["assignedById"], 58913)
                self.assertEqual(self.client.deals[960]["stageId"], "C1:NEW")

    def test_all_old_singleton_queue_entries_drain_outside_hours_preserving_decisions(self):
        self.seed(province="213")
        for deal_id, lead_id in ((960, 950), (961, 951)):
            self.client.leads[lead_id] = {**self.client.leads[950], "ID": str(lead_id)}
            self.client.deals[deal_id] = {**self.client.deals[960], "id": deal_id, "leadId": lead_id,
                "stageId": "C1:KESTRA_QUEUE", "ufCrmRouteBucket": "neuquen",
                "ufCrmKqAction": "approved", "ufCrmKqReason": "neuquen_approved",
                "ufCrmKqStage": "C1:NEW", "ufCrmKqAt": "2026-10-19T10:00:00-03:00",
                "ufCrm_659EBB0445E8E": "MUDON"}
        result = process_distribution_queue(env=self.env, bitrix_client=self.client,
                                             logger=SilentLogger(), now=WEEKEND)
        self.assertEqual(result["distributed_count"], 2)
        self.assertEqual(result["closed_count"], 0)
        for event in result["events"]:
            self.assertFalse(event["within_business_hours"])
            self.assertEqual(event["commercial_reason"], "neuquen_approved")
            self.assertEqual(event["commercial_line"], "MUDON")
            deal = self.client.deals[event["deal_id"]]
            self.assertEqual(deal["assignedById"], 58913)
            self.assertEqual(deal["stageId"], "C1:NEW")
            self.assertEqual(deal["ufCrmKqAt"], "")


if __name__ == "__main__":
    unittest.main()
