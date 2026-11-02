import hashlib
import importlib.util
import json
from pathlib import Path
import shutil

import pytest


def setup_publication(tmp_path, monkeypatch, edition="internal"):
    deploy = Path(__file__).resolve().parents[1] / "deploy"
    spec = importlib.util.spec_from_file_location("demo_publisher_test", deploy / "publish_demo.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    root = tmp_path / "gateway"
    copied = root / "deploy"
    copied.mkdir(parents=True)
    for name in ("apache-mcp.conf", "demo-index.html", "demo-directory-index.html", "demo-style.css"):
        shutil.copyfile(deploy / name, copied / name)
    media = tmp_path / "approved.mp4"
    media.write_bytes(b"synthetic-test-recording")
    manifest_name = "demo-directory-media.json" if edition == "directory" else "demo-media.json"
    prefix = "directorio/" if edition == "directory" else ""
    (copied / manifest_name).write_text(json.dumps({
        "filename": "approved.mp4", "bytes": media.stat().st_size,
        "sha256": hashlib.sha256(media.read_bytes()).hexdigest(),
        "public_url": "https://mcp.redunisol.com.ar/demo/" + prefix + "approved.mp4"}))
    vhost = tmp_path / "mcp.conf"
    vhost.write_text("ServerName mcp.redunisol.com.ar\n# Existing TLS configuration\n")
    if edition == "directory":
        vhost.write_text((copied / "apache-mcp.conf").read_text().replace(
            "/opt/vimarx-oauth-gateway/public-demo/", (root / "public-demo").as_posix() + "/"))
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


@pytest.mark.parametrize("edition", ["internal", "directory"])
def test_wrong_media_is_rejected_before_any_publication(tmp_path, monkeypatch, edition):
    module, media, root, vhost, calls = setup_publication(tmp_path, monkeypatch, edition)
    original = vhost.read_text()
    media.write_bytes(b"different-content")
    with pytest.raises(ValueError, match="approved"):
        module.publish(media, edition)
    assert not (root / "public-demo").exists()
    assert vhost.read_text() == original and not calls


def test_invalid_apache_configuration_restores_previous_vhost_and_files(tmp_path, monkeypatch):
    module, media, root, vhost, _ = setup_publication(tmp_path, monkeypatch)
    target = root / "public-demo"
    target.mkdir()
    previous = {name: b"previous-" + name.encode() for name in ("approved.mp4", "index.html", "style.css")}
    for name, content in previous.items():
        (target / name).write_bytes(content)
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
    assert {name: (target / name).read_bytes() for name in previous} == previous
    assert not list(root.glob(".demo-publish-*"))


def test_directory_publication_preserves_internal_video_and_uses_existing_alias(tmp_path, monkeypatch):
    module, media, root, vhost, calls = setup_publication(tmp_path, monkeypatch, "directory")
    old = root / "public-demo"
    old.mkdir()
    previous = {name: b"old-full-edition-" + name.encode() for name in ("old.mp4", "index.html", "style.css")}
    for name, content in previous.items():
        (old / name).write_bytes(content)
    original_vhost = vhost.read_bytes()
    real_replace = module.os.replace
    def replace(source, destination):
        # Staging is private and on the same filesystem, outside the Alias.
        assert Path(source).parent.parent == root
        assert Path(source).parent.name.startswith(".demo-publish-")
        return real_replace(source, destination)
    monkeypatch.setattr(module.os, "replace", replace)
    module.publish(media, "directory")
    target = old / "directorio"
    assert {p.name for p in target.iterdir()} == {"approved.mp4", "index.html", "style.css"}
    assert (target / "approved.mp4").read_bytes() == media.read_bytes()
    assert {name: (old / name).read_bytes() for name in previous} == previous
    assert vhost.read_bytes() == original_vhost and not calls
    index = (target / "index.html").read_text()
    assert '{{VIDEO_FILENAME}}' not in index
    assert 'src="approved.mp4" type="video/mp4"' in index and 'href="style.css"' in index
    assert 'href="approved.mp4"' in index and "/demo/approved.mp4" not in index
    assert not list(root.glob(".demo-publish-*"))
    assert 'Header always set X-Content-Type-Options "nosniff"' in vhost.read_text()
    assert "media-src 'self'" in vhost.read_text() and "style-src 'self'" in vhost.read_text()


def test_directory_without_approved_manifest_fails_before_creating_public_files(tmp_path, monkeypatch):
    module, media, root, vhost, calls = setup_publication(tmp_path, monkeypatch)
    previous = vhost.read_bytes()
    with pytest.raises(FileNotFoundError):
        module.publish(media, "directory")
    assert not (root / "public-demo").exists() and not calls
    assert vhost.read_bytes() == previous


@pytest.mark.parametrize("field,value", [
    ("filename", "../private.mp4"), ("filename", "recording.html"),
    ("filename", 'recording\".mp4'),
    ("public_url", "https://mcp.redunisol.com.ar/demo/approved.mp4"),
])
def test_directory_rejects_wrong_paths_and_non_video_names(tmp_path, monkeypatch, field, value):
    module, media, root, _, calls = setup_publication(tmp_path, monkeypatch, "directory")
    path = root / "deploy/demo-directory-media.json"
    manifest = json.loads(path.read_text())
    manifest[field] = value
    path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError):
        module.publish(media, "directory")
    assert not (root / "public-demo").exists() and not calls


def test_directory_does_not_install_or_change_apache_alias(tmp_path, monkeypatch):
    module, media, root, vhost, calls = setup_publication(tmp_path, monkeypatch, "directory")
    vhost.write_text("ServerName mcp.redunisol.com.ar\n")
    previous = vhost.read_bytes()
    with pytest.raises(ValueError, match="Alias"):
        module.publish(media, "directory")
    assert not (root / "public-demo").exists() and not calls
    assert vhost.read_bytes() == previous


@pytest.mark.parametrize("location", ["parent", "directory", "file"])
def test_directory_rejects_symlinks_without_touching_other_paths(tmp_path, monkeypatch, location):
    module, media, root, _, calls = setup_publication(tmp_path, monkeypatch, "directory")
    outside = tmp_path / "private"
    outside.mkdir()
    (outside / "approved.mp4").write_bytes(b"private-content")
    public = root / "public-demo"
    try:
        if location == "parent":
            public.symlink_to(outside, target_is_directory=True)
        elif location == "directory":
            public.mkdir()
            (public / "directorio").symlink_to(outside, target_is_directory=True)
        else:
            (public / "directorio").mkdir(parents=True)
            (public / "directorio/approved.mp4").symlink_to(outside / "approved.mp4")
    except OSError:
        pytest.skip("Creating symlinks is unavailable on this host")
    with pytest.raises(ValueError, match="Unsafe"):
        module.publish(media, "directory")
    assert (outside / "approved.mp4").read_bytes() == b"private-content"
    assert {p.name for p in outside.iterdir()} == {"approved.mp4"} and not calls


def test_directory_atomic_replace_failure_restores_previous_recording(tmp_path, monkeypatch):
    module, media, root, vhost, calls = setup_publication(tmp_path, monkeypatch, "directory")
    target = root / "public-demo/directorio"
    target.mkdir(parents=True)
    previous = {name: b"previous-" + name.encode() for name in ("approved.mp4", "index.html", "style.css")}
    for name, content in previous.items():
        (target / name).write_bytes(content)
    original_vhost = vhost.read_bytes()
    real_replace = module.os.replace
    def replace(source, destination):
        if Path(source).name == "style.css":
            raise OSError("Simulated atomic publication failure")
        return real_replace(source, destination)
    monkeypatch.setattr(module.os, "replace", replace)
    with pytest.raises(OSError, match="Simulated"):
        module.publish(media, "directory")
    assert {name: (target / name).read_bytes() for name in previous} == previous
    assert vhost.read_bytes() == original_vhost and not calls
    assert not list(root.glob(".demo-publish-*"))
