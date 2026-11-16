"""Cold-copy guards and real restic backup/manifest restoration in private fixtures."""
import ast
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
ROLE = ROOT / "roles/bcra_backup"
HELPER = ROLE / "files/bcra-cold-backup.py"
SPEC = importlib.util.spec_from_file_location("bcra_cold_backup", HELPER)
BACKUP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BACKUP)
RESTIC = Path(os.environ.get("FOUNDATION_TEST_RESTIC_BINARY", "/nonexistent-pinned-restic"))


class ColdBackupSafetyTests(unittest.TestCase):
    def test_backup_and_full_check_share_one_timeout_budget(self):
        clock = [0]
        budget = BACKUP.TimeBudget(60, clock=lambda: clock[0])
        self.assertEqual(budget.remaining(), 60)
        clock[0] = 25
        self.assertEqual(budget.remaining(), 35)
        self.assertEqual(budget.remaining(10), 10)
        clock[0] = 60
        with self.assertRaisesRegex(BACKUP.BackupError, "time_budget_exhausted"):
            budget.remaining()

    def test_app_and_any_writable_overlap_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory).resolve() / "data"
            data.mkdir()
            for value in (
                {"name": "/redunisol-bcra-file-api", "mounts": []},
                {"name": "/other", "mounts": [{"Source": str(data), "RW": True}]},
                {"name": "/other", "mounts": [{"Source": str(data.parent), "RW": True}]},
                {"name": "/other", "mounts": [{"Source": str(data / "pending"), "RW": True}]},
            ):
                with self.subTest(container=value), self.assertRaises(BACKUP.BackupError):
                    BACKUP.assert_container_cold(value, data)
            BACKUP.assert_container_cold({"name": "/reader", "mounts": [{"Source": str(data), "RW": False}]}, data)

    def test_runtime_tool_has_no_init_retention_unlock_or_foundation_health_writes(self):
        source = HELPER.read_text()
        constants = {node.value for node in ast.walk(ast.parse(source)) if isinstance(node, ast.Constant) and isinstance(node.value, str)}
        self.assertFalse(constants & {"init", "forget", "prune", "unlock"})
        self.assertIn("redunisol-bcra-cold", constants)
        self.assertNotIn("redunisol-foundation", constants)
        self.assertNotIn("foundation-backup.prom", source)
        self.assertNotIn('state / "backup.json"', source)
        defaults = yaml.safe_load((ROLE / "defaults/main.yml").read_text())
        self.assertFalse(defaults["bcra_backup_apply_authorized"])

    @unittest.skipUnless(os.name == "posix", "POSIX receipt permissions")
    def test_receipt_is_private_and_atomic(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "receipt.json"
            BACKUP.atomic_receipt(path, {"status": "verified"})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(path.read_text()), {"status": "verified"})


@unittest.skipUnless(os.name == "posix" and RESTIC.is_file(), "Checksum-pinned Linux restic fixture required")
class RealColdResticTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="bcra-restic-test-")
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name)
        self.password = self.path / "fixture-password"
        self.password.write_text("isolated-test-password-never-a-production-secret\n")
        self.password.chmod(0o600)
        self.prefix = [str(RESTIC), "--repo", str(self.path / "fixture-repository"),
                       "--password-file", str(self.password), "--cache-dir", str(self.path / "cache")]
        # Initialization is confined to this unique test directory. The production
        # helper has no init operation and requires an already mounted repository.
        BACKUP.restic(self.prefix, "init")
        self.data = self.path / "data"
        self.data.mkdir()
        (self.data / "synthetic.sqlite").write_bytes(b"synthetic non-personal fixture bytes")
        self.manifest = self.path / "data-migration.json"
        self.manifest.write_text('{"version":1,"tree_sha256":"synthetic-fixture"}\n')
        self.manifest_sha = hashlib.sha256(self.manifest.read_bytes()).hexdigest()
        self.compose = self.path / "docker-compose.yml"
        self.compose.write_text("services: {}\n")
        self.sources = [self.data, self.manifest, self.compose]
        self.tags = ["redunisol-bcra-cold", "service:bcra-file-api", "manifest:" + self.manifest_sha,
                     "cutoff:2026-11-12T01:59:26Z"]

    def test_real_backup_restores_only_one_manifest_and_preserves_sources(self):
        snapshot = BACKUP.create_snapshot(self.prefix, self.sources, self.tags, 60)
        metadata = BACKUP.verify_snapshot(self.prefix, snapshot, self.sources, self.tags)
        self.assertEqual(set(metadata["paths"]), {str(path) for path in self.sources})
        self.assertRegex(BACKUP.repository_id(self.prefix), r"^[0-9a-f]{64}$")
        integrity = BACKUP.verify_repository_integrity(self.prefix, 60)
        self.assertIs(integrity["repository_integrity_verified"], True)
        self.assertIs(integrity["read_data"], True)
        self.assertIn("repository_integrity_verified_at", integrity)
        restored = BACKUP.restore_manifest(self.prefix, snapshot, self.manifest, self.path / "isolated-restore", self.manifest_sha)
        self.assertEqual(restored.read_bytes(), self.manifest.read_bytes())
        self.assertFalse((self.path / "isolated-restore" / str(self.data).lstrip("/")).exists())
        self.assertEqual((self.data / "synthetic.sqlite").read_bytes(), b"synthetic non-personal fixture bytes")

    def test_real_damaged_pack_cannot_produce_repository_integrity_proof(self):
        BACKUP.create_snapshot(self.prefix, self.sources, self.tags, 60)
        pack = next((self.path / "fixture-repository/data").glob("*/*"))
        contents = bytearray(pack.read_bytes())
        contents[0] ^= 1
        pack.chmod(0o600)
        pack.write_bytes(contents)
        with self.assertRaisesRegex(BACKUP.BackupError, "command_failed"):
            BACKUP.verify_repository_integrity(self.prefix, 60)

    def test_wrong_snapshot_paths_or_tags_are_rejected(self):
        snapshot = BACKUP.create_snapshot(self.prefix, self.sources, self.tags, 60)
        with self.assertRaisesRegex(BACKUP.BackupError, "source_paths_mismatch"):
            BACKUP.verify_snapshot(self.prefix, snapshot, [self.manifest], self.tags)
        with self.assertRaisesRegex(BACKUP.BackupError, "tags_mismatch"):
            BACKUP.verify_snapshot(self.prefix, snapshot, self.sources, self.tags + ["unproven-cutoff"])

    def test_lost_backup_ack_can_reconcile_the_exact_snapshot_without_another_backup(self):
        snapshot = BACKUP.create_snapshot(self.prefix, self.sources, self.tags, 60)
        self.assertEqual(BACKUP.matching_snapshots(self.prefix, self.sources, self.tags), [snapshot])
        self.assertEqual(BACKUP.matching_snapshots(self.prefix, self.sources, self.tags), [snapshot])
        snapshots = json.loads(BACKUP.restic(self.prefix, "snapshots", "--json"))
        self.assertEqual(len(snapshots), 1)

    def test_restore_refuses_existing_targets_and_a_wrong_expected_manifest_hash(self):
        snapshot = BACKUP.create_snapshot(self.prefix, self.sources, self.tags, 60)
        existing = self.path / "already-existing"
        existing.mkdir()
        with self.assertRaisesRegex(BACKUP.BackupError, "target_must_be_new"):
            BACKUP.restore_manifest(self.prefix, snapshot, self.manifest, existing, self.manifest_sha)
        with self.assertRaisesRegex(BACKUP.BackupError, "hash_mismatch"):
            BACKUP.restore_manifest(self.prefix, snapshot, self.manifest, self.path / "wrong-hash-restore", "0" * 64)


@unittest.skipUnless(os.name == "posix" and shutil.which("ansible-playbook"), "Pinned Linux Ansible controller required")
class ExecutableColdBackupGateTests(unittest.TestCase):
    def run_gate(self, *, authorized, check=False):
        defaults = yaml.safe_load((ROLE / "defaults/main.yml").read_text())
        variables = {**defaults, **yaml.safe_load((ROOT / "inventories/production/group_vars/all.yml").read_text()),
                     "bcra_backup_apply_authorized": authorized, "bcra_backup_revision": "a" * 40,
                     "bcra_backup_data_manifest_sha256": "b" * 64}
        first = copy.deepcopy(yaml.safe_load((ROLE / "tasks/main.yml").read_text())[0])
        self.assertIn("ansible.builtin.assert", first)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            play = [{"name": "Evaluate cold backup authorization locally", "hosts": "localhost", "connection": "local",
                     "gather_facts": False, "become": False, "vars": variables, "tasks": [first]}]
            (root / "gate.yml").write_text(yaml.safe_dump(play, sort_keys=False))
            env = dict(os.environ, ANSIBLE_CONFIG=str(ROOT / "ansible.cfg"), ANSIBLE_NOCOLOR="1",
                       ANSIBLE_LOCAL_TEMP=str(root / "local"), ANSIBLE_REMOTE_TEMP=str(root / "remote"))
            command = ["ansible-playbook", "-i", "localhost,", "--limit", "localhost", str(root / "gate.yml")]
            if check:
                command.append("--check")
            return subprocess.run(command, capture_output=True, text=True, env=env, timeout=45)

    def test_default_refuses_writes_while_explicit_authorization_or_check_passes(self):
        self.assertNotEqual(self.run_gate(authorized=False).returncode, 0)
        for authorized, check in ((True, False), (False, True)):
            result = self.run_gate(authorized=authorized, check=check)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("changed=0", result.stdout)


if __name__ == "__main__":
    unittest.main()
