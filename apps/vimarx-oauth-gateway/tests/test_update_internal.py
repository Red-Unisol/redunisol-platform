"""Internal-only updates preserve directory identity and roll back one profile."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

DEPLOY = Path(__file__).resolve().parents[1] / "deploy"
OLD = "0" * 40
NEW = "a" * 40


@pytest.fixture
def updater(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(DEPLOY))
    spec = importlib.util.spec_from_file_location("internal_updater_test", DEPLOY / "update_internal.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    root = tmp_path / "gateway"
    (root / "deploy").mkdir(parents=True)
    monkeypatch.setattr(module.install, "ROOT", root)
    monkeypatch.setattr(module, "require_location", lambda: None)
    modes, commands, events, runtimes = {}, [], [], {}
    controls = {"failure": None, "ready_failed": False}
    for profile in module.install.PROFILES:
        name = profile["name"]
        text = ("# Preserve exact operational lines\n"
                "APP_IMAGE=redunisol/vimarx-oauth-gateway:" + OLD + "\n"
                "GATEWAY_PROFILE=" + name + "\n"
                "GATEWAY_ISSUER=" + profile["issuer"] + "\n"
                "VIMARX_ORIGIN=https://celesol.dyndns.org:35010\n"
                "DATABASE_URL=sqlite:////data/gateway.db\n"
                "GATEWAY_SECRET_KEY=" + name + "-signing\n"
                "TOKEN_ENCRYPTION_KEY=" + name + "-encryption\n"
                "DEMO_ENABLED=1\nDEMO_PASSWORD_HASH='synthetic$hash$value'\n"
                "DEMO_TOKEN_KEY=" + name + "-demo\n")
        if name == "directory":
            text += "GATEWAY_ENV_FILE=../.env.directory\nGATEWAY_PORT=3061\n"
        path = root / profile["env"]
        path.write_bytes(text.encode())
        modes[path] = 0o600
        settings = module.install.values(text)
        runtimes[name] = dict(
            Id=name + "-original-container", Image="sha256:old-image", State={"Running": True},
            Config=dict(Image=settings["APP_IMAGE"], Env=[k + "=" + v for k, v in settings.items()] + ["GIT_SHA=" + OLD],
                        Labels={"com.docker.compose.project": profile["project"]}),
            HostConfig=dict(ReadonlyRootfs=True, PortBindings={"8000/tcp": [{"HostIp": "127.0.0.1", "HostPort": str(profile["port"])}]}),
            Mounts=[dict(Type="volume", Name=profile["project"] + "_gateway_data", Destination="/data", RW=True)])
    for folder in (root / "public-demo", root / "public-demo/directorio"):
        folder.mkdir(exist_ok=True)
        for name in ("index.html", "style.css", "old.mp4"):
            path = folder / name
            path.write_bytes((str(folder.name) + ":" + name).encode())
            modes[path] = 0o644
    original_directory = deepcopy(runtimes["directory"])
    original_env = (root / ".env").read_bytes()
    original_directory_env = (root / ".env.directory").read_bytes()
    original_media = {str(p.relative_to(root)): p.read_bytes() for p in (root / "public-demo").rglob("*") if p.is_file()}
    monkeypatch.setattr(module, "mode", lambda path: modes.get(path, 0o600))
    monkeypatch.setattr(module, "inspect", lambda profile: deepcopy(runtimes[profile["name"]]) if runtimes[profile["name"]]["State"]["Running"] else (_ for _ in ()).throw(RuntimeError("Both existing gateway profiles must be running")))

    def fake_subprocess(args, **kwargs):
        assert args[:2] == ["docker", "inspect"]
        name = "directory" if "directory" in args[2] else "internal"
        return SimpleNamespace(returncode=0, stdout=json.dumps([runtimes[name]]).encode(), stderr=b"")

    monkeypatch.setattr(module.subprocess, "run", fake_subprocess)

    def write_private(path, text):
        events.append(("write", path.name))
        path.write_bytes(text.encode("utf-8"))
        modes[path] = 0o600

    monkeypatch.setattr(module.install, "write_private", write_private)

    def run(*args):
        commands.append(args)
        if args[:2] == ("docker", "build"):
            events.append(("build",))
            if controls["failure"] == "build":
                raise RuntimeError("build failed")
            return
        assert args[:4] == ("docker", "compose", "-p", "vimarx-oauth-gateway")
        assert "vimarx-oauth-directory" not in args
        if "config" in args:
            if controls["failure"] == "config":
                raise RuntimeError("config failed")
            return
        assert args[-7:] == ("up", "-d", "--no-build", "--pull", "never", "--no-deps", "gateway")
        settings = module.install.values((root / ".env").read_text())
        revision = settings["APP_IMAGE"].rsplit(":", 1)[-1]
        info = runtimes["internal"]
        info["Config"]["Image"] = settings["APP_IMAGE"]
        info["Config"]["Env"] = [k + "=" + v for k, v in settings.items()] + ["GIT_SHA=" + revision]
        info["Id"] = "internal-" + revision
        info["Image"] = "sha256:" + revision
        if revision == NEW and controls["failure"] == "directory_changed":
            runtimes["directory"]["Id"] = "externally-changed-directory"
        if revision == NEW and controls["failure"] == "mount_changed":
            info["Mounts"][0]["Name"] = "wrong-volume"
        elif revision == OLD:
            info["Mounts"][0]["Name"] = "vimarx-oauth-gateway_gateway_data"

    monkeypatch.setattr(module.install, "run", run)

    def ready(profile, revision):
        events.append(("ready", profile["name"], revision))
        assert profile["name"] == "internal"
        if revision == NEW and controls["failure"] == "ready":
            raise RuntimeError("new revision failed readiness")

    monkeypatch.setattr(module.install, "wait_ready", ready)

    def snapshot(revision, profile="internal"):
        assert profile == "internal"
        events.append(("backup", profile))
        backup = root / "internal-backup.db"
        backup.write_bytes(b"private-sqlite-backup")
        modes[backup] = 0o644 if controls["failure"] == "backup_mode" else 0o600
        return backup

    monkeypatch.setitem(__import__("sys").modules, "backup", SimpleNamespace(snapshot=snapshot))
    return SimpleNamespace(module=module, root=root, modes=modes, commands=commands, events=events,
                           controls=controls, runtimes=runtimes, original_env=original_env,
                           original_directory=original_directory, original_directory_env=original_directory_env,
                           original_media=original_media)


def assert_directory_and_media_unchanged(state):
    assert state.runtimes["directory"] == state.original_directory
    assert (state.root / ".env.directory").read_bytes() == state.original_directory_env
    assert {str(p.relative_to(state.root)): p.read_bytes() for p in (state.root / "public-demo").rglob("*") if p.is_file()} == state.original_media


def test_update_changes_only_internal_image_and_preserves_other_operational_state(updater):
    state = updater
    answer = state.module.update(NEW)
    expected = state.original_env.replace((":" + OLD).encode(), (":" + NEW).encode(), 1)
    assert (state.root / ".env").read_bytes() == expected
    assert state.events[:3] == [("build",), ("backup", "internal"), ("write", ".env")]
    assert state.runtimes["internal"]["Mounts"][0]["Name"] == "vimarx-oauth-gateway_gateway_data"
    assert answer["directory_unchanged"] and answer["media_unchanged"]
    assert_directory_and_media_unchanged(state)
    assert not any("cleanup" in command or "down" in command or "prune" in command for command in state.commands)


@pytest.mark.parametrize("failure", ["config", "ready", "mount_changed"])
def test_failures_restore_internal_environment_image_and_same_volume(updater, failure):
    state = updater
    state.controls["failure"] = failure
    with pytest.raises(RuntimeError):
        state.module.update(NEW)
    assert (state.root / ".env").read_bytes() == state.original_env
    assert state.runtimes["internal"]["Config"]["Image"].endswith(OLD)
    assert state.runtimes["internal"]["Mounts"][0]["Name"] == "vimarx-oauth-gateway_gateway_data"
    assert_directory_and_media_unchanged(state)


@pytest.mark.parametrize("failure", ["build", "backup_mode"])
def test_build_or_nonprivate_backup_fail_before_environment_mutation(updater, failure):
    state = updater
    state.controls["failure"] = failure
    with pytest.raises(RuntimeError):
        state.module.update(NEW)
    assert (state.root / ".env").read_bytes() == state.original_env
    assert not any(event[0] == "write" for event in state.events)
    assert_directory_and_media_unchanged(state)


@pytest.mark.parametrize("precondition", ["missing_directory", "stopped_directory", "permission", "environment_drift", "writable_root"])
def test_missing_or_mismatched_existing_profiles_abort_without_bootstrap(updater, precondition):
    state = updater
    if precondition == "missing_directory": (state.root / ".env.directory").unlink()
    elif precondition == "stopped_directory": state.runtimes["directory"]["State"]["Running"] = False
    elif precondition == "permission": state.modes[state.root / ".env"] = 0o644
    elif precondition == "writable_root": state.runtimes["internal"]["HostConfig"]["ReadonlyRootfs"] = False
    else: state.runtimes["internal"]["Config"]["Env"].append("TOKEN_ENCRYPTION_KEY=unexpected")
    with pytest.raises(RuntimeError): state.module.update(NEW)
    assert state.commands == [] and state.events == []
    assert (state.root / ".env").read_bytes() == state.original_env


def test_external_directory_change_is_reported_without_recreating_or_repairing_it(updater):
    state = updater
    state.controls["failure"] = "directory_changed"
    with pytest.raises(RuntimeError, match="rollback verification failed"):
        state.module.update(NEW)
    assert (state.root / ".env").read_bytes() == state.original_env
    assert state.runtimes["directory"]["Id"] == "externally-changed-directory"
    assert all("vimarx-oauth-directory" not in command for command in state.commands)


@pytest.mark.parametrize("revision", ["main", "abc123", "A" * 40, "a" * 41])
def test_revision_must_be_full_reviewed_sha_before_any_operation(updater, revision):
    with pytest.raises(ValueError): updater.module.update(revision)
    assert updater.commands == [] and updater.events == []


def test_actual_location_guard_rejects_a_noncanonical_root(updater):
    spec = importlib.util.spec_from_file_location("internal_location_test", DEPLOY / "update_internal.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with pytest.raises(RuntimeError, match="only under"):
        module.require_location()
