"""Derive migration receipts from real synthetic inventory/SQLite reports."""
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


receipt = module("bcra_data_receipt", ROOT / "tools/bcra-data-receipt.py")
inventory = module("receipt_fixture_inventory", ROOT / "tools/bcra-data-manifest.py")
fixtures = module("receipt_fixtures", ROOT / "tests/test_bcra_data_tools.py")
CID = "d9be0a209f53" + "a" * 52
KEY = "ssh-ed25519 AAAA"


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.source = self.base / "source"
        self.source.mkdir()
        fixtures.published(self.source)
        self.destination = self.base / "destination"
        shutil.copytree(self.source, self.destination)
        self.paths = {}
        self.build_reports()

    def tearDown(self):
        self.temp.cleanup()

    def save(self, name, value):
        path = self.base / (name + ".json")
        path.write_text(json.dumps(value, sort_keys=True), encoding="utf-8")
        self.paths[name] = path
        return path

    def get(self, name):
        return json.loads(self.paths[name].read_text())

    def mutate(self, name, **changes):
        value = self.get(name)
        value.update(changes)
        self.save(name, value)

    def manifest(self, root, name, timestamp):
        value = inventory.inventory(root, 1024)
        # These are synthetic host metadata: simulate the production UID without
        # requiring chown on a Windows/Linux test controller.
        for entry in value["entries"]:
            entry["uid"] = 10001
            entry["gid"] = 10001
        value["tree_sha256"] = hashlib.sha256(inventory.canonical(value["entries"])).hexdigest()
        value["generated_at"] = timestamp
        self.save(name, value)
        return value

    def build_reports(self):
        source = self.manifest(self.source, "source_manifest", "2026-11-12T03:20:00Z")
        self.manifest(self.destination, "destination_manifest", "2026-11-12T03:21:00Z")
        compare = inventory.compare(self.paths["source_manifest"], self.paths["destination_manifest"])
        compare["checked_at"] = "2026-11-12T03:22:00Z"
        self.save("comparison", compare)
        sql = inventory.verify_sqlite(self.destination)
        sql["verified_at"] = "2026-11-12T03:23:00Z"
        self.save("sqlite_report", sql)
        self.manifest(self.destination, "post_recovery_manifest", "2026-11-12T03:24:00Z")
        self.save("source_completion", {
            "version": 1, "status": "source_complete", "public_key": KEY, "source_container_id": CID,
            "cutoff_at": "2026-11-12T03:00:00Z", "private_key_exported": False,
            "source_manifest_sha256": hashlib.sha256(self.paths["source_manifest"].read_bytes()).hexdigest(),
            "tree_sha256": source["tree_sha256"], "private_key_present": True,
        })
        self.save("source_image", {
            "id": CID, "running": False, "finished_at": "2026-11-12T01:59:26.637806058Z",
            "observed_at": "2026-11-12T02:19:00Z", "data_root": receipt.SOURCE_ROOT,
            "repo_digests": [receipt.APPROVED_IMAGE], "image_id": "sha256:" + "b" * 64,
            "image_tag": "ghcr.io/red-unisol/bcra-file-api:sha-" + "c" * 40,
            "unused_metadata": "do-not-export-personal-or-arbitrary-fields",
        })
        self.save("revocation", {
            "version": 1, "status": "revoked", "transfer_authorization_revoked": True,
            "receiver_alias_removed": True, "public_key_sha256": hashlib.sha256(KEY.encode()).hexdigest(),
            "authorization_revoked_at": "2026-11-12T03:25:00Z",
        })
        self.save("source_key_cleanup", {
            "version": 1, "status": "source_private_key_removed", "private_key_present": False,
            "source_manifest_preserved": True, "private_key_exported": False,
        })

    def consolidate(self):
        return receipt.consolidate(self.paths, inventory_module=inventory)

    def test_valid_receipt_is_derived_and_accepted_by_application_contract(self):
        result = self.consolidate()
        self.assertTrue(result["copy_verified"])
        self.assertTrue(result["sqlite_verified"])
        self.assertTrue(result["transfer_access_revoked"])
        self.assertTrue(result["receiver_alias_removed"])
        self.assertEqual(self.get("source_manifest")["tree_sha256"], result["copy_tree_sha256"])
        self.assertEqual(self.get("post_recovery_manifest")["tree_sha256"], result["tree_sha256"])
        self.assertFalse(result["freshness_refreshed"])
        self.assertFalse(result["publications"][0]["capabilities"]["history"])
        self.assertNotIn("do-not-export", json.dumps(result))
        self.assertNotIn(KEY, json.dumps(result))
        contract = module("receipt_app_contract", ROOT / "roles/bcra_file_api/files/bcra-contract.py")
        raw = json.dumps(result).encode()
        contract.migration_document(raw, hashlib.sha256(raw).hexdigest(), receipt.APPROVED_IMAGE)

    def test_reader_only_consumes_existing_reports_never_a_data_volume(self):
        with patch.object(inventory, "inventory", side_effect=AssertionError("volume must not be read")), patch.object(inventory, "verify_sqlite", side_effect=AssertionError("SQLite must not run")):
            self.assertEqual("verified", self.consolidate()["status"])

    def test_copy_report_false_or_manifest_hash_mismatch_fails(self):
        self.mutate("comparison", copy_verified=False)
        with self.assertRaisesRegex(receipt.ReceiptError, "copy_report_not_verified"):
            self.consolidate()
        self.mutate("comparison", copy_verified=True, source_manifest_sha256="d" * 64)
        with self.assertRaisesRegex(receipt.ReceiptError, "copy_report_manifest_mismatch"):
            self.consolidate()

    def test_success_flag_cannot_hide_different_destination_manifest(self):
        value = self.get("destination_manifest")
        value["entries"][-1]["sha256"] = "d" * 64
        value["tree_sha256"] = hashlib.sha256(inventory.canonical(value["entries"])).hexdigest()
        self.save("destination_manifest", value)
        with self.assertRaisesRegex(receipt.ReceiptError, "copy_report_manifest_mismatch"):
            self.consolidate()

    def test_wrong_source_container_or_image_or_running_state_fails(self):
        original = self.get("source_image")
        for change in ({"id": "d" * 64}, {"running": True}, {"repo_digests": ["other-image"]}, {"data_root": "/other-volume"}):
            self.save("source_image", dict(original, **change))
            with self.assertRaises(receipt.ReceiptError):
                self.consolidate()

    def test_cutoff_must_be_utc_and_after_observed_stop(self):
        for value in ("2026-11-12T01:00:00Z", "2026-11-12T03:00:00-03:00", "invalid"):
            self.mutate("source_completion", cutoff_at=value)
            with self.assertRaises(receipt.ReceiptError):
                self.consolidate()

    def test_final_inventory_must_follow_sqlite_verification(self):
        self.mutate("post_recovery_manifest", generated_at="2026-11-12T03:22:01Z")
        with self.assertRaisesRegex(receipt.ReceiptError, "verification_chronology_invalid"):
            self.consolidate()

    def test_post_recovery_cannot_change_published_data_or_refresh_state(self):
        for target in ("refresh.json", "components/current/" + fixtures.VERSION + ".sqlite"):
            final = self.get("destination_manifest")
            for entry in final["entries"]:
                if entry["path"] == target:
                    entry["sha256"] = "d" * 64
            final["tree_sha256"] = hashlib.sha256(inventory.canonical(final["entries"])).hexdigest()
            final["generated_at"] = "2026-11-12T03:24:00Z"
            self.save("post_recovery_manifest", final)
            with self.assertRaises(receipt.ReceiptError):
                self.consolidate()

    def test_pending_hot_journal_recovery_preserves_both_audit_trees(self):
        path = fixtures.pending(self.source)
        script = """import os, sqlite3, sys
c=sqlite3.connect(sys.argv[1])
c.execute('PRAGMA synchronous=EXTRA')
c.execute('PRAGMA cache_size=8')
c.execute('BEGIN IMMEDIATE')
c.execute('UPDATE synthetic_data SET value=? WHERE id=1', ('uncommitted-synthetic-'*100000,))
c.execute('UPDATE import_checkpoint SET value=? WHERE id=1', ('invalid-uncommitted',))
os._exit(0)
"""
        subprocess.run([sys.executable, "-c", script, str(path)], check=True)
        shutil.rmtree(self.destination)
        shutil.copytree(self.source, self.destination)
        self.build_reports()
        result = self.consolidate()
        self.assertNotEqual(result["copy_tree_sha256"], result["tree_sha256"])
        self.assertTrue(result["sqlite_verified"])

    def test_sqlite_cannot_claim_success_without_complete_component_coverage(self):
        self.mutate("sqlite_report", published_components=[])
        with self.assertRaisesRegex(receipt.ReceiptError, "sqlite_report_missing_results"):
            self.consolidate()

    def test_revocation_requires_exact_key_alias_and_true_flags(self):
        original = self.get("revocation")
        for change in ({"public_key_sha256": "d" * 64}, {"receiver_alias_removed": False}, {"transfer_authorization_revoked": False}):
            self.save("revocation", dict(original, **change))
            with self.assertRaises(receipt.ReceiptError):
                self.consolidate()

    def test_persisted_revocation_marker_is_supported(self):
        marker = self.get("revocation")
        marker.pop("status")
        marker.pop("transfer_authorization_revoked")
        marker.update(authorization_revoked=True, destination_root=receipt.DESTINATION_ROOT,
                      receiver_alias=receipt.RECEIVER_ALIAS, source_host="66.97.34.158")
        self.save("revocation", marker)
        self.assertTrue(self.consolidate()["transfer_access_revoked"])

    def test_source_private_key_cleanup_is_required(self):
        self.mutate("source_key_cleanup", private_key_present=True)
        with self.assertRaisesRegex(receipt.ReceiptError, "source_private_key_cleanup_required"):
            self.consolidate()

    def test_duplicate_json_keys_are_rejected(self):
        self.paths["comparison"].write_text('{"version":1,"version":1}')
        with self.assertRaisesRegex(receipt.ReceiptError, "duplicate_report_key"):
            self.consolidate()

    def test_boolean_inventory_version_is_rejected(self):
        self.mutate("source_manifest", version=True)
        with self.assertRaisesRegex(receipt.ReceiptError, "invalid_report_version"):
            self.consolidate()

    def test_source_manifest_cannot_be_reused_as_destination_evidence(self):
        self.paths["destination_manifest"] = self.paths["source_manifest"]
        with self.assertRaisesRegex(receipt.ReceiptError, "reports_must_have_distinct_paths"):
            self.consolidate()

    def test_receipt_is_deterministic_idempotent_and_never_overwrites_other_evidence(self):
        target = self.base / "data-migration.json"
        expected = self.consolidate()
        first = receipt.save_receipt(target, expected)
        self.assertEqual(first, receipt.save_receipt(target, self.consolidate()))
        target.write_text('{"unknown":true}')
        with self.assertRaisesRegex(receipt.ReceiptError, "refusing_different_existing_receipt"):
            receipt.save_receipt(target, expected)
        self.assertEqual('{"unknown":true}', target.read_text())

    def test_receipt_cannot_be_written_into_the_data_volume(self):
        with self.assertRaisesRegex(receipt.ReceiptError, "receipt_must_be_outside_data_volume"):
            receipt.save_receipt(Path(receipt.DESTINATION_ROOT) / "data-migration.json", self.consolidate())

    def test_grammar_is_compatible_with_python36(self):
        ast.parse((ROOT / "tools/bcra-data-receipt.py").read_text(), feature_version=(3, 6))


if __name__ == "__main__":
    unittest.main()
