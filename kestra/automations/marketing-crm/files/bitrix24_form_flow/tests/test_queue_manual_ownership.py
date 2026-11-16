"""Queue recovery must preserve live human assignments, including chat-only ones."""
from datetime import datetime
import unittest
from unittest.mock import patch

import test_business_logic as fixtures
from bitrix24_form_flow.form_processor import catamarca_deal_qualification as queue
from bitrix24_form_flow.form_processor.config import load_config
from bitrix24_form_flow.form_processor.deal_service import assign_open_line_chats_to_user


class QueueManualOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.BusinessLogicTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.client = fixtures.FakeBitrixClient()
        self.client.online_user_ids = {71159}
        self.client.leads[960] = self.fixture._cordoba_enriched_lead(
            960, employment_id="1239", bcra_entities=[])
        self.client.leads[960]["ASSIGNED_BY_ID"] = 57
        self.client.deals[960] = self.fixture._queued_deal(
            960, 960, "cordoba_general", "2026-11-09T23:00:00-03:00")
        self.config = load_config(self.fixture.env)
        self.now = datetime.fromisoformat("2026-11-10T11:00:00-03:00")

    def chat(self, owner=10451, line=1, active=True):
        self.client.open_line_chats[("deal", 960)] = [116891]
        self.client.open_line_dialogs[116891] = {
            "id": 116891, "entity_id": f"whatsappbyedna|{line}|fixture|fixture",
            "entity_data_1": "Y|DEAL|960|N|N|117891|0|0|0|DEFAULT",
            "text_field_enabled": active, "owner": owner,
        }

    def run_queue(self):
        return queue.process_distribution_queue(
            env=self.fixture.env, bitrix_client=self.client,
            logger=fixtures.SilentLogger(), now=self.now)

    def assert_preserved(self, owner=10451):
        result = self.run_queue()
        self.assertTrue(result["ok"])
        self.assertEqual(self.client.deals[960]["assignedById"], owner)
        self.assertEqual(self.client.leads[960]["ASSIGNED_BY_ID"], owner)
        self.assertEqual(self.client.deals[960]["stageId"], "C1:NEW")
        self.assertEqual(result["events"][0]["reason"], "manual_assignment_preserved")
        self.assertFalse(self.client.chat_transfers)

    def test_preserves_deal_owner_even_when_offline(self):
        self.client.deals[960]["assignedById"] = 10451
        self.assert_preserved()

    def test_preserves_lead_owner(self):
        self.client.leads[960]["ASSIGNED_BY_ID"] = 10451
        self.assert_preserved()

    def test_preserves_chat_only_owner(self):
        self.chat()
        self.assert_preserved()

    def test_conflicting_owners_go_to_review_without_reassignment(self):
        self.client.deals[960]["assignedById"] = 10451
        self.client.leads[960]["ASSIGNED_BY_ID"] = 68579
        self.chat(owner=90231)
        result = self.run_queue()
        self.assertTrue(result["ok"])
        self.assertEqual(result["events"][0]["reason"], "manual_assignment_conflict")
        self.assertEqual(self.client.deals[960]["assignedById"], 10451)
        self.assertEqual(self.client.leads[960]["ASSIGNED_BY_ID"], 68579)
        self.assertEqual(self.client.deals[960]["stageId"], self.config.deal.manual_review_stage_id)
        self.assertFalse(self.client.chat_transfers)

    def assert_automatic_routing(self):
        result = self.run_queue()
        self.assertTrue(result["ok"])
        self.assertEqual(self.client.deals[960]["assignedById"], 71159)
        self.assertFalse(self.client.chat_transfers)

    def test_collections_chat_does_not_override_commercial_routing(self):
        self.chat(line=3)
        self.assert_automatic_routing()

    def test_closed_chat_does_not_override_commercial_routing(self):
        self.chat(active=False)
        self.assert_automatic_routing()

    def test_deal_moved_after_listing_is_not_modified(self):
        stale = dict(self.client.deals[960])
        self.client.deals[960].update(stageId="C1:NEW", assignedById=10451)
        before = dict(self.client.deals[960])
        result = queue._retry_queued_deal(self.client, self.config, stale, fixtures.SilentLogger(), self.now)
        self.assertEqual(result["reason"], "deal_left_queue")
        self.assertEqual(self.client.deals[960], before)
        self.assertFalse(self.client.chat_transfers)

    def test_assignment_during_seller_selection_is_preserved(self):
        original = queue.resolve_round_robin_assignee
        def selection(*args, **kwargs):
            assignment = original(*args, **kwargs)
            self.client.deals[960]["assignedById"] = 10451
            return assignment
        with patch.object(queue, "resolve_round_robin_assignee", side_effect=selection):
            self.assert_preserved()

    def test_late_chat_owner_change_prevents_transfer(self):
        self.chat(owner=90231)
        result = assign_open_line_chats_to_user(
            self.client, lead_id=960, contact_id=101, deal_id=960,
            assigned_by_id=71159, distributable_open_line_ids=(1,),
            logger=fixtures.SilentLogger(), preserve_existing_ownership=True)
        self.assertEqual(result.skipped_chats, ((116891, "manual_owner_preserved"),))
        self.assertFalse(self.client.chat_transfers)

    def test_failed_chat_inspection_keeps_case_in_queue(self):
        self.chat()
        with patch.object(queue, "active_open_line_owners", side_effect=RuntimeError("inspection unavailable")):
            result = self.run_queue()
        self.assertFalse(result["ok"])
        self.assertEqual(self.client.deals[960]["stageId"], "C1:KESTRA_QUEUE")
        self.assertEqual(self.client.deals[960]["assignedById"], 57)
        self.assertFalse(self.client.chat_transfers)

    def test_weekly_close_preserves_human_assignment(self):
        self.client.deals[960]["assignedById"] = 10451
        self.now = datetime.fromisoformat("2026-11-13T17:00:00-03:00")
        self.assert_preserved()
