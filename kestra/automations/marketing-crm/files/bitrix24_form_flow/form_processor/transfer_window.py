"""Read the provider-backed WhatsApp transfer deadline for an exact native session."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from http.client import HTTPException
import json
import os
from urllib.request import Request

from .internal_web import internal_web_origin, open_without_redirects


def read_transfer_window(chat_id: int, session_id: int) -> tuple[datetime | None, str]:
    scope = os.environ.get("SALES_CHAT_WINDOW_SCOPE", "")
    token = os.environ.get("SALES_CHAT_WINDOW_TOKEN")
    origin = internal_web_origin(scope)
    if not origin or not token:
        return None, "customer_window_unverified"
    request = Request(origin + "/api/internal/sales-chat/transfer-window",
        data=json.dumps({"scope": scope, "chat_id": chat_id, "session_id": session_id}).encode(),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json",
                 "Accept": "application/json", "User-Agent": "redunisol-chat-routing/1"},
        method="POST")
    try:
        # Allow the relay to check the dialog, history, native session and Edna history.
        with open_without_redirects(request, timeout=30) as response:
            body = response.read(4097)
            if response.status != 200 or len(body) > 4096:
                return None, "customer_window_unverified"
            receipt = json.loads(body)
        if (not isinstance(receipt, dict) or type(receipt.get("chat_id")) is not int
                or type(receipt.get("session_id")) is not int
                or receipt["chat_id"] != chat_id or receipt["session_id"] != session_id):
            return None, "customer_window_unverified"
        if receipt.get("state") == "closed":
            return None, "no_current_transferable_session"
        if receipt.get("state") == "expired":
            return None, "customer_window_expired"
        if receipt.get("state") != "open":
            return None, "customer_window_unverified"
        expires = datetime.fromisoformat(receipt["expires_at"].replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        if expires.tzinfo is None or expires > now + timedelta(hours=24):
            return None, "customer_window_unverified"
        if expires <= now:
            return None, "customer_window_expired"
        return expires, "transferable"
    except (OSError, HTTPException, ValueError, TypeError, KeyError, AttributeError, EOFError):
        # Network errors can contain request URLs or message content. Expose only the outcome.
        return None, "customer_window_unverified"
