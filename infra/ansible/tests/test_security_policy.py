"""Exercise structured fail2ban observations without a daemon or host changes."""
import copy
import importlib.util
from pathlib import Path
import unittest


HELPER = Path(__file__).resolve().parents[1] / "roles/security/files/fail2ban-policy.py"
SPEC = importlib.util.spec_from_file_location("foundation_fail2ban_policy", HELPER)
policy_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(policy_module)


def declared():
    return policy_module.declared_policy(dict(
        jail="sshd", ports=[22, 2241], maxretry=5, findtime="10m", bantime="1h",
        ignoreip=["127.0.0.1/8", "::1"], backend="systemd", action="nftables-multiport"))


def commands():
    return [
        ["set", "loglevel", "INFO"], ["add", "sshd", "systemd"],
        ["set", "sshd", "usedns", "warn"], ["set", "sshd", "maxlines", 1],
        ["set", "sshd", "prefregex", "prefix"],
        ["multi-set", "sshd", "addfailregex", ["patched-expression-1", "patched-expression-2"]],
        ["set", "sshd", "addjournalmatch", "_SYSTEMD_UNIT=ssh.service", "+", "_COMM=sshd", "+", "_COMM=sshd-session"],
        ["set", "sshd", "addignoreip", "127.0.0.1/8", "::1"],
        ["set", "sshd", "maxretry", 5], ["set", "sshd", "findtime", "10m"],
        ["set", "sshd", "bantime", "1h"], ["set", "sshd", "addaction", "nftables-multiport"],
        ["multi-set", "sshd", "action", "nftables-multiport",
         [["port", "22,2241"], ["actionban", "nft add element ..."], ["name", "sshd"]]],
        ["start", "sshd"],
    ]


def disk_policy():
    return policy_module.parse_dump("\n".join(repr(command) for command in commands()), "sshd")


def fake_compile(disk):
    # Fixtures represent already-expanded server regex strings. Integration tests
    # exercise the installed package's actual expansion and socket protocol.
    return {key: disk[key] for key in ("prefregex", "failregex", "ignoreregex")}


class SocketFixture:
    def __init__(self):
        disk = disk_policy()
        self.responses = {("status", "--all", "stats"): {"sshd": ["systemd", [], []]}}
        for key in ("maxretry", "maxlines", "findtime", "bantime", "ignoreip", "usedns",
                    "ignorecommand", "ignoreself", "prefregex", "failregex", "ignoreregex", "journalmatch"):
            self.responses[("get", "sshd", key)] = copy.deepcopy(disk[key])
        self.responses[("get", "sshd", "actions")] = ["nftables-multiport"]
        for name, value in disk["actions"]["nftables-multiport"].items():
            self.responses[("get", "sshd", "action", "nftables-multiport", name)] = value
        self.requests = []

    def send(self, command):
        self.requests.append(command)
        return 0, self.responses[tuple(command)]


class ActivePolicyTests(unittest.TestCase):
    def inspect(self, socket=None, disk=None):
        return policy_module.inspect_policy(declared(), disk or disk_policy(),
                                            (socket or SocketFixture()).send, fake_compile)

    def test_exact_policy_matches_using_only_read_commands(self):
        socket = SocketFixture()
        self.assertEqual(self.inspect(socket), {"matches": True, "differences": []})
        self.assertTrue(all(command[0] in ("get", "status") for command in socket.requests))

    def test_maxretry_fifty_is_drift(self):
        socket = SocketFixture()
        socket.responses[("get", "sshd", "maxretry")] = 50
        self.assertEqual(self.inspect(socket)["differences"], ["maxretry"])

    def test_changed_timing_is_drift(self):
        socket = SocketFixture()
        socket.responses[("get", "sshd", "findtime")] = 60
        socket.responses[("get", "sshd", "bantime")] = 600
        self.assertEqual(self.inspect(socket)["differences"], ["findtime", "bantime"])

    def test_missing_allowlist_entry_is_drift(self):
        socket = SocketFixture()
        socket.responses[("get", "sshd", "ignoreip")] = ["127.0.0.0/8"]
        self.assertEqual(self.inspect(socket)["differences"], ["ignoreip"])

    def test_equivalent_ip_and_duration_representations_match(self):
        socket = SocketFixture()
        socket.responses[("get", "sshd", "ignoreip")] = ["0:0:0:0:0:0:0:1/128", "127.0.0.0/8"]
        socket.responses[("get", "sshd", "findtime")] = 600
        socket.responses[("get", "sshd", "bantime")] = 3600
        self.assertTrue(self.inspect(socket)["matches"])

    def test_management_port_missing_is_drift(self):
        socket = SocketFixture()
        socket.responses[("get", "sshd", "action", "nftables-multiport", "port")] = "22"
        self.assertEqual(self.inspect(socket)["differences"], ["action.port"])

    def test_unpatched_loaded_regex_is_drift(self):
        socket = SocketFixture()
        socket.responses[("get", "sshd", "failregex")] = ["old-expression-on-token"]
        self.assertEqual(self.inspect(socket)["differences"], ["failregex"])

    def test_backend_and_missing_sshd_session_journal_match_are_drift(self):
        socket = SocketFixture()
        socket.responses[("status", "--all", "stats")] = {"sshd": ["polling", [], []]}
        socket.responses[("get", "sshd", "journalmatch")] = [["_COMM=sshd"]]
        self.assertEqual(self.inspect(socket)["differences"], ["backend", "journalmatch"])

    def test_changed_action_implementation_is_drift(self):
        socket = SocketFixture()
        socket.responses[("get", "sshd", "action", "nftables-multiport", "actionban")] = ":"
        self.assertEqual(self.inspect(socket)["differences"], ["action.actionban"])

    def test_absent_jail_is_drift_without_getting_missing_jail(self):
        socket = SocketFixture()
        socket.responses[("status", "--all", "stats")] = {}
        self.assertEqual(self.inspect(socket), {"matches": False, "differences": ["jail.absent"]})
        self.assertEqual(len(socket.requests), 1)

    def test_wrong_on_disk_policy_is_an_error_before_live_read(self):
        socket = SocketFixture()
        disk = disk_policy()
        disk["maxretry"] = 50
        with self.assertRaisesRegex(policy_module.PolicyError, "On-disk policy"):
            self.inspect(socket, disk)
        self.assertEqual(socket.requests, [])

    def test_socket_command_error_is_not_a_missing_jail(self):
        with self.assertRaisesRegex(policy_module.PolicyError, "read failed"):
            policy_module.inspect_policy(declared(), disk_policy(), lambda command: (1, RuntimeError("unavailable")), fake_compile)

    def test_unknown_socket_shape_is_not_drift(self):
        with self.assertRaisesRegex(policy_module.PolicyError, "socket response"):
            policy_module.inspect_policy(declared(), disk_policy(), lambda command: "pong", fake_compile)

    def test_unknown_jail_statistics_are_an_error(self):
        socket = SocketFixture()
        socket.responses[("status", "--all", "stats")] = "sshd"
        with self.assertRaisesRegex(policy_module.PolicyError, "statistics"):
            self.inspect(socket)

    def test_dump_is_literal_only_and_never_executes_code(self):
        with self.assertRaisesRegex(policy_module.PolicyError, "command dump"):
            policy_module.parse_dump("__import__('sys').exit(0)", "sshd")

    def test_incomplete_dump_is_rejected(self):
        with self.assertRaisesRegex(policy_module.PolicyError, "Incomplete"):
            policy_module.parse_dump("['add', 'sshd', 'systemd']", "sshd")

    def test_polling_logpath_command_is_parsed_without_accessing_the_path(self):
        values = commands()
        values[1] = ["add", "sshd", "polling"]
        values.append(["set", "sshd", "addlogpath", "/nonexistent/fixture.log", "head"])
        disk = policy_module.parse_dump("\n".join(repr(command) for command in values), "sshd")
        self.assertEqual(disk["maxretry"], 5)
        self.assertEqual(disk["journalmatch"], [])

    def test_mutating_socket_commands_are_rejected_before_sending(self):
        socket = SocketFixture()
        with self.assertRaisesRegex(policy_module.PolicyError, "mutating"):
            policy_module.request(socket.send, ["set", "sshd", "maxretry", "50"])
        self.assertEqual(socket.requests, [])


if __name__ == "__main__":
    unittest.main()
