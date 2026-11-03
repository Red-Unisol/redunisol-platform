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
        logo = archive.read("vimarx-celesol/assets/icon.jpeg")
        assert logo == (module.PACKAGE / "assets/icon.jpeg").read_bytes()
        assert hashlib.sha256(logo).hexdigest() == "2c9c638e6e32e4e6a4226c903c6a18869a39c3557762d1b251f0393d1c08c0cf"
        manifest = json.loads(archive.read("vimarx-celesol/plugin.json"))
        assert manifest["name"] == "vimarx-celesol"
        assert manifest["version"] == "2.0.4"
        interface = manifest["extensions"]["com.openai"]["interface"]
        assert interface["displayName"] == "Celesol · Vimarx"
        assert interface["logo"] == interface["composerIcon"] == "./assets/icon.jpeg"


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



def test_chatgpt_archive_has_registered_app_and_no_desktop_mcp(tmp_path):
    import json

    module = builder()
    first = module.build(tmp_path / "chatgpt.zip", registered_app_id="asdk_app_testfixture123")
    second = module.build(tmp_path / "again.zip", registered_app_id="asdk_app_testfixture123")
    assert first["sha256"] == second["sha256"]
    assert first["mode"] == "registered-app" and first["files"] == 7
    with zipfile.ZipFile(tmp_path / "chatgpt.zip") as archive:
        assert not any(path.endswith(("/mcp.json", "/.mcp.json")) for path in archive.namelist())
        manifest = json.loads(archive.read("vimarx-celesol/plugin.json"))
        assert manifest["name"] == "vimarx-celesol"
        assert manifest["extensions"]["com.openai"]["apps"] == "./.app.json"
        legacy = json.loads(archive.read("vimarx-celesol/.codex-plugin/plugin.json"))
        assert "mcpServers" not in legacy and legacy["apps"] == "./.app.json"
        app = json.loads(archive.read("vimarx-celesol/.app.json"))
        assert app == {"apps": {"vimarx-celesol": {"id": "asdk_app_testfixture123", "required": True}}}


@pytest.mark.parametrize("app_id", ["", "plugin_asdk_app_wrong", "https://example.com/app", "asdk_app_bad/path"])
def test_chatgpt_export_rejects_unverified_identifier_shapes(tmp_path, app_id):
    with pytest.raises(ValueError, match="verified registered App ID"):
        builder().build(tmp_path / "bad.zip", registered_app_id=app_id)
