"""Execute the production assert tasks locally; never provision a host.

These are contract execution tests, not a mocked copy of their conditions. They
select only ansible.builtin.assert tasks from the actual roles/playbook and run
them with an explicit localhost inventory and local connection. No role, package,
service, account, SSH connection, or privileged action is executed.
"""
import copy
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[1]
CONTROL_NODE_EXECUTABLE = Path(sys.executable).with_name("ansible-playbook")
ANSIBLE_PLAYBOOK = shutil.which("ansible-playbook")
if not ANSIBLE_PLAYBOOK and CONTROL_NODE_EXECUTABLE.is_file():
    ANSIBLE_PLAYBOOK = str(CONTROL_NODE_EXECUTABLE)


def read_yaml(relative_path):
    return yaml.safe_load((ROOT / relative_path).read_text(encoding="utf-8"))


def role_contract(role):
    tasks = read_yaml(f"roles/{role}/tasks/main.yml")
    return copy.deepcopy(
        next(task for task in tasks if "ansible.builtin.assert" in task)
    )


def apply_contract():
    play = read_yaml("playbooks/provision.yml")[0]
    return copy.deepcopy(
        next(
            task for task in play["pre_tasks"]
            if "ansible.builtin.assert" in task
            and "foundation_apply_authorized" in str(task)
        )
    )


@unittest.skipUnless(
    os.name == "posix" and ANSIBLE_PLAYBOOK,
    "Install requirements-control-node.txt on the Linux/WSL controller",
)
class ExecutableContractTests(unittest.TestCase):
    def variables(self):
        values = {}
        for role in ("baseline", "access", "docker", "proxy"):
            values.update(read_yaml(f"roles/{role}/defaults/main.yml"))
        values.update(read_yaml("inventories/production/group_vars/all.yml"))
        # This is an inert source-revision fixture, never an apply command.
        values["foundation_revision"] = "a" * 40
        return values

    def run_contract(self, tasks, variables, *, check=False):
        allowed_keys = {
            "name", "ansible.builtin.assert", "loop", "loop_control",
            "vars", "when", "tags",
        }
        for task in tasks:
            self.assertIn("ansible.builtin.assert", task)
            self.assertFalse(
                set(task) - allowed_keys,
                "Only original assert actions may execute in these tests",
            )
        play = [{
            "name": "Execute foundation contracts on the control node only",
            "hosts": "localhost",
            "connection": "local",
            "gather_facts": False,
            "become": False,
            "vars": copy.deepcopy(variables),
            "tasks": copy.deepcopy(tasks),
        }]
        with tempfile.TemporaryDirectory(prefix="foundation-contract-") as directory:
            temp = Path(directory)
            config = temp / "ansible.cfg"
            config.write_text(
                "[defaults]\n"
                "host_key_checking = True\n"
                "retry_files_enabled = False\n"
                "display_args_to_stdout = False\n",
                encoding="utf-8",
            )
            playbook = temp / "contract.yml"
            playbook.write_text(
                yaml.safe_dump(play, sort_keys=False), encoding="utf-8"
            )
            environment = dict(
                os.environ,
                ANSIBLE_CONFIG=str(config),
                ANSIBLE_LOCAL_TEMP=str(temp / "local-tmp"),
                ANSIBLE_REMOTE_TEMP=str(temp / "remote-tmp"),
                ANSIBLE_STDOUT_CALLBACK="default",
                ANSIBLE_NOCOLOR="1",
            )
            command = [
                ANSIBLE_PLAYBOOK,
                "--inventory", "localhost,",
                "--connection", "local",
                "--limit", "localhost",
                str(playbook),
            ]
            if check:
                command.append("--check")
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=45,
                env=environment,
                cwd=directory,
                check=False,
            )
        output = result.stdout + result.stderr
        return result.returncode, output

    def test_reviewed_configuration_is_accepted(self):
        tasks = [
            role_contract(role)
            for role in ("baseline", "access", "docker", "proxy")
        ]
        code, output = self.run_contract(tasks, self.variables())
        self.assertEqual(code, 0, output)
        self.assertIn("changed=0", output)

    def test_floating_docker_package_is_rejected(self):
        values = self.variables()
        values["foundation_docker_package_versions"]["docker-ce"] = "latest"
        task = role_contract("docker")
        code, output = self.run_contract([task], values)
        self.assertNotEqual(code, 0, output)
        self.assertIn(task["ansible.builtin.assert"]["fail_msg"], output)

    def test_account_without_public_key_is_rejected(self):
        values = self.variables()
        values["foundation_access_users"] = [{"name": "fixture_without_key"}]
        task = role_contract("access")
        code, output = self.run_contract([task], values)
        self.assertNotEqual(code, 0, output)
        self.assertIn(task["ansible.builtin.assert"]["fail_msg"], output)

    def test_missing_apply_authorization_is_rejected(self):
        values = self.variables()
        values.pop("foundation_apply_authorized", None)
        task = apply_contract()
        code, output = self.run_contract([task], values)
        self.assertNotEqual(code, 0, output)
        self.assertIn(task["ansible.builtin.assert"]["fail_msg"], output)

    def test_invalid_source_revision_is_rejected(self):
        values = self.variables()
        values["foundation_apply_authorized"] = True
        values["foundation_revision"] = "main"
        task = apply_contract()
        code, output = self.run_contract([task], values)
        self.assertNotEqual(code, 0, output)
        self.assertIn(task["ansible.builtin.assert"]["fail_msg"], output)

    def test_authorized_apply_contract_accepts_exact_source_revision(self):
        values = self.variables()
        values["foundation_apply_authorized"] = True
        code, output = self.run_contract([apply_contract()], values)
        self.assertEqual(code, 0, output)
        self.assertIn("changed=0", output)

    def test_check_mode_validates_contract_without_authorizing_apply(self):
        values = self.variables()
        values.pop("foundation_apply_authorized", None)
        values.pop("foundation_revision", None)
        code, output = self.run_contract([apply_contract()], values, check=True)
        self.assertEqual(code, 0, output)
        self.assertIn("changed=0", output)


if __name__ == "__main__":
    unittest.main()
