"""Exercise the security role contract locally; never provision a host.

Only the role's original assert task runs, against an explicit localhost
inventory with a local connection. No package, service or file is changed.
"""
import copy
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]


def read_yaml(relative_path):
    return yaml.safe_load((ROOT / relative_path).read_text(encoding="utf-8"))


def security_contract():
    tasks = read_yaml("roles/security/tasks/main.yml")
    return copy.deepcopy(next(task for task in tasks if "ansible.builtin.assert" in task))


class PlaybookWiringTests(unittest.TestCase):
    def test_provision_applies_security_after_access(self):
        play = read_yaml("playbooks/provision.yml")[0]
        roles = [entry["role"] for entry in play["roles"]]
        self.assertIn("security", roles)
        self.assertLess(roles.index("access"), roles.index("security"))

    def test_verify_inspects_security_read_only(self):
        play = read_yaml("playbooks/verify.yml")[0]
        imports = [task.get("ansible.builtin.import_role", {}) for task in play["tasks"]]
        self.assertIn({"name": "security", "tasks_from": "verify"}, imports)

    def test_mutating_tasks_are_skipped_in_check_mode(self):
        tasks = read_yaml("roles/security/tasks/main.yml")
        block = next(task for task in tasks if "block" in task)
        self.assertEqual(block["when"], "not ansible_check_mode")
        modules = {key for task in block["block"] for key in task if key.startswith("ansible.")}
        self.assertEqual(
            modules,
            {"ansible.builtin.apt", "ansible.builtin.copy", "ansible.builtin.systemd_service"},
        )


@unittest.skipUnless(shutil.which("ansible-playbook"), "Linux Ansible controller required")
class SecurityContractTests(unittest.TestCase):
    def variables(self):
        values = read_yaml("roles/security/defaults/main.yml")
        values["foundation_expected_ssh_port"] = 2241
        return values

    def run_contract(self, variables):
        play = [{
            "name": "Execute the security contract on the control node only",
            "hosts": "localhost",
            "connection": "local",
            "gather_facts": False,
            "become": False,
            "vars": copy.deepcopy(variables),
            "tasks": [security_contract()],
        }]
        with tempfile.TemporaryDirectory(prefix="foundation-security-") as directory:
            temp = Path(directory)
            playbook = temp / "contract.yml"
            playbook.write_text(yaml.safe_dump(play, sort_keys=False), encoding="utf-8")
            environment = dict(
                os.environ,
                ANSIBLE_CONFIG=str(ROOT / "ansible.cfg"),
                ANSIBLE_LOCAL_TEMP=str(temp / "local-tmp"),
                ANSIBLE_NOCOLOR="1",
            )
            result = subprocess.run(
                ["ansible-playbook", "-i", "localhost,", "-c", "local", str(playbook)],
                env=environment, cwd=directory, capture_output=True, text=True,
                timeout=45, check=False,
            )
        return result.returncode, result.stdout + result.stderr

    def assert_rejected(self, **overrides):
        values = self.variables()
        values.update(overrides)
        code, output = self.run_contract(values)
        self.assertNotEqual(code, 0, output)
        self.assertIn("Invalid fail2ban settings", output)

    def test_reviewed_defaults_are_accepted(self):
        code, output = self.run_contract(self.variables())
        self.assertEqual(code, 0, output)
        self.assertIn("changed=0", output)

    def test_floating_package_is_rejected(self):
        self.assert_rejected(foundation_security_fail2ban_package="fail2ban")

    def test_unwatched_management_port_is_rejected(self):
        self.assert_rejected(foundation_security_fail2ban_ssh_ports=[22])

    def test_invalid_port_is_rejected(self):
        self.assert_rejected(foundation_security_fail2ban_ssh_ports=[22, 2241, 70000])

    def test_too_few_retries_are_rejected(self):
        self.assert_rejected(foundation_security_fail2ban_maxretry=1)

    def test_malformed_ban_time_is_rejected(self):
        self.assert_rejected(foundation_security_fail2ban_bantime="forever")

    def test_ignore_list_without_loopback_is_rejected(self):
        self.assert_rejected(foundation_security_fail2ban_ignoreip=["203.0.113.10"])

    def test_non_address_in_ignore_list_is_rejected(self):
        self.assert_rejected(foundation_security_fail2ban_ignoreip=["127.0.0.1/8", "office"])


if __name__ == "__main__":
    unittest.main()
