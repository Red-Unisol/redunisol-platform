import importlib.util
import shutil
import zipfile
from pathlib import Path

import pytest


def builder():
    source = Path(__file__).resolve().parents[1] / "deploy/build_plugin.py"
    spec = importlib.util.spec_from_file_location("vimarx_plugin_builder_test", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_portable_zip_is_self_contained_and_reproducible(tmp_path):
    module = builder()
    first = module.build(tmp_path / "one.zip")
    second = module.build(tmp_path / "two.zip")
    assert first["sha256"] == second["sha256"]
    assert first["files"] == 6
    with zipfile.ZipFile(tmp_path / "one.zip") as archive:
        assert all(path.startswith("vimarx-celesol/") for path in archive.namelist())
        assert all("credentials" not in path and ".env" not in path for path in archive.namelist())
        assert b'https://mcp.redunisol.com.ar/mcp' in archive.read("vimarx-celesol/mcp.json")
        assert all(b'asdk_app_' not in archive.read(path) for path in archive.namelist())


def test_packaging_rejects_secret_or_unrelated_files(tmp_path):
    module = builder()
    copied = tmp_path / "vimarx-celesol"
    shutil.copytree(module.PACKAGE, copied)
    (copied / ".env").write_text("not-a-real-secret")
    with pytest.raises(ValueError):
        module.build(tmp_path / "bad.zip", copied)


def test_packaging_refuses_archive_inside_source():
    module = builder()
    with pytest.raises(ValueError):
        module.build(module.PACKAGE / "nested.zip")



def test_zip_preserves_official_binary_logo_and_updated_presentation(tmp_path):
    import hashlib
    import json

    module = builder()
    module.build(tmp_path / "plugin.zip")
    with zipfile.ZipFile(tmp_path / "plugin.zip") as archive:
        logo = archive.read("vimarx-celesol/assets/icon.png")
        assert logo == (module.PACKAGE / "assets/icon.png").read_bytes()
        assert hashlib.sha256(logo).hexdigest() == "cbfd5e0ccd30bacf043d2f31f5260a5e500de20679630b720301262eb657c4df"
        manifest = json.loads(archive.read("vimarx-celesol/plugin.json"))
        assert manifest["name"] == "vimarx-celesol"
        assert manifest["version"] == "2.0.1"
        interface = manifest["extensions"]["com.openai"]["interface"]
        assert interface["displayName"] == "Celesol · Vimarx"
        assert interface["logo"] == interface["composerIcon"] == "./assets/icon.png"


def test_packaging_rejects_options_that_break_installed_desktop_parser(tmp_path):
    import json

    module = builder()
    copied = tmp_path / "vimarx-celesol"
    shutil.copytree(module.PACKAGE, copied)
    path = copied / "mcp.json"
    config = json.loads(path.read_text(encoding="utf-8"))
    config["mcpServers"]["vimarx-celesol"]["extensions"] = {
        "com.openai": {"auth": {"type": "oauth"}}}
    path.write_text(json.dumps(config), encoding="utf-8")
    with pytest.raises(AssertionError, match="Unsupported desktop MCP options"):
        module.build(tmp_path / "incompatible.zip", copied)
