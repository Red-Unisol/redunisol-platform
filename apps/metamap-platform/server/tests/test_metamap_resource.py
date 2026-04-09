import io
import json
import unittest
from unittest import mock

from metamap_server.metamap_resource import fetch_metamap_resource


class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._buffer = io.BytesIO(json.dumps(payload).encode("utf-8"))

    def read(self, *args, **kwargs):
        return self._buffer.read(*args, **kwargs)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class MetaMapResourceTests(unittest.TestCase):
    def test_fetch_resource_uses_client_credentials_jwt_when_available(self) -> None:
        requests = []

        def _fake_urlopen(request, timeout=0):
            requests.append(request)
            if request.full_url == "https://api.prod.metamap.com/oauth/":
                self.assertEqual(request.get_method(), "POST")
                self.assertEqual(
                    request.headers["Content-type"],
                    "application/x-www-form-urlencoded",
                )
                self.assertIn("Basic ", request.headers["Authorization"])
                self.assertEqual(request.data, b"grant_type=client_credentials")
                return _FakeResponse({"access_token": "jwt-token"})
            self.assertEqual(request.full_url, "https://api.prod.metamap.com/v2/verifications/verif-1")
            self.assertEqual(request.get_method(), "GET")
            self.assertEqual(request.headers["Authorization"], "Bearer jwt-token")
            return _FakeResponse({"id": "verif-1"})

        with mock.patch("metamap_server.metamap_resource.urlopen", side_effect=_fake_urlopen):
            payload = fetch_metamap_resource(
                "https://api.prod.metamap.com/v2/verifications/verif-1",
                client_id="meta-client-id",
                client_secret="meta-client-secret",
            )

        self.assertEqual(payload["id"], "verif-1")
        self.assertEqual(len(requests), 2)

    def test_fetch_resource_supports_legacy_static_token_fallback(self) -> None:
        def _fake_urlopen(request, timeout=0):
            self.assertEqual(request.full_url, "https://api.prod.metamap.com/v2/verifications/verif-2")
            self.assertEqual(request.headers["Authorization"], "Token static-token")
            return _FakeResponse({"id": "verif-2"})

        with mock.patch("metamap_server.metamap_resource.urlopen", side_effect=_fake_urlopen):
            payload = fetch_metamap_resource(
                "https://api.prod.metamap.com/v2/verifications/verif-2",
                api_token="static-token",
            )

        self.assertEqual(payload["id"], "verif-2")
