"""Exercise Debian Fail2ban itself in private directories, never host services.

Install the checksum-pinned fixture with tools/install-test-fail2ban.py and set
FOUNDATION_TEST_FAIL2BAN_ROOT. Polling reads only a temporary log; the sole ban
action is /usr/bin/true. No privileged operations or production network occur.
"""
from contextlib import contextmanager
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = Path(os.environ.get("FOUNDATION_TEST_FAIL2BAN_ROOT", "/nonexistent-fail2ban-test-fixture"))
AVAILABLE = platform.system() == "Linux" and "FOUNDATION_TEST_FAIL2BAN_ROOT" in os.environ
OVERRIDE = ROOT / "roles/security/files/sshd.local"
POLICY_HELPER = ROOT / "roles/security/files/fail2ban-policy.py"


class InstallerArchiveSafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("install_test_fail2ban", ROOT / "tools/install-test-fail2ban.py")
        cls.installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.installer)

    def inspect_members(self, members):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode="w") as archive:
            for member in members:
                archive.addfile(member, io.BytesIO(b"x" * member.size) if member.isfile() else None)
        data.seek(0)
        with tarfile.open(fileobj=data, mode="r:") as archive:
            return self.installer.inspect(archive)

    def test_archive_rejects_traversal_absolute_paths_and_duplicates(self):
        for name in ("../outside", "/absolute", "safe/../../outside"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.inspect_members([tarfile.TarInfo(name)])
        with self.assertRaises(ValueError):
            self.inspect_members([tarfile.TarInfo("duplicate"), tarfile.TarInfo("./duplicate")])

    def test_archive_rejects_device_nodes_hardlinks_and_unexpected_symlinks(self):
        for kind, link in ((tarfile.CHRTYPE, ""), (tarfile.LNKTYPE, "file"), (tarfile.SYMTYPE, "../../outside")):
            member = tarfile.TarInfo("unsafe")
            member.type, member.linkname = kind, link
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                self.inspect_members([member])

    def test_only_the_reviewed_debian_python_symlink_is_accepted(self):
        member = tarfile.TarInfo("./usr/bin/fail2ban-python")
        member.type, member.linkname = tarfile.SYMTYPE, "python3"
        manifest = self.inspect_members([member])
        self.assertEqual(manifest["usr/bin/fail2ban-python"], {"type": "symlink", "target": "python3"})

    def test_modified_fixture_is_not_reused(self):
        with tempfile.TemporaryDirectory(prefix="foundation-fail2ban-integrity-") as directory:
            root = Path(directory)
            (root / "package-file").write_text("modified")
            with self.assertRaisesRegex(ValueError, "modified test package"):
                self.installer.verify_existing(root, {
                    "package-file": {"type": "file", "sha256": "0" * 64},
                })


@unittest.skipUnless(AVAILABLE, "Checksum-pinned Linux Debian Fail2ban fixture required")
class DebianFail2banTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        marker = json.loads((PACKAGE / ".foundation-test-artifact.json").read_text())
        if marker != {
            "archive_sha256": "ac35080546f1a1581163b2ebcb9796b08eb4abca3d3643082b76dce505cbd6d8",
            "version": "1.1.0-8",
        }:
            raise AssertionError("Unexpected Debian Fail2ban test dependency")
        cls.environment = dict(os.environ)
        cls.environment["PYTHONPATH"] = str(PACKAGE / "usr/lib/python3/dist-packages")
        cls.environment["PYTHONDONTWRITEBYTECODE"] = "1"
        cls.environment["LC_ALL"] = "C.UTF-8"

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="foundation-fail2ban-")
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.config = self.directory / "config"
        shutil.copytree(PACKAGE / "etc/fail2ban", self.config)
        shutil.copyfile(OVERRIDE, self.config / "filter.d/sshd.local")
        self.socket = self.directory / "fail2ban.sock"
        self.pidfile = self.directory / "fail2ban.pid"
        self.log = self.directory / "auth.log"
        self.log.touch()
        self.action = "fixture"

    def execute(self, entrypoint, *arguments, check=True, timeout=20):
        command = [sys.executable, str(PACKAGE / "usr/bin" / entrypoint), *map(str, arguments)]
        result = subprocess.run(
            command, env=self.environment, cwd=self.directory,
            capture_output=True, text=True, timeout=timeout, check=False,
        )
        if check:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def regex_hosts(self, lines, *, mode="normal", override=True):
        destination = self.config / "filter.d/sshd.local"
        if not override:
            destination.unlink(missing_ok=True)
        self.log.write_text("\n".join(lines) + "\n")
        result = self.execute(
            "fail2ban-regex", "-c", self.config, "--usedns=no", "-o", "ip",
            self.log, f"sshd[mode={mode}]",
        )
        return result.stdout.splitlines()

    def test_real_sshd_and_sshd_session_failures_identify_the_source(self):
        lines = [
            "Nov 11 12:00:00 host sshd[101]: Failed password for invalid user test from 203.0.113.41 port 4444 ssh2",
            "Nov 11 12:00:01 host sshd-session[102]: Failed password for root from 203.0.113.42 port 4445 ssh2",
            "Nov 11 12:00:02 host sshd[103]: Invalid user tester from 203.0.113.43 port 4446",
            "Nov 11 12:00:03 host sshd-session[104]: Invalid user tester from 203.0.113.44 port 4447",
        ]
        self.assertCountEqual(self.regex_hosts(lines), [f"203.0.113.{index}" for index in range(41, 45)])

    def test_username_injection_cannot_attribute_failure_to_the_victim(self):
        # Upstream ddd879d22664904ace24e1255ac6571808c58187 regression input.
        # 192.0.2.1 is attacker-controlled username text, not the peer address.
        lines = [
            "Jun 6 04:17:10 host sshd[1189075]: Connection closed by invalid user x 192.0.2.1 on 192.0.2.77 port 4444 [preauth]",
            "Jun 6 04:17:11 host sshd-session[1189076]: Connection closed by invalid user x 192.0.2.1 on 192.0.2.78 port 4444 [preauth]",
        ]
        protected = self.regex_hosts(lines, mode="aggressive")
        self.assertCountEqual(protected, ["192.0.2.77", "192.0.2.78"])
        self.assertNotIn("192.0.2.1", protected)
        vulnerable = self.regex_hosts(lines, mode="aggressive", override=False)
        self.assertIn("192.0.2.1", vulnerable, "Control must reproduce the unpatched Debian filter vulnerability")

    def configure_daemon(self, *, maxretry=5, action="fixture"):
        self.assertIn(action, ["fixture", "nftables-multiport"])
        self.action = action
        (self.config / "fail2ban.local").write_text(
            "[Definition]\n"
            f"logtarget = {self.directory / 'daemon.log'}\n"
            "dbfile = None\n"
        )
        (self.config / "action.d/fixture.conf").write_text(
            "[Definition]\nactionstart =\nactionstop =\nactioncheck =\n"
            "actionban = /usr/bin/true\nactionunban = /usr/bin/true\n"
            "[Init]\nport = 22,2241\nprotocol = tcp\n"
        )
        if action == "nftables-multiport":
            # The pinned nftables-multiport.conf includes nftables.conf, where
            # every firewall command uses <nftables>. Keep all original action
            # templates and IPv6 properties; replace only their executable.
            (self.config / "action.d/nftables-common.local").write_text(
                "[Init]\nnftables = /usr/bin/true\n"
            )
        (self.config / "jail.local").write_text(
            "[DEFAULT]\nbackend = polling\nusedns = no\n"
            f"ignoreip = 127.0.0.1/8 ::1\nbanaction = {action}\nbanaction_allports = {action}\n"
            "[sshd]\nenabled = true\nbackend = polling\n"
            f"logpath = {self.log}\n"
            f"filter = sshd\naction = {action}[port=\"22,2241\"]\n"
            f"maxretry = {maxretry}\nfindtime = 10m\nbantime = 1h\n"
        )

    def client(self, *arguments, check=True):
        return self.execute(
            "fail2ban-client", "-c", self.config, "-s", self.socket,
            "-p", self.pidfile, *arguments, check=check,
        )

    @contextmanager
    def daemon(self, *, maxretry=5, action="fixture"):
        self.configure_daemon(maxretry=maxretry, action=action)
        output = (self.directory / "server-output.log").open("w")
        process = subprocess.Popen(
            [sys.executable, str(PACKAGE / "usr/bin/fail2ban-server"), "-f",
             "-c", str(self.config), "-s", str(self.socket), "-p", str(self.pidfile), "start"],
            env=self.environment, cwd=self.directory, stdout=output, stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    self.fail("Isolated Fail2ban daemon exited: " + (self.directory / "server-output.log").read_text())
                if self.socket.exists() and self.client("ping", check=False).returncode == 0:
                    break
                time.sleep(0.1)
            else:
                self.fail("Isolated Fail2ban daemon did not become ready")
            yield
        finally:
            if process.poll() is None:
                self.client("stop", check=False)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            output.close()

    def policy(self):
        return {
            "jail": "sshd", "ports": [22, 2241], "maxretry": 5,
            "findtime": "10m", "bantime": "1h", "ignoreip": ["127.0.0.1/8", "::1"],
            "backend": "polling", "action": self.action,
        }

    def probe(self):
        result = subprocess.run(
            [sys.executable, str(POLICY_HELPER), "--config", str(self.config),
             "--client", str(PACKAGE / "usr/bin/fail2ban-client"), "--socket", str(self.socket),
             "--policy-json", json.dumps(self.policy())],
            env=self.environment, cwd=self.directory, capture_output=True, text=True,
            timeout=25, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def reconcile_with_real_ansible_tasks(self, *, verify_only=False, expected_returncode=0):
        """Run the role's actual control flow; redirect only its executable argv.

        The package installation, service manager and managed files are outside
        this tail. Never weaken or replace its conditions, includes or asserts.
        """
        source = yaml.safe_load((ROOT / "roles/security/tasks/main.yml").read_text())
        original_block = next(task for task in source if "block" in task)
        block = original_block["block"]
        first = next(index for index, task in enumerate(block)
                     if task["name"] == "Inspect the effective SSH policy before reconciliation")
        tail = copy.deepcopy(block[first:])
        allowed_reloads = [["reload"], ["reload", "--restart", "sshd"]]
        for task in tail:
            modules = {key for key in task if key.startswith("ansible.")}
            self.assertTrue(modules <= {"ansible.builtin.command", "ansible.builtin.include_tasks"}, task)
            if "ansible.builtin.command" in task:
                argv = task["ansible.builtin.command"]["argv"]
                self.assertEqual(argv[0], "/usr/bin/fail2ban-client")
                self.assertIn(argv[1:], allowed_reloads)
                task["ansible.builtin.command"]["argv"] = [
                    sys.executable, str(PACKAGE / "usr/bin/fail2ban-client"),
                    "-c", str(self.config), "-s", str(self.socket), "-p", str(self.pidfile), *argv[1:],
                ]
            else:
                self.assertIn(task["ansible.builtin.include_tasks"], ["probe.yml", "verify-policy.yml"])
        probe = yaml.safe_load((ROOT / "roles/security/tasks/probe.yml").read_text())
        self.assertEqual(len(probe), 1)
        self.assertIn("ansible.builtin.command", probe[0])
        probe[0]["ansible.builtin.command"]["argv"] = [
            sys.executable, str(POLICY_HELPER), "--client", str(PACKAGE / "usr/bin/fail2ban-client"),
            "--config", str(self.config), "--socket", str(self.socket),
            "--policy-json", json.dumps(self.policy()),
        ]
        verify = yaml.safe_load((ROOT / "roles/security/tasks/verify-policy.yml").read_text())
        for task in verify:
            modules = {key for key in task if key.startswith("ansible.")}
            self.assertTrue(modules <= {"ansible.builtin.import_tasks", "ansible.builtin.assert"}, task)
            if "ansible.builtin.import_tasks" in task:
                self.assertEqual(task["ansible.builtin.import_tasks"], "probe.yml")
        directory = self.directory / "ansible-reconciliation"
        directory.mkdir(exist_ok=True)
        (directory / "probe.yml").write_text(yaml.safe_dump(probe, sort_keys=False))
        (directory / "verify-policy.yml").write_text(yaml.safe_dump(verify, sort_keys=False))
        tasks = ([{"ansible.builtin.include_tasks": "verify-policy.yml"}] if verify_only
                 else [{**copy.deepcopy(original_block), "block": tail}])
        play = [{
            "name": "Reconcile a private daemon with the original security tasks",
            "hosts": "localhost", "connection": "local", "gather_facts": False, "become": False,
            "vars": {"ansible_python_interpreter": sys.executable,
                     "ansible_remote_tmp": str(directory / "remote-tmp")},
            "tasks": tasks,
        }]
        playbook = directory / "playbook.yml"
        playbook.write_text(yaml.safe_dump(play, sort_keys=False))
        configuration = directory / "ansible.cfg"
        configuration.write_text("[defaults]\nretry_files_enabled=False\nnocows=True\n")
        environment = dict(self.environment, ANSIBLE_CONFIG=str(configuration),
                           ANSIBLE_LOCAL_TEMP=str(directory / "controller-tmp"), ANSIBLE_NOCOLOR="1")
        controller = shutil.which("ansible-playbook") or str(Path(sys.executable).with_name("ansible-playbook"))
        self.assertTrue(Path(controller).is_file(), "Pinned Ansible controller is required for integration tests")
        result = subprocess.run(
            [controller, "-i", "localhost,", "--limit", "localhost", "-c", "local", str(playbook)],
            env=environment, cwd=directory, capture_output=True, text=True, timeout=60, check=False,
        )
        output = result.stdout + result.stderr
        self.assertEqual(result.returncode, expected_returncode, output)
        if expected_returncode:
            self.assertIn("The active SSH policy differs from the reviewed inventory or filter", output)
        recap = re.search(r"localhost\s+:\s+ok=\d+\s+changed=(\d+)", output)
        self.assertIsNotNone(recap, output)
        return int(recap.group(1))

    def test_runtime_policy_rejects_live_drift_even_with_correct_file(self):
        with self.daemon():
            self.assertTrue(self.probe()["matches"])
            changes = [
                ("maxretry", ("set", "sshd", "maxretry", "50")),
                ("findtime", ("set", "sshd", "findtime", "3")),
                ("bantime", ("set", "sshd", "bantime", "3")),
                ("ignoreip", ("set", "sshd", "addignoreip", "198.51.100.45")),
                ("port22", ("set", "sshd", "action", "fixture", "port", "22")),
                ("filter", ("set", "sshd", "addfailregex", r"^injected <HOST>$")),
            ]
            for label, command in changes:
                with self.subTest(drift=label):
                    self.client(*command)
                    self.assertFalse(self.probe()["matches"], label)
                    self.client("reload", "--restart", "sshd")
                    self.assertTrue(self.probe()["matches"], label)

    def test_retry_converges_unchanged_config_after_previous_activation_failure(self):
        with self.daemon(maxretry=50):
            jail = self.config / "jail.local"
            desired = jail.read_text().replace("maxretry = 50", "maxretry = 5")
            jail.write_text(desired)
            # Simulate the first apply failing after the copy, before activation.
            self.assertIn("50", self.client("get", "sshd", "maxretry").stdout)
            self.assertFalse(self.probe()["matches"])
            before = jail.stat().st_mtime_ns
            self.assertEqual(jail.read_text(), desired)
            # A second copy is unchanged; live drift must still trigger reload.
            self.client("reload", "--restart", "sshd")
            self.assertTrue(self.probe()["matches"])
            self.assertEqual(jail.stat().st_mtime_ns, before)
            self.assertIn("5", self.client("get", "sshd", "maxretry").stdout)

    def test_fixed_file_does_not_mask_a_vulnerable_active_filter(self):
        (self.config / "filter.d/sshd.local").unlink()
        with self.daemon():
            # Writing the CVE fix does not change the already running regex.
            shutil.copyfile(OVERRIDE, self.config / "filter.d/sshd.local")
            result = self.probe()
            self.assertFalse(result["matches"])
            self.assertIn("failregex", result["differences"])
            self.client("reload", "--restart", "sshd")
            self.assertTrue(self.probe()["matches"])

    def test_real_nftables_action_properties_match_before_and_after_reload(self):
        with self.daemon(action="nftables-multiport"):
            executable = self.client("get", "sshd", "action", "nftables-multiport", "nftables")
            self.assertEqual(executable.stdout.strip(), "/usr/bin/true")
            self.assertTrue(self.probe()["matches"])
            self.client("reload", "--restart", "sshd")
            self.assertTrue(self.probe()["matches"])

    def test_real_ansible_tail_retries_activation_when_the_file_is_unchanged(self):
        with self.daemon(maxretry=50):
            jail = self.config / "jail.local"
            jail.write_text(jail.read_text().replace("maxretry = 50", "maxretry = 5"))
            unchanged_since = jail.stat().st_mtime_ns
            self.assertFalse(self.probe()["matches"])
            self.assertEqual(self.reconcile_with_real_ansible_tasks(), 1)
            self.assertTrue(self.probe()["matches"])
            self.assertEqual(self.reconcile_with_real_ansible_tasks(), 0)
            self.assertEqual(jail.stat().st_mtime_ns, unchanged_since)

    def test_real_ansible_tail_recovers_a_missing_jail_and_then_changes_nothing(self):
        with self.daemon():
            self.client("stop", "sshd")
            self.assertFalse(self.probe()["matches"])
            self.assertEqual(self.reconcile_with_real_ansible_tasks(), 1)
            self.assertTrue(self.probe()["matches"])
            self.assertEqual(self.reconcile_with_real_ansible_tasks(), 0)

    def test_real_verify_rejects_drift_without_changing_the_daemon(self):
        with self.daemon(maxretry=50):
            jail = self.config / "jail.local"
            jail.write_text(jail.read_text().replace("maxretry = 50", "maxretry = 5"))
            unchanged_since = jail.stat().st_mtime_ns
            self.assertEqual(self.reconcile_with_real_ansible_tasks(verify_only=True, expected_returncode=2), 0)
            self.assertFalse(self.probe()["matches"])
            self.assertIn("50", self.client("get", "sshd", "maxretry").stdout)
            self.assertEqual(jail.stat().st_mtime_ns, unchanged_since)

    def test_reload_recreates_a_missing_jail_without_a_service_restart(self):
        with self.daemon():
            self.client("stop", "sshd")
            self.assertFalse(self.probe()["matches"])
            # Debian 1.1.0 rejects reload --restart sshd when sshd is absent.
            # Reloading the desired configuration creates the missing jail.
            self.client("reload")
            self.assertTrue(self.probe()["matches"])


if __name__ == "__main__":
    unittest.main()
