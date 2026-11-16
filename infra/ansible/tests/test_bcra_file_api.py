"""Exercise real BCRA start gates and runtime metadata validation without a server."""
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
ROLE = ROOT / "roles/bcra_file_api"
SPEC = importlib.util.spec_from_file_location("bcra_contract", ROLE / "files/bcra-contract.py")
CONTRACT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTRACT)
DEFAULTS = yaml.safe_load((ROLE / "defaults/main.yml").read_text())
IMAGE = DEFAULTS["bcra_file_api_image"]
REVISION = "a" * 40


def migration():
    return {
        "version": 1, "copy_verified": True, "sqlite_verified": True,
        "source_manifest_sha256": "1" * 64, "destination_manifest_sha256": "2" * 64,
        "post_recovery_manifest_sha256": "6" * 64,
        "copy_tree_sha256": "7" * 64, "transfer_revocation_receipt_sha256": "8" * 64,
        "transfer_access_revoked": True, "receiver_alias_removed": True,
        "tree_sha256": "3" * 64, "source_container_id": "d9be0a209f53",
        "cutoff_at": "2026-11-12T01:59:26.637806Z", "image": IMAGE,
    }


def metadata():
    return {
        "image_ref": IMAGE, "image_id": "sha256:" + "4" * 64, "running": True,
        "project": "bcra-file-api", "service": "bcra-file-api", "revision": REVISION,
        "user": "10001:10001", "readonly": True, "privileged": False,
        "caps": ["ALL"], "security": ["no-new-privileges:true"],
        "pids": 64, "memory": 2147483648, "cpus": 1000000000,
        "ports": {"8080/tcp": [{"HostIp": "127.0.0.1", "HostPort": "18082"}]},
        "mounts": [{"Type": "bind", "Source": DEFAULTS["bcra_file_api_data_dir"], "Destination": "/data", "RW": True}],
        "tmpfs": {"/tmp": "size=67108864,mode=1777"},
    }


class MigrationGateTests(unittest.TestCase):
    def validate(self, value):
        raw = json.dumps(value).encode()
        return CONTRACT.migration_document(raw, hashlib.sha256(raw).hexdigest(), IMAGE)

    def test_verified_cutoff_is_preserved_without_exporting_extra_payload(self):
        value = migration()
        value["private_extra"] = "must not be exported"
        proof = self.validate(value)
        self.assertEqual(proof["tree_sha256"], "3" * 64)
        self.assertEqual(proof["cutoff_at"], value["cutoff_at"])
        self.assertNotIn("private_extra", proof)

    def test_changing_the_report_after_copy_fails_the_exact_checksum(self):
        raw = json.dumps(migration()).encode()
        with self.assertRaisesRegex(CONTRACT.ContractError, "checksum_mismatch"):
            CONTRACT.migration_document(raw + b"\n", hashlib.sha256(raw).hexdigest(), IMAGE)

    def test_unverified_copy_sqlite_or_wrong_image_cannot_authorize_start(self):
        for changes in ({"copy_verified": False}, {"sqlite_verified": False}, {"copy_verified": 1},
                        {"image": "ghcr.io/red-unisol/bcra-file-api:latest"}, {"source_manifest_sha256": ""},
                        {"source_container_id": "unknown"}, {"cutoff_at": "2026-11-12T01:59:26"},
                        {"cutoff_at": "2026-11-11T22:59:26-03:00"}, {"version": True},
                        {"transfer_access_revoked": False}, {"receiver_alias_removed": False},
                        {"transfer_revocation_receipt_sha256": ""}, {"copy_tree_sha256": ""}):
            with self.subTest(changes=changes), self.assertRaises(CONTRACT.ContractError):
                self.validate({**migration(), **changes})

    @unittest.skipUnless(os.name == "posix", "POSIX no-follow file guard")
    def test_migration_report_cannot_be_a_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            raw = json.dumps(migration()).encode()
            (path / "report.json").write_bytes(raw)
            (path / "linked.json").symlink_to(path / "report.json")
            with self.assertRaises(OSError):
                CONTRACT.read_migration(path / "linked.json", hashlib.sha256(raw).hexdigest(), IMAGE)


class RuntimeConfinementTests(unittest.TestCase):
    def validate(self, value, local_image=None):
        local_image = local_image or {"id": "sha256:" + "4" * 64, "digests": [IMAGE]}
        return CONTRACT.runtime_document(value, local_image, IMAGE, DEFAULTS["bcra_file_api_data_dir"], REVISION)

    def test_only_the_actual_pinned_confined_runtime_passes(self):
        proof = self.validate(metadata())
        self.assertEqual(proof, {"image": IMAGE, "image_id": "sha256:" + "4" * 64, "running": True, "confined": True})
        self.assertNotIn("Env", CONTRACT.CONTAINER_FORMAT)
        self.assertNotIn("Env", CONTRACT.IMAGE_FORMAT)

    def test_a_public_listener_or_docker_socket_is_rejected(self):
        public = metadata()
        public["ports"]["8080/tcp"][0]["HostIp"] = "0.0.0.0"
        socket = metadata()
        socket["mounts"].append({"Type": "bind", "Source": "/var/run/docker.sock", "Destination": "/var/run/docker.sock"})
        for value in (public, socket):
            with self.subTest(value=value), self.assertRaises(CONTRACT.ContractError):
                self.validate(value)

    def test_runtime_drift_in_identity_limits_or_ownership_is_rejected(self):
        for name, value in (("running", False), ("user", "0:0"), ("readonly", False), ("privileged", True),
                            ("caps", []), ("security", []), ("pids", 0), ("memory", 0), ("cpus", 0),
                            ("revision", "b" * 40), ("project", "unmanaged"), ("image_id", "sha256:" + "5" * 64)):
            with self.subTest(field=name), self.assertRaises(CONTRACT.ContractError):
                self.validate({**metadata(), name: value})
        with self.assertRaisesRegex(CONTRACT.ContractError, "image_mismatch"):
            self.validate(metadata(), {"id": "sha256:" + "4" * 64, "digests": []})


@unittest.skipUnless(os.name == "posix" and shutil.which("ansible-playbook"), "Pinned Linux Ansible controller required")
class ExecutableAnsibleContractTests(unittest.TestCase):
    def run_contract(self, **changes):
        values = {**DEFAULTS, "bcra_file_api_revision": REVISION, **changes}
        tasks = yaml.safe_load((ROLE / "tasks/contract.yml").read_text())
        self.assertTrue(all("ansible.builtin.assert" in task for task in tasks))
        return self.run_tasks(tasks, values)

    def run_tasks(self, tasks, values):
        play = [{"name": "Check application gates locally only", "hosts": "localhost", "connection": "local",
                 "gather_facts": False, "become": False, "vars": values, "tasks": tasks}]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "play.yml").write_text(yaml.safe_dump(play, sort_keys=False))
            env = dict(os.environ, ANSIBLE_CONFIG=str(ROOT / "ansible.cfg"), ANSIBLE_NOCOLOR="1",
                       ANSIBLE_LOCAL_TEMP=str(path / "local"), ANSIBLE_REMOTE_TEMP=str(path / "remote"))
            return subprocess.run(["ansible-playbook", "-i", "localhost,", "--limit", "localhost", str(path / "play.yml")],
                                  env=env, capture_output=True, text=True, timeout=45)

    def test_preparation_default_passes_without_a_migration_or_activation(self):
        self.assertFalse(DEFAULTS["bcra_file_api_running"])
        result = self.run_contract()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("changed=0", result.stdout)

    def test_activation_requires_both_a_report_checksum_and_terms_acceptance(self):
        for changes in ({"bcra_file_api_running": True},
                        {"bcra_file_api_running": True, "bcra_file_api_data_manifest_sha256": "1" * 64}):
            with self.subTest(changes=changes):
                result = self.run_contract(**changes)
                self.assertNotEqual(result.returncode, 0)
        result = self.run_contract(bcra_file_api_running=True, bcra_file_api_data_manifest_sha256="1" * 64,
                                   bcra_file_api_cold_backup_receipt_sha256="2" * 64,
                                   bcra_file_api_terms_accepted=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_other_paths_or_floating_image_are_rejected(self):
        for changes in ({"bcra_file_api_data_dir": "/var/lib/docker"}, {"bcra_file_api_image": "bcra:latest"}):
            with self.subTest(changes=changes):
                result = self.run_contract(**changes)
                self.assertNotEqual(result.returncode, 0)

    def test_recreated_runtime_reports_change_even_when_files_and_running_state_match(self):
        main = yaml.safe_load((ROLE / "tasks/main.yml").read_text())
        prepare = next(task["block"] for task in main if "block" in task)
        activate = next(task["block"] for task in prepare if "block" in task)
        converge = next(task for task in activate if "Converge the single" in task.get("name", ""))
        condition = converge["changed_when"]
        for progress, changed in (("Running", False), ("Recreated", True), ("Created", True), ("Started", True)):
            values = {
                "bcra_file_api_compose": {"changed": False}, "bcra_file_api_secret": {"changed": False},
                "bcra_file_api_previous_running": {"rc": 0, "stdout": "true"},
                "bcra_file_api_up": {"stdout": "", "stderr": "Container redunisol-bcra-file-api " + progress},
                "expected_change": changed,
            }
            tasks = [{"name": "Evaluate the actual convergence change condition", "ansible.builtin.assert": {
                "that": ["(" + condition + ") == expected_change"],
            }}]
            with self.subTest(progress=progress):
                result = self.run_tasks(tasks, values)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_real_templates_keep_the_token_literal_and_out_of_the_compose_document(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            token = 'synthetic$token"with_quotes_and_symbols'
            tasks = [{
                "name": "Render the real application template in a private local fixture",
                "ansible.builtin.template": {"src": str(ROLE / "templates" / source), "dest": str(target / name), "mode": "0600"},
            } for source, name in (("docker-compose.yml.j2", "docker-compose.yml"), ("api.env.j2", "api.env"))]
            result = self.run_tasks(tasks, {**DEFAULTS, "bcra_file_api_revision": REVISION, "bcra_file_api_api_token": token})
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            rendered = (target / "docker-compose.yml").read_text()
            service = yaml.safe_load(rendered)["services"]["bcra-file-api"]
            self.assertNotIn(token, rendered)
            self.assertEqual((target / "api.env").read_text(), "BCRA_FILE_API_TOKEN=" + token + "\n")
            self.assertEqual(service["env_file"], [{"path": "./api.env", "format": "raw"}])
            self.assertEqual(service["ports"], ["127.0.0.1:18082:8080"])
            self.assertEqual(service["image"], IMAGE)
            self.assertTrue(service["read_only"])
            self.assertNotIn("kestra_net", rendered)

    def test_preexisting_copied_data_directory_keeps_its_metadata(self):
        main = yaml.safe_load((ROLE / "tasks/main.yml").read_text())
        prepare = next(task["block"] for task in main if "block" in task)
        creation = next(task for task in prepare if "Create the data root" in task.get("name", ""))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            path.chmod(0o750)
            before = path.stat()
            result = self.run_tasks([creation], {
                "bcra_file_api_data_dir": str(path),
                "bcra_file_api_paths": {"results": [{"stat": {}}, {"stat": {"exists": True}}]},
            })
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(path.stat().st_mode, before.st_mode)
            self.assertEqual(path.stat().st_uid, before.st_uid)
            self.assertIn("changed=0", result.stdout)


class ColdBackupGateTests(unittest.TestCase):
    def receipt(self):
        return {"version": 1, "scope": "initial-cold-bcra-local", "status": "verified",
                "snapshot_verified": True, "restored_manifest_verified": True,
                "repository_integrity_verified": True, "read_data": True,
                "repository_integrity_verified_at": "2026-11-12T05:00:00Z",
                "offsite": False, "continuous_backup": False,
                "repository_id": "7" * 64, "snapshot_id": "8" * 64,
                "migration_manifest_sha256": "9" * 64, "restored_manifest_sha256": "9" * 64,
                "image": IMAGE, "tree_sha256": "3" * 64, "cutoff_at": migration()["cutoff_at"]}

    def validate(self, receipt):
        raw = json.dumps(receipt).encode()
        return CONTRACT.cold_backup_document(raw, hashlib.sha256(raw).hexdigest(), migration(), "9" * 64)

    def test_only_the_initial_restored_backup_of_the_same_cutoff_passes(self):
        self.assertEqual(self.validate(self.receipt())["snapshot_id"], "8" * 64)
        for changes in ({"snapshot_verified": False}, {"restored_manifest_verified": False},
                        {"repository_integrity_verified": False}, {"read_data": False}, {"read_data": "true"},
                        {"repository_integrity_verified_at": "2026-11-12T05:00:00"},
                        {"tree_sha256": "f" * 64}, {"migration_manifest_sha256": "a" * 64},
                        {"restored_manifest_sha256": "a" * 64}, {"image": "wrong"},
                        {"cutoff_at": "2026-11-12T02:00:00Z"}, {"offsite": True}):
            with self.subTest(changes=changes), self.assertRaises(CONTRACT.ContractError):
                self.validate({**self.receipt(), **changes})

    def test_version_one_receipt_without_full_pack_verification_is_rejected(self):
        receipt = self.receipt()
        receipt.pop("repository_integrity_verified")
        receipt.pop("read_data")
        with self.assertRaisesRegex(CONTRACT.ContractError, "read_data_check_required"):
            self.validate(receipt)


if __name__ == "__main__":
    unittest.main()
