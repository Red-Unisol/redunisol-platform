"""Separate synthetic-only Restic recovery, with real local round-trips."""
from argparse import Namespace
import base64
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

import yaml


ROOT = Path(__file__).resolve().parents[1]
ROLE = ROOT / "roles/metamap_backup"
SOURCE = ROLE / "files/metamap-backup.py"
SPEC = importlib.util.spec_from_file_location("metamap_backup", SOURCE)
BACKUP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BACKUP)
RESTIC = os.environ.get("FOUNDATION_TEST_RESTIC_BINARY") or shutil.which("restic")
PLAYBOOK = shutil.which("ansible-playbook")
if not PLAYBOOK and Path(os.sys.executable).with_name("ansible-playbook").is_file():
    PLAYBOOK = str(Path(os.sys.executable).with_name("ansible-playbook"))


class Layout:
    def __init__(self, base):
        self.mount = base / "backup-mount"
        for path in (self.mount, self.mount / "restic", base / "private", base / "state", base / "restores"):
            path.mkdir(mode=0o700)
        self.password = base / "private" / "password"
        self.password.write_text("synthetic-custodied-key-" + "x" * 40 + "\n")
        self.password.chmod(0o600)
        self.args = Namespace(revision="a" * 40, mountpoint=self.mount, mount_uuid="fixture-uuid",
                              repository=self.mount / "restic/metamap", password_file=self.password,
                              state_dir=base / "state", restore_dir=base / "restores",
                              timeout_seconds=600, initialize_authorized=True)


@unittest.skipUnless(os.name == "posix", "Linux filesystem semantics required")
class GuardTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="metamap-backup-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.layout = Layout(self.root)
        self.args = self.layout.args

    def test_foundation_repository_is_never_selected(self):
        self.args.repository = self.layout.mount / "restic/foundation"
        with self.assertRaisesRegex(BACKUP.RecoveryError, "separate MetaMap"):
            BACKUP.validate_layout(self.args)
        self.assertFalse(self.args.repository.exists())

    def test_wrong_mount_uuid_and_root_device_are_rejected(self):
        for change in ({"uuid": "wrong"}, {"maj:min": "1:1"}):
            selected = dict(target=str(self.layout.mount), uuid="fixture-uuid", fstype="xfs", **{"maj:min": "2:1"})
            selected.update(change)
            root = dict(target="/", uuid="root", fstype="xfs", **{"maj:min": "1:1"})
            results = [subprocess.CompletedProcess([], 0, json.dumps({"filesystems": [value]}).encode(), b"")
                       for value in (selected, root)]
            with self.subTest(change=change), mock.patch.object(BACKUP, "command", side_effect=results):
                with self.assertRaisesRegex(BACKUP.RecoveryError, "mount"):
                    BACKUP.validate_mount(self.args)

    def test_key_symlinks_and_public_permissions_are_rejected(self):
        self.layout.password.chmod(0o644)
        with self.assertRaisesRegex(BACKUP.RecoveryError, "permissions"):
            BACKUP.validate_layout(self.args)
        self.layout.password.chmod(0o600)
        linked = self.root / "linked"
        linked.symlink_to(self.layout.password.parent)
        self.args.password_file = linked / "password"
        with self.assertRaisesRegex(BACKUP.RecoveryError, "Noncanonical"):
            BACKUP.validate_layout(self.args)

    def test_existing_unrecognized_repository_is_not_adopted(self):
        self.args.repository.mkdir(mode=0o700)
        (self.args.repository / "config").write_bytes(b"fixture")
        with self.assertRaisesRegex(BACKUP.RecoveryError, "never adopted"):
            BACKUP.ensure_repository(self.args, mock.Mock())

    def test_initialization_requires_its_separate_flag(self):
        self.args.initialize_authorized = False
        with self.assertRaisesRegex(BACKUP.RecoveryError, "initialization authorization"):
            BACKUP.ensure_repository(self.args, mock.Mock())
        self.assertFalse(self.args.repository.exists())

    def test_unrelated_files_are_never_removed_for_initialization(self):
        self.args.repository.mkdir(mode=0o700)
        marker = self.args.repository / "unrelated"
        marker.write_text("preserve me")
        with self.assertRaisesRegex(BACKUP.RecoveryError, "unrelated"):
            BACKUP.ensure_repository(self.args, mock.Mock())
        self.assertEqual(marker.read_text(), "preserve me")

    def test_failure_does_not_publish_partial_or_replace_existing_evidence(self):
        destination = self.args.state_dir / "canary.json"
        with mock.patch.object(BACKUP.os, "link", side_effect=OSError("fixture failure")):
            with self.assertRaises(OSError):
                BACKUP.atomic_json(destination, {"accepted": True})
        self.assertEqual(list(self.args.state_dir.iterdir()), [])
        BACKUP.atomic_json(destination, {"first": True})
        with self.assertRaises(BACKUP.RecoveryError):
            BACKUP.atomic_json(destination, {"second": True})
        self.assertEqual(json.loads(destination.read_text()), {"first": True})

    def test_parallel_operations_fail_instead_of_being_reported_successful(self):
        with BACKUP.operation_lock(self.args, True):
            with self.assertRaisesRegex(BACKUP.RecoveryError, "in progress"):
                with BACKUP.operation_lock(self.args, True):
                    self.fail("Concurrent operation entered")

    def test_restic_environment_is_scrubbed_and_backend_output_is_not_exposed(self):
        value = subprocess.CompletedProcess([], 0, b"", b"")
        with mock.patch.dict(os.environ, {"RESTIC_PASSWORD": "synthetic", "RESTIC_REPOSITORY": "wrong"}):
            with mock.patch.object(BACKUP.subprocess, "run", return_value=value) as run:
                BACKUP.command(["fixture"], 1)
                self.assertFalse(any(key.startswith("RESTIC_") for key in run.call_args.kwargs["env"]))
        self.assertEqual(run.call_args.kwargs["stdin"], subprocess.DEVNULL)

    def test_cli_cannot_select_another_repository_or_dataset(self):
        flags = ["prepare", "--revision", "a" * 40, "--mount-uuid", "fixture"]
        for key in ("mountpoint", "repository", "password_file", "state_dir", "restore_dir"):
            flags += ["--" + key.replace("_", "-"), str(getattr(self.args, key))]
        with mock.patch.object(BACKUP.os, "geteuid", return_value=0), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(BACKUP.main(flags), 2)
        self.assertFalse(self.args.repository.exists())


@unittest.skipUnless(os.name == "posix" and RESTIC, "Pinned local Restic test binary required")
class ResticRoundTripTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="metamap-restic-real-")
        self.addCleanup(self.temporary.cleanup)
        self.layout = Layout(Path(self.temporary.name))
        self.args = self.layout.args
        self.addCleanup(mock.patch.stopall)
        mock.patch.object(BACKUP, "RESTIC_BINARY", RESTIC).start()
        # The physical mount contract has separate negative tests. Real Restic
        # operations here are restricted to the test's temporary filesystem.
        mock.patch.object(BACKUP, "validate_mount").start()

    def test_real_encrypted_restore_is_repeatable_without_refreshing_proof(self):
        first = BACKUP.execute(self.args, prepare=True)
        self.assertTrue(first["created"])
        receipt_path = self.args.state_dir / "canary.json"
        original = receipt_path.read_bytes()
        original_mtime = receipt_path.stat().st_mtime_ns
        receipt = json.loads(original)
        self.assertTrue(receipt["wrong_key_rejected"])
        self.assertTrue(receipt["read_data"])
        self.assertFalse(receipt["production_data_protected"])
        self.assertFalse(receipt["offsite"])
        self.assertFalse(receipt["continuous_backup"])
        self.args.initialize_authorized = False
        repeated = BACKUP.execute(self.args, prepare=True)
        verified = BACKUP.execute(self.args, prepare=False)
        self.assertFalse(repeated["created"])
        self.assertFalse(verified["created"])
        self.assertEqual(receipt_path.read_bytes(), original)
        self.assertEqual(receipt_path.stat().st_mtime_ns, original_mtime)
        snapshots = BACKUP.Restic(self.args).json("snapshots", "--json")
        self.assertEqual(len(snapshots), 1)
        self.assertEqual(snapshots[0]["id"], first["snapshot_id"])

    def test_wrong_key_and_restore_tampering_fail_without_rewriting_receipts(self):
        BACKUP.execute(self.args, prepare=True)
        receipt_path = self.args.state_dir / "canary.json"
        original = receipt_path.read_bytes()
        key = self.args.password_file.read_bytes()
        self.args.password_file.write_text("different-synthetic-key-" + "y" * 40)
        with self.assertRaisesRegex(BACKUP.RecoveryError, "Restic operation"):
            BACKUP.execute(self.args, prepare=False)
        self.args.password_file.write_bytes(key)
        receipt = json.loads(original)
        restored = Path(receipt["restored_source"])
        (restored / "data/payload.bin").write_bytes(b"truncated")
        with self.assertRaisesRegex(BACKUP.RecoveryError, "metadata differ"):
            BACKUP.execute(self.args, prepare=False)
        self.assertEqual(receipt_path.read_bytes(), original)


@unittest.skipUnless(os.name == "posix" and PLAYBOOK, "Ansible controller required")
class RoleContractTests(unittest.TestCase):
    def run_private_assert(self, task, variables):
        with tempfile.TemporaryDirectory() as directory:
            playbook = Path(directory) / "private-contract.yml"
            playbook.write_text(yaml.safe_dump([{"hosts": "localhost", "connection": "local",
                                                "gather_facts": False, "vars": variables, "tasks": [task]}]))
            environment = dict(os.environ, ANSIBLE_CONFIG=str(ROOT / "ansible.cfg"),
                               ANSIBLE_LOCAL_TEMP=str(Path(directory) / "ansible-temp"))
            return subprocess.run([PLAYBOOK, "-i", "localhost,", str(playbook)], capture_output=True,
                                  text=True, env=environment, timeout=30, check=False)

    def test_supplied_key_controls_are_rejected_by_the_actual_ansible_assert(self):
        tasks = yaml.safe_load((ROLE / "tasks/main.yml").read_text())
        task = next(item for item in next(item for item in tasks if "block" in item)["block"]
                    if item["name"] == "Require the private custodied password supplied by the controller")
        for key, accepted in (("synthetic-" + "a" * 40, True), ("a" * 40 + "\0", False),
                              ("a" * 40 + "\nb", False), (" " + "a" * 40, False)):
            with self.subTest(accepted=accepted):
                result = self.run_private_assert(task, {"metamap_backup_password": key})
                self.assertEqual(result.returncode == 0, accepted, result.stdout + result.stderr)

    def test_existing_key_is_preserved_unless_the_custodied_copy_matches(self):
        tasks = yaml.safe_load((ROLE / "tasks/main.yml").read_text())
        task = dict(next(item for item in next(item for item in tasks if "block" in item)["block"]
                         if item["name"] == "Never replace a different existing MetaMap key"))
        task.pop("when")
        key = "synthetic-custody-" + "a" * 40
        for existing, accepted in ((key, True), (key + "\n", True), ("other-" + "b" * 40, False)):
            with self.subTest(accepted=accepted):
                variables = {"metamap_backup_password": key,
                             "metamap_backup_existing_key": {"content": base64.b64encode(existing.encode()).decode()}}
                result = self.run_private_assert(task, variables)
                self.assertEqual(result.returncode == 0, accepted, result.stdout + result.stderr)

    def test_actual_contract_accepts_only_the_fixed_reviewed_destination(self):
        task = yaml.safe_load((ROLE / "tasks/contract.yml").read_text())[0]
        defaults = yaml.safe_load((ROLE / "defaults/main.yml").read_text())
        for changed, accepted in (({}, True), ({"metamap_backup_repository": "/srv/redunisol-backups/restic/foundation"}, False),
                                  ({"metamap_backup_revision": ""}, False)):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as directory:
                variables = dict(defaults, metamap_backup_revision="a" * 40)
                variables.update(changed)
                playbook = Path(directory) / "contract.yml"
                playbook.write_text(yaml.safe_dump([{"hosts": "localhost", "connection": "local",
                                                    "gather_facts": False, "vars": variables, "tasks": [task]}]))
                environment = dict(os.environ, ANSIBLE_CONFIG=str(ROOT / "ansible.cfg"),
                                   ANSIBLE_LOCAL_TEMP=str(Path(directory) / "ansible-temp"))
                result = subprocess.run([PLAYBOOK, "-i", "localhost,", str(playbook)], capture_output=True,
                                        text=True, env=environment, timeout=30, check=False)
                self.assertEqual(result.returncode == 0, accepted, result.stdout + result.stderr)

    def test_check_mode_skips_mutations_and_no_policy_schedules_deletion(self):
        tasks = yaml.safe_load((ROLE / "tasks/main.yml").read_text())
        block = next(task for task in tasks if "block" in task)
        self.assertEqual(block["when"], "not ansible_check_mode")
        policy = json.loads((ROLE / "files/retention-policy.json").read_text())
        self.assertFalse(policy["enforcement_enabled"])
        self.assertFalse(policy["timers_enabled"])
        self.assertFalse(policy["automatic_forget_or_prune"])
        self.assertFalse(policy["synthetic_canary_satisfies_production_activation"])


if __name__ == "__main__":
    unittest.main()
