import hashlib
import importlib.util
import json
from pathlib import Path
import shutil

import pytest


def setup_publication(tmp_path, monkeypatch):
    deploy = Path(__file__).resolve().parents[1] / "deploy"
    spec = importlib.util.spec_from_file_location("demo_publisher_test", deploy / "publish_demo.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    root = tmp_path / "gateway"
    copied = root / "deploy"
    copied.mkdir(parents=True)
    for name in ("apache-mcp.conf", "demo-index.html", "demo-style.css"):
        shutil.copyfile(deploy / name, copied / name)
    media = tmp_path / "approved.mp4"
    media.write_bytes(b"synthetic-test-recording")
    (copied / "demo-media.json").write_text(json.dumps({
        "filename": "approved.mp4", "bytes": media.stat().st_size,
        "sha256": hashlib.sha256(media.read_bytes()).hexdigest(),
        "public_url": "https://mcp.redunisol.com.ar/demo/approved.mp4"}))
    vhost = tmp_path / "mcp.conf"
    vhost.write_text("ServerName mcp.redunisol.com.ar\n# Existing TLS configuration\n")
    monkeypatch.setattr(module, "ROOT", root)
    monkeypatch.setattr(module, "VHOST", vhost)
    monkeypatch.setattr(module, "__file__", str(copied / "publish_demo.py"))
    calls = []
    monkeypatch.setattr(module.subprocess, "run", lambda command, **kwargs: calls.append(command))
    return module, media, root, vhost, calls


def test_only_explicit_approved_media_is_published_without_restarting_gateway(tmp_path, monkeypatch):
    module, media, root, _, calls = setup_publication(tmp_path, monkeypatch)
    (tmp_path / "private.env").write_text("never publish")
    module.publish(media)
    assert {p.name for p in (root / "public-demo").iterdir()} == {"approved.mp4", "index.html", "style.css"}
    assert calls == [["/opt/apache/bin/apachectl", "-t"], ["/opt/apache/bin/apachectl", "graceful"]]


def test_wrong_media_is_rejected_before_any_publication(tmp_path, monkeypatch):
    module, media, root, vhost, calls = setup_publication(tmp_path, monkeypatch)
    original = vhost.read_text()
    media.write_bytes(b"different-content")
    with pytest.raises(ValueError, match="approved"):
        module.publish(media)
    assert not (root / "public-demo").exists()
    assert vhost.read_text() == original and not calls


def test_invalid_apache_configuration_restores_previous_vhost(tmp_path, monkeypatch):
    module, media, _, vhost, _ = setup_publication(tmp_path, monkeypatch)
    original = vhost.read_text()
    calls = []
    def run(command, **kwargs):
        calls.append(command)
        if len(calls) == 1:
            raise RuntimeError("Invalid Apache configuration")
    monkeypatch.setattr(module.subprocess, "run", run)
    with pytest.raises(RuntimeError):
        module.publish(media)
    assert vhost.read_text() == original
    assert calls[-1] == ["/opt/apache/bin/apachectl", "graceful"]
