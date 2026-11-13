"""Real SQLite/file recovery in local temporary trees; Docker is never invoked."""
import contextlib
import ast
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import yaml


SOURCE = Path(__file__).resolve().parents[1] / "roles/metamap_server/files/metamap-state.py"
SPEC = importlib.util.spec_from_file_location("metamap_state", SOURCE)
STATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(STATE)
IMAGE = "sha256:" + "a" * 64
REVISION = "b" * 40
CONTROLLER = shutil.which("ansible-playbook")
if not CONTROLLER and Path(sys.executable).with_name("ansible-playbook").is_file():
    CONTROLLER = str(Path(sys.executable).with_name("ansible-playbook"))


class SourceCompatibilityTests(unittest.TestCase):
    def test_helper_and_identity_script_parse_as_python36(self):
        ast.parse(SOURCE.read_text(encoding="utf-8"), feature_version=(3, 6))
        tasks = yaml.safe_load((SOURCE.parents[1] / "tasks/backup.yml").read_text())
        identity = next(task["ansible.builtin.raw"] for task in tasks
                        if task["name"] == "Read the reviewed migration origin identity without changing it")
        script = identity.split("\n", 1)[1].rsplit("REDUNISOL_METAMAP_ORIGIN_IDENTITY", 1)[0]
        ast.parse(script, feature_version=(3, 6))

    def test_source_does_not_depend_on_newer_stdlib_apis(self):
        tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute):
                self.assertNotEqual(node.attr, "is_relative_to")
            if isinstance(node, ast.Call):
                self.assertFalse({keyword.arg for keyword in node.keywords}
                                 & {"capture_output", "text", "missing_ok"})
                if isinstance(node.func, ast.Attribute) and node.func.attr == "add_subparsers":
                    self.assertNotIn("required", {keyword.arg for keyword in node.keywords})

    def test_entire_source_route_uses_raw_without_remote_python_modules(self):
        root = SOURCE.parents[3]
        play = yaml.safe_load((root / "playbooks/metamap-server-backup.yml").read_text())[0]
        self.assertIs(play["gather_facts"], False)
        self.assertEqual(play["hosts"], "metamap_migration_origins")
        self.assertEqual(play["tasks"][0]["ansible.builtin.import_role"],
                         {"name": "metamap_server", "tasks_from": "backup"})
        tasks = yaml.safe_load((SOURCE.parents[1] / "tasks/backup.yml").read_text())
        allowed = {"ansible.builtin.raw", "ansible.builtin.assert", "ansible.builtin.debug"}
        for task in tasks:
            self.assertTrue({key for key in task if key.startswith("ansible.")} <= allowed)
        capture = next(task for task in tasks if task["name"] == "Capture the stopped source into a new private local bundle")
        self.assertIn("ansible.builtin.raw", capture)
        self.assertEqual(capture["when"], "not ansible_check_mode")
        self.assertIn("--writers-stopped-confirmed", capture["ansible.builtin.raw"])
        identity = next(task for task in tasks if task["name"] == "Match the immutable migration origin identity")
        clauses = "\n".join(identity["ansible.builtin.assert"]["that"])
        for field in ("hostname", "machine_id", "python_version", "docker_socket"):
            self.assertIn(field, clauses)


@unittest.skipUnless(os.name == "posix" and CONTROLLER, "Local Linux Ansible controller required")
class SourceRawRouteTests(unittest.TestCase):
    def run_local_tasks(self, tasks, variables):
        with tempfile.TemporaryDirectory(prefix="metamap-raw-controller-") as directory:
            root = Path(directory)
            playbook = root / "play.yml"
            play = [{"name": "Exercise raw compatibility without SSH or runtime operations",
                     "hosts": "localhost", "connection": "local", "gather_facts": False,
                     "become": False, "vars": variables, "tasks": tasks}]
            playbook.write_text(yaml.safe_dump(play, sort_keys=False))
            configuration = root / "ansible.cfg"
            configuration.write_text("[defaults]\nretry_files_enabled=False\n")
            environment = dict(os.environ, ANSIBLE_CONFIG=str(configuration), ANSIBLE_NOCOLOR="1",
                               ANSIBLE_LOCAL_TEMP=str(root / "controller-tmp"))
            return subprocess.run([CONTROLLER, "-i", "localhost,", "--limit", "localhost", "-c", "local", str(playbook)],
                                  env=environment, cwd=root, capture_output=True, text=True, timeout=45, check=False)

    def identity_guard(self):
        tasks = yaml.safe_load((SOURCE.parents[1] / "tasks/backup.yml").read_text())
        return copy.deepcopy(next(task for task in tasks if task["name"] == "Match the immutable migration origin identity"))

    def identity_variables(self):
        return {"metamap_source_expected_hostname": "synthetic-origin.test",
                "metamap_source_expected_machine_id": "e" * 32,
                "metamap_source_identity": {"stdout": json.dumps({
                    "hostname": "synthetic-origin.test", "machine_id": "e" * 32,
                    "python_version": [3, 6, 8], "sqlite_version": "3.7.17", "docker_socket": True})}}

    def test_real_identity_guard_accepts_the_legacy_origin_signature(self):
        result = self.run_local_tasks([self.identity_guard()], self.identity_variables())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_real_identity_guard_rejects_different_hosts_old_python_or_no_socket(self):
        for override in ({"machine_id": "f" * 32}, {"hostname": "different-origin.test"},
                         {"python_version": [3, 5, 9]}, {"docker_socket": False}):
            with self.subTest(override=override):
                variables = self.identity_variables()
                signature = json.loads(variables["metamap_source_identity"]["stdout"])
                signature.update(override)
                variables["metamap_source_identity"]["stdout"] = json.dumps(signature)
                result = self.run_local_tasks([self.identity_guard()], variables)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("Migration origin identity differs", result.stdout + result.stderr)

    def test_real_raw_transport_executes_only_helper_help_in_a_local_shell(self):
        tasks = yaml.safe_load((SOURCE.parents[1] / "tasks/backup.yml").read_text())
        capture = copy.deepcopy(next(task for task in tasks
                                     if task["name"] == "Capture the stopped source into a new private local bundle"))
        # Keep the actual base64/bootstrap/quoting. Replace the snapshot's data
        # arguments with --help, which exits before inspection or filesystem work.
        prefix, _ = capture["ansible.builtin.raw"].split(" snapshot", 1)
        capture["ansible.builtin.raw"] = prefix + " snapshot --help"
        capture["changed_when"] = False
        assertion = {"ansible.builtin.assert": {"that": [
            "'--writers-stopped-confirmed' in metamap_cold_capture.stdout"]}}
        result = self.run_local_tasks([capture, assertion], {"role_path": str(SOURCE.parents[1])})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("changed=0", result.stdout)


@unittest.skipUnless(os.name == "posix", "POSIX metadata and nonsymlink file operations required")
class ColdStateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="metamap-cold-state-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.data, self.updates = self.root / "source-data", self.root / "source-updates"
        self.data.mkdir(mode=0o750)
        self.updates.mkdir(mode=0o750)
        self.db = self.data / "metamap.db"
        with contextlib.closing(sqlite3.connect(self.db)) as connection:
            with connection:
                connection.execute("CREATE TABLE validations(id INTEGER PRIMARY KEY, value TEXT)")
                connection.execute("INSERT INTO validations(value) VALUES ('synthetic')")
        self.db.chmod(0o640)
        (self.updates / "signed-update.zip").write_bytes(b"synthetic-signed-archive\x00\xff")
        (self.updates / "manifest.json").write_bytes(b'{"signature":"synthetic-not-a-real-signature"}\n')
        (self.updates / "empty-directory").mkdir(mode=0o750)
        self.bundle = self.root / "bundle"
        self.destination = self.root / "restored"
        self.observation = {
            "container": {"Id": "c" * 64, "Image": IMAGE, "RestartCount": 0,
                          "State": {"Status": "exited", "Running": False, "Paused": False,
                                    "Restarting": False, "Pid": 0,
                                    "StartedAt": "2026-11-13T01:00:00Z", "FinishedAt": "2026-11-13T01:01:00Z"},
                          "Mounts": [
                              {"Type": "volume", "Source": str(self.data), "Destination": "/data", "RW": True},
                              {"Type": "bind", "Source": str(self.updates), "Destination": "/updates", "RW": False},
                          ],
                          "Config": {"Env": ["METAMAP_SERVER_DATABASE_URL=sqlite+pysqlite:////data/metamap.db",
                                             "PRIVATE_TOKEN=synthetic-secret-never-output"]}},
            "active_containers": [],
        }

    def inspector(self, name):
        self.assertEqual(name, "metamap-source")
        return copy.deepcopy(self.observation)

    def snapshot(self, **overrides):
        parameters = dict(container="metamap-source", expected_image_id=IMAGE,
                          source_data=self.data, source_updates=self.updates,
                          bundle=self.bundle, reviewed_revision=REVISION,
                          writers_stopped_confirmed=True, inspector=self.inspector)
        parameters.update(overrides)
        return STATE.snapshot(**parameters)

    def tree_bytes(self, root):
        return {path.relative_to(root).as_posix(): path.read_bytes()
                for path in root.rglob("*") if path.is_file()}

    def test_real_round_trip_preserves_signed_bytes_hashes_modes_and_ownership(self):
        with mock.patch.object(STATE.os, "chown", side_effect=AssertionError("Unnecessary chown")):
            receipt = self.snapshot()
            manifest = STATE.verify(self.bundle, receipt["manifest_sha256"])
            restored = STATE.restore(self.bundle, receipt["manifest_sha256"], self.destination, "d" * 40)
        self.assertEqual(restored["scope"], "metamap-isolated-restore")
        self.assertFalse(restored["runtime_activated"])
        self.assertEqual(restored["source_revision"], REVISION)
        self.assertEqual(stat.S_IMODE(self.bundle.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(self.destination.stat().st_mode), 0o700)
        for entry in manifest["files"]:
            path = self.destination / entry["root"] / entry["path"]
            info = path.stat()
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), entry["sha256"])
            self.assertEqual((info.st_size, format(stat.S_IMODE(info.st_mode), "04o"), info.st_uid, info.st_gid),
                             (entry["size"], entry["mode"], entry["uid"], entry["gid"]))
        self.assertEqual(self.tree_bytes(self.updates), self.tree_bytes(self.destination / "updates"))

    def test_wal_only_schema_is_recovered_without_modifying_source_or_bundle(self):
        wal_db = self.data / "wal.db"
        connection = sqlite3.connect(wal_db)
        self.addCleanup(connection.close)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA wal_autocheckpoint=0")
        connection.execute("CREATE TABLE wal_only(value TEXT)")
        connection.execute("INSERT INTO wal_only VALUES ('committed-only-in-wal')")
        connection.execute("PRAGMA user_version=73")
        connection.commit()
        self.assertTrue(Path(str(wal_db) + "-wal").is_file())
        self.observation["container"]["Config"]["Env"][0] = "METAMAP_SERVER_DATABASE_URL=sqlite:////data/wal.db"
        # A standalone copy of the main DB lacks the schema, proving WAL matters.
        main_only = self.root / "main-only.db"
        shutil.copyfile(wal_db, main_only)
        with contextlib.closing(sqlite3.connect(main_only)) as without_wal:
            self.assertEqual(without_wal.execute("SELECT name FROM sqlite_schema WHERE type='table'").fetchall(), [])
        before = self.tree_bytes(self.data)
        receipt = self.snapshot()
        self.assertEqual(receipt["sqlite_check"]["table_names"], ["wal_only"])
        self.assertEqual(receipt["sqlite_check"]["user_version"], 73)
        bundle_before = self.tree_bytes(self.bundle)
        STATE.verify(self.bundle, receipt["manifest_sha256"])
        STATE.restore(self.bundle, receipt["manifest_sha256"], self.destination, REVISION)
        self.assertEqual(before, self.tree_bytes(self.data))
        self.assertEqual(bundle_before, self.tree_bytes(self.bundle))
        with tempfile.TemporaryDirectory(prefix="metamap-wal-read-") as directory:
            copied = Path(directory) / "data"
            shutil.copytree(self.destination / "data", copied)
            with contextlib.closing(sqlite3.connect(copied / "wal.db")) as recovered:
                self.assertEqual(recovered.execute("SELECT value FROM wal_only").fetchall(), [("committed-only-in-wal",)])

    def test_hot_rollback_journal_is_recovered_only_in_a_temporary_copy(self):
        journal_db = self.data / "journal.db"
        script = """
import os,sqlite3,sys
c=sqlite3.connect(sys.argv[1]); c.execute('PRAGMA journal_mode=DELETE')
c.execute('CREATE TABLE records(value BLOB)')
c.executemany('INSERT INTO records VALUES (?)',[(b'a'*8192,)]*100); c.commit()
c.execute('PRAGMA cache_size=2'); c.execute('BEGIN IMMEDIATE')
c.execute("UPDATE records SET value=?",(b'b'*8192,)); os._exit(0)
"""
        subprocess.run([sys.executable, "-c", script, str(journal_db)], check=True, timeout=20)
        self.assertTrue(Path(str(journal_db) + "-journal").is_file())
        self.observation["container"]["Config"]["Env"][0] = "METAMAP_SERVER_DATABASE_URL=sqlite:////data/journal.db"
        before = self.tree_bytes(self.data)
        receipt = self.snapshot()
        self.assertEqual(receipt["sqlite_check"]["table_names"], ["records"])
        self.assertEqual(before, self.tree_bytes(self.data))
        bundle_before = self.tree_bytes(self.bundle)
        STATE.verify(self.bundle, receipt["manifest_sha256"])
        self.assertEqual(bundle_before, self.tree_bytes(self.bundle))

    def test_running_paused_or_restarting_sources_are_rejected_before_copy(self):
        for changed in ({"Status": "running", "Running": True}, {"Paused": True}, {"Restarting": True}):
            with self.subTest(changed=changed):
                original = copy.deepcopy(self.observation)
                self.observation["container"]["State"].update(changed)
                with self.assertRaises(STATE.StateError):
                    self.snapshot()
                self.assertFalse(self.bundle.exists())
                self.observation = original

    def test_reviewed_image_and_both_exact_mount_roots_are_required(self):
        mutations = [lambda value: value["container"].update(Image="sha256:" + "f" * 64),
                     lambda value: value["container"]["Mounts"][0].update(Source=str(self.root)),
                     lambda value: value["container"]["Mounts"].pop(),
                     lambda value: value["container"]["Mounts"].append(
                         {"Type": "bind", "Source": str(self.root), "Destination": "/data/nested"})]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                original = copy.deepcopy(self.observation)
                mutation(self.observation)
                with self.assertRaises(STATE.StateError):
                    self.snapshot()
                self.assertFalse(self.bundle.exists())
                self.observation = original

    def test_other_active_containers_and_unconfirmed_external_writers_are_rejected(self):
        with self.assertRaises(STATE.StateError):
            self.snapshot(writers_stopped_confirmed=False)
        self.observation["active_containers"] = [{"State": {"Running": True}, "Mounts": [{"Source": str(self.data)}]}]
        with self.assertRaises(STATE.StateError):
            self.snapshot()
        self.assertFalse(self.bundle.exists())

    def test_database_engine_path_and_secret_errors_fail_closed(self):
        for url in ("postgresql://synthetic-secret@host/db", "sqlite:///relative.db",
                    "sqlite:////other/db", "sqlite:////data/../outside.db"):
            with self.subTest(url=url):
                self.observation["container"]["Config"]["Env"][0] = "METAMAP_SERVER_DATABASE_URL=" + url
                with self.assertRaises(STATE.StateError) as error:
                    self.snapshot()
                self.assertNotIn("synthetic-secret", str(error.exception))
                self.assertFalse(self.bundle.exists())

    def test_symlinks_special_files_and_runtime_env_are_not_bundled(self):
        unsafe = self.updates / "unsafe"
        unsafe.symlink_to(self.db)
        with self.assertRaises(STATE.StateError):
            self.snapshot()
        unsafe.unlink()
        os.mkfifo(unsafe)
        with self.assertRaises(STATE.StateError):
            self.snapshot()
        unsafe.unlink()
        (self.data / "runtime.env").write_text("SYNTHETIC_SECRET=do-not-copy")
        with self.assertRaises(STATE.StateError):
            self.snapshot()
        self.assertFalse(self.bundle.exists())

    def test_existing_targets_and_destinations_inside_source_are_never_overwritten(self):
        self.bundle.mkdir()
        with self.assertRaises(STATE.StateError):
            self.snapshot()
        self.bundle.rmdir()
        with self.assertRaises(STATE.StateError):
            self.snapshot(bundle=self.data / "nested-output")
        receipt = self.snapshot()
        with self.assertRaises(STATE.StateError):
            STATE.restore(self.bundle, receipt["manifest_sha256"], self.data / "nested-restore", REVISION)
        self.assertFalse((self.data / "nested-restore").exists())
        self.destination.mkdir()
        with self.assertRaises(STATE.StateError):
            STATE.restore(self.bundle, receipt["manifest_sha256"], self.destination, REVISION)
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_truncated_files_and_wrong_manifest_hash_are_rejected(self):
        receipt = self.snapshot()
        with self.assertRaises(STATE.StateError):
            STATE.verify(self.bundle, "0" * 64)
        (self.bundle / "updates/signed-update.zip").write_bytes(b"truncated")
        with self.assertRaises(STATE.StateError):
            STATE.restore(self.bundle, receipt["manifest_sha256"], self.destination, REVISION)
        self.assertFalse(self.destination.exists())

    def test_manifest_path_traversal_is_rejected_even_with_an_updated_hash(self):
        self.snapshot()
        path = self.bundle / "manifest.json"
        manifest = json.loads(path.read_bytes())
        manifest["files"][0]["path"] = "../outside"
        path.write_text(json.dumps(manifest))
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        with self.assertRaises(STATE.StateError):
            STATE.verify(self.bundle, digest)

    def test_changes_during_snapshot_leave_no_accepted_receipt(self):
        calls = 0

        def changing_inspector(name):
            nonlocal calls
            calls += 1
            if calls == 2:
                (self.updates / "signed-update.zip").write_bytes(b"changed-during-copy")
            return self.inspector(name)

        with self.assertRaises(STATE.StateError):
            self.snapshot(inspector=changing_inspector)
        self.assertFalse((self.bundle / "receipt.json").exists())
        self.assertFalse((self.bundle / "manifest.json").exists())

    def test_transient_source_restart_is_rejected_even_when_files_do_not_change(self):
        calls = 0

        def restarted_inspector(name):
            nonlocal calls
            calls += 1
            result = self.inspector(name)
            if calls == 2:
                result["container"]["State"]["StartedAt"] = "2026-11-13T01:02:00Z"
                result["container"]["State"]["FinishedAt"] = "2026-11-13T01:03:00Z"
                result["container"]["RestartCount"] = 1
            return result

        with self.assertRaises(STATE.StateError):
            self.snapshot(inspector=restarted_inspector)
        self.assertFalse((self.bundle / "receipt.json").exists())

    def test_failed_sqlite_validation_does_not_create_a_receipt(self):
        self.db.write_bytes(b"not-a-sqlite-database")
        with self.assertRaises(sqlite3.Error):
            self.snapshot()
        self.assertFalse((self.bundle / "receipt.json").exists())
        with self.assertRaises(STATE.StateError):
            STATE.verify(self.bundle, "0" * 64)

    def test_cli_has_no_guard_bypass_and_does_not_disclose_environment(self):
        errors = io.StringIO()
        arguments = ["snapshot", "--container", "metamap-source", "--expected-image-id", IMAGE,
                     "--revision", REVISION, "--source-data", str(self.data),
                     "--source-updates", str(self.updates), "--bundle", str(self.bundle)]
        with mock.patch.object(STATE, "inspect_runtime", side_effect=AssertionError("Docker must not run")):
            with contextlib.redirect_stderr(errors):
                self.assertEqual(STATE.main(arguments), 2)
        self.assertNotIn("synthetic-secret", errors.getvalue())
        self.assertFalse(self.bundle.exists())

    def test_docker_inspection_is_pinned_to_the_local_socket(self):
        responses = [subprocess.CompletedProcess([], 0, json.dumps([self.observation["container"]]), ""),
                     subprocess.CompletedProcess([], 0, "", "")]
        with mock.patch.dict(os.environ, {"DOCKER_HOST": "ssh://synthetic-remote", "DOCKER_CONTEXT": "remote"}):
            with mock.patch.object(STATE.subprocess, "run", side_effect=responses) as run:
                result = STATE.inspect_runtime("metamap-source")
        self.assertEqual(result["container"]["Id"], "c" * 64)
        self.assertEqual(len(run.call_args_list), 2)
        for call in run.call_args_list:
            self.assertEqual(call.args[0][:3], ["docker", "--host", "unix:///var/run/docker.sock"])
            self.assertNotIn("DOCKER_HOST", call.kwargs["env"])
            self.assertNotIn("DOCKER_CONTEXT", call.kwargs["env"])

    def test_failed_receipt_write_does_not_publish_a_partial_receipt(self):
        path = self.root / "receipt.json"
        with mock.patch.object(STATE.os, "fsync", side_effect=OSError("synthetic write failure")):
            with self.assertRaises(OSError):
                STATE.write_json_new(path, {"synthetic": True})
        self.assertFalse(path.exists())

    def test_legacy_sqlite_api_uses_string_paths_and_sqlite_master(self):
        original_connect = sqlite3.connect

        class LegacyConnection:
            def __init__(self, connection):
                self.connection = connection

            def execute(self, statement):
                if "sqlite_schema" in statement:
                    raise sqlite3.OperationalError("Legacy SQLite has no sqlite_schema alias")
                return self.connection.execute(statement)

            def close(self):
                self.connection.close()

        def legacy_connect(database, **kwargs):
            self.assertIsInstance(database, str, "Python 3.6 sqlite3 does not accept pathlib objects")
            return LegacyConnection(original_connect(database, **kwargs))

        with mock.patch.object(STATE.sqlite3, "connect", side_effect=legacy_connect):
            result = STATE.check_sqlite(self.data, "metamap.db")
        self.assertEqual(result["table_names"], ["validations"])
        self.assertEqual(result["integrity"], "ok")

    def test_docker_subprocess_uses_python36_compatible_keywords(self):
        responses = [subprocess.CompletedProcess([], 0, json.dumps([self.observation["container"]]), ""),
                     subprocess.CompletedProcess([], 0, "", "")]
        with mock.patch.object(STATE.subprocess, "run", side_effect=responses) as run:
            STATE.inspect_runtime("metamap-source")
        for call in run.call_args_list:
            self.assertNotIn("capture_output", call.kwargs)
            self.assertNotIn("text", call.kwargs)
            self.assertIs(call.kwargs["universal_newlines"], True)
            self.assertEqual(call.kwargs["stdout"], subprocess.PIPE)
            self.assertEqual(call.kwargs["stderr"], subprocess.PIPE)


if __name__ == "__main__":
    unittest.main()
