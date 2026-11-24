"""Exercise the firewall role locally; never provision a host.

The role's assert tasks run against an explicit localhost inventory with a local
connection. The nftables template is rendered with Jinja2 and, when the control
node allows it, validated by nft inside a throwaway user and network namespace.
No package, service, firewall rule or file of the control node is changed.
"""
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
ROLE = ROOT / "roles/firewall"


def read_yaml(relative_path):
    return yaml.safe_load((ROOT / relative_path).read_text(encoding="utf-8"))


def contract_tasks():
    tasks = read_yaml("roles/firewall/tasks/main.yml")
    return [copy.deepcopy(task) for task in tasks if "ansible.builtin.assert" in task]


def apply_block():
    tasks = read_yaml("roles/firewall/tasks/main.yml")
    return next(task for task in tasks if "block" in task)


def production_variables():
    values = read_yaml("roles/firewall/defaults/main.yml")
    inventory = read_yaml("inventories/production/group_vars/all.yml")
    values.update({key: value for key, value in inventory.items() if key.startswith("foundation_firewall_")})
    values["foundation_expected_ssh_port"] = 2241
    return values


def render_rules(values):
    # Same block handling as Ansible's template module.
    environment = jinja2.Environment(
        trim_blocks=True, keep_trailing_newline=True, undefined=jinja2.StrictUndefined,
    )
    template = environment.from_string((ROLE / "templates/firewall.nft.j2").read_text(encoding="utf-8"))
    return template.render(**values)


def nft_namespace_available():
    if os.name != "posix" or not shutil.which("nft") or not shutil.which("unshare"):
        return False
    probe = subprocess.run(
        ["unshare", "--user", "--map-root-user", "--net", "nft", "list", "ruleset"],
        capture_output=True, text=True, timeout=20, check=False,
    )
    return probe.returncode == 0


class PlaybookWiringTests(unittest.TestCase):
    def test_provision_applies_firewall_after_docker(self):
        play = read_yaml("playbooks/provision.yml")[0]
        roles = [entry["role"] for entry in play["roles"]]
        self.assertIn("firewall", roles)
        self.assertLess(roles.index("docker"), roles.index("firewall"))

    def test_verify_inspects_firewall_read_only(self):
        play = read_yaml("playbooks/verify.yml")[0]
        imports = [task.get("ansible.builtin.import_role", {}) for task in play["tasks"]]
        self.assertIn({"name": "firewall", "tasks_from": "verify"}, imports)

    def test_production_inventory_keeps_the_firewall_disabled(self):
        inventory = read_yaml("inventories/production/group_vars/all.yml")
        self.assertIs(inventory["foundation_firewall_enabled"], False)

    def test_role_defaults_open_nothing(self):
        defaults = read_yaml("roles/firewall/defaults/main.yml")
        self.assertIs(defaults["foundation_firewall_enabled"], False)
        for key in ("foundation_firewall_provider_sources", "foundation_firewall_cloudflare_ipv4",
                    "foundation_firewall_cloudflare_ipv6", "foundation_firewall_monitoring_sources"):
            self.assertEqual(defaults[key], [], key)
        self.assertEqual(defaults["foundation_firewall_public_interface"], "")

    def test_host_changes_require_enabled_firewall_and_real_run(self):
        block = apply_block()
        self.assertEqual(block["when"], ["foundation_firewall_enabled | bool", "not ansible_check_mode"])

    def test_rules_are_validated_before_replacing_the_file(self):
        template = next(task for task in apply_block()["block"] if "ansible.builtin.template" in task)
        self.assertEqual(template["ansible.builtin.template"]["validate"], "/usr/sbin/nft -c -f %s")

    def test_load_is_compared_against_confirmed_rules(self):
        load = next(task for task in apply_block()["block"]
                    if task.get("ansible.builtin.include_tasks") == "load.yml")
        self.assertIn("foundation_firewall_loaded.rc != 0", load["when"])
        self.assertIn("foundation_firewall_confirmed_file.stat.checksum", load["when"])

    def test_rollback_is_armed_before_loading_and_cancelled_only_after_a_new_connection(self):
        tasks = read_yaml("roles/firewall/tasks/load.yml")
        names = [task["name"] for task in tasks]
        arm = names.index("Programar la vuelta atrás por si no se confirma")
        load = names.index("Cargar las reglas nuevas de una sola vez")
        reset = names.index("Cerrar la conexión SSH actual para probar una nueva")
        confirm = names.index("Confirmar que una conexión SSH nueva entra con las reglas activas")
        save = names.index("Guardar las reglas como confirmadas")
        cancel = names.index("Cancelar la vuelta atrás")
        self.assertEqual(sorted([arm, load, reset, confirm, save, cancel]), [arm, load, reset, confirm, save, cancel])
        argv = tasks[arm]["ansible.builtin.command"]["argv"]
        self.assertIn("--timer-property=AccuracySec=1s", argv)
        self.assertEqual(tasks[reset]["ansible.builtin.meta"], "reset_connection")

    def test_boot_service_loads_only_confirmed_rules_after_debian_nftables(self):
        unit = (ROLE / "files/redunisol-firewall.service").read_text(encoding="utf-8")
        self.assertIn("ExecStart=/usr/sbin/nft -f /etc/redunisol-firewall/rules.confirmed.nft", unit)
        self.assertIn("After=nftables.service", unit)
        commands = [line for line in unit.splitlines() if line.startswith("Exec")]
        self.assertEqual(commands, ["ExecStart=/usr/sbin/nft -f /etc/redunisol-firewall/rules.confirmed.nft"])


@unittest.skipUnless(shutil.which("ansible-playbook"), "Linux Ansible controller required")
class FirewallContractTests(unittest.TestCase):
    def run_contract(self, variables):
        play = [{
            "name": "Execute the firewall contract on the control node only",
            "hosts": "localhost",
            "connection": "local",
            "gather_facts": False,
            "become": False,
            "vars": copy.deepcopy(variables),
            "tasks": contract_tasks(),
        }]
        with tempfile.TemporaryDirectory(prefix="foundation-firewall-") as directory:
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

    def enabled_variables(self, **overrides):
        values = production_variables()
        values["foundation_firewall_enabled"] = True
        values.update(overrides)
        return values

    def assert_rejected(self, **overrides):
        code, output = self.run_contract(self.enabled_variables(**overrides))
        self.assertNotEqual(code, 0, output)
        self.assertIn("no se modificó el host", output)

    def test_reviewed_production_values_are_accepted_when_enabled(self):
        code, output = self.run_contract(self.enabled_variables())
        self.assertEqual(code, 0, output)
        self.assertIn("changed=0", output)

    def test_disabled_role_defaults_are_accepted(self):
        values = read_yaml("roles/firewall/defaults/main.yml")
        values["foundation_expected_ssh_port"] = 2241
        code, output = self.run_contract(values)
        self.assertEqual(code, 0, output)

    def test_firewall_ssh_port_must_match_the_management_port(self):
        self.assert_rejected(foundation_firewall_ssh_port=22)

    def test_too_short_rollback_is_rejected(self):
        self.assert_rejected(foundation_firewall_rollback_seconds=10)

    def test_enabled_without_provider_sources_is_rejected(self):
        self.assert_rejected(foundation_firewall_provider_sources=[])

    def test_enabled_without_cloudflare_ranges_is_rejected(self):
        self.assert_rejected(foundation_firewall_cloudflare_ipv4=[])

    def test_enabled_without_public_interface_is_rejected(self):
        self.assert_rejected(foundation_firewall_public_interface="")

    def test_non_address_source_is_rejected(self):
        self.assert_rejected(foundation_firewall_provider_sources=["200.58.112.191", "donweb"])

    def test_source_with_spaces_is_rejected(self):
        self.assert_rejected(foundation_firewall_monitoring_sources=[" 66.97.36.31"])


class FirewallTemplateTests(unittest.TestCase):
    def test_production_rules_express_the_reviewed_policy(self):
        rules = render_rules(production_variables())
        for expected in (
            "table inet redunisol_firewall",
            "delete table inet redunisol_firewall",
            "type filter hook input priority filter; policy drop;",
            "ct state established,related accept",
            "tcp dport 2241 accept",
            "elements = { 200.58.112.191, 200.58.109.48/29 }",
            "ip saddr @provider_v4 tcp dport 22 accept",
            "ip saddr @cloudflare_v4 tcp dport 443 accept",
            "ip6 saddr @cloudflare_v6 tcp dport 443 accept",
            "ip saddr @provider_v4 udp dport 161 accept",
            "ip saddr @monitoring_v4 tcp dport 9100 accept",
            "type filter hook forward priority filter; policy accept;",
            'iifname "enp3s0" ct state new drop',
        ):
            self.assertIn(expected, rules)
        self.assertNotIn("flush ruleset", rules)
        self.assertNotIn("udp dport 123", rules)

    def test_empty_defaults_render_no_elements_and_no_forward_drop(self):
        rules = render_rules(read_yaml("roles/firewall/defaults/main.yml"))
        self.assertNotIn("elements", rules)
        self.assertNotIn("ct state new drop", rules)

    @unittest.skipUnless(nft_namespace_available(), "nft with unprivileged network namespaces required")
    def test_rendered_rules_load_twice_in_a_throwaway_namespace(self):
        for values in (production_variables(), read_yaml("roles/firewall/defaults/main.yml")):
            with tempfile.TemporaryDirectory(prefix="foundation-firewall-nft-") as directory:
                rules = Path(directory) / "rules.nft"
                rules.write_text(render_rules(values), encoding="utf-8")
                script = f"nft -c -f {rules} && nft -f {rules} && nft -f {rules} && nft list table inet redunisol_firewall"
                result = subprocess.run(
                    ["unshare", "--user", "--map-root-user", "--net", "sh", "-c", script],
                    capture_output=True, text=True, timeout=30, check=False,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("policy drop", result.stdout)


if __name__ == "__main__":
    unittest.main()
