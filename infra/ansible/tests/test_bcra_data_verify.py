"""Verification orchestration only touches synthetic destination/report trees."""
import ast
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile
import unittest
from unittest.mock import patch

import yaml

ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


verify = module("bcra_verify_tests", ROOT / "tools/bcra-data-verify.py")
inventory = module("bcra_verify_inventory", ROOT / "tools/bcra-data-manifest.py")
receipt = module("bcra_verify_receipt", ROOT / "tools/bcra-data-receipt.py")
fixtures = module("bcra_verify_fixtures", ROOT / "tests/test_bcra_data_tools.py")
CID = "d9be0a209f53" + "a" * 52


class VerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.source = self.base / "source"
        self.source.mkdir()
        fixtures.published(self.source)
        self.destination = self.base / "destination"
        shutil.copytree(self.source, self.destination)
        self.platform = self.base / "platform"
        self.platform.mkdir(mode=0o700)
        original = self.base / "original.json"
        inventory.write_report(original, inventory.inventory(self.source, 1024))
        self.source_bytes = original.read_bytes()
        self.completion = {"version": 1, "status": "source_complete", "public_key": "ssh-ed25519 AAAA",
                           "source_container_id": CID, "cutoff_at": "2026-11-12T03:00:00Z", "private_key_exported": False,
                           "private_key_present": True, "source_manifest_sha256": hashlib.sha256(self.source_bytes).hexdigest(),
                           "tree_sha256": json.loads(self.source_bytes)["tree_sha256"]}
        self.modules = {"bcra-data-manifest": inventory, "bcra-data-receipt": receipt}
        self.patches = [patch.object(verify, "PLATFORM", self.platform), patch.object(verify, "DATA", self.destination),
                        patch.object(verify, "load_module", side_effect=lambda name: self.modules[name]),
                        patch.object(verify, "assert_stopped")]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def stage(self):
        return verify.stage_source(base64.b64encode(json.dumps(self.completion).encode()).decode(),
                                   base64.b64encode(self.source_bytes).decode())

    def test_staging_preserves_manifest_bytes_and_ignores_only_private_key_presence_on_retry(self):
        first = self.stage()
        self.assertTrue(first["changed"])
        self.assertEqual(self.source_bytes, (self.platform / "source-manifest.json").read_bytes())
        original = (self.platform / "source-completion.json").read_bytes()
        self.completion["private_key_present"] = False
        self.assertFalse(self.stage()["changed"])
        self.assertEqual(original, (self.platform / "source-completion.json").read_bytes())
        self.assertEqual(0o600, stat.S_IMODE((self.platform / "source-manifest.json").stat().st_mode))

    def test_invalid_source_inventory_is_not_persisted(self):
        value = json.loads(self.source_bytes)
        value["tree_sha256"] = "d" * 64
        self.source_bytes = json.dumps(value).encode()
        self.completion["source_manifest_sha256"] = hashlib.sha256(self.source_bytes).hexdigest()
        self.completion["tree_sha256"] = value["tree_sha256"]
        with self.assertRaises(Exception):
            self.stage()
        self.assertFalse((self.platform / "source-manifest.json").exists())

    def test_first_verification_persists_stages_and_completed_retry_does_not_repeat_sqlite(self):
        self.stage()
        first = verify.verify_destination(1024)
        self.assertTrue(first["changed"])
        reports = ["destination-manifest.json", "copy-comparison.json", "sqlite-verification.json",
                   "post-recovery-manifest.json", "data-verification.json"]
        before = {name: (self.platform / name).read_bytes() for name in reports}
        with patch.object(inventory, "verify_sqlite", side_effect=AssertionError("must not recover again")):
            repeated = verify.verify_destination(1024)
        self.assertFalse(repeated["changed"])
        self.assertTrue(repeated["reused"])
        for name in reports:
            self.assertEqual(before[name], (self.platform / name).read_bytes())
            self.assertEqual(0o600, stat.S_IMODE((self.platform / name).stat().st_mode))

    def test_completed_verification_cannot_hide_a_later_data_change(self):
        self.stage()
        verify.verify_destination(1024)
        (self.destination / "refresh.json").write_text('{"modified":true}')
        with self.assertRaisesRegex(verify.VerificationError, "verified_destination_tree_changed"):
            verify.verify_destination(1024)

    def test_mismatched_copy_never_starts_sqlite_recovery(self):
        self.stage()
        (self.destination / "refresh.json").write_text('{"changed":true}')
        with patch.object(inventory, "verify_sqlite") as sql:
            with self.assertRaisesRegex(verify.VerificationError, "destination_does_not_match_source"):
                verify.verify_destination(1024)
            sql.assert_not_called()

    def test_interrupted_recovery_without_atomic_report_is_not_automatically_replayed(self):
        self.stage()
        with patch.object(inventory, "verify_sqlite", side_effect=RuntimeError("synthetic interruption")):
            with self.assertRaises(RuntimeError):
                verify.verify_destination(1024)
        with patch.object(inventory, "verify_sqlite") as sql:
            with self.assertRaisesRegex(verify.VerificationError, "interrupted_sqlite_recovery_requires_review"):
                verify.verify_destination(1024)
            sql.assert_not_called()

    def test_atomic_sqlite_report_can_finish_after_interruption_before_post_inventory(self):
        self.stage()
        original_inventory = inventory.inventory
        calls = [0]
        def interrupt_final(*args, **kwargs):
            calls[0] += 1
            if calls[0] == 2:
                raise RuntimeError("after SQLite report")
            return original_inventory(*args, **kwargs)
        with patch.object(inventory, "inventory", side_effect=interrupt_final):
            with self.assertRaises(RuntimeError):
                verify.verify_destination(1024)
        self.assertTrue((self.platform / "sqlite-verification.json").exists())
        with patch.object(inventory, "verify_sqlite", side_effect=AssertionError("already verified")):
            self.assertEqual("verified", verify.verify_destination(1024)["status"])

    def test_unknown_preexisting_reports_are_not_adopted(self):
        self.stage()
        (self.platform / "sqlite-verification.json").write_text('{"unknown":true}')
        with self.assertRaisesRegex(verify.VerificationError, "unknown_existing_verification_reports"):
            verify.verify_destination(1024)

    def test_image_staging_copies_only_sanitized_metadata(self):
        self.stage()
        image = {"observed_at": "2026-11-12T02:00:00Z", "id": CID, "running": False,
                 "finished_at": "2026-11-12T01:59:00Z", "image_tag": "ghcr.io/red-unisol/bcra-file-api:sha-" + "a" * 40, "image_id": "sha256:" + "a" * 64,
                 "repo_digests": [receipt.APPROVED_IMAGE], "data_root": receipt.SOURCE_ROOT,
                 "not_for_destination": "controller-secret-fixture"}
        result = verify.stage_image(base64.b64encode(json.dumps(image).encode()).decode())
        self.assertTrue(result["changed"])
        self.assertNotIn("controller-secret-fixture", (self.platform / "source-image.json").read_text())

    def test_source_authentication_inventory_is_never_copied_by_playbook(self):
        plays = yaml.safe_load((ROOT / "playbooks/bcra-data-verify.yml").read_text())
        self.assertFalse(plays[0]["gather_facts"])
        source_tasks = plays[0]["tasks"]
        self.assertTrue(any("ansible.builtin.raw" in task and "base64 -w0" in task["ansible.builtin.raw"] for task in source_tasks))
        for playbook in ("bcra-data-verify.yml", "bcra-data-receipt.yml", "bcra-data-copy-revoke.yml"):
            text = (ROOT / "playbooks" / playbook).read_text()
            self.assertNotIn("ansible_password", text)
            self.assertNotIn("credentials.txt", text)
            self.assertNotIn("bcra_migration_passwords", text)
            self.assertNotIn("id_ed25519", text)
            self.assertNotIn("delegate_to", text)

    def test_verifier_grammar_is_python36_compatible(self):
        ast.parse((ROOT / "tools/bcra-data-verify.py").read_text(), feature_version=(3, 6))


if __name__ == "__main__":
    unittest.main()
