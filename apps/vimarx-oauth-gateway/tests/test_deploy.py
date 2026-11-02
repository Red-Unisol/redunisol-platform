import importlib.util
import json
import os
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest
import yaml

DEPLOY = Path(__file__).resolve().parents[1] / "deploy"
REVISION = "a" * 40
INTERNAL_ENV = (
    "APP_IMAGE=old-internal-image\n"
    "GATEWAY_ISSUER=https://mcp.redunisol.com.ar\n"
    "GATEWAY_SECRET_KEY=keep-internal-secret\n"
    "TOKEN_ENCRYPTION_KEY=keep-internal-key\n"
    "DEMO_ENABLED='1'\nDEMO_PASSWORD_HASH='scrypt:test$hash$value'\n"
    "DEMO_TOKEN_KEY=keep-internal-demo-key\n"
)


def load_script(name):
    spec = importlib.util.spec_from_file_location("vimarx_" + name + "_test", DEPLOY / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def installer(tmp_path, monkeypatch, existing_directory=False):
    module = load_script("install")
    root = tmp_path / "gateway"
    (root / "deploy").mkdir(parents=True)
    for name in ("apache-http.conf", "apache-mcp.conf") + module.UNITS:
        (root / "deploy" / name).write_bytes((DEPLOY / name).read_bytes())
    frontend, vhost, systemd = tmp_path / "kestra.conf", tmp_path / "mcp.conf", tmp_path / "systemd"
    systemd.mkdir()
    frontend.write_text("Existing Kestra settings\n" + module.LEGACY_INCLUDE)
    vhost.write_text("ServerName mcp.redunisol.com.ar\n# Previous MCP vhost\n")
    (root / ".env").write_text(INTERNAL_ENV)
    monkeypatch.setattr(module, "ROOT", root)
    monkeypatch.setattr(module, "FRONTEND", frontend)
    monkeypatch.setattr(module, "VHOST", vhost)
    monkeypatch.setattr(module, "SYSTEMD", systemd)
    monkeypatch.setattr(module, "__file__", str(root / "deploy/install.py"))
    monkeypatch.setattr("sys.argv", ["install.py", "--revision", REVISION])
    running = {"internal"}
    if existing_directory:
        running.add("directory")
        environment = module.desired_environment(module.PROFILES[1], None, "old-directory-image",
                                                 module.values(INTERNAL_ENV))
        (root / ".env.directory").write_text(environment)
    monkeypatch.setattr(module, "is_running", lambda profile: profile["name"] in running)
    commands, events, ready = [], [], []
    def run(*args):
        commands.append(args)
        events.append(("run", args))
    monkeypatch.setattr(module, "run", run)
    monkeypatch.setattr(module, "wait_ready", lambda profile, revision: ready.append((profile["name"], revision)))
    monkeypatch.setattr(module, "verify_runtime", lambda profile, desired, image: events.append(("verify", profile["name"])))
    import sys
    snapshots = []
    def snapshot(revision, profile="internal"):
        snapshots.append((revision, profile))
        events.append(("backup", profile))
    monkeypatch.setitem(sys.modules, "backup", SimpleNamespace(snapshot=snapshot))
    return module, root, frontend, vhost, commands, events, ready, snapshots


def test_dual_deploy_keeps_internal_environment_and_creates_isolated_directory(tmp_path, monkeypatch):
    module, root, frontend, vhost, commands, events, ready, snapshots = installer(tmp_path, monkeypatch)
    module.main()
    before = module.values(INTERNAL_ENV)
    internal = module.values((root / ".env").read_text())
    directory = module.values((root / ".env.directory").read_text())
    assert {k: v for k, v in internal.items() if k != "APP_IMAGE"} == {
        k: v for k, v in before.items() if k != "APP_IMAGE"}
    assert (root / ".env.previous").read_text() == INTERNAL_ENV
    assert directory["GATEWAY_PROFILE"] == "directory"
    assert directory["GATEWAY_ISSUER"] == "https://mcp.redunisol.com.ar/directorio"
    assert directory["GATEWAY_PORT"] == "3061"
    assert directory["GATEWAY_ENV_FILE"] == "../.env.directory"
    assert directory["DEMO_ENABLED"] == "1"
    assert directory["DEMO_PASSWORD_HASH"] == before["DEMO_PASSWORD_HASH"]
    assert internal["APP_IMAGE"] == directory["APP_IMAGE"] == "redunisol/vimarx-oauth-gateway:" + REVISION
    keys = [environment[key] for environment in (internal, directory) for key in module.KEYS]
    assert len(set(keys)) == 6
    assert snapshots == [(REVISION, "internal")]
    assert events[0] == ("backup", "internal")
    assert ready == [("internal", REVISION), ("directory", REVISION)]
    assert ("verify", "internal") in events and ("verify", "directory") in events
    for profile in module.PROFILES:
        own = [command for command in commands if command[:4] == ("docker", "compose", "-p", profile["project"])]
        assert any("up" in command for command in own)
        assert any(command[-1] == "cleanup" for command in own)
        assert all(str(root / profile["env"]) in command for command in own)
    assert frontend.read_text() == "Existing Kestra settings\n"
    assert 'ProxyPass "/directorio/" "http://127.0.0.1:3061/directorio/"' in vhost.read_text()
    assert not any("prune" in command or "-v" in command for command in commands)


def test_upgrade_backs_up_both_profiles_and_preserves_existing_directory_keys(tmp_path, monkeypatch):
    module, root, _, _, _, _, _, snapshots = installer(tmp_path, monkeypatch, existing_directory=True)
    previous = module.values((root / ".env.directory").read_text())
    module.main()
    updated = module.values((root / ".env.directory").read_text())
    assert {k: v for k, v in updated.items() if k != "APP_IMAGE"} == {
        k: v for k, v in previous.items() if k != "APP_IMAGE"}
    assert snapshots == [(REVISION, "internal"), (REVISION, "directory")]


def test_directory_readiness_failure_restores_internal_and_retains_new_volume_keys(tmp_path, monkeypatch):
    module, root, frontend, vhost, commands, _, _, _ = installer(tmp_path, monkeypatch)
    original_frontend, original_vhost = frontend.read_text(), vhost.read_text()
    def ready(profile, revision):
        if profile["name"] == "directory":
            raise RuntimeError("Directory not ready")
    monkeypatch.setattr(module, "wait_ready", ready)
    with pytest.raises(RuntimeError, match="Directory not ready"):
        module.main()
    assert (root / ".env").read_text() == INTERNAL_ENV
    assert frontend.read_text() == original_frontend and vhost.read_text() == original_vhost
    directory = (root / ".env.directory").read_text()
    assert module.desired_environment(module.PROFILES[1], directory,
                                      module.values(directory)["APP_IMAGE"]) == directory
    assert any(command[:4] == ("docker", "compose", "-p", "vimarx-oauth-directory") and command[-1] == "down"
               for command in commands)
    assert not any("-v" in command or "prune" in command for command in commands)


def test_apache_failure_rolls_back_both_existing_profile_images_and_environments(tmp_path, monkeypatch):
    module, root, frontend, vhost, commands, _, _, _ = installer(tmp_path, monkeypatch, existing_directory=True)
    previous_directory = (root / ".env.directory").read_text()
    previous_vhost, previous_frontend = vhost.read_text(), frontend.read_text()
    checks = []
    def run(*args):
        commands.append(args)
        if args == ("/opt/apache/bin/apachectl", "-t"):
            checks.append(1)
            if len(checks) == 2:
                raise RuntimeError("Invalid dual HTTPS publication")
    monkeypatch.setattr(module, "run", run)
    with pytest.raises(RuntimeError, match="Invalid dual HTTPS"):
        module.main()
    assert (root / ".env").read_text() == INTERNAL_ENV
    assert (root / ".env.directory").read_text() == previous_directory
    assert frontend.read_text() == previous_frontend and vhost.read_text() == previous_vhost
    assert len([command for command in commands if "up" in command]) == 4


def test_shared_profile_key_is_rejected_before_build_or_runtime_changes(tmp_path, monkeypatch):
    module, root, _, _, commands, _, _, snapshots = installer(tmp_path, monkeypatch, existing_directory=True)
    path = root / ".env.directory"
    text = path.read_text()
    key = module.values(text)["TOKEN_ENCRYPTION_KEY"]
    path.write_text(text.replace(key, module.values(INTERNAL_ENV)["TOKEN_ENCRYPTION_KEY"]))
    before = path.read_text()
    with pytest.raises(ValueError, match="independent"):
        module.main()
    assert not commands and not snapshots
    assert path.read_text() == before and (root / ".env").read_text() == INTERNAL_ENV


def test_wrong_directory_port_is_rejected_before_runtime_changes(tmp_path, monkeypatch):
    module, root, _, _, commands, _, _, _ = installer(tmp_path, monkeypatch, existing_directory=True)
    path = root / ".env.directory"
    path.write_text(path.read_text().replace("GATEWAY_PORT=3061", "GATEWAY_PORT=3060"))
    with pytest.raises(ValueError, match="dedicated issuer"):
        module.main()
    assert not commands


def test_each_profile_readiness_requires_its_own_path_and_exact_revision(monkeypatch):
    module = load_script("install")
    urls = []
    monkeypatch.setattr(module.time, "sleep", lambda seconds: None)
    def check(command, **kwargs):
        urls.append(command[-1])
        body = {"status": "ok", "revision": REVISION}
        if len(urls) == 1:
            body["revision"] = "old"
        return subprocess.CompletedProcess(command, 0, json.dumps(body).encode(), b"")
    monkeypatch.setattr(module.subprocess, "run", check)
    module.wait_ready(module.PROFILES[1], REVISION)
    module.wait_ready(module.PROFILES[0], REVISION)
    assert urls == ["http://127.0.0.1:3061/directorio/health"] * 2 + ["http://127.0.0.1:3060/health"]


def test_apache_keeps_directory_discovery_and_requests_ahead_of_internal_catchall():
    text = (DEPLOY / "apache-mcp.conf").read_text()
    catchall = text.index('ProxyPass "/" "http://127.0.0.1:3060/"')
    for path in ("/directorio/", "/.well-known/oauth-authorization-server/directorio",
                 "/.well-known/oauth-protected-resource/directorio/mcp"):
        directive = next(line for line in text.splitlines() if line.startswith('    ProxyPass "' + path + '"'))
        assert '"http://127.0.0.1:3061' + path + '"' in directive
        assert text.index(directive) < catchall
    assert 'Alias "/demo/" "/opt/vimarx-oauth-gateway/public-demo/"' in text
    assert text.count('CustomLog "/dev/null" combined') == 2
    assert "ProxyPreserveHost On" in text and 'RequestHeader unset X-Forwarded-For' in text
    assert "SSLProtocol all -SSLv3 -TLSv1 -TLSv1.1" in text


def test_compose_defaults_keep_original_project_volume_port_and_environment():
    document = yaml.safe_load((DEPLOY / "docker-compose.yml").read_text())
    gateway = document["services"]["gateway"]
    variable = "$"
    assert gateway["ports"] == ["127.0.0.1:" + variable + "{GATEWAY_PORT:-3060}:8000"]
    assert gateway["env_file"] == variable + "{GATEWAY_ENV_FILE:-../.env}"
    assert "environment" not in gateway  # Profile is read only from its own env_file.
    assert gateway["volumes"] == ["gateway_data:/data"]
    assert not document["volumes"]["gateway_data"]  # No globally shared volume name.


def test_profile_snapshots_use_separate_containers_and_private_backup_folders(tmp_path, monkeypatch):
    module = load_script("backup")
    monkeypatch.setattr(module, "ROOT", tmp_path)
    calls = []
    def run(command, **kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command, 0, b"SQLite format 3\0fixture", b"")
    monkeypatch.setattr(module.subprocess, "run", run)
    internal = module.snapshot(REVISION)
    directory = module.snapshot(REVISION, profile="directory")
    assert internal.parent == tmp_path / "backups"
    assert directory.parent == tmp_path / "backups/directory"
    assert [command[2] for command in calls] == ["vimarx-oauth-gateway-gateway-1", "vimarx-oauth-directory-gateway-1"]
    assert internal.read_bytes().startswith(b"SQLite format 3") and directory.read_bytes() == internal.read_bytes()
    with pytest.raises(ValueError, match="Unknown gateway profile"):
        module.snapshot(REVISION, profile="../internal")


def test_backup_prunes_only_owned_old_snapshots(tmp_path):
    import time
    module = load_script("backup")
    old, fresh, unrelated = (tmp_path / name for name in
                             ("gateway-100-aaaaaaaaaaaa.db", "gateway-200-bbbbbbbbbbbb.db", "gateway-user-data.db"))
    for path in (old, fresh, unrelated):
        path.write_bytes(b"example")
    os.utime(old, (time.time() - 8 * 86400,) * 2)
    os.utime(unrelated, (time.time() - 8 * 86400,) * 2)
    module.prune(tmp_path)
    assert not old.exists() and fresh.exists() and unrelated.exists()


def test_cleanup_uses_each_profile_environment_and_continues_after_one_failure(tmp_path, monkeypatch):
    module = load_script("cleanup")
    monkeypatch.setattr(module, "ROOT", tmp_path)
    for filename in (".env", ".env.directory"):
        (tmp_path / filename).write_text("fixture")
    calls = []
    monkeypatch.setenv("GATEWAY_ENV_FILE", "../.env")
    monkeypatch.setenv("GATEWAY_PORT", "3060")
    def run(command, **kwargs):
        assert "GATEWAY_ENV_FILE" not in kwargs["env"] and "GATEWAY_PORT" not in kwargs["env"]
        calls.append(command)
        return SimpleNamespace(returncode=1 if len(calls) == 1 else 0)
    monkeypatch.setattr(module.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="vimarx-oauth-gateway"):
        module.cleanup()
    assert len(calls) == 2
    for (project, filename), command in zip(module.PROFILES, calls):
        assert command[command.index("-p") + 1] == project
        assert command[command.index("--env-file") + 1] == str(tmp_path / filename)
        assert command[-1] == "cleanup"


def test_unready_directory_contract_aborts_before_environment_or_container_changes(tmp_path, monkeypatch):
    module, root, frontend, vhost, commands, _, _, _ = installer(tmp_path, monkeypatch)
    previous_vhost, previous_frontend = vhost.read_text(), frontend.read_text()
    def run(*args):
        commands.append(args)
        if args[:2] == ("docker", "run"):
            assert "--network" in args and "none" in args and "production_ready" in args[-1]
            raise RuntimeError("Unready directory contract")
    monkeypatch.setattr(module, "run", run)
    with pytest.raises(RuntimeError, match="Unready directory contract"):
        module.main()
    assert (root / ".env").read_text() == INTERNAL_ENV
    assert not (root / ".env.directory").exists()
    assert vhost.read_text() == previous_vhost and frontend.read_text() == previous_frontend
    assert not any("up" in command for command in commands)


def test_compose_cannot_inherit_another_profile_from_the_operator_shell(monkeypatch):
    module = load_script("install")
    for key in module.COMPOSE_VARIABLES:
        monkeypatch.setenv(key, "wrong-profile")
    called = []
    def run(command, **kwargs):
        called.append(command)
        assert all(key not in kwargs["env"] for key in module.COMPOSE_VARIABLES)
    monkeypatch.setattr(module.subprocess, "run", run)
    module.run("docker", "compose", "-p", "vimarx-oauth-directory", "config", "-q")
    assert len(called) == 1


@pytest.mark.parametrize("broken", [None, "key", "profile", "port", "volume", "issuer", "origin"])
def test_runtime_isolation_accepts_only_the_expected_profile_state(monkeypatch, broken):
    module = load_script("install")
    profile = module.PROFILES[1]
    image = "redunisol/vimarx-oauth-gateway:" + REVISION
    desired = module.desired_environment(profile, None, image, module.values(INTERNAL_ENV))
    environment = module.values(desired)
    info = {"Config": {"Image": image, "Env": []}, "State": {"Running": True},
            "HostConfig": {"PortBindings": {"8000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3061"}]}},
            "Mounts": [{"Destination": "/data", "Type": "volume", "Name": "vimarx-oauth-directory_gateway_data"}]}
    if broken == "key": environment["TOKEN_ENCRYPTION_KEY"] = "other-key"
    if broken == "profile": environment["GATEWAY_PROFILE"] = "internal"
    if broken == "port": info["HostConfig"]["PortBindings"]["8000/tcp"][0]["HostIp"] = "0.0.0.0"
    if broken == "volume": info["Mounts"][0]["Name"] = "vimarx-oauth-gateway_gateway_data"
    if broken == "issuer": environment["GATEWAY_ISSUER"] = module.ISSUER
    if broken == "origin": environment["VIMARX_ORIGIN"] = "https://another-mutual.invalid"
    info["Config"]["Env"] = [key + "=" + value for key, value in environment.items()]
    monkeypatch.setattr(module.subprocess, "run", lambda *args, **kwargs:
                        subprocess.CompletedProcess(args, 0, json.dumps([info]).encode(), b""))
    if broken is None:
        module.verify_runtime(profile, desired, image)
    else:
        with pytest.raises(RuntimeError, match="runtime isolation"):
            module.verify_runtime(profile, desired, image)
