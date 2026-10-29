import importlib.util
import json
import subprocess
from pathlib import Path

import pytest


def installer(tmp_path, monkeypatch):
    source = Path(__file__).resolve().parents[1] / "deploy/install.py"
    spec = importlib.util.spec_from_file_location("vimarx_installer_test", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    import sys
    from types import SimpleNamespace
    monkeypatch.setitem(sys.modules, "backup", SimpleNamespace(snapshot=lambda revision: None))
    root = tmp_path / "gateway"
    root.mkdir()
    (root / "deploy").mkdir()
    for name in ("apache-http.conf", "apache-mcp.conf", "vimarx-oauth-cleanup.service", "vimarx-oauth-cleanup.timer", "vimarx-mcp-cert-renew.service", "vimarx-mcp-cert-renew.timer"):
        (root / "deploy" / name).write_text((source.parent / name).read_text())
    frontend, vhost = tmp_path / "kestra.conf", tmp_path / "mcp.conf"
    frontend.write_text("Existing Kestra settings\n" + module.LEGACY_INCLUDE)
    vhost.write_text("ServerName mcp.redunisol.com.ar\n# Previous MCP vhost\n")
    old_env = "APP_IMAGE=old-image\nGATEWAY_ISSUER=https://kestra.example/vimarx-oauth\nGATEWAY_SECRET_KEY=keep-secret\nTOKEN_ENCRYPTION_KEY=keep-key\n"
    (root / ".env").write_text(old_env)
    monkeypatch.setattr(module, "ROOT", root)
    monkeypatch.setattr(module, "FRONTEND", frontend)
    monkeypatch.setattr(module, "VHOST", vhost)
    monkeypatch.setattr(module, "__file__", str(root / "deploy/install.py"))
    monkeypatch.setattr(module.shutil, "copy2", lambda *args: None)
    monkeypatch.setattr(module.time, "sleep", lambda *args: None)
    revision = "a" * 40
    monkeypatch.setattr("sys.argv", ["install.py", "--revision", revision])
    commands = []
    def run(*args):
        commands.append(args)
    monkeypatch.setattr(module, "run", run)
    monkeypatch.setattr(module.subprocess, "run", lambda *args, **kwargs: subprocess.CompletedProcess(
        args, 0, stdout=json.dumps(dict(revision=revision)).encode(), stderr=b""))
    return module, root, frontend, vhost, old_env, commands


def test_dedicated_deploy_preserves_secrets_and_retires_only_own_route(tmp_path, monkeypatch):
    module, root, frontend, vhost, old_env, commands = installer(tmp_path, monkeypatch)
    module.main()
    env = (root / ".env").read_text()
    assert "GATEWAY_SECRET_KEY=keep-secret" in env and "TOKEN_ENCRYPTION_KEY=keep-key" in env
    assert "GATEWAY_ISSUER=https://mcp.redunisol.com.ar" in env
    assert frontend.read_text() == "Existing Kestra settings\n"
    assert 'ServerName mcp.redunisol.com.ar' in vhost.read_text()
    assert any(command[0] == "certbot" for command in commands)
    assert any(command[:3] == ("systemctl", "enable", "--now") for command in commands)
    assert not any("prune" in command for command in commands)


def test_publication_failure_restores_environment_vhosts_and_old_container(tmp_path, monkeypatch):
    module, root, frontend, vhost, old_env, commands = installer(tmp_path, monkeypatch)
    original_frontend, original_vhost = frontend.read_text(), vhost.read_text()
    checks = []
    def run(*args):
        commands.append(args)
        if args == ("/opt/apache/bin/apachectl", "-t"):
            checks.append(1)
            if len(checks) == 2:
                raise RuntimeError("Simulated invalid HTTPS publication")
    monkeypatch.setattr(module, "run", run)
    with pytest.raises(RuntimeError):
        module.main()
    assert (root / ".env").read_text() == old_env
    assert frontend.read_text() == original_frontend
    assert vhost.read_text() == original_vhost
    assert len([c for c in commands if "up" in c]) == 2


def test_apache_never_records_oauth_urls():
    root = Path(__file__).resolve().parents[1] / "deploy"
    text = (root / "apache-mcp.conf").read_text()
    assert text.count('CustomLog "/dev/null" combined') == 2
    assert "ProxyPreserveHost On" in text
    assert 'RequestHeader unset X-Forwarded-For' in text
    assert "SSLProtocol all -SSLv3 -TLSv1 -TLSv1.1" in text


def test_backup_prunes_only_owned_old_snapshots(tmp_path):
    import os
    import time
    source = Path(__file__).resolve().parents[1] / "deploy/backup.py"
    spec = importlib.util.spec_from_file_location("vimarx_backup_test", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    old = tmp_path / "gateway-100-aaaaaaaaaaaa.db"
    fresh = tmp_path / "gateway-200-bbbbbbbbbbbb.db"
    unrelated = tmp_path / "gateway-user-data.db"
    for path in (old, fresh, unrelated):
        path.write_bytes(b"example")
    os.utime(old, (time.time() - 8 * 86400,) * 2)
    os.utime(unrelated, (time.time() - 8 * 86400,) * 2)
    module.prune(tmp_path)
    assert not old.exists() and fresh.exists() and unrelated.exists()
