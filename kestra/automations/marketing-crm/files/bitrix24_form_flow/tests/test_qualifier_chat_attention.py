"""Human attention always wins over a scheduled commercial transfer."""
import copy
from datetime import datetime, timezone
import unittest
from unittest.mock import patch

import test_business_logic as fixtures
from bitrix24_form_flow.form_processor import catamarca_deal_qualification as qualify
from bitrix24_form_flow.form_processor.deal_service import (
    assign_open_line_chats_to_user, inspect_open_line_assignments,
)


class AttentionClient(fixtures.FakeBitrixClient):
    def __init__(self):
        super().__init__()
        self.session_changes = {}
        self.stat_changes = {}
        self.native_transfers = []
        self.history_changes = {}
        self.before = None

    def call(self, method, payload):
        if self.before:
            self.before(method, payload)
        result = super().call(method, payload)
        if method == "imopenlines.v2.Session.list":
            for row in result["sessions"]:
                row.update(copy.deepcopy(self.session_changes))
        elif method == "imopenlines.v2.Session.Stat.get":
            result["sessions"][0].update(copy.deepcopy(self.stat_changes))
        elif method == "imopenlines.v2.Session.Transfer.list":
            result["transfers"] = copy.deepcopy(self.native_transfers)
        elif method == "imopenlines.session.history.get":
            result.update(copy.deepcopy(self.history_changes))
        return result


class QualifierAttentionTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.BusinessLogicTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.reset_client()

    def reset_client(self):
        self.client = AttentionClient()
        self.client.online_user_ids = {68579}
        self.client.leads[920] = self.fixture._catamarca_enriched_lead(920, bcra_entities=[])
        self.client.deals[930] = {"id": 930, "categoryId": 1, "stageId": "C1:KESTRA_PENDING",
            "leadId": 920, "contactId": 101, "assignedById": 57, "createdTime": "2026-07-31T12:00:00+00:00"}
        self.client.open_line_chats[("contact", 101)] = [777]

    def run_qualification(self):
        return qualify.qualify_catamarca_deal(930, env=self.fixture.env,
            bitrix_client=self.client, logger=fixtures.SilentLogger())

    def assert_no_assignment(self):
        writes = [(method, body) for method, body in self.client.calls
                  if method == "crm.lead.update" and "ASSIGNED_BY_ID" in body.get("fields", {})
                  or method == "crm.item.update" and "assignedById" in body.get("fields", {})]
        self.assertFalse(writes)
        self.assertFalse(self.client.chat_transfers)
        self.assertEqual(self.client.deals[930]["assignedById"], 57)
        self.assertEqual(self.client.deals[930]["stageId"], "C1:KESTRA_ROUTE_REVIEW")
        stage_writes = [body["fields"] for method, body in self.client.calls
                        if method == "crm.item.update" and "stageId" in body.get("fields", {})]
        self.assertTrue(stage_writes)
        self.assertTrue(all(set(fields) == {"stageId", "ufCrmKqReason"} for fields in stage_writes))

    def test_unattended_current_sales_chat_routes_without_accepting_it(self):
        result = self.run_qualification()
        self.assertEqual(result["action"], "approved")
        self.assertEqual(self.client.chat_transfers, [{"CHAT_ID": 777, "USER_ID": 68579}])
        self.assertFalse(any(".answer" in method or ".start" in method or ".join" in method for method, _ in self.client.calls))

    def test_acceptance_status_or_reply_preserves_even_the_default_owner(self):
        for field, value in [("dateOperatorAnswer", "2026-11-10T18:00:01Z"),
                             ("dateFirstAnswer", "2026-11-10T18:00:01Z"), ("status", "answered")]:
            with self.subTest(field=field):
                self.reset_client()
                self.client.session_changes = {field: value}
                result = self.run_qualification()
                self.assertEqual(result["reason"], "operator_attention_preserved")
                self.assert_no_assignment()

    def test_a_manual_return_to_maru_is_not_undone_by_the_direct_qualifier(self):
        self.client.open_line_dialogs[777] = self.client.call("imopenlines.dialog.get", {"CHAT_ID": 777})
        self.client.open_line_dialogs[777]["owner"] = 57
        self.client.native_transfers = [{"sessionId": 1777, "type": "USER", "mode": "MANUAL", "initiatorId": 71283, "toOperatorId": 57}]
        result = self.run_qualification()
        self.assertEqual(result["reason"], "manual_transfer_preserved")
        self.assert_no_assignment()

    def test_manual_operator_messages_with_lagging_answer_dates_preserve_responsibles(self):
        self.client.history_changes = {"message": {"1": {"id": "1", "chatid": "777", "senderid": "57"}},
                                       "users": {"57": {"connector": False}}}
        result = self.run_qualification()
        self.assertEqual(result["reason"], "operator_message_preserved")
        self.assert_no_assignment()

    def test_a_foreign_crm_or_chat_owner_is_preserved(self):
        for record in ("lead", "deal", "chat"):
            with self.subTest(record=record):
                self.reset_client()
                if record == "lead": self.client.leads[920]["ASSIGNED_BY_ID"] = 90231
                elif record == "deal": self.client.deals[930]["assignedById"] = 90231
                else:
                    self.client.open_line_dialogs[777] = self.client.call("imopenlines.dialog.get", {"CHAT_ID": 777})
                    self.client.open_line_dialogs[777]["owner"] = 90231
                result = self.run_qualification()
                self.assertEqual(result["reason"], "manual_owner_preserved")
                self.assertFalse(self.client.chat_transfers)
                self.assertFalse(any(method == "crm.lead.update" or method == "crm.item.update"
                    and "assignedById" in body.get("fields", {}) for method, body in self.client.calls))
                self.client.leads[920]["ASSIGNED_BY_ID"] = 57
                self.client.deals[930]["assignedById"] = 57

    def test_attention_during_seller_selection_is_checked_before_first_owner_write(self):
        original = qualify.resolve_round_robin_assignee
        def select(*args, **kwargs):
            assignment = original(*args, **kwargs)
            self.client.session_changes["dateOperatorAnswer"] = "2026-11-10T18:00:02Z"
            return assignment
        with patch.object(qualify, "resolve_round_robin_assignee", side_effect=select):
            result = self.run_qualification()
        self.assertEqual(result["reason"], "operator_attention_preserved")
        self.assert_no_assignment()

    def test_a_late_same_owner_acceptance_is_caught_in_the_second_session_frame(self):
        reads = 0
        def change(method, body):
            nonlocal reads
            if method == "imopenlines.v2.Session.list":
                reads += 1
                if reads == 2:
                    self.client.session_changes["dateOperatorAnswer"] = "2026-11-10T18:00:02Z"
        self.client.before = change
        self.run_qualification()
        self.assert_no_assignment()

    def test_human_attention_during_empty_pool_selection_does_not_write_provisional_owners(self):
        def unavailable(*args, **kwargs):
            self.client.session_changes["dateOperatorAnswer"] = "2026-11-10T18:00:02Z"
            raise qualify.NoOnlineSellersError(())
        with patch.object(qualify, "resolve_round_robin_assignee", side_effect=unavailable):
            result = self.run_qualification()
        self.assertEqual(result["reason"], "operator_attention_preserved")
        self.assert_no_assignment()

    def test_a_late_manual_transfer_is_caught_in_the_second_transfer_frame(self):
        reads = 0
        def change(method, body):
            nonlocal reads
            if method == "imopenlines.v2.Session.Transfer.list":
                reads += 1
                if reads == 2:
                    self.client.native_transfers = [{"sessionId": 1777, "type": "USER", "mode": "MANUAL"}]
        self.client.before = change
        self.run_qualification()
        self.assert_no_assignment()

    def test_accepted_or_reopened_after_crm_assignment_never_causes_a_chat_post(self):
        for change in ("accepted", "reopened"):
            with self.subTest(change=change):
                self.reset_client()
                def mutate(method, body):
                    if method == "crm.item.update" and "assignedById" in body.get("fields", {}):
                        if change == "accepted": self.client.session_changes["dateOperatorAnswer"] = "2026-11-10T18:00:02Z"
                        else:
                            dialog = self.client.call("imopenlines.dialog.get", {"CHAT_ID": 777})
                            dialog["entity_data_1"] = dialog["entity_data_1"].replace("|1777|", "|1778|")
                            self.client.open_line_dialogs[777] = dialog
                self.client.before = mutate
                result = self.run_qualification()
                self.assertFalse(self.client.chat_transfers)
                self.assertEqual(result["transferred_chat_count"], 0)

    def test_missing_truncated_and_unknown_native_evidence_never_changes_crm_owners(self):
        cases = ["history_page", "unknown_sender", "operator_stat", "bad_stat", "missing_transfer", "wrong_session"]
        for condition in cases:
            with self.subTest(condition=condition):
                self.reset_client()
                if condition == "history_page": self.client.history_changes = {"hasNextPage": True}
                elif condition == "unknown_sender": self.client.history_changes = {"message": [{"id": 1, "chatid": 777, "senderid": 999}]}
                elif condition == "operator_stat": self.client.stat_changes = {"messagesOperatorCount": 1}
                elif condition == "bad_stat": self.client.stat_changes = {"messagesOperatorCount": True}
                elif condition == "missing_transfer": self.client.stat_changes = {"transfersCount": 1}
                else: self.client.session_changes = {"id": 999}
                self.run_qualification()
                self.assert_no_assignment()

    def test_reserved_system_zero_without_user_metadata_does_not_block_an_unattended_session(self):
        self.client.history_changes = {"message": {"1": {"id": "1", "chatid": "777", "senderid": "0", "params": {"class": "bx-messenger-content-item-ol-start"}}}}
        self.assertEqual(self.run_qualification()["transferred_chat_count"], 1)

    def test_a_second_ambiguous_chat_blocks_assignment_instead_of_using_the_first_match(self):
        self.client.open_line_chats[("contact", 101)] = [777, 778]
        self.client.open_line_dialogs[778] = {"id": 778, "entity_type": "LINES", "owner": 0,
            "entity_id": "whatsappbyedna|1|synthetic|901", "entity_data_1": "Y|LEAD|920|N|N|1778|0", "text_field_enabled": True}
        original = self.client.call
        def incomplete(method, body):
            result = original(method, body)
            if method == "imopenlines.session.history.get" and body["SESSION_ID"] == 1778:
                result["hasNextPage"] = True
            return result
        self.client.call = incomplete
        self.run_qualification()
        self.assert_no_assignment()

    def test_expected_old_session_zero_never_allows_a_newly_opened_session_to_be_transferred(self):
        result = assign_open_line_chats_to_user(self.client, lead_id=920, contact_id=101, deal_id=930,
            assigned_by_id=68579, distributable_open_line_ids=(1,), logger=fixtures.SilentLogger(), expected_sessions={777: 0})
        self.assertEqual(result.skipped_chats, ((777, "session_changed_before_transfer"),))
        self.assertFalse(self.client.chat_transfers)

    def test_queue_return_to_default_owner_with_human_transfer_stays_untouched(self):
        self.client.deals[930].update(stageId="C1:KESTRA_QUEUE", ufCrmRouteBucket="catamarca_general")
        self.client.native_transfers = [{"sessionId": 1777, "type": "USER", "mode": "MANUAL", "toOperatorId": 57}]
        before = copy.deepcopy(self.client.deals[930])
        _, result = qualify._guard_queued_ownership(self.client, qualify.load_config(self.fixture.env),
            self.client.deals[930], fixtures.SilentLogger(), datetime.now(timezone.utc))
        self.assertEqual(result["reason"], "manual_transfer_preserved")
        self.assertEqual(self.client.deals[930]["assignedById"], before["assignedById"])
        self.assertEqual(self.client.deals[930]["stageId"], "C1:KESTRA_ROUTE_REVIEW")
        self.assertFalse(self.client.chat_transfers)

    def test_routing_review_is_idempotent_and_does_not_write_an_owner_or_transfer(self):
        self.client.session_changes["dateOperatorAnswer"] = "2026-11-10T18:00:01Z"
        first = self.run_qualification()
        second = self.run_qualification()
        self.assertEqual(first["action"], "routing_review")
        self.assertEqual(second["reason"], "deal_not_pending")
        writes = [body for method, body in self.client.calls
                  if method == "crm.item.update" and "stageId" in body.get("fields", {})]
        self.assertEqual(len(writes), 1)
        self.assert_no_assignment()

    def test_a_human_change_during_final_review_read_preserves_stage_and_owners(self):
        for field in ("stage", "deal_owner", "lead_owner", "contact"):
            with self.subTest(field=field):
                self.reset_client()
                self.client.session_changes["dateOperatorAnswer"] = "2026-11-10T18:00:01Z"
                reads = 0
                def changed(method, body):
                    nonlocal reads
                    if method == "crm.item.get":
                        reads += 1
                        if reads == 3:
                            if field == "stage": self.client.deals[930]["stageId"] = "C1:NEW"
                            elif field == "deal_owner": self.client.deals[930]["assignedById"] = 90231
                            elif field == "contact": self.client.deals[930]["contactId"] = 102
                            else: self.client.leads[920]["ASSIGNED_BY_ID"] = 90231
                self.client.before = changed
                result = self.run_qualification()
                self.assertEqual(result["action"], "skipped")
                self.assertFalse(any(method == "crm.item.update" and "stageId" in body.get("fields", {})
                                     for method, body in self.client.calls))
                self.assertFalse(self.client.chat_transfers)

    def test_a_preserved_first_candidate_leaves_the_selector_and_the_next_inquiry_advances(self):
        self.client.session_changes["dateOperatorAnswer"] = "2026-11-10T18:00:01Z"
        self.client.leads[921] = self.fixture._catamarca_enriched_lead(921, bcra_entities=[])
        self.client.leads[921]["CONTACT_ID"] = "102"
        self.client.deals[931] = {**self.client.deals[930], "id": 931, "leadId": 921, "contactId": 102}
        source = {**self.fixture.env, "BITRIX24_DEAL_QUALIFICATION_BATCH_SIZE": "1"}
        first = qualify.process_pending_catamarca_deals(env=source, bitrix_client=self.client, logger=fixtures.SilentLogger())
        second = qualify.process_pending_catamarca_deals(env=source, bitrix_client=self.client, logger=fixtures.SilentLogger())
        self.assertEqual(first["deal_id"], 930)
        self.assertEqual(first["action"], "routing_review")
        self.assertEqual(second["deal_id"], 931)
        self.assertEqual(second["action"], "approved")
        self.assertEqual(self.client.deals[930]["assignedById"], 57)
        self.assertEqual(self.client.deals[931]["assignedById"], 68579)

    def test_a_protected_oldest_queue_case_leaves_the_bucket_and_the_next_one_advances(self):
        self.client.deals[930] = self.fixture._queued_deal(930, 920, "catamarca_general", "2026-11-09T23:00:00-03:00")
        self.client.leads[921] = self.fixture._catamarca_enriched_lead(921, bcra_entities=[])
        self.client.leads[921]["CONTACT_ID"] = "102"
        self.client.deals[931] = self.fixture._queued_deal(931, 921, "catamarca_general", "2026-11-09T23:01:00-03:00")
        self.client.deals[931]["contactId"] = 102
        self.client.native_transfers = [{"sessionId": 1777, "type": "USER", "mode": "MANUAL", "toOperatorId": 57}]
        now = datetime.fromisoformat("2026-11-10T11:00:00-03:00")
        first = qualify.process_distribution_queue(env=self.fixture.env, bitrix_client=self.client, logger=fixtures.SilentLogger(), now=now)
        second = qualify.process_distribution_queue(env=self.fixture.env, bitrix_client=self.client, logger=fixtures.SilentLogger(), now=now)
        self.assertEqual(first["events"][0]["reason"], "manual_transfer_preserved")
        self.assertEqual(self.client.deals[930]["stageId"], "C1:KESTRA_ROUTE_REVIEW")
        self.assertEqual(self.client.deals[930]["assignedById"], 57)
        self.assertEqual(second["events"][0]["deal_id"], 931)
        self.assertEqual(second["events"][0]["action"], "queue_distributed")
        self.assertEqual(self.client.deals[931]["assignedById"], 68579)


if __name__ == "__main__":
    unittest.main()
