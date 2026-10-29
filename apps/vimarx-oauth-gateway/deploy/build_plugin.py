"""Validate and export the private portable plugin, without credentials."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile
import struct

import yaml

PACKAGE = Path(__file__).resolve().parents[1] / "plugin/vimarx-celesol"
FILES = (
    "README.md", "assets/icon.png", "mcp.json", "plugin.json",
    "skills/consultar-vimarx/SKILL.md", "skills/consultar-vimarx/agents/openai.yaml",
)


def validate(folder):
    folder = Path(folder).resolve()
    actual = {str(path.relative_to(folder)).replace("\\", "/")
              for path in folder.rglob("*") if path.is_file()}
    if actual != set(FILES) or any(path.is_symlink() for path in folder.rglob("*")):
        raise ValueError("Unexpected or linked files in plugin package")
    manifest = json.loads((folder / "plugin.json").read_text(encoding="utf-8"))
    assert manifest["$schema"] == "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
    assert manifest["name"] == folder.name == "vimarx-celesol"
    assert re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", manifest["version"])
    assert not {"apps", "interface", "skills", "mcpServers"}.intersection(manifest)
    interface = manifest["extensions"]["com.openai"]["interface"]
    assert len(interface["shortDescription"]) <= 30
    assert interface["category"] == "Finance"
    assert isinstance(interface["capabilities"], list)
    assert all(isinstance(prompt, str) and 0 < len(prompt) <= 128 for prompt in interface["defaultPrompt"])
    assert len(interface["defaultPrompt"]) <= 3
    for field in ("logo", "composerIcon"):
        path = (folder / interface[field]).resolve()
        assert path.is_relative_to(folder) and path.is_file()
    icon = (folder / "assets/icon.png").read_bytes()
    assert 24 <= len(icon) <= 5 * 1024 * 1024
    assert icon[:8] == b"\x89PNG\r\n\x1a\n" and icon[12:16] == b"IHDR"
    width, height = struct.unpack(">II", icon[16:24])
    assert 48 <= width == height <= 4096
    mcp = json.loads((folder / "mcp.json").read_text(encoding="utf-8"))
    assert mcp["$schema"] == "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"
    server = mcp["mcpServers"]["vimarx-celesol"]
    assert server["type"] == "streamable-http"
    assert server["url"] == "https://mcp.redunisol.com.ar/mcp"
    # The installed desktop parser accepts transport fields only. OAuth is
    # discovered from the HTTPS challenge and protected-resource metadata.
    assert set(server) == {"type", "url"}, "Unsupported desktop MCP options"
    for relative in ("plugin.json", "mcp.json"):
        content = (folder / relative).read_text(encoding="utf-8")
        assert "asdk_app_" not in content and "clientSecret" not in content
    skill = (folder / "skills/consultar-vimarx/SKILL.md").read_text(encoding="utf-8")
    parts = skill.split("---", 2)
    metadata = yaml.safe_load(parts[1])
    assert metadata["name"] == "consultar-vimarx" and metadata["description"].strip()
    agent = yaml.safe_load((folder / "skills/consultar-vimarx/agents/openai.yaml").read_text(encoding="utf-8"))
    assert agent["interface"]["display_name"] and isinstance(agent["policy"]["allow_implicit_invocation"], bool)
    return manifest


def build(output, folder=PACKAGE):
    folder, output = Path(folder).resolve(), Path(output).resolve()
    if output.is_relative_to(folder):
        raise ValueError("Write the archive outside its package")
    manifest = validate(folder)
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for relative in FILES:
            entry = zipfile.ZipInfo(folder.name + "/" + relative, date_time=(2026, 1, 1, 0, 0, 0))
            entry.external_attr = 0o100644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            data = (folder / relative).read_bytes()
            if not relative.endswith(".png"):
                data = data.decode("utf-8").replace("\r\n", "\n").encode("utf-8")
            archive.writestr(entry, data)
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist()) == len(FILES)
    return dict(name=manifest["name"], version=manifest["version"], files=len(FILES),
                sha256=hashlib.sha256(output.read_bytes()).hexdigest(), bytes=output.stat().st_size)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.output)))
