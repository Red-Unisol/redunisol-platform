"""Contract with the internal, provider-backed sales chat window endpoint."""
from datetime import datetime, timedelta, timezone
from io import BytesIO
import json
import os
from pathlib import Path
import sys
from unittest.mock import patch

import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from bitrix24_form_flow.form_processor import transfer_window as window


class Response(BytesIO):
    status = 200


NOW = datetime(2026, 11, 24, 12, tzinfo=timezone.utc)
SCOPE = "redunisol.prod.marketing-crm"
ENV = {"SALES_CHAT_WINDOW_SCOPE": SCOPE, "SALES_CHAT_WINDOW_TOKEN": "test-token"}


def lookup(**fields):
    body = {"chat_id": 123, "session_id": 456, "state": "open", "expires_at": (NOW + timedelta(hours=1)).isoformat()}
    with patch.dict(os.environ, ENV), patch.object(window, "datetime", wraps=datetime) as clock, \
            patch.object(window, "open_without_redirects", return_value=Response(json.dumps(body | fields).encode())) as send:
        clock.now.return_value = NOW
        result = window.read_transfer_window(123, 456)
        request = send.call_args.args[0]
        assert request.full_url == "https://redunisol.com.ar/api/internal/sales-chat/transfer-window"
        assert json.loads(request.data) == {"scope": SCOPE, "chat_id": 123, "session_id": 456}
        return result


class TransferWindowTests(unittest.TestCase):
    def test_unusable_receipt_blocks_transfer(self):
        cases = [
            ({"expires_at": NOW.isoformat()}, "customer_window_expired"),
            ({"expires_at": (NOW + timedelta(days=2)).isoformat()}, "customer_window_unverified"),
            ({"expires_at": "2026-11-24T23:00:00"}, "customer_window_unverified"),
            ({"expires_at": None}, "customer_window_unverified"),
            ({"session_id": 457}, "customer_window_unverified"),
            ({"chat_id": 123.0}, "customer_window_unverified"),
            ({"state": "expired"}, "customer_window_expired"),
            ({"state": "closed"}, "no_current_transferable_session"),
            ({"state": "unknown"}, "customer_window_unverified"),
        ]
        for fields, reason in cases:
            with self.subTest(fields=fields):
                self.assertEqual(lookup(**fields), (None, reason))

    def test_open_receipt_returns_a_hard_deadline(self):
        self.assertEqual(lookup(), (NOW + timedelta(hours=1), "transferable"))

    def test_unknown_scope_never_sends_credentials_and_timeout_blocks_transfer(self):
        with patch.dict(os.environ, ENV), patch.object(window, "open_without_redirects", side_effect=TimeoutError) as send:
            with patch.dict(os.environ, {"SALES_CHAT_WINDOW_SCOPE": "https://elsewhere.test"}):
                self.assertEqual(window.read_transfer_window(123, 456), (None, "customer_window_unverified"))
                send.assert_not_called()
            self.assertEqual(window.read_transfer_window(123, 456), (None, "customer_window_unverified"))
            send.assert_called_once()
