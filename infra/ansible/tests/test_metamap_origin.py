"""Contracts and isolated HTTPS/proxy fixtures; never contacts an operational host."""
import copy
from http.client import HTTPSConnection
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import tempfile
from threading import Thread
import time
import unittest

from jinja2 import Environment, StrictUndefined
import yaml


ROOT = Path(__file__).resolve().parents[1]
ROLE = ROOT / "roles/metamap_origin"
HOSTNAME = "metamap-origin.redunisol.com.ar"
REVISION = "1" * 40
MARKER = "2" * 64


def read_yaml(path):
    return yaml.safe_load((ROOT / path).read_text(encoding="utf-8"))


def named_task(path, name):
    return copy.deepcopy(next(item for item in read_yaml(path) if item["name"] == name))


def values():
    result = read_yaml("roles/metamap_origin/defaults/main.yml")
    result.update(metamap_origin_revision=REVISION,
                  metamap_origin_configuration_sha256=MARKER,
                  metamap_origin_certificate_not_after=2000000000,
                  metamap_origin_certificate_fingerprint_sha256="3" * 64,
                  ansible_facts={"all_ipv4_addresses": ["192.0.2.10"]})
    return result


def environment():
    result = Environment(undefined=StrictUndefined, keep_trailing_newline=True)
    result.filters["to_nice_json"] = lambda value: json.dumps(value, indent=4, sort_keys=True)
    return result


def render(name, variables):
    return environment().from_string((ROLE / "templates" / name).read_text(encoding="utf-8")).render(**variables)


class OriginRenderingTests(unittest.TestCase):
    def test_default_origin_is_inactive_private_and_without_backend(self):
        defaults = read_yaml("roles/metamap_origin/defaults/main.yml")
        for key in ("enabled", "apply_authorized", "public_listen_authorized", "backend_enabled"):
            self.assertIs(defaults["metamap_origin_" + key], False)
        self.assertEqual(defaults["metamap_origin_listen_address"], "127.0.0.1")
        self.assertEqual(defaults["metamap_origin_listen_port"], 18443)
        self.assertEqual(defaults["metamap_origin_private_key_file"], "")

    def test_rendered_preparation_has_no_upstream_and_distinct_transport_health(self):
        config = render("apache.conf.j2", values())
        self.assertIn('RedirectMatch 503 "^/metamap-platform(?:/|$)"', config)
        self.assertNotIn("ProxyPass ", config)
        self.assertNotIn("/etc/apache2/ports.conf", config)
        health = json.loads(render("health.json.j2", values()))
        self.assertEqual(health["scope"], "https-transport-only")
        self.assertFalse(health["application_ready"])
        self.assertFalse(health["production_cutover"])

    def test_unit_is_independent_and_cannot_reload_the_foundation_service(self):
        unit = render("metamap-origin.service.j2", values())
        self.assertIn("-f /etc/redunisol-metamap-origin/apache.conf -DFOREGROUND", unit)
        self.assertIn("RuntimeDirectory=metamap-origin", unit)
        self.assertNotIn("apache2ctl", unit)
        self.assertNotIn("systemctl reload apache2", unit)

    def test_lost_restart_is_recovered_even_when_files_are_unchanged(self):
        tasks = read_yaml("roles/metamap_origin/tasks/main.yml")
        block = next(item["block"] for item in tasks if item["name"].startswith("Prepare only"))
        state = next(item["ansible.builtin.systemd_service"]["state"] for item in block
                     if item["name"].startswith("Reconcile only"))
        variables = values()
        variables.update(metamap_origin_configuration={"changed": False}, metamap_origin_unit={"changed": False},
                         metamap_origin_tls_installation={"changed": False},
                         metamap_origin_loaded_probe={"rc": 0, "stdout_lines": ["200"],
                                                      "stdout": "X-Redunisol-Origin-Config: old\n200"})
        self.assertEqual(environment().from_string(state).render(**variables).strip(), "restarted")
        variables["metamap_origin_loaded_probe"]["stdout"] = "X-Redunisol-Origin-Config: " + MARKER + "\n200"
        self.assertEqual(environment().from_string(state).render(**variables).strip(), "started")

    def test_static_metrics_never_claim_live_application_or_origin_health(self):
        metrics = render("origin.prom.j2", values())
        self.assertIn("metamap_origin_tls_not_after_timestamp_seconds 2000000000", metrics)
        self.assertIn("metamap_origin_backend_enabled 0", metrics)
        self.assertIn('certificate_sha256="' + "3" * 64 + '"', metrics)
        self.assertNotIn("metamap_origin_up", metrics)
        self.assertNotIn("application_ready 1", metrics)


@unittest.skipUnless(shutil.which("ansible-playbook"), "Linux Ansible controller required")
class ExecutableOriginContractTests(unittest.TestCase):
    def run_tasks(self, tasks=None, overrides=None, check=False, role=False):
        variables = values()
        variables.update(overrides or {})
        play = dict(name="Original origin contracts on localhost only", hosts="localhost", connection="local",
                    gather_facts=False, become=False, vars=variables)
        play["roles" if role else "tasks"] = ["metamap_origin"] if role else tasks
        with tempfile.TemporaryDirectory(prefix="origin-contract-") as directory:
            path = Path(directory)
            playbook = path / "test.yml"
            playbook.write_text(yaml.safe_dump([play], sort_keys=False), encoding="utf-8")
            env = dict(os.environ, ANSIBLE_CONFIG=str(ROOT / "ansible.cfg"),
                       ANSIBLE_ROLES_PATH=str(ROOT / "roles"), ANSIBLE_LOCAL_TEMP=str(path / "ansible-tmp"),
                       ANSIBLE_NOCOLOR="1")
            command = ["ansible-playbook", "-i", "localhost,", "-c", "local", str(playbook)]
            if check:
                command.append("--check")
            result = subprocess.run(command, cwd=directory, env=env, capture_output=True,
                                    text=True, timeout=45, check=False)
        return result.returncode, result.stdout + result.stderr

    def assert_rejected(self, overrides, tasks=None):
        code, output = self.run_tasks(tasks or read_yaml("roles/metamap_origin/tasks/contract.yml"), overrides)
        self.assertNotEqual(code, 0, output)
        self.assertIn('"evaluated_to": false', output)

    def test_default_contract_is_accepted(self):
        code, output = self.run_tasks(read_yaml("roles/metamap_origin/tasks/contract.yml"))
        self.assertEqual(code, 0, output)

    def test_backend_enablement_is_rejected_even_with_write_approval(self):
        self.assert_rejected(dict(metamap_origin_enabled=True, metamap_origin_apply_authorized=True,
                                  metamap_origin_backend_enabled=True))

    def test_public_listener_without_its_own_approval_is_rejected(self):
        self.assert_rejected(dict(metamap_origin_listen_address="0.0.0.0", metamap_origin_listen_port=443))

    def test_only_assigned_or_explicit_wildcard_public_binding_is_accepted(self):
        contract = read_yaml("roles/metamap_origin/tasks/contract.yml")
        for address in ("192.0.2.10", "0.0.0.0"):
            code, output = self.run_tasks(contract, dict(metamap_origin_listen_address=address,
                                                       metamap_origin_listen_port=443,
                                                       metamap_origin_public_listen_authorized=True))
            self.assertEqual(code, 0, output)
        self.assert_rejected(dict(metamap_origin_listen_address="192.0.2.11", metamap_origin_listen_port=443,
                                  metamap_origin_public_listen_authorized=True))

    def test_active_apply_without_separate_authorization_is_rejected(self):
        guard = named_task("roles/metamap_origin/tasks/main.yml",
                           "Require origin authorization and immutable inputs before applying")
        self.assert_rejected(dict(metamap_origin_enabled=True), tasks=[guard])

    def test_check_mode_with_pending_tls_never_reaches_origin_mutations(self):
        code, output = self.run_tasks(overrides=dict(metamap_origin_enabled=True), check=True, role=True)
        self.assertEqual(code, 0, output)
        self.assertIn("changed=0", output)

    def foundation_tasks(self):
        names = ["Require a live foundation Apache main process",
                 "Select sockets owned by the foundation Apache main process",
                 "Verify Apache is actually listening only on the private address"]
        return [named_task("roles/proxy/tasks/verify.yml", name) for name in names]

    def test_foundation_ignores_only_sockets_belonging_to_another_apache_unit(self):
        code, output = self.run_tasks(self.foundation_tasks(), dict(
            foundation_proxy_main_pid={"stdout": "123"}, foundation_proxy_sockets={"stdout_lines": [
                'LISTEN 0 511 127.0.0.1:8088 0.0.0.0:* users:(("apache2",pid=123,fd=4))',
                'LISTEN 0 511 127.0.0.1:8088 0.0.0.0:* users:(("apache2",pid=123,fd=5))',
                'LISTEN 0 511 0.0.0.0:443 0.0.0.0:* users:(("apache2",pid=456,fd=4))']}))
        self.assertEqual(code, 0, output)

    def test_foundation_still_rejects_a_public_socket_of_its_own_main_process(self):
        self.assert_rejected(dict(foundation_proxy_main_pid={"stdout": "123"},
                                  foundation_proxy_sockets={"stdout_lines": [
                                      'LISTEN 0 511 0.0.0.0:443 0.0.0.0:* users:(("apache2",pid=123,fd=4))']}),
                             tasks=self.foundation_tasks())

    def test_foundation_cannot_be_satisfied_by_zero_or_missing_pid(self):
        for pid in ("0", "123"):
            self.assert_rejected(dict(foundation_proxy_main_pid={"stdout": pid},
                                      foundation_proxy_sockets={"stdout_lines": [
                                          'LISTEN 0 511 127.0.0.1:8088 0.0.0.0:* users:(("apache2",pid=456,fd=4))']}),
                                 tasks=self.foundation_tasks())


APACHE = os.environ.get("METAMAP_TEST_APACHE_BINARY") or shutil.which("apache2")
MODULES = os.environ.get("METAMAP_TEST_APACHE_MODULE_DIR", "/usr/lib/apache2/modules")


@unittest.skipUnless(APACHE and shutil.which("openssl") and Path(MODULES, "mod_ssl.so").is_file(),
                     "Apache with SSL/proxy modules is required for isolated HTTPS fixtures")
class IsolatedHttpsOriginTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="metamap-origin-http-")
        cls.root = Path(cls.temporary.name)
        cls.root.chmod(0o755)
        cls.received = []
        cls.processes = []
        cls.log_streams = []

        class Backend(BaseHTTPRequestHandler):
            def log_message(self, unused_format, *unused_arguments):
                pass

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                cls.received.append((self.command, self.path, dict(self.headers), body))
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                cls.received.append((self.command, self.path, dict(self.headers), b""))
                payload = b"0123456789abcdef"
                if self.headers.get("Range") == "bytes=2-5":
                    self.send_response(206)
                    self.send_header("Content-Range", "bytes 2-5/16")
                    payload = payload[2:6]
                else:
                    self.send_response(200)
                self.send_header("Cache-Control", "public, max-age=31536000, immutable")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        cls.backend = HTTPServer(("127.0.0.1", 0), Backend)
        cls.backend_thread = Thread(target=cls.backend.serve_forever, daemon=True)
        cls.backend_thread.start()
        certificate, key = cls.root / "certificate.pem", cls.root / "private-key.pem"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                        "-subj", "/CN=" + HOSTNAME, "-addext", "subjectAltName=DNS:" + HOSTNAME,
                        "-keyout", str(key), "-out", str(certificate)],
                       check=True, capture_output=True, timeout=30)
        key.chmod(0o600)
        cls.context = ssl.create_default_context(cafile=str(certificate))
        cls.ports = {}
        try:
            for enabled in (False, True):
                fixture = cls.root / ("proxy" if enabled else "closed")
                fixture.mkdir(mode=0o755)
                fixture.chmod(0o755)
                for name in ("tls", "www", "runtime", "logs"):
                    (fixture / name).mkdir(mode=0o755)
                    (fixture / name).chmod(0o755)
                shutil.copyfile(certificate, fixture / "tls/certificate.pem")
                shutil.copyfile(key, fixture / "tls/private-key.pem")
                (fixture / "tls/private-key.pem").chmod(0o600)
                with socket.socket() as probe:
                    probe.bind(("127.0.0.1", 0))
                    port = probe.getsockname()[1]
                variables = values()
                variables.update(metamap_origin_backend_enabled=enabled, metamap_origin_listen_port=port,
                                 metamap_origin_backend_port=cls.backend.server_port,
                                 metamap_origin_config_dir=str(fixture), metamap_origin_module_dir=MODULES,
                                 metamap_origin_document_root=str(fixture / "www"),
                                 metamap_origin_runtime_dir=str(fixture / "runtime"),
                                 metamap_origin_log_dir=str(fixture / "logs"))
                config = render("apache.conf.j2", variables)
                import grp
                import pwd
                # The disposable controller fixture must not require Debian accounts.
                # A root Apache parent still drops worker privileges to an existing user.
                account = pwd.getpwnam("nobody") if os.geteuid() == 0 else pwd.getpwuid(os.geteuid())
                group_id = account.pw_gid if os.geteuid() == 0 else os.getegid()
                config = config.replace("User www-data\n", "User " + account.pw_name + "\n")
                config = config.replace("Group www-data\n", "Group " + grp.getgrgid(group_id).gr_name + "\n")
                (fixture / "www/health.json").write_text(render("health.json.j2", variables), encoding="utf-8")
                (fixture / "www/health.json").chmod(0o644)
                config_path = fixture / "apache.conf"
                config_path.write_text(config, encoding="utf-8")
                env = os.environ.copy()
                if os.environ.get("METAMAP_TEST_APACHE_LIBRARY_PATH"):
                    env["LD_LIBRARY_PATH"] = os.environ["METAMAP_TEST_APACHE_LIBRARY_PATH"]
                builtins = subprocess.run([APACHE, "-l"], env=env, capture_output=True, text=True,
                                          timeout=10, check=True).stdout
                extra_modules = []
                for name in ("unixd", "log_config", "watchdog"):
                    module = Path(MODULES) / ("mod_" + name + ".so")
                    if module.is_file() and ("mod_" + name + ".c") not in builtins:
                        extra_modules.append("LoadModule " + name + "_module " + str(module))
                if extra_modules:
                    config_path.write_text("\n".join(extra_modules) + "\n" + config, encoding="utf-8")
                validation = subprocess.run([APACHE, "-t", "-f", str(config_path)], env=env,
                                            capture_output=True, text=True, timeout=15)
                if validation.returncode:
                    raise AssertionError(validation.stdout + validation.stderr)
                log = (fixture / "process.log").open("wb")
                cls.log_streams.append(log)
                process = subprocess.Popen([APACHE, "-f", str(config_path), "-DFOREGROUND"],
                                           env=env, stdout=log, stderr=log, start_new_session=True)
                cls.processes.append(process)
                cls.ports[enabled] = port
                for unused in range(80):
                    if process.poll() is not None:
                        raise AssertionError((fixture / "process.log").read_text())
                    try:
                        status, unused_headers, unused_body = cls.request(False, "GET", "/health", port=port)
                        if status == 200:
                            break
                    except OSError:
                        pass
                    time.sleep(0.05)
                else:
                    raise AssertionError("Isolated Apache did not become ready")
        except Exception:
            cls.tearDownClass()
            raise

    @classmethod
    def request(cls, proxy, method, path, body=None, headers=None, port=None):
        connection = HTTPSConnection(HOSTNAME, port or cls.ports[proxy], context=cls.context, timeout=5)
        connection._create_connection = lambda *args, **kwargs: socket.create_connection(
            ("127.0.0.1", port or cls.ports[proxy]), timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    @classmethod
    def tearDownClass(cls):
        for process in cls.processes:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        for stream in cls.log_streams:
            stream.close()
        cls.backend.shutdown()
        cls.backend.server_close()
        cls.temporary.cleanup()

    def test_verified_tls_transport_health_and_fail_closed_routes_without_redirects(self):
        status, headers, body = self.request(False, "GET", "/health")
        self.assertEqual(status, 200)
        self.assertNotIn("Location", headers)
        self.assertFalse(json.loads(body)["application_ready"])
        before = len(self.received)
        for method in ("GET", "POST", "HEAD"):
            for path in ("/metamap-platform", "/metamap-platform/health",
                         "/metamap-platform/updates/transferencias/latest.json"):
                status, headers, unused_body = self.request(False, method, path)
                self.assertEqual(status, 503)
                self.assertNotIn("Location", headers)
        self.assertEqual(len(self.received), before)

    def test_proxy_fixture_preserves_method_binary_body_and_signature_headers(self):
        body = b'{"fixture":"raw"}\r\n\x00\xff'
        path = "/metamap-platform/api/v1/metamap/webhooks?fixture=1"
        status, headers, response = self.request(True, "POST", path, body=body,
                                                headers={"Content-Type": "application/octet-stream",
                                                         "X-Signature": "fixture-signature",
                                                         "Authorization": "Bearer fixture"})
        self.assertEqual(status, 200)
        self.assertNotIn("Location", headers)
        self.assertEqual(response, body)
        method, received_path, received_headers, received_body = self.received[-1]
        self.assertEqual((method, received_path, received_body),
                         ("POST", "/api/v1/metamap/webhooks?fixture=1", body))
        self.assertEqual(received_headers["X-Signature"], "fixture-signature")
        self.assertEqual(received_headers["Authorization"], "Bearer fixture")

    def test_proxy_fixture_preserves_range_cache_control_and_raw_encoded_path(self):
        status, headers, body = self.request(True, "GET",
                                             "/metamap-platform/updates/transferencias/1.2.3/transferencias-celesol.exe",
                                             headers={"Range": "bytes=2-5"})
        self.assertEqual((status, body), (206, b"2345"))
        self.assertEqual(headers["Content-Range"], "bytes 2-5/16")
        self.assertEqual(headers["Cache-Control"], "public, max-age=31536000, immutable")
        self.request(True, "GET", "/metamap-platform/api/fixture/a%2Fb?x=hello%2Bworld")
        self.assertEqual(self.received[-1][1], "/api/fixture/a%2Fb?x=hello%2Bworld")


if __name__ == "__main__":
    unittest.main()
