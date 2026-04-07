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
            "METAMAP_SERVER_WEBHOOK_TOKEN": "meta-token",
            "METAMAP_SERVER_BANK_CALLBACK_TOKEN": "bank-token",
            "METAMAP_SERVER_BOOTSTRAP_CLIENTS_JSON": (
                '[{"client_id":"validador-dev-1","client_secret":"abc","role":"validador"}]'
            ),
        }
        with mock.patch.dict(os.environ, env, clear=False):
            settings = load_settings_from_env()
        self.assertEqual(settings.database_url, "sqlite+pysqlite:///./test.db")
        self.assertEqual(settings.webhook_token, "meta-token")
        self.assertEqual(settings.bank_callback_token, "bank-token")
        self.assertEqual(len(settings.bootstrap_clients), 1)
