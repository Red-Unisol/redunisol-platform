from datetime import datetime
import json
import unittest
from unittest.mock import patch

from bitrix24_form_flow.form_processor import _chat_ownership as ownership


class RequestChatReadinessTests(unittest.TestCase):
    case = {"deal_id": 408, "lead_id": 32, "channel": "web", "request_id": "8d59feb7-75db-4658-8227-0ef6094edd92"}
    now = datetime.fromisoformat("2026-12-07T12:00:00Z")
    env = {"BITRIX24_ROUTING_CONFIG_URL": "https://example.test/api/internal/bitrix-routing",
           "BITRIX24_VOLUME_COMPENSATION_TOKEN": "test-token"}

    def check(self, response_row):
        with patch.object(ownership, "HTTPSConnection") as connect:
            connection = connect.return_value
            response = connection.getresponse.return_value
            response.status = 200
            response.read.return_value = json.dumps({"cases": [response_row]}).encode()
            result = ownership.readiness([self.case], self.env, live=True, now=self.now)
            self.assertEqual(connection.request.call_args.args[:2], ("POST", "/api/internal/bitrix-routing/chat-readiness"))
            sent = json.loads(connection.request.call_args.kwargs["body"])
            self.assertEqual(sent, {"cases": [self.case], "live": True})
            return result

    def test_only_exact_unexpired_chat_or_verified_activity_can_wake(self):
        row = {**self.case, "state": "ready", "chat_id": 12, "session_id": 14, "expires_at": "2026-12-07T12:01:00Z"}
        self.assertEqual(self.check(row), {408: ("chat", 12, 14)})
        self.assertEqual(self.check({**row, "expires_at": self.now.isoformat()}), {})
        self.assertEqual(self.check({**self.case, "state": "waiting"}), {})
        self.assertEqual(self.check({**self.case, "state": "outbound", "activity_id": 16}), {408: ("outbound", 16)})
        for bad in ({**row, "lead_id": 31}, {**row, "request_id": "different"}, {**row, "session_id": 0},
                    {**row, "deal_id": 409}, {**row, "state": "unknown"}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.check(bad)
