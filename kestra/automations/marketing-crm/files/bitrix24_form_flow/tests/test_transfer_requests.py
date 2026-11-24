"""Contract between the sales qualifier and the durable exact-session Laravel endpoint."""
import json
from io import BytesIO
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

from bitrix24_form_flow.form_processor import transfer_requests as delivery
from bitrix24_form_flow.form_processor.catamarca_deal_qualification import _chat_delivery_totals_json
from bitrix24_form_flow.form_processor.deal_service import AssignmentResolution


ORIGIN = "https://dev.redunisol.com.ar"
SCOPE = "redunisol.dev.marketing-crm"
PAYLOAD = {"scope": SCOPE, "chat_id": 10, "session_id": 20, "deal_id": 30,
           "lead_id": 40, "contact_id": None, "stage_id": "C1:NEW", "target_id": 50}
RECEIPT = {**PAYLOAD, "ok": True, "request_id": 60, "status": "pending"}


class Response(BytesIO):
    status = 202


class HandoffTests(unittest.TestCase):
    def send(self, receipt, status):
        body = json.dumps(receipt).encode()
        response = Response(body)
        response.status = status
        if status in (409, 422):
            response = HTTPError(ORIGIN, status, "Conflict", {}, response)
        with patch.object(delivery, "open_without_redirects",
                          side_effect=response if status in (409, 422) else None, return_value=response) as send:
            result = delivery.register(ORIGIN, "synthetic", PAYLOAD)
        request = send.call_args.args[0]
        self.assertEqual(request.full_url, ORIGIN + "/api/internal/sales-chat/transfer-requests")
        self.assertEqual(json.loads(request.data), PAYLOAD)
        return result

    def test_accepts_only_exact_positive_durable_receipts(self):
        self.assertEqual(self.send(RECEIPT, 202), RECEIPT)
        self.assertEqual(self.send(RECEIPT, 200), RECEIPT)
        for field, value in [("scope", "redunisol.prod.marketing-crm"), ("chat_id", 11), ("session_id", 21),
                             ("deal_id", 31), ("lead_id", 41), ("contact_id", 3), ("stage_id", "C1:OTHER"),
                             ("target_id", 51), ("request_id", True), ("chat_id", 10.0),
                             ("status", "unknown"), ("status", []), ("ok", 1)]:
            with self.subTest(field=field, value=value):
                self.assertIsNone(self.send({**RECEIPT, field: value}, 202))
        self.assertIsNone(self.send({k: v for k, v in RECEIPT.items() if k != "contact_id"}, 200))

    def test_laravel_can_decline_if_current_native_case_changes_during_registration(self):
        for reason in ("case_binding_mismatch", "session_closed_or_replaced"):
            self.assertEqual(self.send({"ok": False, "error": reason}, 422), reason)
        self.assertIsNone(self.send({"ok": False, "error": "wrong_scope"}, 422))

    def test_conflict_must_match_every_identity_except_the_reserved_seller(self):
        previous = {**RECEIPT, "target_id": 53, "ok": False}
        self.assertEqual(self.send(previous, 409), previous)
        self.assertIsNone(self.send({**previous, "deal_id": 31}, 409))
        self.assertIsNone(self.send({**previous, "target_id": 50}, 409))

    def reserve(self, env=None):
        def native(method, args):
            if method == "imopenlines.crm.chat.get":
                return [{"CHAT_ID": 10}, {"CHAT_ID": 11}]
            chat = args["CHAT_ID"]
            return {"id": chat, "entity_type": "LINES", "entity_id": "whatsappbyedna|1|fixture|guest",
                    "entity_data_1": f"Y|DEAL|30|N|N|{chat + 10}|1", "text_field_enabled": True}
        return delivery.reserve_sessions("durable", {"SALES_CHAT_WINDOW_SCOPE": SCOPE,
            "SALES_CHAT_WINDOW_TOKEN": "synthetic", **(env or {})}, {10: 20, 11: 21, 13: 0},
            {"id": 30, "leadId": 40}, "C1:NEW", AssignmentResolution(50, "round_robin", (50, 53), (50, 53)),
            client=Mock(**{"call.side_effect": native}))

    def test_lost_receipt_can_recover_the_still_eligible_original_seller_for_every_chat(self):
        seen = []
        def confirm(origin, token, payload):
            seen.append(payload["target_id"])
            return {**payload, "target_id": 53, "status": "pending"}
        with patch.object(delivery, "register", side_effect=confirm):
            handoff = self.reserve()
        self.assertEqual(seen, [50, 53])
        self.assertEqual(handoff.target_id, 53)
        self.assertFalse(handoff.blocked)
        self.assertEqual(handoff.transferred_count, 0)
        self.assertEqual(dict(handoff.states), {10: "delivery_queued", 11: "delivery_queued"})

    def test_block_if_receipt_seller_left_pool_or_other_chat_already_committed_to_a_different_seller(self):
        for targets, first_state in [([80], "delivery_target_conflict"), ([50, 53], "delivery_queued")]:
            with self.subTest(targets=targets), patch.object(delivery, "register",
                    side_effect=[{"target_id": target, "status": "pending"} for target in targets]):
                handoff = self.reserve()
                self.assertEqual(handoff.blocked, "delivery_target_conflict")
                self.assertEqual(handoff.states[0], (10, first_state))
                self.assertEqual(handoff.states[-1], (11, "delivery_target_conflict"))

    def test_unavailable_binding_lookup_keeps_case_in_selector_and_claims_nothing(self):
        with patch.object(delivery, "_current_case_binding", return_value=None), \
                patch.object(delivery, "register") as register:
            result = self.reserve()
        self.assertEqual(result.blocked, "delivery_binding_pending")
        register.assert_not_called()

    def test_summary_keeps_unlinked_queued_and_actual_transfers_distinct_and_deduplicates(self):
        states = {"10": "delivery_queued", "11": "delivery_binding_unverified"}
        summary = _chat_delivery_totals_json([{"chat_delivery_states": states, "transferred_chat_ids": "12"},
                                             {"chat_delivery_states": states, "transferred_chat_ids": "12,13"}])
        self.assertEqual(json.loads(summary), {"delivery_queued": 1, "delivery_binding_unverified": 1, "transferred": 2})

    def test_missing_token_unknown_scope_timeout_or_server_error_never_authorize_crm_commit(self):
        for env in ({"SALES_CHAT_WINDOW_SCOPE": "invalid"}, {"SALES_CHAT_WINDOW_TOKEN": ""}):
            with patch.object(delivery, "open_without_redirects") as send:
                self.assertEqual(self.reserve(env).blocked, "handoff_unconfirmed")
                send.assert_not_called()
        with patch.object(delivery, "open_without_redirects", side_effect=TimeoutError):
            self.assertEqual(self.reserve().blocked, "handoff_unconfirmed")
        self.assertIsNone(self.send(RECEIPT, 503))