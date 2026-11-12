"""Revocation is limited to the exact known key, with receiver processes stopped."""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import struct
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
        self.assertTrue(result["changed"])
        self.assertFalse(self.keys.exists())
        self.assertTrue(json.loads(self.marker.read_text())["authorization_revoked"])
        first_timestamp = result["authorization_revoked_at"]
        marker_before = self.marker.read_bytes()
        repeated = self.run_revoke()
        self.assertTrue(repeated["transfer_authorization_revoked"])
        self.assertFalse(repeated["changed"])
        self.assertEqual(first_timestamp, repeated["authorization_revoked_at"])
        self.assertEqual(marker_before, self.marker.read_bytes())

    @unittest.skipUnless(hasattr(__import__('os'), 'geteuid') and __import__('os').geteuid() == 0, "Root-owned synthetic files required")
    def test_key_reappearing_after_revocation_is_preserved_for_review(self):
        self.run_revoke()
        self.keys.write_text(AUTH + "\n")
        with self.assertRaisesRegex(revoke.RevokeError, "authorization_reappeared_after_revocation"):
            self.run_revoke()
        self.assertTrue(self.keys.exists())

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


@unittest.skipUnless(hasattr(__import__('os'), 'geteuid') and __import__('os').geteuid() == 0, "Root-owned synthetic files required")
class SourceCacheRegressionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.runtime = Path(self.temp.name) / "runtime"
        self.runtime.mkdir(mode=0o700)
        self.helper = self.runtime / "transfer.py"
        source = (ROOT / "tools/bcra-data-transfer.py").read_text()
        source = source.replace('RUNTIME = Path("/run/redunisol-bcra-transfer")', 'RUNTIME = Path(' + repr(str(self.runtime)) + ')')
        self.source = source.encode()
        self.helper.write_bytes(self.source)
        self.config = {"version": 1, "transfer_helper_sha256": hashlib.sha256(self.source).hexdigest(),
                       "source_container_id": "d9be0a209f53" + "a" * 52}
        (self.runtime / "config.json").write_text(json.dumps(self.config))
        config_hash = hashlib.sha256(json.dumps(self.config, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        (self.runtime / "state.json").write_text(json.dumps({"phase": "complete", "copy_returncode": 0,
            "config_sha256": config_hash, "source_manifest_sha256": "a" * 64, "tree_sha256": "b" * 64,
            "cutoff_at": "2026-11-12T02:55:17Z"}))
        (self.runtime / "id_ed25519.pub").write_text(KEY + "\n")

    def tearDown(self):
        self.temp.cleanup()

    def cache(self, extra=False, corrupt=False):
        directory = self.runtime / "__pycache__"
        directory.mkdir(mode=0o755)
        header = revoke.importlib.util.MAGIC_NUMBER + struct.pack("<II", int(self.helper.stat().st_mtime) & 0xffffffff, len(self.source))
        path = directory / "transfer.cpython-36.pyc"
        path.write_bytes((b"bad!" + header[4:] if corrupt else header) + b"synthetic-unused-bytecode")
        path.chmod(0o600)
        if extra:
            (directory / "other.pyc").write_bytes(b"must remain")
        return directory

    def check(self):
        def process(argv, **kwargs):
            return SimpleNamespace(returncode=0, stdout=self.config["source_container_id"] + ' {"Status":"exited","Running":false,"Paused":false,"Restarting":false,"Pid":0}')
        with patch.object(revoke, "RUNTIME", self.runtime), patch.object(revoke.subprocess, "run", side_effect=process):
            return revoke.source_check()

    def test_direct_execution_of_verified_source_never_creates_or_reads_pyc(self):
        result = self.check()
        self.assertEqual("source_complete", result["status"])
        self.assertFalse(result["changed"])
        self.assertFalse((self.runtime / "__pycache__").exists())
        self.check()
        self.assertFalse((self.runtime / "__pycache__").exists())

    def test_exact_python36_cache_is_repaired_once_and_reported(self):
        directory = self.cache()
        result = self.check()
        self.assertTrue(result["changed"])
        self.assertEqual("removed_expected_python36_cache", result["bytecode_cleanup"])
        self.assertFalse(directory.exists())
        self.assertFalse(self.check()["changed"])

    def test_unknown_cache_contents_or_header_are_preserved(self):
        directory = self.cache(extra=True)
        with self.assertRaisesRegex(revoke.RevokeError, "unknown_import_cache_contents"):
            self.check()
        self.assertTrue((directory / "other.pyc").exists())
        self.assertTrue((directory / "transfer.cpython-36.pyc").exists())
        (directory / "other.pyc").unlink()
        (directory / "transfer.cpython-36.pyc").write_bytes(b"invalid-header-padding")
        with self.assertRaisesRegex(revoke.RevokeError, "accidental_import_cache_header_mismatch"):
            self.check()
        self.assertTrue(directory.exists())

    def test_known_transfer_guard_reason_is_exported_without_traceback_or_paths(self):
        (self.runtime / "unexpected-file").write_text("synthetic")
        with self.assertRaisesRegex(revoke.RevokeError, "transfer_unknown_runtime_contents"):
            self.check()


if __name__ == "__main__":
    unittest.main()
