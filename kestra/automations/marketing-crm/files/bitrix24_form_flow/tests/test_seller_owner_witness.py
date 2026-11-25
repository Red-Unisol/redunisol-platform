"""The decision to follow a seller belongs to an exact, still-open Bitrix session."""
import unittest
from unittest.mock import patch

from test_qualifier_chat_attention import AttentionClient
import test_business_logic as fixtures
from bitrix24_form_flow.form_processor import catamarca_deal_qualification as qualify


class SellerChatWitnessTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.BusinessLogicTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.client = AttentionClient()
        self.client.online_user_ids = {68579}
        self.client.leads[920] = self.fixture._catamarca_enriched_lead(920, bcra_entities=[])
        self.client.deals[930] = {
            "id": 930, "categoryId": 1, "stageId": "C1:KESTRA_PENDING",
            "leadId": 920, "contactId": 101, "assignedById": 57, "createdTime": "2026-07-31T12:00:00+00:00",
        }
        self.client.open_line_chats[("contact", 101)] = [777]
        dialog = self.client.call("imopenlines.dialog.get", {"CHAT_ID": 777})
        self.client.open_line_dialogs[777] = {**dialog, "owner": 90231}

    def qualify(self):
        return qualify.qualify_catamarca_deal(930, env=self.fixture.env,
            bitrix_client=self.client, logger=fixtures.SilentLogger())

    def assert_no_seller_write(self):
        self.assertEqual(self.client.deals[930]["assignedById"], 57)
        self.assertFalse(self.client.chat_transfers)
        self.assertFalse(any(
            "ASSIGNED_BY_ID" in data.get("fields", {}) or "assignedById" in data.get("fields", {})
            for method, data in self.client.calls if method in {"crm.lead.update", "crm.item.update"}
        ))

    def test_chat_unlinked_between_seller_discovery_and_second_preflight(self):
        original = qualify._sales_chat_ownership

        def unlink_after_read(*args):
            ownership = original(*args)
            self.client.open_line_chats[("contact", 101)] = []
            return ownership

        with patch.object(qualify, "_sales_chat_ownership", side_effect=unlink_after_read):
            result = self.qualify()
        self.assertEqual(result["reason"], "seller_chat_witness_changed")
        self.assert_no_seller_write()

    def test_same_chat_and_session_returned_to_default_before_assignment(self):
        original = qualify.resolve_routing_bucket

        def return_to_default(*args, **kwargs):
            self.client.open_line_dialogs[777]["owner"] = 74827
            return original(*args, **kwargs)

        with patch.object(qualify, "resolve_routing_bucket", side_effect=return_to_default):
            result = self.qualify()
        self.assertEqual(result["reason"], "seller_chat_witness_changed")
        self.assert_no_seller_write()

    def test_same_seller_on_reopened_session_does_not_keep_the_original_witness(self):
        config = qualify.load_config(self.fixture.env)
        deal = {**self.client.deals[930], "_seller_chat_owner": 90231,
                "_seller_chat_witness": {777: (1777, 90231)}}
        dialog = self.client.open_line_dialogs[777]
        dialog["entity_data_1"] = dialog["entity_data_1"].replace("|1777|", "|2777|")
        self.assertEqual(qualify._seller_chat_witness_reason(self.client, config, deal),
                         "seller_chat_witness_changed")
