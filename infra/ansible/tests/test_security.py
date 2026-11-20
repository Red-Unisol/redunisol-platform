"""Exercise the security role contract locally; never provision a host.

Only the role's original assert task runs, against an explicit localhost
inventory with a local connection. No package, service or file is changed.
"""
import base64
import copy
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import jinja2
import yaml

ROOT = Path(__file__).resolve().parents[1]


def read_yaml(relative_path):
    return yaml.safe_load((ROOT / relative_path).read_text(encoding="utf-8"))


def security_contract():
    tasks = read_yaml("roles/security/tasks/main.yml")
    return copy.deepcopy(next(task for task in tasks if "ansible.builtin.assert" in task))


class PlaybookWiringTests(unittest.TestCase):
    def test_jail_is_monitored_and_backed_up(self):
        inventory = read_yaml("inventories/production/group_vars/all.yml")
        defaults = read_yaml("roles/security/defaults/main.yml")
        allowed = read_yaml("roles/backups/defaults/main.yml")["foundation_backups_foundation_config_files"]
        self.assertIn("fail2ban.service", inventory["foundation_monitoring_expected_services"])
        for key in ("foundation_security_fail2ban_jail_path", "foundation_security_fail2ban_filter_path"):
            self.assertIn(defaults[key], inventory["foundation_backups_source_paths"])
            self.assertIn(defaults[key], allowed)

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
            {"ansible.builtin.apt", "ansible.builtin.copy", "ansible.builtin.template",
             "ansible.builtin.file", "ansible.builtin.command", "ansible.builtin.include_tasks",
             "ansible.builtin.systemd_service"},
        )

    def test_installation_and_initial_start_require_validated_configuration(self):
        tasks = next(task["block"] for task in read_yaml("roles/security/tasks/main.yml") if "block" in task)
        install = next(task for task in tasks if "ansible.builtin.apt" in task)
        self.assertEqual(install["ansible.builtin.apt"]["policy_rc_d"], 101)
        names = [task["name"] for task in tasks]
        validate = names.index("Test fail2ban configuration before starting or reloading")
        for name in ("Install the upstream SSH filter correction", "Declare the SSH jail"):
            self.assertLess(names.index(name), validate)
        self.assertLess(validate, names.index("Enable fail2ban"))

    def test_every_apply_reconciles_live_policy_without_a_changed_file_notification(self):
        tasks = next(task["block"] for task in read_yaml("roles/security/tasks/main.yml") if "block" in task)
        self.assertFalse(any("notify" in task for task in tasks))
        probe = next(task for task in tasks if task.get("ansible.builtin.include_tasks") == "probe.yml")
        self.assertNotIn("when", probe)
        reload_task = next(task for task in tasks if task["name"] == "Reconcile the live SSH jail when its policy differs")
        self.assertIn("not (foundation_security_policy_probe.stdout | from_json).matches", reload_task["when"])
        self.assertIn("'jail.absent' not in (foundation_security_policy_probe.stdout | from_json).differences",
                      reload_task["when"])
        self.assertEqual(reload_task["ansible.builtin.command"]["argv"],
                         ["/usr/bin/fail2ban-client", "reload", "--restart", "sshd"])
        verify = next(task for task in tasks if task.get("ansible.builtin.include_tasks") == "verify-policy.yml")
        self.assertGreater(tasks.index(verify), tasks.index(reload_task))
        self.assertFalse((ROOT / "roles/security/handlers/main.yml").exists())

    def test_missing_jail_is_created_without_trying_to_restart_an_absent_jail(self):
        tasks = next(task["block"] for task in read_yaml("roles/security/tasks/main.yml") if "block" in task)
        restore = next(task for task in tasks if task["name"] == "Restore a missing SSH jail from the validated configuration")
        self.assertEqual(restore["ansible.builtin.command"]["argv"], ["/usr/bin/fail2ban-client", "reload"])
        self.assertEqual(restore["when"],
                         "'jail.absent' in (foundation_security_policy_probe.stdout | from_json).differences")


@unittest.skipUnless(shutil.which("ansible-playbook"), "Linux Ansible controller required")
class SecurityContractTests(unittest.TestCase):
    def variables(self):
        values = read_yaml("roles/security/defaults/main.yml")
        inventory = read_yaml("inventories/production/group_vars/all.yml")
        values.update({key: value for key, value in inventory.items() if key.startswith("foundation_security_")})
        values["foundation_expected_ssh_port"] = 2241
        return values

    def run_contract(self, variables, task=None, check_mode=False):
        play = [{
            "name": "Execute the security contract on the control node only",
            "hosts": "localhost",
            "connection": "local",
            "gather_facts": False,
            "become": False,
            "vars": copy.deepcopy(variables),
            "tasks": [copy.deepcopy(task) if task is not None else security_contract()],
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
                ["ansible-playbook", "-i", "localhost,", "-c", "local", str(playbook)]
                + (["--check"] if check_mode else []),
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

    def test_role_default_without_reviewed_version_is_rejected(self):
        self.assert_rejected(
            foundation_security_fail2ban_package=read_yaml("roles/security/defaults/main.yml")[
                "foundation_security_fail2ban_package"
            ],
        )

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

    def test_check_mode_runs_the_real_role_without_packages_or_a_daemon(self):
        code, output = self.run_contract(
            self.variables(), {"ansible.builtin.import_role": {"name": "security"}}, check_mode=True,
        )
        self.assertEqual(code, 0, output)
        self.assertIn("changed=0", output)
        self.assertIn("Contracts only", output)

    def file_verification_fixture(self):
        values = self.variables()
        # File-mutation cases use synthetic addresses, independent of production.
        values["foundation_security_fail2ban_ignoreip"] = ["127.0.0.1/8", "::1", "203.0.113.10"]
        role = ROOT / "roles/security"
        values["role_path"] = str(role)
        template = jinja2.Environment(keep_trailing_newline=True).from_string(
            (role / "templates/sshd-jail.local.j2").read_text(encoding="utf-8"),
        )
        contents = [template.render(**values)] + [
            (role / "files" / name).read_text(encoding="utf-8")
            for name in ("sshd.local", "fail2ban-policy.py")
        ]
        return values, contents

    def verify_files(self, values, contents):
        values["foundation_security_files"] = {"results": [
            {"content": base64.b64encode(content.encode()).decode()} for content in contents
        ]}
        assertion = next(task for task in read_yaml("roles/security/tasks/verify.yml")
                         if task["name"] == "Verify complete security files rather than text fragments")
        return self.run_contract(values, assertion)

    def test_complete_matching_security_files_are_accepted(self):
        code, output = self.verify_files(*self.file_verification_fixture())
        self.assertEqual(code, 0, output)

    def test_maxretry_50_is_rejected_when_inventory_requires_5(self):
        values, contents = self.file_verification_fixture()
        contents[0] = contents[0].replace("maxretry = 5\n", "maxretry = 50\n")
        code, output = self.verify_files(values, contents)
        self.assertNotEqual(code, 0, output)
        self.assertIn("managed security files differ from Git", output)

    def test_wrong_timing_or_missing_office_exception_is_rejected(self):
        for original, changed in (("bantime = 1h", "bantime = 1s"),
                                  ("findtime = 10m", "findtime = 1s"),
                                  (" ::1 203.0.113.10", " ::1")):
            with self.subTest(original=original):
                values, contents = self.file_verification_fixture()
                self.assertIn(original, contents[0])
                contents[0] = contents[0].replace(original, changed)
                code, output = self.verify_files(values, contents)
                self.assertNotEqual(code, 0, output)

    def test_missing_filter_fix_or_outdated_probe_is_rejected(self):
        for index in (1, 2):
            with self.subTest(file=index):
                values, contents = self.file_verification_fixture()
                contents[index] = "# old configuration\n"
                code, output = self.verify_files(values, contents)
                self.assertNotEqual(code, 0, output)


if __name__ == "__main__":
    unittest.main()
