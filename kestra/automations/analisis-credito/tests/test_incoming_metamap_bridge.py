from __future__ import annotations

from pathlib import Path
import sys
import unittest

import requests

FILES_ROOT = Path(__file__).resolve().parent.parent / "files"
if str(FILES_ROOT) not in sys.path:
    sys.path.insert(0, str(FILES_ROOT))

from incoming_metamap_bridge.kestra_webhook_entrypoint import process_payload


class FakeResponse:
    def __init__(self, status_code: int = 200, text: str = "ok") -> None:
        self.status_code = status_code
        self.text = text


class FakeSession:
    def __init__(self, response: FakeResponse | None = None, error: Exception | None = None) -> None:
        self.response = response or FakeResponse()
        self.error = error
        self.calls: list[dict[str, object]] = []

    def post(self, url: str, *, json: object, timeout: float, headers: dict[str, str]) -> FakeResponse:
        self.calls.append(
            {
                "url": url,
                "json": json,
                "timeout": timeout,
                "headers": headers,
            }
        )
        if self.error is not None:
            raise self.error
        return self.response


class IncomingMetaMapBridgeTests(unittest.TestCase):
    def test_returns_without_forward_when_target_is_missing(self) -> None:
        result = process_payload({"hello": "world"})

        self.assertTrue(result["ok"])
        self.assertFalse(result["forward_attempted"])
        self.assertFalse(result["forward_connected"])
        self.assertEqual(result["forward_target"], "")
        self.assertIn("No forward target configured", result["forward_error"])

    def test_forwards_payload_without_control_fields(self) -> None:
        session = FakeSession(response=FakeResponse(status_code=202, text="accepted"))

        result = process_payload(
            {
                "_bridge_forward_url": "http://host.docker.internal:8787/metamap",
                "_bridge_timeout_seconds": 3,
                "lead_id": "abc123",
                "decision": "approved",
            },
            session=session,
        )

        self.assertTrue(result["ok"])
        self.assertTrue(result["forward_attempted"])
        self.assertTrue(result["forward_connected"])
        self.assertEqual(result["forward_status_code"], "202")
        self.assertEqual(len(session.calls), 1)
        self.assertEqual(session.calls[0]["url"], "http://host.docker.internal:8787/metamap")
        self.assertEqual(
            session.calls[0]["json"],
            {"lead_id": "abc123", "decision": "approved"},
        )

    def test_tunnel_connection_errors_do_not_fail_execution(self) -> None:
        session = FakeSession(error=requests.ConnectionError("connection refused"))

        result = process_payload(
            {
                "_bridge_forward_url": "http://host.docker.internal:8787/metamap",
                "payload": {"id": 1},
            },
            session=session,
        )

        self.assertTrue(result["ok"])
        self.assertTrue(result["forward_attempted"])
        self.assertFalse(result["forward_connected"])
        self.assertIn("connection refused", result["forward_error"])


if __name__ == "__main__":
    unittest.main()
