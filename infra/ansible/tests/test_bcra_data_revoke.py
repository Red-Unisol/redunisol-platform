"""Revocation is limited to the exact known key, with receiver processes stopped."""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("bcra_revoke", ROOT / "tools/bcra-data-revoke.py")
revoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(revoke)
KEY = "ssh-ed25519 AAAA"
AUTH = 'from="66.97.34.158",restrict,command="/usr/bin/rrsync -wo /var/lib/redunisol-bcra-transfer/data" ' + KEY


class RevokeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.keys = root / "authorized_keys"
        self.marker = root / "receiver.json"
        self.alias = root / "alias"
        self.payload = {"version": 1, "destination_root": str(revoke.DATA), "source_host": "66.97.34.158",
                        "receiver_alias": str(self.alias),
                        "public_key_sha256": hashlib.sha256(KEY.encode()).hexdigest()}
        self.marker.write_text(json.dumps(self.payload))
        self.keys.write_text(AUTH + "\n")

    def tearDown(self):
        self.temp.cleanup()

    def run_revoke(self, process_code=1):
        def process(argv, **kwargs):
            return SimpleNamespace(returncode=process_code if argv[0] == "pgrep" else 0, stdout="")
        with patch.object(revoke, "MARKER", self.marker), patch.object(revoke, "KEYS", self.keys), patch.object(revoke, "ALIAS", self.alias), patch.object(revoke.subprocess, "run", side_effect=process):
            return revoke.destination_revoke(KEY)

    def test_python36_grammar(self):
        ast.parse((ROOT / "tools/bcra-data-revoke.py").read_text(), feature_version=(3, 6))

    @unittest.skipUnless(hasattr(__import__('os'), 'geteuid') and __import__('os').geteuid() == 0, "Root-owned synthetic files required")
    def test_exact_authorization_is_revoked_and_evidence_persisted(self):
        result = self.run_revoke()
        self.assertTrue(result["transfer_authorization_revoked"])
        self.assertTrue(result["receiver_alias_removed"])
        self.assertFalse(self.keys.exists())
        self.assertTrue(json.loads(self.marker.read_text())["authorization_revoked"])
        self.assertTrue(self.run_revoke()["transfer_authorization_revoked"])

    @unittest.skipUnless(hasattr(__import__('os'), 'geteuid') and __import__('os').geteuid() == 0, "Root-owned synthetic files required")
    def test_other_keys_are_preserved(self):
        self.keys.write_text("ssh-ed25519 BBBB\n")
        with self.assertRaisesRegex(revoke.RevokeError, "unknown_authorization"):
            self.run_revoke()
        self.assertEqual("ssh-ed25519 BBBB\n", self.keys.read_text())

    @unittest.skipUnless(hasattr(__import__('os'), 'geteuid') and __import__('os').geteuid() == 0, "Root-owned synthetic files required")
    def test_active_or_uncertain_receiver_process_is_preserved(self):
        for code in (0, 2):
            with self.assertRaisesRegex(revoke.RevokeError, "receiver_process_active_or_unknown"):
                self.run_revoke(code)
            self.assertTrue(self.keys.exists())


if __name__ == "__main__":
    unittest.main()
