import io
import json
import unittest
from unittest import mock
from urllib.error import HTTPError, URLError

from metamap_server.metamap_resource import MetaMapResourceClient, fetch_metamap_resource


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

    def test_resource_client_reuses_cached_oauth_token(self) -> None:
        requests = []

        def _fake_urlopen(request, timeout=0):
            requests.append(request.full_url)
            if request.full_url.endswith("/oauth/"):
                return _FakeResponse({"access_token": "cached-jwt", "expires_in": 3600})
            return _FakeResponse({"id": request.full_url.rsplit("/", 1)[-1]})

        client = MetaMapResourceClient(
            client_id="meta-client-id",
            client_secret="meta-client-secret",
        )
        with mock.patch("metamap_server.metamap_resource.urlopen", side_effect=_fake_urlopen):
            client.fetch("https://api.prod.metamap.com/v2/verifications/verif-1")
            client.fetch("https://api.prod.metamap.com/v2/verifications/verif-2")

        self.assertEqual(requests.count("https://api.prod.metamap.com/oauth/"), 1)
        self.assertEqual(len(requests), 3)

    def test_resource_client_retries_transient_network_errors_with_a_limit(self) -> None:
        attempts = 0

        def _fake_urlopen(request, timeout=0):
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                raise URLError("temporary failure")
            return _FakeResponse({"id": "verif-retry"})

        client = MetaMapResourceClient(
            api_token="static-token",
            max_attempts=3,
            retry_backoff_seconds=0,
        )
        with mock.patch("metamap_server.metamap_resource.urlopen", side_effect=_fake_urlopen):
            payload = client.fetch(
                "https://api.prod.metamap.com/v2/verifications/verif-retry"
            )

        self.assertEqual(payload["id"], "verif-retry")
        self.assertEqual(attempts, 3)

    def test_resource_client_does_not_retry_terminal_http_errors(self) -> None:
        attempts = 0

        def _fake_urlopen(request, timeout=0):
            nonlocal attempts
            attempts += 1
            raise HTTPError(request.full_url, 404, "Not Found", {}, None)

        client = MetaMapResourceClient(
            api_token="static-token",
            max_attempts=3,
            retry_backoff_seconds=0,
        )
        with mock.patch("metamap_server.metamap_resource.urlopen", side_effect=_fake_urlopen):
            with self.assertRaises(HTTPError):
                client.fetch("https://api.prod.metamap.com/v2/verifications/missing")

        self.assertEqual(attempts, 1)

    def test_resource_client_refreshes_cached_token_once_after_unauthorized(self) -> None:
        oauth_calls = 0
        resource_calls = 0

        def _fake_urlopen(request, timeout=0):
            nonlocal oauth_calls, resource_calls
            if request.full_url.endswith("/oauth/"):
                oauth_calls += 1
                return _FakeResponse(
                    {"access_token": f"jwt-{oauth_calls}", "expires_in": 3600}
                )
            resource_calls += 1
            if resource_calls == 1:
                raise HTTPError(request.full_url, 401, "Unauthorized", {}, None)
            self.assertEqual(request.headers["Authorization"], "Bearer jwt-2")
            return _FakeResponse({"id": "verif-token-refresh"})

        client = MetaMapResourceClient(
            client_id="meta-client-id",
            client_secret="meta-client-secret",
            max_attempts=3,
            retry_backoff_seconds=0,
        )
        with mock.patch("metamap_server.metamap_resource.urlopen", side_effect=_fake_urlopen):
            payload = client.fetch(
                "https://api.prod.metamap.com/v2/verifications/verif-token-refresh"
            )

        self.assertEqual(payload["id"], "verif-token-refresh")
        self.assertEqual(oauth_calls, 2)
        self.assertEqual(resource_calls, 2)
