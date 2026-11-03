"""Build a desktop MCP package or a private ChatGPT package bound to a registered App."""
import argparse
from copy import deepcopy
import hashlib
from io import BytesIO
import json
from pathlib import Path
import re
import zipfile

from PIL import Image
import yaml

PACKAGE = Path(__file__).resolve().parents[1] / "plugin/vimarx-celesol"
FILES = (
    "README.md", "assets/icon.jpeg", "mcp.json", "plugin.json",
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
    assert len(interface["shortDescription"]) <= 30 and interface["category"] == "Finance"
    assert isinstance(interface["capabilities"], list)
    assert all(isinstance(prompt, str) and 0 < len(prompt) <= 128 for prompt in interface["defaultPrompt"])
    assert len(interface["defaultPrompt"]) <= 3
    for field in ("logo", "composerIcon"):
        path = (folder / interface[field]).resolve()
        assert path.is_relative_to(folder) and path.is_file()
    icon = (folder / "assets/icon.jpeg").read_bytes()
    assert 0 < len(icon) <= 5 * 1024 * 1024
    with Image.open(BytesIO(icon)) as image:
        assert image.format == "JPEG" and 48 <= image.width == image.height <= 4096
        image.verify()
    mcp = json.loads((folder / "mcp.json").read_text(encoding="utf-8"))
    assert mcp["$schema"] == "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"
    server = mcp["mcpServers"]["vimarx-celesol"]
    assert server["type"] == "streamable-http"
    assert server["url"] == "https://mcp.redunisol.com.ar/mcp"
    assert set(server) == {"type", "url"}, "Unsupported desktop MCP options"
    for relative in ("plugin.json", "mcp.json"):
        content = (folder / relative).read_text(encoding="utf-8")
        assert "asdk_app_" not in content and "clientSecret" not in content
    skill = (folder / "skills/consultar-vimarx/SKILL.md").read_text(encoding="utf-8")
    metadata = yaml.safe_load(skill.split("---", 2)[1])
    assert metadata["name"] == "consultar-vimarx" and metadata["description"].strip()
    agent = yaml.safe_load((folder / "skills/consultar-vimarx/agents/openai.yaml").read_text(encoding="utf-8"))
    assert agent["interface"]["display_name"] and isinstance(agent["policy"]["allow_implicit_invocation"], bool)
    return manifest


def build(output, folder=PACKAGE, registered_app_id=None):
    folder, output = Path(folder).resolve(), Path(output).resolve()
    if output.is_relative_to(folder):
        raise ValueError("Write the archive outside its package")
    if registered_app_id is not None and not re.fullmatch(
            r"(?:asdk_app|connector|templated_apps)_[A-Za-z0-9][A-Za-z0-9_-]{0,199}", registered_app_id):
        raise ValueError("Use a verified registered App ID, not a plugin ID or URL")
    manifest = validate(folder)
    contents = {relative: (folder / relative).read_bytes() for relative in FILES}
    if registered_app_id is not None:
        # Any bundled MCP declaration, even remote HTTPS, forces Desktop only.
        # The ChatGPT variant contains ONLY the registered App dependency.
        del contents["mcp.json"]
        manifest = deepcopy(manifest)
        extension = manifest["extensions"]["com.openai"]
        extension["apps"] = "./.app.json"
        contents["plugin.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
        contents[".app.json"] = (json.dumps({"apps": {"vimarx-celesol": {
            "id": registered_app_id, "required": True}}}, indent=2) + "\n").encode()
        # Replace stale generated compatibility wiring when updating an existing
        # imported plugin. The archive editor overlays, rather than replaces.
        legacy = {key: deepcopy(manifest[key]) for key in
                  ("name", "version", "description", "author", "keywords", "homepage")}
        legacy.update(interface=deepcopy(extension["interface"]), skills="./skills/", apps="./.app.json")
        contents[".codex-plugin/plugin.json"] = (json.dumps(legacy, ensure_ascii=False, indent=2) + "\n").encode()
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for relative, data in sorted(contents.items()):
            entry = zipfile.ZipInfo(folder.name + "/" + relative, date_time=(2026, 1, 1, 0, 0, 0))
            entry.external_attr = 0o100644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            if not relative.endswith(".jpeg"):
                data = data.decode("utf-8").replace("\r\n", "\n").encode("utf-8")
            archive.writestr(entry, data)
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None and len(archive.namelist()) == len(contents)
    return dict(name=manifest["name"], version=manifest["version"], files=len(contents),
                mode="registered-app" if registered_app_id else "desktop-mcp",
                sha256=hashlib.sha256(output.read_bytes()).hexdigest(), bytes=output.stat().st_size)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--registered-app-id", help="Verified private/workspace App dependency for ChatGPT")
    args = parser.parse_args()
    print(json.dumps(build(args.output, registered_app_id=args.registered_app_id)))
