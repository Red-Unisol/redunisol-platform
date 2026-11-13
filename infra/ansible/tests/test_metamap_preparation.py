"""Exercise the original preparation contracts locally without SSH or Docker."""
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
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
        for flag in ("running", "prepare_authorized", "backup_authorized", "restore_authorized",
                     "prefetch_image", "writers_stopped_confirmed"):
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
        self.assertEqual(server["env_file"], [{"path": "./runtime.env", "required": True}])
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


if __name__ == "__main__":
    unittest.main()
