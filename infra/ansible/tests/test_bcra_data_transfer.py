"""Local contracts for the one-shot transfer. No SSH, rsync or Docker runs."""
import ast
import base64
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from types import SimpleNamespace

import yaml

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools/bcra-data-transfer.py"
SPEC = importlib.util.spec_from_file_location("bcra_data_transfer", SOURCE)
transfer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(transfer)
CID = "d9be0a209f53" + "a" * 52


class TransferTests(unittest.TestCase):
    def test_tools_parse_with_python36_grammar(self):
        for name in ("bcra-data-transfer.py", "bcra-data-manifest.py"):
            ast.parse((ROOT / "tools" / name).read_text(), feature_version=(3, 6))

    def test_inspection_requests_state_only_and_rejects_running_or_replaced_container(self):
        stopped = {"Status": "exited", "Running": False, "Paused": False, "Restarting": False, "Pid": 0}
        with patch.object(transfer, "command", return_value=CID + " " + json.dumps(stopped)) as run:
            self.assertEqual(CID, transfer.stopped_container(CID[:12]))
            self.assertNotIn(".Env", repr(run.call_args))
        for ident, changes in [(CID, {"Running": True}), (CID, {"Pid": 123}), ("b" * 64, {})]:
            with patch.object(transfer, "command", return_value=ident + " " + json.dumps(dict(stopped, **changes))):
                with self.assertRaises(transfer.TransferError):
                    transfer.stopped_container(CID[:12])

    def test_bounded_copy_has_no_delete_checksum_secluded_args_or_root_receiver(self):
        config = {"destination_port": 2241, "bwlimit_kib": 8192,
                  "destination_user": "bcra-transfer", "destination_host": "168.197.51.104"}
        command = transfer.rsync_command(config)
        self.assertIn("-aH", command)
        self.assertIn("--numeric-ids", command)
        self.assertIn("--partial", command)
        self.assertIn("--bwlimit=8192", command)
        self.assertEqual("bcra-transfer@168.197.51.104:./", command[-1])
        self.assertNotIn("--delete", command)
        self.assertNotIn("--checksum", command)
        self.assertNotIn("--protect-args", command)
        self.assertIn("StrictHostKeyChecking=yes", command[command.index("--rsh") + 1])

    def test_tmpfs_empty_source_does_not_falsely_match_destination(self):
        def command(argv):
            if "--filter" in argv:
                return ""
            if argv[1] == "ps":
                return "a" * 12
            return json.dumps([{"RW": True, "Source": "", "Type": "tmpfs"}])
        with patch.object(transfer, "command", side_effect=command):
            transfer.assert_destination_stopped()

    def test_any_running_writer_to_parent_or_child_data_mount_is_rejected(self):
        for source in (transfer.DESTINATION.as_posix(), "/srv/redunisol", (transfer.DESTINATION / "pending").as_posix()):
            def command(argv):
                if "--filter" in argv:
                    return ""
                return "a" * 12 if argv[1] == "ps" else json.dumps([{"RW": True, "Source": source}])
            with patch.object(transfer, "command", side_effect=command):
                with self.assertRaisesRegex(transfer.TransferError, "destination_has_running_writer"):
                    transfer.assert_destination_stopped()

    def test_expected_service_running_is_rejected_even_without_the_data_mount(self):
        with patch.object(transfer, "command", return_value="a" * 12):
            with self.assertRaisesRegex(transfer.TransferError, "destination_service_running"):
                transfer.assert_destination_stopped()

    def test_receiver_alias_requires_the_same_device_inode_and_numeric_owner(self):
        alias = MagicMock()
        alias.is_symlink.return_value = False
        alias.is_dir.return_value = True
        original = MagicMock()
        original.stat.return_value = SimpleNamespace(st_dev=7, st_ino=42)
        with patch.object(transfer, "RECEIVER_ALIAS", alias), patch.object(transfer, "DESTINATION", original), patch.object(transfer, "alias_mounts", return_value=[["known-mount"]]):
            alias.stat.return_value = SimpleNamespace(st_dev=7, st_ino=42, st_uid=10001, st_gid=10001)
            transfer.assert_alias_identity()
            for changed in ({"st_ino": 43}, {"st_dev": 8}, {"st_uid": 0}):
                value = dict(st_dev=7, st_ino=42, st_uid=10001, st_gid=10001)
                value.update(changed)
                alias.stat.return_value = SimpleNamespace(**value)
                with self.assertRaisesRegex(transfer.TransferError, "receiver_alias_identity_mismatch"):
                    transfer.assert_alias_identity()

    def test_unknown_existing_alias_mount_is_never_overmounted(self):
        marker = {"destination_root": str(transfer.DESTINATION), "receiver_alias": str(transfer.RECEIVER_ALIAS)}
        parent = MagicMock()
        parent.is_symlink.return_value = False
        parent.resolve.return_value = parent
        parent.stat.return_value = SimpleNamespace(st_uid=0, st_mode=0o40755)
        alias = MagicMock()
        alias.parent = parent
        with patch.object(transfer, "RECEIVER_ALIAS", alias), patch.object(transfer, "assert_destination_stopped"), patch.object(transfer, "read_json", return_value=dict(marker, receiver_alias=str(alias))), patch.object(transfer, "alias_mounts", return_value=[["unknown"]]), patch.object(transfer, "assert_alias_identity", side_effect=transfer.TransferError("receiver_alias_identity_mismatch")), patch.object(transfer, "command") as command:
            with self.assertRaises(transfer.TransferError):
                transfer.destination_alias()
            command.assert_not_called()

    def test_unknown_existing_configuration_never_replaces_private_key(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            runtime = root / "runtime"
            runtime.mkdir()
            volume = root / "volume"
            volume.mkdir()
            (runtime / "config.json").write_text('{"unknown":true}')
            private = runtime / "id_ed25519"
            private.write_text("private-fixture-never-output")
            tool = b"synthetic manifest helper"
            args = type("Args", (), {"revision": "a" * 40, "source_container": CID[:12], "bwlimit_kib": 8192,
                                     "hash_mib_per_sec": 8, "known_host": "[168.197.51.104]:2241 ssh-ed25519 AAAA",
                                     "tool_base64": base64.b64encode(tool).decode(), "tool_sha256": hashlib.sha256(tool).hexdigest()})()
            with patch.object(transfer, "RUNTIME", runtime), patch.object(transfer, "SOURCE", volume), patch.object(transfer, "runtime_directory"), patch.object(transfer, "stopped_container", return_value=CID):
                with self.assertRaisesRegex(transfer.TransferError, "existing_transfer_contract_differs"):
                    transfer.source_prepare(args)
            self.assertEqual("private-fixture-never-output", private.read_text())
            self.assertFalse((runtime / "data_tool.py").exists())

    def test_existing_active_worker_is_observed_without_launching_a_second(self):
        config = {"source_container_id": CID}
        state = {"phase": "copying", "config_sha256": transfer.digest(config)}
        with patch.object(transfer, "runtime_directory"), patch.object(transfer, "lock_runtime", return_value=MagicMock()), patch.object(transfer, "read_json", side_effect=[config, state]), patch.object(Path, "exists", return_value=True), patch.object(transfer, "active", return_value=True), patch.object(transfer, "safe_status", return_value={"phase": "copying"}), patch.object(transfer.subprocess, "Popen") as popen:
            self.assertEqual("copying", transfer.source_start()["phase"])
            popen.assert_not_called()

    def test_pid_reuse_is_not_misclassified_as_the_original_worker(self):
        state = {"worker_pid": 42, "worker_start_ticks": "100"}
        with patch.object(transfer, "process_identity", return_value="200"):
            self.assertFalse(transfer.active(state, "worker"))

    def test_failed_rsync_never_produces_a_successful_manifest(self):
        config = {"source_container_id": CID, "destination_port": 2241, "bwlimit_kib": 8192,
                  "destination_user": "bcra-transfer", "destination_host": "168.197.51.104"}
        state = {"worker_pid": os.getpid(), "config_sha256": transfer.digest(config)}
        child = MagicMock(pid=42)
        child.wait.return_value = 23
        with patch.object(transfer, "runtime_directory"), patch.object(transfer, "lock_runtime", return_value=MagicMock()), patch.object(transfer, "read_json", side_effect=[state, config]), patch.object(transfer, "stopped_container"), patch.object(transfer, "command", return_value="{}") as command, patch.object(transfer, "save_state"), patch.object(transfer, "process_identity", return_value="100"), patch.object(transfer.subprocess, "Popen", return_value=child):
            self.assertEqual(1, transfer.source_worker())
            self.assertEqual("failed", state["phase"])
            self.assertEqual("rsync_failed", state["reason"])
            self.assertEqual(23, state["copy_returncode"])
            self.assertNotIn("source_manifest_sha256", state)
            self.assertEqual(1, command.call_count)

    def test_cli_failure_does_not_export_exception_details(self):
        output = io.StringIO()
        with patch.object(transfer, "fcntl", object()), patch.object(transfer.os, "geteuid", return_value=0, create=True), patch.object(transfer, "safe_status", side_effect=OSError("private-fixture-path")), redirect_stdout(output):
            self.assertEqual(1, transfer.main(["status"]))
        self.assertNotIn("private-fixture-path", output.getvalue())
        self.assertEqual("operation_failed", json.loads(output.getvalue())["reason"])


class PlaybookContracts(unittest.TestCase):
    def test_only_source_scripts_are_used_on_python36_without_fact_gathering(self):
        plays = yaml.safe_load((ROOT / "playbooks/bcra-data-copy.yml").read_text())
        self.assertEqual(["bcra_migration_origins", "bcra_file_api_hosts", "bcra_migration_origins"], [play["hosts"] for play in plays])
        self.assertTrue(all(play["gather_facts"] is False for play in plays))
        for name in ("prepare_source", "start_source", "status"):
            tasks = yaml.safe_load((ROOT / "roles/bcra_data_transfer/tasks" / (name + ".yml")).read_text())
            self.assertFalse(any("ansible.builtin.command" in task or "ansible.builtin.shell" in task for task in tasks))

    def test_receiver_key_has_exact_source_forced_command_and_no_private_transfer(self):
        source = (ROOT / "roles/bcra_data_transfer/tasks/prepare_destination.yml").read_text()
        self.assertIn('from="66.97.34.158",restrict,command="/usr/bin/rrsync -wo /var/lib/redunisol-bcra-transfer/data"', source)
        self.assertIn("password_lock: true", source)
        self.assertIn("Refuse to replace unknown SSH keys", source)
        self.assertNotIn("id_ed25519", source)
        status = (ROOT / "roles/bcra_data_transfer/tasks/status.yml").read_text()
        self.assertIn("changed_when: false", status)


if __name__ == "__main__":
    unittest.main()
