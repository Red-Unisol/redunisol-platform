"""Exercise the original preparation contracts locally without SSH or Docker."""
import copy
import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from jinja2 import Environment, StrictUndefined
import yaml


ROOT = Path(__file__).resolve().parents[1]
ROLE = ROOT / "roles/metamap_server"
IMAGE = "ghcr.io/red-unisol/metamap-platform-server@sha256:" + "1" * 64
REVISION = "2" * 40


def read_yaml(path):
    return yaml.safe_load((ROOT / path).read_text(encoding="utf-8"))


def task(path, name):
    return copy.deepcopy(next(item for item in read_yaml(path) if item["name"] == name))


def render(template, variables):
    environment = Environment(undefined=StrictUndefined, keep_trailing_newline=True)
    environment.filters["to_nice_json"] = lambda value: json.dumps(value, sort_keys=True, indent=4)
    return environment.from_string((ROLE / "templates" / template).read_text(encoding="utf-8")).render(**variables)


def variables():
    result = read_yaml("roles/metamap_server/defaults/main.yml")
    # Resolve these two default paths for direct Jinja rendering outside Ansible.
    result.update(metamap_data_dir=result["metamap_state_dir"] + "/data",
                  metamap_updates_dir=result["metamap_state_dir"] + "/updates",
                  metamap_image=IMAGE, metamap_revision=REVISION)
    return result


class PreparationWiringTests(unittest.TestCase):
    def test_defaults_have_no_image_activation_or_write_approval(self):
        defaults = read_yaml("roles/metamap_server/defaults/main.yml")
        self.assertEqual(defaults["metamap_image"], "")
        self.assertEqual(defaults["metamap_registry_auth_file"], "")
        for flag in ("running", "prepare_authorized", "backup_authorized", "restore_authorized",
                     "prefetch_image", "writers_stopped_confirmed", "stage_runtime_env"):
            self.assertIs(defaults["metamap_" + flag], False)

    def test_prepare_and_verify_are_separate_from_foundation_and_source_capture(self):
        prepare = read_yaml("playbooks/metamap-server-prepare.yml")[0]
        verify = read_yaml("playbooks/metamap-server-verify.yml")[0]
        capture = read_yaml("playbooks/metamap-server-backup.yml")[0]
        restore = read_yaml("playbooks/metamap-server-restore.yml")[0]
        self.assertEqual(prepare["hosts"], "metamap_server_hosts")
        self.assertEqual(verify["hosts"], "metamap_server_hosts")
        self.assertEqual(capture["hosts"], "metamap_migration_origins")
        self.assertEqual(restore["hosts"], "metamap_server_hosts")
        foundation = read_yaml("playbooks/provision.yml")[0]
        self.assertNotIn("metamap_server", [item["role"] for item in foundation["roles"]])

    def test_rendered_compose_is_closed_and_keeps_credentials_required(self):
        data = yaml.safe_load(render("compose.yml.j2", variables()))
        self.assertEqual(set(data["services"]), {"server"})
        server = data["services"]["server"]
        self.assertEqual(server["profiles"], ["activation"])
        self.assertEqual(server["image"], IMAGE)
        self.assertEqual(server["pull_policy"], "never")
        self.assertEqual(server["ports"], ["127.0.0.1:18083:8000"])
        self.assertEqual(server["env_file"], [{"path": "./runtime.env", "required": True, "format": "raw"}])
        self.assertEqual([item["target"] for item in server["volumes"]], ["/data", "/updates"])
        self.assertTrue(server["volumes"][1]["read_only"])
        self.assertTrue(all(item["bind"]["create_host_path"] is False for item in server["volumes"]))
        self.assertNotIn("/var/run/docker.sock", json.dumps(data))

    def test_preparation_evidence_does_not_claim_activation_or_transfer(self):
        record = json.loads(render("preparation.json.j2", variables()))
        self.assertEqual(record["revision"], REVISION)
        self.assertEqual(record["image"], IMAGE)
        self.assertFalse(record["activation_included"])
        self.assertFalse(record["production_data_transferred"])
        self.assertFalse(record["runtime_settings_staged"])
        self.assertFalse(record["runtime_settings_loaded"])
        self.assertNotIn("registry_auth", json.dumps(record))

    def test_private_staging_cannot_supply_the_compose_runtime_environment(self):
        values = variables()
        values.update(metamap_stage_runtime_env=True,
                      metamap_runtime_env_source_file="/private/operator/runtime.env.pending")
        compose = yaml.safe_load(render("compose.yml.j2", values))
        self.assertEqual(compose["services"]["server"]["env_file"][0]["path"], "./runtime.env")
        self.assertNotIn(values["metamap_pending_runtime_env_path"], json.dumps(compose))
        record = json.loads(render("preparation.json.j2", values))
        self.assertTrue(record["runtime_settings_staged"])
        self.assertFalse(record["runtime_settings_loaded"])
        copy_task = task("roles/metamap_server/tasks/runtime-staging.yml",
                         "Copy existing runtime settings to the pending private location only")
        self.assertTrue(copy_task["no_log"])
        self.assertFalse(copy_task["diff"])
        self.assertEqual(copy_task["ansible.builtin.copy"]["mode"], "0600")

    def test_compose_validation_does_not_resolve_environment_or_run_services(self):
        checks = read_yaml("roles/metamap_server/tasks/compose-check.yml")
        command = next(item["ansible.builtin.command"]["argv"] for item in checks
                       if item["name"].startswith("Validate the activation"))
        self.assertIn("config", command)
        self.assertIn("--no-env-resolution", command)
        self.assertIn("--quiet", command)
        self.assertNotIn("up", command)


@unittest.skipUnless(shutil.which("ansible-playbook"), "Linux Ansible controller required")
class ExecutablePreparationTests(unittest.TestCase):
    def run_tasks(self, tasks, overrides=None, check=False, roles=None):
        values = variables()
        values.update(overrides or {})
        play = dict(name="Exercise original MetaMap contracts locally only", hosts="localhost",
                    connection="local", become=False, gather_facts=False, vars=values)
        if roles:
            play["roles"] = roles
        else:
            play["tasks"] = tasks
        with tempfile.TemporaryDirectory(prefix="metamap-contract-") as directory:
            temporary = Path(directory)
            playbook = temporary / "test.yml"
            playbook.write_text(yaml.safe_dump([play], sort_keys=False), encoding="utf-8")
            binaries = temporary / "bin"
            binaries.mkdir()
            # Any accidentally executed host inspection makes the check-mode
            # test fail, without reaching an actual Docker engine or ss binary.
            for binary in ("docker", "ss"):
                path = binaries / binary
                path.write_text("#!/bin/sh\nexit 93\n", encoding="utf-8")
                path.chmod(0o700)
            environment = dict(os.environ, ANSIBLE_CONFIG=str(ROOT / "ansible.cfg"),
                               ANSIBLE_ROLES_PATH=str(ROOT / "roles"),
                               ANSIBLE_LOCAL_TEMP=str(temporary / "ansible-tmp"), ANSIBLE_NOCOLOR="1")
            environment["PATH"] = str(binaries) + os.pathsep + os.environ["PATH"]
            command = ["ansible-playbook", "-i", "localhost,", "-c", "local", str(playbook)]
            if check:
                command.append("--check")
            result = subprocess.run(command, cwd=directory, env=environment, capture_output=True,
                                    text=True, timeout=45, check=False)
        return result.returncode, result.stdout + result.stderr

    def contracts(self):
        return read_yaml("roles/metamap_server/tasks/contract.yml")

    def authorization(self):
        return task("roles/metamap_server/tasks/main.yml",
                    "Require a separate prepare authorization and immutable inputs outside check mode")

    def assert_rejected(self, overrides, tasks=None):
        code, output = self.run_tasks(tasks or self.contracts(), overrides)
        self.assertNotEqual(code, 0, output)
        self.assertIn('"evaluated_to": false', output)
        self.assertIn('"assertion":', output)

    def test_valid_preparation_contract_is_accepted(self):
        code, output = self.run_tasks(self.contracts())
        self.assertEqual(code, 0, output)

    def test_private_staging_requires_an_explicit_operator_source(self):
        self.assert_rejected(dict(metamap_stage_runtime_env=True, metamap_runtime_env_source_file=""))

    def test_private_staging_cannot_write_the_active_compose_environment(self):
        self.assert_rejected(dict(metamap_stage_runtime_env=True,
                                  metamap_runtime_env_source_file="/private/operator.env",
                                  metamap_pending_runtime_env_path="/srv/redunisol/platform/metamap-server/runtime.env"))

    def test_activation_is_rejected_even_with_approval(self):
        self.assert_rejected(dict(metamap_running=True, metamap_prepare_authorized=True))

    def test_mutable_image_is_rejected(self):
        self.assert_rejected(dict(metamap_image="ghcr.io/red-unisol/metamap-platform-server:latest"))

    def test_unrelated_registry_or_repository_is_rejected(self):
        self.assert_rejected(dict(metamap_image="example.com/metamap@sha256:" + "1" * 64))

    def test_unapproved_apply_is_rejected(self):
        self.assert_rejected({}, tasks=[self.authorization()])

    def test_approved_apply_still_requires_digest(self):
        self.assert_rejected(dict(metamap_prepare_authorized=True, metamap_image=""), tasks=[self.authorization()])

    def test_approved_apply_still_requires_git_sha(self):
        self.assert_rejected(dict(metamap_prepare_authorized=True, metamap_revision="main"), tasks=[self.authorization()])

    def test_approved_apply_with_immutable_inputs_passes_the_authorization_guard(self):
        code, output = self.run_tasks([self.authorization()], dict(metamap_prepare_authorized=True))
        self.assertEqual(code, 0, output)
        self.assertIn("changed=0", output)

    def test_check_mode_without_digest_never_reaches_host_operations(self):
        code, output = self.run_tasks([], dict(metamap_image="", metamap_revision=""), check=True, roles=["metamap_server"])
        self.assertEqual(code, 0, output)
        self.assertIn("PENDING: reviewed image digest", output)
        self.assertIn("changed=0", output)

    def test_unapproved_role_fails_before_reaching_any_host_operation(self):
        code, output = self.run_tasks([], roles=["metamap_server"])
        self.assertNotEqual(code, 0, output)
        self.assertIn("Prepare requires metamap_prepare_authorized=true", output)
        self.assertIn("changed=0", output)
        self.assertNotIn("rc: 93", output)

    def test_even_a_stopped_container_blocks_preparation(self):
        guard = task("roles/metamap_server/tasks/target-guard.yml",
                     "Refuse preparation over any existing MetaMap container including stopped ones")
        self.assert_rejected(dict(metamap_existing_containers={"stdout": "stopped-container-id"}), tasks=[guard])

    def test_empty_existing_state_is_repeatable_and_precopied_state_is_rejected(self):
        inspect = task("roles/metamap_server/tasks/target-guard.yml",
                       "Inspect existing runtime directories without changing their contents")
        guard = task("roles/metamap_server/tasks/target-guard.yml",
                     "Refuse to prepare over existing application or update data")
        with tempfile.TemporaryDirectory(prefix="metamap-existing-state-") as directory:
            data = Path(directory) / "data"
            updates = Path(directory) / "updates"
            data.mkdir()
            updates.mkdir()
            overrides = dict(metamap_data_dir=str(data), metamap_updates_dir=str(updates),
                             metamap_path_inspections={"results": [
                                 {"item": str(data), "stat": {"exists": True}},
                                 {"item": str(updates), "stat": {"exists": True}}]})
            for unused in range(2):
                code, output = self.run_tasks([inspect, guard], overrides)
                self.assertEqual(code, 0, output)
                self.assertIn("changed=0", output)
            (data / ".existing-state").write_bytes(b"fixture")
            self.assert_rejected(overrides, tasks=[inspect, guard])

    def test_restore_cannot_target_runtime_data(self):
        guard = task("roles/metamap_server/tasks/restore.yml",
                     "Require an independently authorized isolated restore and a trusted bundle fingerprint")
        self.assert_rejected(dict(metamap_restore_authorized=True,
                                  metamap_restore_directory="/srv/redunisol/state/metamap-server/data",
                                  metamap_restore_bundle_dir="/approved/bundle",
                                  metamap_bundle_manifest_sha256="3" * 64), tasks=[guard])

    def test_capture_needs_its_own_authorization(self):
        guard = task("roles/metamap_server/tasks/backup.yml",
                     "Require an independently authorized cold capture of a concrete reviewed source")
        self.assert_rejected(dict(metamap_prepare_authorized=True), tasks=[guard])


@unittest.skipUnless(os.name == "posix" and shutil.which("ansible-playbook"), "Linux Ansible controller required")
class TransientRegistryAuthenticationTests(unittest.TestCase):
    AUTH = base64.b64encode(b"synthetic-user:synthetic-registry-secret").decode()

    def exercise(self, *, auth=True, config=None, missing=False, present=False, prefetch=True, fail=False):
        with tempfile.TemporaryDirectory(prefix="metamap-registry-fixture-") as directory:
            root = Path(directory)
            staging_parent = root / "temporary-configs"
            staging_parent.mkdir(mode=0o700)
            values = variables()
            values.update(metamap_prefetch_image=prefetch, metamap_image_inspection={"rc": 0 if present else 1},
                          metamap_registry_auth_file=str(root / "registry.json") if auth else "")
            if auth and not missing:
                source = root / "registry.json"
                source.write_text(json.dumps(config if config is not None else {"auths": {"ghcr.io": {"auth": self.AUTH}}}))
                source.chmod(0o600)
            tasks = read_yaml("roles/metamap_server/tasks/prefetch.yml")
            credential_block = next(item for item in tasks if "block" in item)
            create = next(item for item in credential_block["block"] if "ansible.builtin.tempfile" in item)
            self.assertEqual(create["ansible.builtin.tempfile"]["path"], "/run")
            create["ansible.builtin.tempfile"]["path"] = str(staging_parent)
            prefetch_tasks = root / "prefetch.yml"
            prefetch_tasks.write_text(yaml.safe_dump(tasks, sort_keys=False))
            include = next(item for item in read_yaml("roles/metamap_server/tasks/main.yml")
                           if "block" in item)["block"]
            include = copy.deepcopy(next(item for item in include
                                         if item["name"] == "Prefetch only the reviewed immutable image directly from GHCR"))
            include["ansible.builtin.import_tasks"] = str(prefetch_tasks)
            binaries = root / "bin"
            binaries.mkdir()
            stub = binaries / "docker"
            log = root / "docker.json"
            stub.write_text(
                "#!" + sys.executable + "\n"
                "import json,os,pathlib,stat,sys\n"
                "args=sys.argv[1:];record={'argv':args}\n"
                "if '--config' in args:\n"
                " directory=pathlib.Path(args[args.index('--config')+1]);p=directory/'config.json'\n"
                " record['directory_mode']=format(stat.S_IMODE(directory.stat().st_mode),'04o')\n"
                " record['file_mode']=format(stat.S_IMODE(p.stat().st_mode),'04o')\n"
                " record['exact_auth']=json.loads(p.read_text())=={'auths':{'ghcr.io':{'auth':"
                + repr(self.AUTH) + "}}}\n"
                "pathlib.Path(" + repr(str(log)) + ").write_text(json.dumps(record))\n"
                "sys.exit(" + ("71" if fail else "0") + ")\n",
                encoding="utf-8")
            stub.chmod(0o700)
            playbook = root / "exercise.yml"
            playbook.write_text(yaml.safe_dump([dict(hosts="localhost", connection="local", become=False,
                                                     gather_facts=False, vars=values, tasks=[include])], sort_keys=False))
            environment = dict(os.environ, ANSIBLE_CONFIG=str(ROOT / "ansible.cfg"),
                               ANSIBLE_LOCAL_TEMP=str(root / "ansible-tmp"), ANSIBLE_NOCOLOR="1")
            environment["PATH"] = str(binaries) + os.pathsep + os.environ["PATH"]
            result = subprocess.run(["ansible-playbook", "-i", "localhost,", "-c", "local", str(playbook)],
                                    capture_output=True, text=True, env=environment, timeout=45, check=False)
            output = result.stdout + result.stderr
            self.assertNotIn(self.AUTH, output)
            self.assertNotIn("synthetic-registry-secret", output)
            self.assertEqual(list(staging_parent.iterdir()), [], output)
            record = json.loads(log.read_text()) if log.exists() else None
            return result.returncode, output, record

    def test_transient_auth_has_private_modes_exact_digest_and_cleanup(self):
        code, output, record = self.exercise()
        self.assertEqual(code, 0, output)
        self.assertEqual(record["directory_mode"], "0700")
        self.assertEqual(record["file_mode"], "0600")
        self.assertTrue(record["exact_auth"])
        self.assertEqual(record["argv"][-3:], ["image", "pull", IMAGE])
        self.assertEqual(record["argv"][2:4], ["--host", "unix:///var/run/docker.sock"])
        self.assertNotIn(self.AUTH, json.dumps(record["argv"]))
        self.assertNotIn("synthetic-registry-secret", json.dumps(record["argv"]))

    def test_failed_pull_still_removes_the_only_temporary_config(self):
        code, unused, record = self.exercise(fail=True)
        self.assertNotEqual(code, 0)
        self.assertTrue(record["exact_auth"])

    def test_present_image_or_disabled_prefetch_never_reads_a_missing_credential_file(self):
        for overrides in ({"present": True}, {"prefetch": False}):
            with self.subTest(overrides=overrides):
                code, output, record = self.exercise(missing=True, **overrides)
                self.assertEqual(code, 0, output)
                self.assertIsNone(record)
                self.assertIn("changed=0", output)

    def test_empty_auth_path_preserves_existing_target_authentication(self):
        code, output, record = self.exercise(auth=False)
        self.assertEqual(code, 0, output)
        self.assertNotIn("--config", record["argv"])
        self.assertEqual(record["argv"], ["--host", "unix:///var/run/docker.sock", "image", "pull", IMAGE])

    def test_other_registries_helpers_and_invalid_basic_auth_fail_before_copy_or_pull(self):
        cases = [
            {"auths": {"ghcr.io": {"auth": self.AUTH}}, "credsStore": "synthetic-helper"},
            {"auths": {"example.test": {"auth": self.AUTH}}},
            {"auths": {"ghcr.io": {"auth": base64.b64encode(b"no-colon").decode()}}},
            {"auths": {"ghcr.io": {"auth": base64.b64encode(b"user:token\n").decode()}}},
        ]
        for value in cases:
            with self.subTest(shape=list(value)):
                code, unused, record = self.exercise(config=value)
                self.assertNotEqual(code, 0)
                self.assertIsNone(record)


if __name__ == "__main__":
    unittest.main()
