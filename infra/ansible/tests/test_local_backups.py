"""Local-only safety contracts and a real restic configuration round-trip."""
import base64
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import types
import unittest

import jinja2
import yaml

ROOT = Path(__file__).resolve().parents[1]
ROLE = ROOT / "roles/backups"
PLAYBOOK = shutil.which("ansible-playbook")
if not PLAYBOOK and Path(sys.executable).with_name("ansible-playbook").is_file():
    PLAYBOOK = str(Path(sys.executable).with_name("ansible-playbook"))
RESTIC = os.environ.get("FOUNDATION_TEST_RESTIC_BINARY") or shutil.which("restic")


def data(path):
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def task_from(path, name):
    return copy.deepcopy(next(task for task in data(path) if task["name"] == name))


@unittest.skipUnless(os.name == "posix" and PLAYBOOK, "Linux Ansible controller required")
class LocalBackupContractTests(unittest.TestCase):
    def run_assert(self, task, variables):
        self.assertIn("ansible.builtin.assert", task)
        defaults = data(ROLE / "defaults/main.yml")
        defaults.update(variables)
        play = [{"name": "Validate backup contract without SSH or provisioning",
                 "hosts": "localhost", "connection": "local", "become": False,
                 "gather_facts": False, "tasks": [task]}]
        with tempfile.TemporaryDirectory(prefix="foundation-local-contract-") as directory:
            temporary = Path(directory)
            play_path = temporary / "play.yml"
            play_path.write_text(yaml.safe_dump(play, sort_keys=False), encoding="utf-8")
            config = temporary / "ansible.cfg"
            config.write_text("[defaults]\nhost_key_checking=True\nretry_files_enabled=False\n",
                              encoding="utf-8")
            private_vars = temporary / "private-vars.json"
            private_vars.write_text(json.dumps(defaults), encoding="utf-8")
            private_vars.chmod(0o600)
            environment = dict(os.environ, ANSIBLE_CONFIG=str(config), ANSIBLE_NOCOLOR="1",
                               ANSIBLE_LOCAL_TEMP=str(temporary / "local-tmp"))
            return subprocess.run([PLAYBOOK, "-i", "localhost,", "-c", "local",
                                   str(play_path), "--extra-vars", "@" + str(private_vars), "--check"],
                                  cwd=directory, env=environment, capture_output=True,
                                  text=True, timeout=45)

    def test_sources_reject_directories_and_repository_password(self):
        task = task_from(ROLE / "tasks/main.yml", "Validate backup role settings")
        for source in ("/etc", "/etc/redunisol-foundation/backup/restic-password"):
            with self.subTest(source=source):
                result = self.run_assert(task, {"foundation_backups_source_paths": [source]})
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_initialization_requires_authorization_and_independent_custody(self):
        task = task_from(ROLE / "tasks/initialize.yml",
                         "Require explicit local repository initialization authorization")
        values = {"foundation_apply_authorized": True, "foundation_revision": "a" * 40,
                  "foundation_backups_repository_kind": "local",
                  "foundation_backups_initialize_authorized": True,
                  "foundation_backups_key_custody_confirmed": True}
        for override, accepted in (({}, True),
                                   ({"foundation_backups_initialize_authorized": False}, False),
                                   ({"foundation_backups_key_custody_confirmed": False}, False)):
            result = self.run_assert(task, dict(values, **override))
            self.assertEqual(result.returncode == 0, accepted, result.stdout + result.stderr)

    def test_mount_guard_rejects_root_fallback_and_wrong_uuid(self):
        task = task_from(ROLE / "tasks/validate-local-mount.yml",
                         "Require the intended filesystem rather than the root fallback")
        local = {"target": "/srv/redunisol-backups", "uuid": "df29bb35-b77f-4355-a93c-c53a32580267",
                 "maj:min": "8:17"}
        root = {"target": "/", "uuid": "11111111-1111-1111-1111-111111111111",
                "maj:min": "259:3"}
        for changed, accepted in (({}, True), ({"maj:min": root["maj:min"]}, False),
                                  ({"uuid": root["uuid"]}, False)):
            values = {
                "foundation_backups_local_mountpoint": local["target"],
                "foundation_backups_local_mount_uuid": local["uuid"],
                "foundation_backups_local_mount": {
                    "stdout": json.dumps({"filesystems": [dict(local, **changed)]})},
                "foundation_backups_root_mount": {
                    "stdout": json.dumps({"filesystems": [root]})},
            }
            result = self.run_assert(task, values)
            self.assertEqual(result.returncode == 0, accepted, result.stdout + result.stderr)

    def test_existing_different_key_is_rejected_without_disclosing_it(self):
        task = task_from(ROLE / "tasks/initialize.yml",
                         "Refuse to replace an existing different repository password")
        fixture_key = "synthetic-unit-test-key-not-a-real-secret"
        for candidate, accepted in ((fixture_key, True), (fixture_key + "-changed", False)):
            values = {
                "foundation_backups_initialize_password": {"stat": {"exists": True}},
                "foundation_backups_existing_password": {
                    "content": base64.b64encode((fixture_key + "\n").encode()).decode()},
                "foundation_backups_password": candidate,
            }
            result = self.run_assert(task, values)
            self.assertEqual(result.returncode == 0, accepted, result.stdout + result.stderr)
            self.assertNotIn(fixture_key, result.stdout + result.stderr)


    def test_password_parent_canonical_and_private_directory_contracts(self):
        canonical_task = task_from(
            ROLE / "tasks/initialize.yml",
            "Refuse symlinked or noncanonical password parent paths",
        )
        with tempfile.TemporaryDirectory(prefix="foundation-key-parent-") as directory:
            root = Path(directory)
            private = root / "private"
            private.mkdir(mode=0o700)
            alias = root / "alias"
            alias.symlink_to(private, target_is_directory=True)
            for candidate, accepted in ((private / "password", True),
                                         (alias / "password", False)):
                values = {
                    "foundation_backups_password_file": str(candidate),
                    "foundation_backups_initialize_password_realpath": {
                        "stdout": str(candidate.resolve())},
                }
                result = self.run_assert(canonical_task, values)
                self.assertEqual(result.returncode == 0, accepted,
                                 result.stdout + result.stderr)

        private_task = task_from(
            ROLE / "tasks/initialize.yml",
            "Refuse to change ownership or mode of an unexpected password directory",
        )
        valid = {"exists": True, "islnk": False, "isdir": True,
                 "uid": 0, "mode": "0700"}
        cases = [(valid, True), ({"exists": False}, True)]
        cases.extend((dict(valid, **changed), False) for changed in (
            {"islnk": True}, {"uid": 1000}, {"mode": "0755"}, {"isdir": False},
        ))
        for observed, accepted in cases:
            values = {"foundation_backups_initialize_password_directory": {
                "stat": observed}}
            result = self.run_assert(private_task, values)
            self.assertEqual(result.returncode == 0, accepted,
                             result.stdout + result.stderr)


@unittest.skipUnless(os.name == "posix" and RESTIC, "Provide a verified local restic test binary")
class RealLocalResticTests(unittest.TestCase):
    def test_real_config_roundtrip_and_content_mode_and_change_rejections(self):
        with tempfile.TemporaryDirectory(prefix="foundation-restic-") as directory:
            temporary = Path(directory)
            source = temporary / "source"
            source.mkdir()
            first = source / "daemon.json"
            second = source / "foundation.conf"
            first.write_text('{"log-driver":"local"}\n', encoding="utf-8")
            second.write_text("Listen 127.0.0.1:8088\n", encoding="utf-8")
            for path in (first, second):
                path.chmod(0o644)
            environment = jinja2.Environment(undefined=jinja2.StrictUndefined)
            environment.filters["to_json"] = json.dumps
            rendered = environment.from_string(
                (ROLE / "templates/backup-catalog.py.j2").read_text(encoding="utf-8")
            ).render(foundation_backups_foundation_config_files=[str(first), str(second)],
                     foundation_revision="b" * 40)
            helper = temporary / "catalog.py"
            helper.write_text(rendered, encoding="utf-8")
            module = types.ModuleType("foundation_catalog_fixture")
            exec(compile(rendered, str(helper), "exec"), module.__dict__)
            catalog = temporary / "source-catalog.json"
            module.capture(catalog, [str(first), str(second)])
            password = temporary / "password"
            password.write_text("local-test-only-disposable-password\n", encoding="utf-8")
            password.chmod(0o600)
            unrelated = temporary / "unapproved.txt"
            unrelated.write_text("This unapproved file must not be restored.\n", encoding="utf-8")
            common = [RESTIC, "--repo", str(temporary / "repository"),
                      "--password-file", str(password), "--cache-dir", str(temporary / "cache")]

            def restic(*arguments):
                result = subprocess.run(common + list(arguments), capture_output=True,
                                        text=True, timeout=90)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                return result

            restic("init")
            result = restic("backup", "--json", str(first), str(second), str(catalog), str(unrelated))
            summary = next(json.loads(line) for line in result.stdout.splitlines()
                           if json.loads(line).get("message_type") == "summary")
            snapshot = summary["snapshot_id"]
            self.assertRegex(snapshot, r"^[0-9a-f]{64}$")
            restic("check", "--read-data")
            restored = temporary / "isolated"
            restored.mkdir(mode=0o700)
            restic("restore", snapshot, "--target", str(restored), "--verify",
                   "--include", str(first), "--include", str(second))
            self.assertEqual(len(module.verify(catalog, restored)["files"]), 2)
            self.assertFalse((restored / str(unrelated).lstrip("/")).exists())

            restored_first = restored / str(first).lstrip("/")
            restored_first.chmod(0o600)
            with self.assertRaises(ValueError):
                module.verify(catalog, restored)
            restored_first.chmod(0o644)
            original = restored_first.read_bytes()
            restored_first.write_text("changed\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                module.verify(catalog, restored)
            restored_first.write_bytes(original)
            module.verify(catalog, restored)

            first.write_text('{"log-driver":"json-file"}\n', encoding="utf-8")
            changed = temporary / "changed-catalog.json"
            module.capture(changed, [str(first), str(second)])
            result = subprocess.run([sys.executable, str(helper), "compare",
                                     str(catalog), str(changed)], capture_output=True,
                                    text=True, timeout=15)
            self.assertNotEqual(result.returncode, 0)
            with self.assertRaises(ValueError):
                module.capture(temporary / "forbidden.json", [str(password)])


if __name__ == "__main__":
    unittest.main()
