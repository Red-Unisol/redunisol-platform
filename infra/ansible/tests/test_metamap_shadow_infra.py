"""Executable local contracts and isolated Docker-inspection fixtures; no remote host or daemon."""
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from jinja2 import Environment, StrictUndefined
import yaml

ROOT = Path(__file__).resolve().parents[1]
ROLE = ROOT / "roles/metamap_shadow"
SPEC = importlib.util.spec_from_file_location("metamap_shadow_control", ROLE / "files/shadow-control.py")
CONTROL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTROL)
REVISION = "a" * 40
ADAPTER = "b" * 64


def read_yaml(path):
    return yaml.safe_load((ROOT / path).read_text(encoding="utf-8"))


def variables():
    values = read_yaml("roles/metamap_shadow/defaults/main.yml")
    values.update(metamap_shadow_revision=REVISION, role_path=str(ROLE))
    return values


def environment_values():
    return {"METAMAP_SHADOW_WEBHOOK_SECRET": "fixture-signing-secret-00000000",
            "METAMAP_SHADOW_DELIVERY_TOKEN": "fixture-delivery-token-000000000000000000000000",
            "METAMAP_SHADOW_DATABASE_URL": "sqlite+pysqlite:////data/shadow.sqlite",
            "METAMAP_SHADOW_REVISION": REVISION}


def environment_text(values=None):
    return "".join(key + "=" + value + "\n" for key, value in (values or environment_values()).items())


def snapshot():
    return {
        "Id": "c" * 64, "State": {"Running": True, "Health": {"Status": "healthy"}}, "RestartCount": 0,
        "Config": {"Image": CONTROL.IMAGE, "User": "10090:10090", "Cmd": CONTROL.COMMAND, "Entrypoint": None,
                   "Labels": {"com.docker.compose.project": CONTROL.PROJECT, "redunisol.shadow.scope": "webhook-replay-only",
                              "redunisol.shadow.revision": REVISION, "redunisol.shadow.adapter-sha256": ADAPTER},
                   "Env": [key + "=" + value for key, value in environment_values().items()] +
                          ["METAMAP_SERVER_GIT_SHA=" + "d" * 40, "PYTHONPATH=/shadow:/app", "PYTHONDONTWRITEBYTECODE=1",
                           "PYTHONUNBUFFERED=1", "PATH=/usr/local/bin:/usr/bin"]},
        "HostConfig": {"ReadonlyRootfs": True, "CapDrop": ["ALL"], "CapAdd": None,
                       "SecurityOpt": ["no-new-privileges:true"], "Privileged": False, "PidsLimit": 64,
                       "Memory": 536870912, "NanoCpus": 500000000, "RestartPolicy": {"Name": "unless-stopped"},
                       "Init": True, "PortBindings": {"8000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "18084"}]},
                       "Binds": None, "Devices": None, "Tmpfs": {"/tmp": "rw,noexec,nosuid,size=16777216"},
                       "PidMode": "", "IpcMode": "private", "UTSMode": ""},
        "Mounts": [{"Type": "bind", "Source": str(CONTROL.PLATFORM / "code/shadow_app.py"),
                    "Destination": "/shadow/shadow_app.py", "RW": False},
                   {"Type": "bind", "Source": str(CONTROL.STATE / "data"), "Destination": "/data", "RW": True}],
        "NetworkSettings": {"Networks": {CONTROL.PROJECT + "-internal": {}}}}


def network():
    return {"Internal": True, "EnableIPv6": False, "Labels": {"com.docker.compose.project": CONTROL.PROJECT},
            "Containers": {"c" * 64: {}}}


class ShadowEnvironmentTests(unittest.TestCase):
    def test_four_exact_keys_preserve_raw_signing_bytes_and_equals(self):
        expected = environment_values()
        expected["METAMAP_SHADOW_WEBHOOK_SECRET"] = "raw$signing+secret=value-with=equals"
        self.assertEqual(CONTROL.parse_environment(environment_text(expected), REVISION), expected)

    def test_production_oauth_unknown_duplicate_and_wrong_database_settings_fail_closed(self):
        for extra in ("METAMAP_SERVER_API_KEY=fixture\n", "OAUTH_CLIENT_SECRET=fixture\n",
                      "METAMAP_SHADOW_DELIVERY_TOKEN=duplicate\n"):
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                CONTROL.parse_environment(environment_text() + extra, REVISION)
        for name, value in (("METAMAP_SHADOW_DATABASE_URL", "sqlite+pysqlite:////data/production.db"),
                            ("METAMAP_SHADOW_WEBHOOK_SECRET", "short"), ("METAMAP_SHADOW_DELIVERY_TOKEN", "short"),
                            ("METAMAP_SHADOW_REVISION", "e" * 40)):
            settings = environment_values()
            settings[name] = value
            with self.subTest(name=name), self.assertRaises(ValueError):
                CONTROL.parse_environment(environment_text(settings), REVISION)

    @unittest.skipUnless(os.name == "posix", "POSIX private-file semantics")
    def test_environment_file_cannot_be_a_symlink_or_world_readable_and_cli_never_prints_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory) / "runtime.env"
            private.write_text(environment_text(), encoding="utf-8")
            private.chmod(0o600)
            self.assertEqual(CONTROL.private_file(private), environment_text())
            link = Path(directory) / "link"
            link.symlink_to(private)
            with self.assertRaises(OSError):
                CONTROL.private_file(link)
            private.chmod(0o644)
            with self.assertRaises(ValueError):
                CONTROL.private_file(private)
            result = subprocess.run([sys.executable, str(ROLE / "files/shadow-control.py"), "environment", "--file", str(private),
                                     "--revision", REVISION], text=True, capture_output=True, check=False)
            self.assertEqual(result.returncode, 2)
            self.assertNotIn(environment_values()["METAMAP_SHADOW_WEBHOOK_SECRET"], result.stdout + result.stderr)


class ShadowRuntimeTests(unittest.TestCase):
    def differences(self, value=None, net=None):
        return CONTROL.runtime_differences(value or snapshot(), REVISION, ADAPTER, environment_values(), net or network(),
                                           ["METAMAP_SERVER_GIT_SHA=" + "d" * 40, "PATH=/usr/local/bin:/usr/bin"])

    def test_reviewed_runtime_accepts_only_the_build_sha_inherited_from_the_base_image(self):
        self.assertEqual(self.differences(), [])
        value = snapshot()
        value["Config"]["Env"].append("METAMAP_SERVER_CLIENT_SECRET=forbidden")
        self.assertIn("application_environment", self.differences(value))
        value = snapshot()
        value["Config"]["Env"].append("OAUTH_CLIENT_SECRET=forbidden")
        self.assertIn("application_environment", self.differences(value))

    def test_live_secret_or_revision_drift_is_detected_even_when_managed_files_are_unchanged(self):
        value = snapshot()
        value["Config"]["Env"] = [item.replace("fixture-signing-secret-00000000", "previous-signing-secret-0000000")
                                  for item in value["Config"]["Env"]]
        self.assertIn("application_environment", self.differences(value))
        value = snapshot()
        value["Config"]["Labels"]["redunisol.shadow.revision"] = "f" * 40
        self.assertIn("revision", self.differences(value))

    def test_confinement_changes_are_detected_against_the_actual_container(self):
        cases = [("ReadonlyRootfs", False, "read_only_root"), ("Privileged", True, "privileged"),
                 ("CapAdd", ["SYS_ADMIN"], "capabilities"), ("SecurityOpt", [], "no_new_privileges"),
                 ("PidMode", "host", "host_namespaces"), ("Memory", 0, "resource_limits"),
                 ("PidsLimit", 0, "resource_limits"), ("NanoCpus", 0, "resource_limits"),
                 ("PortBindings", {"8000/tcp": [{"HostIp": "0.0.0.0", "HostPort": "18084"}]}, "ports"),
                 ("Tmpfs", {"/tmp": "rw,size=1g"}, "tmpfs_limits")]
        for name, value, expected in cases:
            with self.subTest(name=name):
                changed = snapshot()
                changed["HostConfig"][name] = value
                self.assertIn(expected, self.differences(changed))

    def test_production_mount_network_and_foreign_peer_are_rejected(self):
        value = snapshot()
        value["Mounts"][1]["Source"] = "/srv/redunisol/state/metamap-server/data"
        self.assertIn("bind_mounts", self.differences(value))
        net = network()
        net["Internal"] = False
        self.assertIn("network_isolation", self.differences(net=net))
        net = network()
        net["Containers"]["foreign"] = {}
        self.assertIn("shared_network", self.differences(net=net))

    def test_all_docker_reads_pin_the_local_unix_socket(self):
        completed = subprocess.CompletedProcess([], 0, "[]", "")
        with patch.object(CONTROL.subprocess, "run", return_value=completed) as run:
            self.assertEqual(CONTROL.docker(["image", "inspect", CONTROL.IMAGE], json_output=True), [])
        self.assertEqual(run.call_args.args[0][:3], ["docker", "--host", "unix:///var/run/docker.sock"])

    def test_unlabelled_existing_container_cannot_be_adopted_or_stopped(self):
        value = snapshot()
        value["Config"]["Labels"].pop("redunisol.shadow.scope")
        with patch.object(CONTROL, "docker", side_effect=["abc", "abc", [value]]), self.assertRaises(ValueError):
            CONTROL.owned_snapshot()

    def test_health_and_stats_accept_only_current_readonly_aggregate_contract(self):
        common = {"shadow_only": True, "enrichment_enabled": False, "revision": REVISION,
                  "recommended_trial_days": 7, "automatic_retention": False}
        health = {"status": "ok", **common}
        stats = {"status": "ok", "deliveries": 3, "duplicates": 1, "rejections": 0, "processing_failures": 0,
                 "validations": 2, "receipts": 3, "volatile_counters": ["envelope_rejections", "processing_failures"], **common}

        def response(value):
            stream = io.BytesIO(json.dumps(value).encode())
            stream.status = 200
            return stream

        with patch.object(CONTROL.urllib.request, "build_opener") as build:
            build.return_value.open.side_effect = [response(health), response(stats)]
            self.assertEqual(CONTROL.read_health(REVISION), {"health": health, "stats": stats})
            self.assertEqual([call.args[0] for call in build.return_value.open.call_args_list],
                             ["http://127.0.0.1:18084/health", "http://127.0.0.1:18084/stats"])
        for changed in ({**health, "automatic_retention": True}, {**health, "private_payload": "forbidden"}):
            with patch.object(CONTROL.urllib.request, "build_opener") as build:
                build.return_value.open.return_value = response(changed)
                with self.assertRaises(ValueError):
                    CONTROL.read_health(REVISION)


class ShadowComposeTests(unittest.TestCase):
    def render(self):
        env = Environment(undefined=StrictUndefined, keep_trailing_newline=True)
        env.filters["hash"] = lambda value, unused: __import__("hashlib").sha256(value.encode()).hexdigest()
        values = variables()
        values["lookup"] = lambda unused_plugin, path, **unused_options: Path(path).read_text(encoding="utf-8")
        return yaml.safe_load(env.from_string((ROLE / "templates/compose.yml.j2").read_text(encoding="utf-8")).render(**values))

    def test_compose_has_one_nonroot_confined_service_and_no_production_mount_or_network(self):
        data = self.render()
        self.assertEqual(data["name"], CONTROL.PROJECT)
        self.assertEqual(set(data["services"]), {"receiver"})
        service = data["services"]["receiver"]
        self.assertEqual(service["image"], CONTROL.IMAGE)
        self.assertEqual(service["pull_policy"], "never")
        self.assertEqual(service["user"], "10090:10090")
        self.assertTrue(service["read_only"])
        self.assertEqual(service["ports"], ["127.0.0.1:18084:8000"])
        self.assertEqual(service["command"], CONTROL.COMMAND)
        self.assertEqual([item["target"] for item in service["volumes"]], ["/shadow/shadow_app.py", "/data"])
        self.assertTrue(service["volumes"][0]["read_only"])
        self.assertTrue(all(item["bind"]["create_host_path"] is False for item in service["volumes"]))
        self.assertTrue(data["networks"]["isolated"]["internal"])
        serialized = json.dumps(data)
        for forbidden in ("18083", "runtime.env.pending", "metamap-server/data", "docker.sock", "OAuth", "updates"):
            self.assertNotIn(forbidden, serialized)
        self.assertEqual(service["env_file"], [{"path": "/etc/redunisol-metamap-shadow/runtime.env", "format": "raw", "required": True}])

    def test_defaults_inventory_and_playbooks_keep_authorizations_separate_and_inactive(self):
        defaults = variables()
        for name in ("apply_authorized", "stop_authorized", "running"):
            self.assertIs(defaults["metamap_shadow_" + name], False)
        inventory = read_yaml("inventories/production/group_vars/metamap_shadow_hosts.yml")
        self.assertTrue(all(value is False for value in inventory.values()))
        for suffix in ("prepare", "verify", "stop"):
            play = read_yaml("playbooks/metamap-shadow-" + suffix + ".yml")[0]
            self.assertEqual(play["hosts"], "metamap_shadow_hosts")
        stop = json.dumps(read_yaml("roles/metamap_shadow/tasks/stop.yml"))
        self.assertNotIn('"state": "absent"', stop)
        self.assertNotIn('"down"', stop)


@unittest.skipUnless(shutil.which("ansible-playbook"), "Linux Ansible controller required")
class ExecutableShadowContractTests(unittest.TestCase):
    def run_contract(self, overrides=None, role=False, check=False, stop=False):
        values = variables()
        values.pop("role_path")
        values.update(overrides or {})
        play = dict(name="Local shadow contracts only", hosts="localhost", connection="local", gather_facts=False,
                    become=False, vars=values)
        if role:
            play["roles"] = ["metamap_shadow"]
        elif stop:
            play["tasks"] = [{"name": "Original stop tasks", "ansible.builtin.import_role": {"name": "metamap_shadow", "tasks_from": "stop"}}]
        else:
            play["tasks"] = read_yaml("roles/metamap_shadow/tasks/contract.yml")
        with tempfile.TemporaryDirectory(prefix="shadow-contract-") as directory:
            path = Path(directory)
            target = path / "play.yml"
            target.write_text(yaml.safe_dump([play], sort_keys=False), encoding="utf-8")
            env = dict(os.environ, ANSIBLE_CONFIG=str(ROOT / "ansible.cfg"), ANSIBLE_ROLES_PATH=str(ROOT / "roles"),
                       ANSIBLE_LOCAL_TEMP=str(path / "ansible-tmp"), ANSIBLE_NOCOLOR="1")
            command = ["ansible-playbook", "-i", "localhost,", "-c", "local", str(target)] + (["--check"] if check else [])
            completed = subprocess.run(command, cwd=directory, env=env, text=True, capture_output=True, timeout=45, check=False)
        return completed.returncode, completed.stdout + completed.stderr

    def test_original_contract_accepts_default_isolation_and_rejects_escape_inputs(self):
        code, output = self.run_contract()
        self.assertEqual(code, 0, output)
        for overrides in ({"metamap_shadow_project": "metamap-server"}, {"metamap_shadow_port": 18083},
                          {"metamap_shadow_running": "true"}, {"metamap_shadow_uid": 0},
                          {"metamap_shadow_image": "ghcr.io/red-unisol/metamap-platform-server:latest"},
                          {"metamap_shadow_state_dir": "/srv/redunisol/state/metamap-server"}):
            with self.subTest(overrides=overrides):
                code, output = self.run_contract(overrides)
                self.assertNotEqual(code, 0, output)
                self.assertIn('"evaluated_to": false', output)

    def test_actual_prepare_and_stop_refuse_missing_authorization_before_any_docker_call(self):
        for kwargs in ({"role": True}, {"stop": True}):
            code, output = self.run_contract(**kwargs)
            self.assertNotEqual(code, 0, output)
            self.assertIn('"evaluated_to": false', output)
            self.assertNotIn("Local Docker read failed", output)

    def test_actual_prepare_and_stop_check_mode_have_zero_changes_without_reading_secrets(self):
        for kwargs in ({"role": True}, {"stop": True}):
            code, output = self.run_contract(check=True, **kwargs)
            self.assertEqual(code, 0, output)
            self.assertIn("changed=0", output)


if __name__ == "__main__":
    unittest.main()
