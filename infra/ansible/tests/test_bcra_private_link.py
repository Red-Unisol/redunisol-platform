"""Local guards, real loopback TCP forwarding and reconciliation; no SSH/production calls."""
import ast
import base64
import copy
import importlib.util
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest import mock

import yaml


ROOT = Path(__file__).resolve().parents[1]
ROLE = ROOT / "roles/bcra_private_link"


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROLE / "files" / (name + ".py"))
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


LINK = module("link")
PROXY = module("proxy")
SOURCE = (ROLE / "files/proxy.py").read_bytes()
PUBLIC = "ssh-ed25519 " + base64.b64encode(b"\0\0\0\x0bssh-ed25519\0\0\0\x20" + b"k" * 32).decode()


def config(side="client", action="apply"):
    hostname, machine = LINK.APPROVED[side]
    return dict(side=side, action=action, apply_authorized=True, revision="a" * 40,
                expected_hostname=hostname, expected_machine_id=machine,
                server_host="168.197.51.104", server_port=2241, server_host_key=PUBLIC,
                client_public_key=PUBLIC, client_source_ip="66.97.34.158",
                expected_gateway="172.18.0.1", expected_subnet="172.18.0.0/16",
                proxy_image="ghcr.io/red-unisol/bcra-file-api@sha256:" + "7" * 64)


def container(values):
    return {
        "Image": "sha256:" + "8" * 64,
        "State": {"Running": True},
        "Config": {"Labels": {LINK.OWNER_LABEL: "true", LINK.HASH_LABEL: LINK.proxy_spec(values, SOURCE)},
                   "User": "10001:10001", "Entrypoint": ["python"],
                   "Cmd": ["/proxy.py", "--upstream-host", "172.18.0.1", "--upstream-port", "18083"], "Env": []},
        "HostConfig": {"ReadonlyRootfs": True, "Privileged": False, "CapDrop": ["ALL"], "CapAdd": None,
                       "SecurityOpt": ["no-new-privileges:true"], "Memory": 64 * 1024 * 1024,
                       "NanoCpus": 100000000, "PidsLimit": 40, "LogConfig": {"Type": "none"},
                       "RestartPolicy": {"Name": "unless-stopped"},
                       "PortBindings": {"8080/tcp": [{"HostIp": "127.0.0.1", "HostPort": "18082"}]}},
        "Mounts": [{"Type": "bind", "Source": str(LINK.CONFIG / "proxy.py"), "Destination": "/proxy.py", "RW": False}],
        "NetworkSettings": {"Networks": {"kestra_net": {"Aliases": ["bcra-file-api-poc"], "IPAddress": "172.18.0.21"}}},
    }


def unit_properties(values):
    command = next(line.split("=", 1)[1] for line in LINK.tunnel_unit(values).splitlines() if line.startswith("ExecStart="))
    return {"User": "bcra-link", "Group": "bcra-link", "NoNewPrivileges": "yes", "ProtectSystem": "strict",
            "ProtectHome": "yes", "PrivateTmp": "yes", "PrivateDevices": "yes", "ProtectKernelTunables": "yes",
            "ProtectKernelModules": "yes", "ProtectControlGroups": "yes", "LockPersonality": "yes",
            "CapabilityBoundingSet": "", "RestrictAddressFamilies": "AF_UNIX AF_INET AF_INET6",
            "ExecStart": "{ path=/usr/bin/ssh ; argv[]=" + command + " ; ignore_errors=no ; pid=123 ; }",
            "NeedDaemonReload": "no", "MainPID": "123"}


class PrivateLinkGuardTests(unittest.TestCase):
    def test_default_and_check_mode_do_not_contact_or_change_a_host(self):
        defaults = yaml.safe_load((ROLE / "defaults/main.yml").read_text())
        self.assertFalse(defaults["bcra_private_link_apply_authorized"])
        self.assertEqual(defaults["bcra_private_link_action"], "plan")
        with mock.patch.object(LINK, "run", side_effect=AssertionError("No command in plan")):
            self.assertFalse(LINK.execute(dict(side="client", action="plan", apply_authorized=False), b"")["changed"])
        tasks = yaml.safe_load((ROLE / "tasks/main.yml").read_text())
        script = next(t for t in tasks if "ansible.builtin.script" in t)
        self.assertIn("not ansible_check_mode", script["when"])
        self.assertEqual(script["ansible.builtin.script"]["executable"], "/usr/bin/python3")
        self.assertNotIn("ansible.builtin.copy", (ROLE / "tasks/main.yml").read_text())

    def test_writes_require_real_boolean_authorization_and_full_revision(self):
        for action in ("apply", "prepare_key"):
            for changes in ({"apply_authorized": False}, {"apply_authorized": "false"}, {"revision": "main"}):
                with self.subTest(action=action, changes=changes):
                    values = config(action=action)
                    values.update(changes)
                    with self.assertRaises(LINK.LinkError):
                        LINK.validate(values)

    def test_wrong_side_identity_and_private_material_are_rejected(self):
        cases = [{"side": "server"}, {"server_host": "host;touch /tmp/unsafe"},
                 {"server_port": "2241"}, {"server_host_key": "-----BEGIN OPENSSH PRIVATE KEY-----"},
                 {"proxy_image": "python:latest"}, {"expected_gateway": "0.0.0.0"},
                 {"BCRA_FILE_API_TOKEN": "not-accepted-by-the-transport"}]
        for changes in cases:
            with self.subTest(changes=list(changes)):
                values = config()
                values.update(changes)
                with self.assertRaises(LINK.LinkError):
                    LINK.validate(values)

    def test_tunnel_pins_host_and_binds_only_the_reviewed_docker_bridge(self):
        unit = LINK.tunnel_unit(config())
        self.assertIn("-L 172.18.0.1:18083:127.0.0.1:18082", unit)
        self.assertIn("StrictHostKeyChecking=yes", unit)
        self.assertIn("ExitOnForwardFailure=yes", unit)
        self.assertIn("-F /dev/null -a -x -N -T", unit)
        self.assertNotIn("0.0.0.0", unit)
        self.assertNotIn("root@", unit)
        self.assertEqual(LINK.known_host(config()), "[168.197.51.104]:2241 " + PUBLIC + "\n")

    def test_server_policy_allows_only_the_single_local_tcp_destination(self):
        policy = LINK.ssh_policy()
        for line in ("Match User bcra-link", "AllowTcpForwarding local", "PermitOpen 127.0.0.1:18082",
                     "PermitListen none", "AllowStreamLocalForwarding no", "MaxSessions 0",
                     "PermitTTY no", "PermitTunnel no", "ForceCommand /usr/sbin/nologin"):
            self.assertIn(line, policy)
        self.assertTrue(policy.endswith("Match all\n"))
        key = LINK.authorized_key(config("server"))
        self.assertIn('from="66.97.34.158",restrict,port-forwarding,permitopen="127.0.0.1:18082"', key)
        self.assertNotIn("PRIVATE KEY", key)

    def test_manifest_digest_is_distinct_from_local_image_content_id(self):
        values = config()
        local = "sha256:" + "f" * 64
        with mock.patch.object(LINK, "run", return_value=json.dumps([{"Id": local, "RepoDigests": [values["proxy_image"]]}])):
            self.assertEqual(LINK.local_image(values), local)
        with mock.patch.object(LINK, "run", return_value=json.dumps([{"Id": local, "RepoDigests": []}])):
            with self.assertRaises(LINK.LinkError):
                LINK.local_image(values)

    def test_proxy_is_data_free_bounded_and_cannot_pull_an_image(self):
        args = LINK.proxy_args(config(), "a" * 64)
        self.assertIn("--pull=never", args)
        self.assertIn("--entrypoint", args)
        self.assertIn("--read-only", args)
        self.assertIn("64m", args)
        self.assertNotIn("/data", " ".join(args))
        self.assertNotIn("BCRA_FILE_API_TOKEN", " ".join(args))
        self.assertIn("127.0.0.1:18082:8080", args)

    def test_drift_is_detected_even_when_the_managed_hash_label_is_unchanged(self):
        values = config()
        original = container(values)
        self.assertTrue(LINK.proxy_matches(original, values, SOURCE, original["Image"]))
        changes = [lambda c: c["HostConfig"].update(Privileged=True),
                   lambda c: c["HostConfig"]["PortBindings"]["8080/tcp"][0].update(HostIp="0.0.0.0"),
                   lambda c: c["HostConfig"].update(CapAdd=["SYS_ADMIN"]),
                   lambda c: c["Config"].update(User="root"),
                   lambda c: c["Config"].update(Env=["BCRA_FILE_API_TOKEN=must-not-be-here"]),
                   lambda c: c["Mounts"].append({"Type": "volume", "Destination": "/data"}),
                   lambda c: c["NetworkSettings"]["Networks"].update(extra={}),
                   lambda c: c["HostConfig"].update(ReadonlyRootfs=False)]
        for index, mutate in enumerate(changes):
            with self.subTest(index=index):
                changed = copy.deepcopy(original)
                mutate(changed)
                self.assertFalse(LINK.proxy_matches(changed, values, SOURCE, original["Image"]))

    def test_unowned_proxy_name_is_never_adopted_or_removed(self):
        with mock.patch.object(LINK, "run", return_value=json.dumps([{"Config": {"Labels": {}}}])) as commands:
            with self.assertRaises(LINK.LinkError):
                LINK.inspect_proxy()
        self.assertEqual(commands.call_count, 1)
        self.assertEqual(commands.call_args[0][0][1:3], ["container", "inspect"])

    def test_old_importer_running_aborts_before_any_write(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            (home / "id_ed25519").write_text("synthetic fixture")
            with mock.patch.object(LINK, "HOME", home), mock.patch.object(LINK, "account"), \
                    mock.patch.object(LINK, "network"), mock.patch.object(LINK, "local_image"), \
                    mock.patch.object(LINK, "run", return_value="old-container-running\n"), \
                    mock.patch.object(LINK, "write") as write, mock.patch.object(LINK, "directory") as directory:
                with self.assertRaises(LINK.LinkError):
                    LINK.client_apply(config(), SOURCE)
                write.assert_not_called()
                directory.assert_not_called()

    def test_an_unchanged_client_apply_does_not_restart_or_recreate(self):
        values = config()
        existing = container(values)

        def command(args, **kwargs):
            if "is-active" in args:
                return "active\n"
            if "is-enabled" in args:
                return "enabled\n"
            return ""

        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            (home / "id_ed25519").write_text("synthetic fixture")
            with mock.patch.object(LINK, "HOME", home), \
                    mock.patch.object(LINK, "account", return_value=SimpleNamespace(pw_uid=123)), \
                    mock.patch.object(LINK, "network", return_value="172.18.0.1"), \
                    mock.patch.object(LINK, "local_image", return_value=existing["Image"]), \
                    mock.patch.object(LINK, "write", return_value=False), \
                    mock.patch.object(LINK, "directory", return_value=False), \
                    mock.patch.object(LINK, "inspect_proxy", return_value=existing), \
                    mock.patch.object(LINK, "health"), \
                    mock.patch.object(LINK, "unit_runtime", return_value=unit_properties(values)), \
                    mock.patch.object(LINK, "client_verify", return_value={"changed": False}), \
                    mock.patch.object(LINK, "run", side_effect=command) as commands:
                self.assertFalse(LINK.client_apply(values, SOURCE)["changed"])
        for call in commands.call_args_list:
            self.assertFalse(set(call[0][0]) & {"restart", "enable", "rm", "run", "stop", "pull"})

    def test_loaded_unit_drift_is_detected_despite_an_unchanged_file(self):
        values = config()
        properties = unit_properties(values)
        self.assertTrue(LINK.loaded_unit_matches(properties, values))
        for change in ({"User": "root"}, {"NoNewPrivileges": "no"}, {"ProtectSystem": "no"},
                       {"CapabilityBoundingSet": "cap_sys_admin"}, {"ExecStart": "argv[]=/bin/false ;"}):
            changed = dict(properties, **change)
            self.assertFalse(LINK.loaded_unit_matches(changed, values))

    def test_verify_rejects_loaded_unit_drift_without_daemon_reload_or_repair(self):
        values = config(action="verify")
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            unit = directory / "test.service"
            unit.write_text(LINK.tunnel_unit(values))
            (directory / "known_hosts").write_text(LINK.known_host(values))
            (directory / "proxy.py").write_bytes(SOURCE)
            drift = dict(unit_properties(values), NoNewPrivileges="no")
            with mock.patch.object(LINK, "CONFIG", directory), mock.patch.object(LINK, "UNIT", unit), \
                    mock.patch.object(LINK, "account", return_value=SimpleNamespace(pw_uid=123)), \
                    mock.patch.object(LINK, "network", return_value="172.18.0.1"), \
                    mock.patch.object(LINK, "unit_runtime", return_value=drift), \
                    mock.patch.object(LINK, "write") as writes, mock.patch.object(LINK, "run", return_value="") as commands:
                with self.assertRaisesRegex(LINK.LinkError, "loaded_unit_policy_drift"):
                    LINK.client_verify(values, SOURCE)
                writes.assert_not_called()
                self.assertEqual([c[0][0][1] for c in commands.call_args_list], ["is-active", "is-enabled"])

    def test_server_restores_previous_dropin_if_effective_root_policy_changes(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder) / "home"
            home.mkdir()
            (home / ".ssh").mkdir()
            dropin = Path(folder) / "dropin.conf"
            dropin.write_text("# previous reviewed content\n")
            previous = dropin.read_bytes()
            user = SimpleNamespace(pw_uid=0, pw_gid=0)
            with mock.patch.object(LINK, "HOME", home), mock.patch.object(LINK, "DROPIN", dropin), \
                    mock.patch.object(LINK, "account", return_value=user), \
                    mock.patch.object(LINK, "directory", return_value=False), \
                    mock.patch.object(LINK.os, "chown", create=True), \
                    mock.patch.object(LINK, "effective", side_effect=["root original", "root changed"]), \
                    mock.patch.object(LINK, "server_policy_verify", return_value={"changed": False}), \
                    mock.patch.object(LINK, "run") as commands:
                with self.assertRaisesRegex(LINK.LinkError, "root_ssh_policy_would_change"):
                    LINK.server_apply(config("server"))
                self.assertEqual(dropin.read_bytes(), previous)
                self.assertFalse((home / ".ssh/authorized_keys").exists())
                commands.assert_not_called()

    def test_invalid_sshd_configuration_never_installs_a_new_authorized_key(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder) / "home"
            home.mkdir()
            (home / ".ssh").mkdir()
            dropin = Path(folder) / "dropin.conf"
            user = SimpleNamespace(pw_uid=0, pw_gid=0)
            with mock.patch.object(LINK, "HOME", home), mock.patch.object(LINK, "DROPIN", dropin), \
                    mock.patch.object(LINK, "account", return_value=user), \
                    mock.patch.object(LINK, "directory", return_value=False), \
                    mock.patch.object(LINK.os, "chown", create=True), \
                    mock.patch.object(LINK, "effective", return_value="root original"), \
                    mock.patch.object(LINK, "server_policy_verify", side_effect=LINK.LinkError("invalid_sshd_config")), \
                    mock.patch.object(LINK, "run") as commands:
                with self.assertRaisesRegex(LINK.LinkError, "invalid_sshd_config"):
                    LINK.server_apply(config("server"))
                self.assertFalse((home / ".ssh/authorized_keys").exists())
                self.assertFalse(dropin.exists())
                commands.assert_not_called()

    def test_a_new_key_forces_reload_before_authorization_even_when_policy_file_already_matches(self):
        events = []
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder) / "home"
            home.mkdir()
            (home / ".ssh").mkdir()
            dropin = Path(folder) / "dropin.conf"
            dropin.write_text(LINK.ssh_policy())
            original_write = LINK.write

            def write(path, *args, **kwargs):
                if path.name == "authorized_keys":
                    events.append("authorize")
                return original_write(path, *args, **kwargs)

            def command(args, **kwargs):
                if args[1:] == ["reload", "ssh"]:
                    events.append("reload")
                return ""

            with mock.patch.object(LINK, "HOME", home), mock.patch.object(LINK, "DROPIN", dropin), \
                    mock.patch.object(LINK, "account", return_value=SimpleNamespace(pw_uid=0, pw_gid=0)), \
                    mock.patch.object(LINK, "directory", return_value=False), \
                    mock.patch.object(LINK.os, "chown", create=True), \
                    mock.patch.object(LINK, "effective", return_value="root unchanged"), \
                    mock.patch.object(LINK, "server_policy_verify", return_value={"changed": False}), \
                    mock.patch.object(LINK, "server_verify", return_value={"changed": False}), \
                    mock.patch.object(LINK, "write", side_effect=write), \
                    mock.patch.object(LINK, "run", side_effect=command):
                self.assertTrue(LINK.server_apply(config("server"))["changed"])
            self.assertEqual(events, ["reload", "authorize"])

    def test_both_remote_helpers_parse_as_python36(self):
        for name in ("link.py", "proxy.py"):
            ast.parse((ROLE / "files" / name).read_text(), feature_version=(3, 6))

    def test_server_and_client_playbooks_never_gather_remote_facts(self):
        plays = yaml.safe_load((ROOT / "playbooks/bcra-private-link.yml").read_text())
        self.assertEqual([p["hosts"] for p in plays], ["bcra_file_api_hosts", "bcra_migration_origins"])
        self.assertTrue(all(p["gather_facts"] is False for p in plays))


class LoopbackUpstream:
    def __init__(self, reply=True):
        self.listener = socket.socket()
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(8)
        self.listener.settimeout(0.1)
        self.address = self.listener.getsockname()
        self.accepted = threading.Event()
        self.received = []
        self.stop = threading.Event()
        self.reply = reply
        self.connections = 0
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def serve(self):
        while not self.stop.is_set():
            try:
                client, _ = self.listener.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            self.connections += 1
            self.accepted.set()

            def handle(connection):
                data = bytearray()
                connection.settimeout(2)
                try:
                    while True:
                        part = connection.recv(65536)
                        if not part:
                            break
                        data.extend(part)
                    self.received.append(bytes(data))
                    if self.reply:
                        connection.sendall(bytes(data)[::-1])
                except OSError:
                    pass
                finally:
                    connection.close()

            threading.Thread(target=handle, args=(client,), daemon=True).start()

    def close(self):
        self.stop.set()
        self.listener.close()
        self.thread.join(timeout=1)


class RealProxyTests(unittest.TestCase):
    def setUp(self):
        self.upstream = LoopbackUpstream()
        self.proxy = PROXY.Proxy(self.upstream.address, listen=("127.0.0.1", 0), limit=1,
                                 idle_timeout=0.3, lifetime=2)
        self.thread = threading.Thread(target=self.proxy.serve, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.proxy.close()
        self.upstream.close()
        self.thread.join(timeout=1)

    def test_large_binary_stream_and_half_close_reach_upstream_once(self):
        data = bytes(range(256)) * 1024
        with socket.create_connection(self.proxy.address, timeout=2) as client:
            client.sendall(data)
            client.shutdown(socket.SHUT_WR)
            response = bytearray()
            while True:
                part = client.recv(65536)
                if not part:
                    break
                response.extend(part)
        self.assertEqual(bytes(response), data[::-1])
        self.assertEqual(self.upstream.received, [data])
        self.assertEqual(self.upstream.connections, 1)

    def test_concurrency_bound_rejects_a_second_connection_without_forwarding(self):
        with socket.create_connection(self.proxy.address, timeout=2) as first:
            self.assertTrue(self.upstream.accepted.wait(1))
            with socket.create_connection(self.proxy.address, timeout=2) as second:
                try:
                    self.assertEqual(second.recv(1), b"")
                except ConnectionResetError:
                    pass
            self.assertEqual(self.upstream.connections, 1)
            first.shutdown(socket.SHUT_WR)

    def test_idle_connections_are_closed_and_capacity_is_released(self):
        started = time.monotonic()
        with socket.create_connection(self.proxy.address, timeout=2) as client:
            self.assertEqual(client.recv(1), b"")
        self.assertLess(time.monotonic() - started, 1.5)
        self.assertTrue(self.proxy.capacity.acquire(timeout=1))
        self.proxy.capacity.release()

    def test_unavailable_upstream_is_not_retried(self):
        client = mock.Mock()
        self.assertTrue(self.proxy.capacity.acquire(timeout=1))
        with mock.patch.object(PROXY.socket, "create_connection", side_effect=OSError("synthetic failure")) as connect:
            self.proxy.relay(client)
        self.assertEqual(connect.call_count, 1)
        client.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
