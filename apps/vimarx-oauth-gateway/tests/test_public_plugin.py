import importlib.util
import json
from pathlib import Path
import sys
import zipfile

import pytest
from gateway import directory


@pytest.fixture
def builder():
    deploy = Path(__file__).resolve().parents[1] / "deploy"
    sys.path.insert(0, str(deploy))
    try:
        spec = importlib.util.spec_from_file_location("public_plugin_test", deploy / "build_public_plugin.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        yield module
    finally:
        sys.path.remove(str(deploy))


@pytest.fixture
def metadata_without_recording(tmp_path, builder):
    metadata = json.loads(builder.METADATA.read_text(encoding="utf-8"))
    metadata["review"].pop("demo_recording_url", None)
    path = tmp_path / "draft-metadata.json"
    path.write_text(json.dumps(metadata), encoding="utf-8")
    return path


def test_public_draft_has_restricted_endpoint_and_review_metadata_without_private_bindings(tmp_path, builder, metadata_without_recording):
    first = builder.build(tmp_path / "one.zip", metadata_path=metadata_without_recording)
    second = builder.build(tmp_path / "two.zip", metadata_path=metadata_without_recording)
    assert first["sha256"] == second["sha256"]
    assert first["demo_recording_included"] is False
    assert "record the restricted directory walkthrough" in first["remaining_checks"]
    with zipfile.ZipFile(tmp_path / "one.zip") as archive:
        assert not any(".app.json" in name or ".codex-plugin" in name for name in archive.namelist())
        manifest = json.loads(archive.read("vimarx-celesol/plugin.json"))
        ext = manifest["extensions"]["com.openai"]
        assert manifest["name"] == "vimarx-celesol" and manifest["version"] == "2.2.0"
        assert manifest["author"]["name"] == "Santiago Agustín Acosta"
        assert manifest["homepage"] == "https://mcp.redunisol.com.ar/directorio/"
        assert "apps" not in manifest and "apps" not in ext
        assert ext["interface"]["category"] == "Finance"
        assert ext["publication"]["countries"] == []
        assert ext["review"]["commerce"] is False
        assert "demo_recording_url" not in ext["review"]
        assert len(ext["review"]["test_cases"]["positive"]) == 5
        assert len(ext["review"]["test_cases"]["negative"]) == 3
        allowed_tools = {
            "contexto_cliente", "get_fecha_trabajo", "buscar_socios", "get_socio_por_numero",
            "get_solicitudes_recientes", "get_solicitudes_socio", "get_prestamos", "get_cuotas_prestamo",
        }
        assert allowed_tools == directory.TOOLS
        covered_tools = set()
        for case in ext["review"]["test_cases"]["positive"]:
            assert case["expected_behavior"]
            tools = set(case["tools_triggered"].split(", "))
            assert tools.issubset(allowed_tools)
            covered_tools.update(tools)
        assert covered_tools == allowed_tools
        assert [case["prompt"] for case in ext["review"]["test_cases"]["positive"]] == ext["review"]["prompts"]
        assert len(set(ext["review"]["prompts"])) == 5
        for prompt in ext["interface"]["defaultPrompt"]:
            assert 0 < len(prompt) <= 128 and "documento" not in prompt.casefold()
        assert ext["publication"]["translations"]["es-419"]["subtitle"] == "Consultas de Mutual Celesol"
        assert ext["interface"]["websiteURL"] == "https://mcp.redunisol.com.ar/directorio/"
        servers = json.loads(archive.read("vimarx-celesol/mcp.json"))["mcpServers"]
        assert set(servers) == {"vimarx-celesol-directorio"}
        server = servers["vimarx-celesol-directorio"]
        assert server["url"] == "https://mcp.redunisol.com.ar/directorio/mcp"
        assert server["extensions"]["com.openai"]["auth"] == {"type": "oauth"}
        assert not server.get("headers")
        assert archive.read("vimarx-celesol/assets/icon.png").startswith(bytes.fromhex("89504e470d0a1a0a"))


def test_public_skill_is_separate_and_does_not_change_internal_package(tmp_path, builder):
    before = {name: (builder.PACKAGE / name).read_bytes() for name in builder.FILES}
    builder.build(tmp_path / "directory.zip")
    assert before == {name: (builder.PACKAGE / name).read_bytes() for name in builder.FILES}
    private_manifest = json.loads(before["plugin.json"])
    assert private_manifest["version"] == "2.0.4"
    with zipfile.ZipFile(tmp_path / "directory.zip") as archive:
        skill = archive.read("vimarx-celesol/skills/consultar-vimarx/SKILL.md").decode("utf-8")
        assert skill.encode("utf-8") != before["skills/consultar-vimarx/SKILL.md"]
        assert "get_solicitudes_recientes" in skill and "get_solicitudes_socio" in skill
        assert "get_entidades" not in skill and "query_entidad" not in skill
        assert "No reinterpretar un DNI" in skill
        assert "No consultar otra cuenta" in skill
        assert "vimarx-celesol-directorio" in skill


def test_old_full_endpoint_cannot_enter_directory_package(tmp_path, builder):
    metadata = json.loads(builder.METADATA.read_text(encoding="utf-8"))
    metadata["mcp_url"] = "https://mcp.redunisol.com.ar/mcp"
    path = tmp_path / "metadata.json"
    path.write_text(json.dumps(metadata), encoding="utf-8")
    with pytest.raises(ValueError, match="restricted directory endpoint"):
        builder.build(tmp_path / "bad.zip", metadata_path=path)
    assert not (tmp_path / "bad.zip").exists()


def test_final_candidate_requires_current_recording_instead_of_reusing_full_demo(tmp_path, builder, metadata_without_recording):
    with pytest.raises(ValueError, match="restricted directory walkthrough"):
        builder.build(tmp_path / "missing.zip", metadata_path=metadata_without_recording,
                      require_demo_recording=True)
    assert not (tmp_path / "missing.zip").exists()
    recording = "https://mcp.redunisol.com.ar/demo/directorio/walkthrough.mp4"
    report = builder.build(tmp_path / "candidate.zip", demo_recording_url=recording,
                           require_demo_recording=True)
    assert report["demo_recording_included"] is True
    assert report["readiness"].startswith("DRAFT")
    with zipfile.ZipFile(tmp_path / "candidate.zip") as archive:
        manifest = json.loads(archive.read("vimarx-celesol/plugin.json"))
        assert manifest["extensions"]["com.openai"]["review"]["demo_recording_url"] == recording


def test_canonical_directory_recording_matches_approved_media_manifest(tmp_path, builder):
    metadata = json.loads(builder.METADATA.read_text(encoding="utf-8"))
    media = json.loads((builder.METADATA.parent.parent / "deploy/demo-directory-media.json").read_text(encoding="utf-8"))
    assert metadata["review"]["demo_recording_url"] == media["public_url"]
    report = builder.build(tmp_path / "with-approved-recording.zip", require_demo_recording=True)
    assert report["demo_recording_included"] is True
    with zipfile.ZipFile(tmp_path / "with-approved-recording.zip") as archive:
        manifest = json.loads(archive.read("vimarx-celesol/plugin.json"))
        assert manifest["extensions"]["com.openai"]["review"]["demo_recording_url"] == media["public_url"]


@pytest.mark.parametrize("recording", ["http://example.invalid/video", "https://user:password@example.invalid/video", ""])
def test_recording_url_requires_https_without_credentials(tmp_path, builder, recording):
    with pytest.raises(ValueError, match="public HTTPS recording URL"):
        builder.build(tmp_path / "bad-url.zip", demo_recording_url=recording)


def test_unexpected_public_content_cannot_enter_archive(tmp_path, builder):
    extra = tmp_path / "content"
    extra.mkdir()
    (extra / "credentials.txt").write_text("not an account", encoding="utf-8")
    with pytest.raises(ValueError, match="Unexpected files"):
        builder.build(tmp_path / "bad-content.zip", public_content=extra)
