from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from bitrix24_form_flow.form_processor import _attention_chat_delivery as delivery


class DeliveryClient:
    def __init__(self, deal, lead, now):
        self.deal, self.lead, self.now = deal, lead, now
        self.calls = []
        self.post_fails = False
        self.return_event = True
        self.pages = {}

    def call(self, method, body):
        self.calls.append((method, deepcopy(body)))
        if method == "crm.item.get":
            return {"item": deepcopy(self.deal)}
        if method == "crm.lead.get":
            return deepcopy(self.lead)
        if method == "crm.item.update":
            fields = body["fields"]
            assert set(fields) == {"action", "reason", "due"}
            self.deal.update(fields)
            return True
        if method == "imopenlines.operator.transfer":
            assert self.deal["action"] == delivery.INTENT
            if self.post_fails:
                raise RuntimeError("native_response_lost")
            return True
        if method == "imopenlines.v2.Session.Transfer.list":
            rows = [{"sessionId": 820, "toOperatorId": 222, "initiatorId": 71283,
                     "type": "USER", "date": self.now.isoformat()}] if self.return_event else []
            return {"transfers": rows}
        raise AssertionError(method)

    def call_full(self, method, body):
        assert method == "crm.item.list"
        return self.pages[body["start"]]

    def post_count(self):
        return sum(method == "imopenlines.operator.transfer" for method, _ in self.calls)


class AttentionChatDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 11, 25, 16, tzinfo=timezone.utc)
        cfg = SimpleNamespace(category_id=1, queue_action_field="action", queue_reason_field="reason",
                              queue_enqueued_at_field="due", distributable_open_line_ids=(1,))
        self.config = SimpleNamespace(deal=cfg, webhook_path="rest/71283/fake")
        self.deal = {"id": 91, "leadId": 89, "contactId": 90, "categoryId": 1, "stageId": "C1:NEW",
                     "assignedById": 222}
        self.deal.update(delivery.delivery_fields(self.config, self.deal, self.deal,
                                                  {819: 820}, self.now - timedelta(minutes=8)))
        self.client = DeliveryClient(self.deal, {"ID": "89", "CONTACT_ID": "90", "ASSIGNED_BY_ID": "222"}, self.now)

    def deliver(self, status=None, now=None):
        checks = iter(status or [({819: 820}, None)] * 2)
        def inspect(*args, window_evidence, **kwargs):
            result = next(checks)
            if not result[1]:
                window_evidence["expires_at"] = (now or self.now) + timedelta(hours=1)
            return result
        with patch.object(delivery, "inspect_attention_retry_sessions", side_effect=inspect):
            return delivery.deliver_attention_chat(self.client, self.config, 91, now=now or self.now)

    def test_delivers_once_and_verifies_native_event(self):
        result = self.deliver()
        self.assertEqual(result.transferred_chat_ids, (819,))
        self.assertEqual(self.deal["action"], "attention_chat_confirmed")
        self.deliver()
        self.assertEqual(self.client.post_count(), 1)

    def test_temporary_final_read_failure_retries_only_chat(self):
        result = self.deliver([({819: 820}, None), ({}, "attention_inspection_unavailable")])
        self.assertEqual(result.transferred_count, 0)
        self.assertEqual(self.client.post_count(), 0)
        self.assertEqual(self.deal["action"], delivery.PENDING)
        self.assertEqual(self.deliver().skipped_chats[0][1], "attention_delivery_not_due")
        self.now += timedelta(minutes=2)
        self.client.now = self.now
        self.assertEqual(self.deliver().transferred_count, 1)

    def test_uncertain_post_or_crash_never_replays(self):
        self.client.post_fails = True
        result = self.deliver()
        self.assertEqual(result.skipped_chats, ((819, "attention_transfer_uncertain"),))
        self.assertEqual(self.deal["action"], delivery.INTENT)
        self.assertEqual(delivery.Delivery.parse(self.deal["reason"]).intent, int(self.now.timestamp()))
        self.client.post_fails = False
        self.deliver()
        self.assertEqual(self.client.post_count(), 1)

    def test_acknowledgement_without_native_event_does_not_count_or_retry(self):
        self.client.return_event = False
        result = self.deliver()
        self.assertEqual(result.transferred_count, 0)
        self.assertEqual(self.deal["action"], "attention_chat_acknowledged")
        self.deliver()
        self.assertEqual(self.client.post_count(), 1)

    def test_changed_crm_owner_blocks_post_even_during_final_session_read(self):
        def moved(*args, **kwargs):
            self.client.lead["ASSIGNED_BY_ID"] = "333"
            return {819: 820}, None
        with patch.object(delivery, "inspect_attention_retry_sessions",
                          side_effect=[({819: 820}, None), ({819: 820}, None)]) as inspect:
            inspect.side_effect = lambda *args, **kwargs: moved() if inspect.call_count == 2 else ({819: 820}, None)
            result = delivery.deliver_attention_chat(self.client, self.config, 91, self.now)
        self.assertEqual(result.skipped_chats[0][1], "crm_changed_before_transfer")
        self.assertEqual(self.client.lead["ASSIGNED_BY_ID"], "333")
        self.assertEqual(self.client.post_count(), 0)

    def test_whatsapp_window_expires_during_last_crm_owner_read(self):
        clock = [self.now]
        expiry = self.now + timedelta(seconds=1)
        calls = 0
        real_call = self.client.call
        real_utc = delivery._utc

        def inspect(*args, window_evidence, **kwargs):
            nonlocal calls
            calls += 1
            window_evidence["expires_at"] = expiry
            return {819: 820}, None

        def api(method, body):
            if calls == 2 and method == "crm.lead.get":
                clock[0] = expiry
            return real_call(method, body)

        with patch.object(delivery, "inspect_attention_retry_sessions", side_effect=inspect), \
                patch.object(self.client, "call", side_effect=api), \
                patch.object(delivery, "_utc", side_effect=lambda value=None: real_utc(value) if value else clock[0]):
            result = delivery.deliver_attention_chat(self.client, self.config, 91)
        self.assertEqual(result.skipped_chats, ((819, "whatsapp_window_expired"),))
        self.assertEqual(self.client.post_count(), 0)

    def test_human_attention_session_reopening_and_expiry_stop_the_post(self):
        for reason in ("operator_attention_preserved", "session_changed_before_transfer", "whatsapp_window_expired"):
            with self.subTest(reason=reason):
                self.setUp()
                result = self.deliver([({819: 820}, None), ({819: 821}, reason)])
                self.assertEqual(result.skipped_chats[0][1], reason)
                self.assertEqual(self.client.post_count(), 0)
                self.assertEqual(self.deal["action"], "attention_chat_preserved")

    def test_due_scan_skips_unrelated_rows_and_reads_next_page(self):
        self.client.pages = {
            0: {"result": {"items": [{"id": 6, "action": "approved"},
                                      {**self.deal, "due": (self.now + timedelta(minutes=1)).isoformat()}]}, "next": 2},
            2: {"result": {"items": [self.deal]}},
        }
        self.assertEqual(delivery.due_deliveries(self.client, self.config, self.now, 1), [91])

    def test_deadline_survives_restart(self):
        result = self.deliver(now=self.now + timedelta(days=1))
        self.assertEqual(result.skipped_chats[0][1], "attention_delivery_expired")
        self.assertEqual(self.client.post_count(), 0)
