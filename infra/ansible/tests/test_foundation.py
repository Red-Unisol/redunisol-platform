"""Exercise host identity gates and inventory isolation without an SSH target."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]


class InventoryIsolationTests(unittest.TestCase):
    def test_only_dedicated_is_targeted_and_integration_has_no_host(self):
        prod = yaml.safe_load((ROOT / "inventories/production/hosts.yml").read_text())
        hosts = prod["all"]["children"]["foundation_hosts"]["hosts"]
        self.assertEqual(set(hosts), {"dedicated_prod_01"})
        host = hosts["dedicated_prod_01"]
        self.assertEqual(host["ansible_host"], "168.197.51.104")
        self.assertEqual(host["ansible_port"], 2241)
        self.assertIn("StrictHostKeyChecking=yes", host["ansible_ssh_common_args"])
        integration = yaml.safe_load((ROOT / "inventories/integration/hosts.yml").read_text())
        self.assertEqual(integration["all"]["children"]["foundation_hosts"]["hosts"], {})

    def test_no_external_backup_is_claimed_without_its_destination(self):
        config = yaml.safe_load((ROOT / "inventories/production/group_vars/all.yml").read_text())
        self.assertFalse(config["foundation_backups_enabled"])
        self.assertFalse(config["foundation_external_monitoring_configured"])
        self.assertEqual(config["foundation_storage_unmanaged_devices"], ["/dev/sda", "/dev/sdb"])


@unittest.skipUnless(shutil.which("ansible-playbook"), "Linux Ansible controller required")
class IdentityGateTests(unittest.TestCase):
    def run_preflight(self, **overrides):
        variables = {
            "ansible_connection": "local",
            "ansible_port": 2241,
            "ansible_facts": {
                "distribution": "Debian",
                "distribution_major_version": "13",
                "architecture": "x86_64",
                "nodename": "fixture-host",
            },
            "foundation_expected_hostname": "fixture-host",
            "foundation_expected_machine_id": Path("/etc/machine-id").read_text().strip(),
            "foundation_expected_ssh_port": 2241,
        }
        variables.update(overrides)
        play = [{"name": "Exercise identity gate locally", "hosts": "localhost", "gather_facts": False,
                 "vars": variables, "roles": [{"role": "preflight"}]}]
        env = dict(os.environ, ANSIBLE_CONFIG=str(ROOT / "ansible.cfg"),
                   ANSIBLE_ROLES_PATH=str(ROOT / "roles"), ANSIBLE_NOCOLOR="1")
        with tempfile.TemporaryDirectory(prefix="foundation-gate-") as temp:
            path = Path(temp) / "play.yml"
            path.write_text(yaml.safe_dump(play, sort_keys=False))
            return subprocess.run(["ansible-playbook", "-i", "localhost,", str(path)],
                                  env=env, cwd=ROOT, capture_output=True, text=True, timeout=45)

    def test_matching_identity_passes_without_changes(self):
        result = self.run_preflight()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertRegex(result.stdout, r"changed=0")

    def test_wrong_hostname_is_rejected_before_other_roles(self):
        result = self.run_preflight(foundation_expected_hostname="another-server")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unexpected host", result.stdout)

    def test_wrong_machine_id_is_rejected(self):
        result = self.run_preflight(foundation_expected_machine_id="f" * 32)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Machine identity does not match", result.stdout)

    def test_wrong_ssh_port_is_rejected(self):
        result = self.run_preflight(ansible_port=22)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unexpected host", result.stdout)


if __name__ == "__main__":
    unittest.main()
