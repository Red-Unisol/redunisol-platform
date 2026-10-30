import importlib.util
import json
from pathlib import Path
import sys
import zipfile


def test_public_draft_has_own_oauth_and_review_metadata_without_private_bindings(tmp_path):
    deploy=Path(__file__).resolve().parents[1] / "deploy"
    sys.path.insert(0,str(deploy))
    try:
        spec=importlib.util.spec_from_file_location("public_plugin_test",deploy / "build_public_plugin.py")
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        first=module.build(tmp_path / "one.zip")
        second=module.build(tmp_path / "two.zip")
    finally:
        sys.path.remove(str(deploy))
    assert first["sha256"] == second["sha256"]
    with zipfile.ZipFile(tmp_path / "one.zip") as archive:
        assert not any(".app.json" in name or ".codex-plugin" in name for name in archive.namelist())
        manifest=json.loads(archive.read("vimarx-celesol/plugin.json"))
        ext=manifest["extensions"]["com.openai"]
        assert manifest["name"] == "vimarx-celesol" and manifest["version"] == "2.1.0"
        assert "apps" not in manifest and "apps" not in ext
        assert ext["interface"]["category"] == "Finance"
        assert ext["publication"]["countries"] == []
        assert ext["review"]["commerce"] is False
        for case in ext["review"]["test_cases"]["positive"]:
            assert isinstance(case["tools_triggered"],str) and case["expected_behavior"]
        assert len(ext["review"]["test_cases"]["positive"]) == 5
        assert len(ext["review"]["test_cases"]["negative"]) == 3
        assert "demo_recording_url" not in ext["review"]
        server=json.loads(archive.read("vimarx-celesol/mcp.json"))["mcpServers"]["vimarx-celesol"]
        assert server["url"] == "https://mcp.redunisol.com.ar/mcp"
        assert server["extensions"]["com.openai"]["auth"] == {"type":"oauth"}
        assert not server.get("headers")
        assert archive.read("vimarx-celesol/assets/icon.png").startswith(b"\x89PNG\r\n\x1a\n")
