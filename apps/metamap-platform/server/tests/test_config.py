import os
import unittest
from unittest import mock

from metamap_server.config import _parse_bootstrap_clients, load_settings_from_env


class MetaMapServerConfigTests(unittest.TestCase):
    def test_parse_bootstrap_clients_accepts_quoted_json(self) -> None:
        raw = (
            '\'[{"client_id":"validador-dev-1","client_secret":"abc","role":"validador"},'
            '{"client_id":"transferencias-dev-1","client_secret":"xyz","role":"transferencias_celesol"}]\''
        )
        clients = _parse_bootstrap_clients(raw)
        self.assertEqual(len(clients), 2)
        self.assertEqual(clients[0].client_id, "validador-dev-1")
        self.assertEqual(clients[1].role.value, "transferencias_celesol")

    def test_load_settings_from_env_reads_tokens_and_clients(self) -> None:
        env = {
            "METAMAP_SERVER_DATABASE_URL": "sqlite+pysqlite:///./test.db",
            "METAMAP_SERVER_WEBHOOK_SECRET": "MetaSecret1234Ab",
            "METAMAP_SERVER_BANK_CALLBACK_TOKEN": "bank-token",
            "METAMAP_SERVER_GIT_SHA": "deadbeef123",
            "METAMAP_SERVER_METAMAP_CLIENT_ID": "meta-client-id",
            "METAMAP_SERVER_METAMAP_CLIENT_SECRET": "meta-client-secret",
            "METAMAP_SERVER_METAMAP_API_TOKEN": "meta-token",
            "METAMAP_SERVER_METAMAP_AUTH_SCHEME": "Bearer",
            "METAMAP_SERVER_BOOTSTRAP_CLIENTS_JSON": (
                '[{"client_id":"validador-dev-1","client_secret":"abc","role":"validador"}]'
            ),
        }
        with mock.patch.dict(os.environ, env, clear=False):
            settings = load_settings_from_env()
        self.assertEqual(settings.database_url, "sqlite+pysqlite:///./test.db")
        self.assertEqual(settings.webhook_secret, "MetaSecret1234Ab")
        self.assertEqual(settings.bank_callback_token, "bank-token")
        self.assertEqual(settings.git_sha, "deadbeef123")
        self.assertEqual(settings.metamap_client_id, "meta-client-id")
        self.assertEqual(settings.metamap_client_secret, "meta-client-secret")
        self.assertEqual(settings.metamap_api_token, "meta-token")
        self.assertEqual(settings.metamap_auth_scheme, "Bearer")
        self.assertEqual(len(settings.bootstrap_clients), 1)

    def test_load_settings_from_env_keeps_backward_compatibility_with_old_webhook_token(self) -> None:
        env = {
            "METAMAP_SERVER_DATABASE_URL": "sqlite+pysqlite:///./test.db",
            "METAMAP_SERVER_WEBHOOK_TOKEN": "legacy-token",
            "METAMAP_SERVER_BOOTSTRAP_CLIENTS_JSON": "[]",
        }
        with mock.patch.dict(os.environ, env, clear=False):
            settings = load_settings_from_env()
        self.assertEqual(settings.webhook_secret, "legacy-token")
