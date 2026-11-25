"""Revalidation of the native WhatsApp service window for a delayed handoff."""
from datetime import datetime, timedelta, timezone
import unittest

from test_qualifier_chat_attention import AttentionClient
from bitrix24_form_flow.form_processor.deal_service import (
    active_sales_chat_owners, inspect_attention_retry_sessions,
)


class RetrySessionTests(unittest.TestCase):
    def setUp(self):
        self.api = AttentionClient()
        self.crm = dict(lead_id=920, contact_id=101, deal_id=930, distributable_open_line_ids=(1,))
        self.api.open_line_chats[("contact", 101)] = [777]
        self.api.open_line_dialogs[777] = {"id": 777, "owner": 74827, "entity_type": "LINES",
            "entity_id": "whatsappbyedna|1|test@1|901", "text_field_enabled": True,
            "entity_data_1": "Y|DEAL|930|N|N|1777|1794333600",
            "entity_data_2": "LEAD|920|COMPANY|0|CONTACT|101|DEAL|930"}
        self.started = datetime(2026, 11, 10, 18, tzinfo=timezone.utc)
        self.now = self.started + timedelta(hours=1)
        self.add_message(1, self.started)

    def add_message(self, message_id, when, *, sender=901, connector=True, params=None):
        h = self.api.history_changes
        h.setdefault("users", {})[str(sender)] = {"connector": connector}
        h.setdefault("message", []).append({"id": str(message_id), "senderid": str(sender), "chatid": "777",
            "params": {"connectorMid": [str(message_id)]} if params is None else params,
            "date": when.isoformat()})

    def inspect(self, **kw):
        return inspect_attention_retry_sessions(self.api, **self.crm, now=self.now, **kw)

    def test_one_open_unattended_edna_session_passes_the_read_only_gate(self):
        sessions, reason = self.inspect(failed_at=self.now)
        self.assertEqual((sessions, reason), ({777: 1777}, None))
        self.assertEqual(active_sales_chat_owners(self.api, **self.crm), {777: (1777, 74827)})
        self.assertEqual(self.inspect(expected_sessions=sessions), (sessions, None))
        self.assertEqual(self.api.chat_transfers, [])

    def test_24h_is_exclusive_and_outgoing_messages_do_not_extend_it(self):
        self.now = self.started + timedelta(hours=24)
        self.add_message(2, self.now - timedelta(minutes=2), params={
            "CLASS": "bx-messenger-content-item-ol-output", "connectorMid": ["out"]})
        self.assertEqual(self.inspect()[1], "whatsapp_window_expired")
        self.now -= timedelta(microseconds=1)
        self.assertIsNone(self.inspect()[1])
        self.now += timedelta(hours=2)
        self.add_message(3, self.now - timedelta(minutes=4))
        self.assertIsNone(self.inspect()[1])

    def test_unidentifiable_sender_missing_id_and_invalid_dates_cannot_reopen_window(self):
        self.api.history_changes["message"].clear()
        self.add_message(1, self.now, params={})
        self.assertEqual(self.inspect()[1], "customer_inbound_unverified")
        self.add_message(2, self.now, sender=902)
        self.assertEqual(self.inspect()[1], "attention_evidence_ambiguous")
        self.api.history_changes["message"].clear()
        self.add_message(3, self.now.replace(tzinfo=None))
        self.assertEqual(self.inspect()[1], "attention_evidence_ambiguous")
        self.api.history_changes["message"].clear()
        self.add_message(4, self.now + timedelta(seconds=3))
        self.assertEqual(self.inspect()[1], "attention_evidence_ambiguous")

    def test_reopen_after_first_failure_explicit_offset_and_different_session_block(self):
        self.assertEqual(self.inspect(failed_at=self.started - timedelta(seconds=1))[1],
                         "session_created_after_inspection_failure")
        self.assertIsNone(self.inspect(failed_at=self.started.astimezone(timezone(timedelta(hours=-3))))[1])
        self.assertEqual(self.inspect(failed_at=self.started.replace(tzinfo=None))[1], "attention_evidence_ambiguous")
        self.assertEqual(self.inspect(expected_sessions={777: 1555})[1], "session_changed_before_transfer")
        self.assertEqual(self.inspect(expected_sessions={})[1], "session_changed_before_transfer")

    def test_closed_chats_other_connector_and_ambiguous_chats_are_not_delivered(self):
        self.api.open_line_dialogs[777]["text_field_enabled"] = False
        self.assertEqual(self.inspect()[1], "no_current_transferable_session")
        self.api.open_line_dialogs[777]["text_field_enabled"] = True
        self.api.open_line_chats[("lead", 920)] = [778]
        self.api.open_line_dialogs[778] = dict(self.api.open_line_dialogs[777], id=778)
        self.assertEqual(self.inspect()[1], "ambiguous_active_sales_sessions")
        self.api.open_line_dialogs[778]["entity_id"] = "another|1|test@1|901"
        self.assertIsNone(self.inspect()[1])

    def test_unknown_binding_read_error_and_accepted_chat_are_distinguishable(self):
        self.api.open_line_dialogs[777]["entity_data_2"] = "DEAL|999"
        self.assertEqual(self.inspect()[1], "attention_evidence_ambiguous")
        self.api.open_line_dialogs[777]["entity_data_2"] = "DEAL|930"
        def interrupted(method, payload):
            if method == "imopenlines.v2.Session.Stat.get":
                raise RuntimeError("synthetic read failure")
        self.api.before = interrupted
        self.assertEqual(self.inspect()[1], "attention_inspection_unavailable")
        self.api.before = None
        self.api.session_changes = {"dateOperatorAnswer": self.now.isoformat()}
        self.assertEqual(self.inspect()[1], "operator_attention_preserved")

    def test_final_reread_preserves_human_actions(self):
        sessions, _ = self.inspect()
        for change, reason in [
            (lambda: self.api.stat_changes.update(messagesOperatorCount=1), "operator_message_preserved"),
            (lambda: self.api.native_transfers.append({"sessionId": 1777, "type": "USER", "mode": "MANUAL"}),
             "manual_transfer_preserved"),
            (lambda: self.api.open_line_dialogs[777].update(owner=68579), "manual_owner_preserved"),
        ]:
            with self.subTest(reason=reason):
                self.api.stat_changes.clear()
                self.api.native_transfers.clear()
                self.api.open_line_dialogs[777]["owner"] = 74827
                change()
                self.assertEqual(self.inspect(expected_sessions=sessions)[1], reason)
                self.assertFalse(self.api.chat_transfers)

    def test_native_crm_binding_disappearing_after_check_blocks_post(self):
        sessions, _ = self.inspect()
        self.api.open_line_chats.clear()
        self.assertEqual(self.inspect(expected_sessions=sessions)[1], "no_current_transferable_session")
        self.assertFalse(self.api.chat_transfers)

    def test_a_contact_alone_cannot_identify_an_unpinned_request(self):
        dialog = self.api.open_line_dialogs[777]
        dialog["entity_data_1"] = dialog["entity_data_1"].replace("DEAL|930", "CONTACT|101")
        dialog["entity_data_2"] = "CONTACT|101"
        self.assertEqual(self.inspect()[1], "attention_evidence_ambiguous")
        self.api.open_line_chats[("lead", 920)] = [777]
        self.assertIsNone(self.inspect()[1])
        dialog["entity_data_2"] = "CONTACT|101|DEAL|999"
        self.assertEqual(self.inspect()[1], "attention_evidence_ambiguous")

    def test_sender_receives_only_the_current_inbound_expiry_after_success(self):
        evidence = {}
        self.add_message(2, self.now)
        self.assertIsNone(self.inspect(window_evidence=evidence)[1])
        self.assertEqual(evidence["expires_at"], self.now + timedelta(hours=24))
        self.now += timedelta(hours=24)
        self.assertEqual(self.inspect(window_evidence=evidence)[1], "whatsapp_window_expired")
        self.assertNotIn("expires_at", evidence)
