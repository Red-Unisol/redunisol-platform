"""Build a public-review DRAFT; never uploads, publishes, or rewrites a private App."""
import argparse
from copy import deepcopy
import hashlib
from io import BytesIO
import json
from pathlib import Path
from urllib.parse import urlsplit
import zipfile
from PIL import Image
import yaml
from build_plugin import PACKAGE, FILES, validate

METADATA = PACKAGE.parent / "public-submission.json"
PUBLIC_CONTENT = PACKAGE.parent / "directory-content"
DIRECTORY_MCP_URL = "https://mcp.redunisol.com.ar/directorio/mcp"
DIRECTORY_SERVER_NAME = "vimarx-celesol-directorio"
PUBLIC_PLUGIN_NAME = "celesol-vimarx-directorio"
PUBLIC_OVERRIDES = (
    "README.md", "skills/consultar-vimarx/SKILL.md",
    "skills/consultar-vimarx/agents/openai.yaml",
)


def public_url(value):
    if not isinstance(value, str) or len(value) > 1024:
        raise ValueError("Use a public HTTPS recording URL without credentials")
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Use a public HTTPS recording URL without credentials")
    return value


def build(output, folder=PACKAGE, metadata_path=METADATA,
          public_content=PUBLIC_CONTENT, demo_recording_url=None,
          require_demo_recording=False):
    folder, output = Path(folder).resolve(), Path(output).resolve()
    if output.is_relative_to(folder):
        raise ValueError("Write the archive outside its source")
    manifest = deepcopy(validate(folder))
    manifest["name"] = PUBLIC_PLUGIN_NAME
    metadata = json.loads(Path(metadata_path).read_text(encoding="utf-8"))
    manifest["version"] = metadata["version"]
    manifest["author"] = {"name": metadata["publisher"]}
    manifest["homepage"] = metadata["interface"]["websiteURL"]
    extension = manifest["extensions"]["com.openai"]
    extension.pop("apps", None)
    extension["interface"].update(metadata["interface"])
    extension["review"] = deepcopy(metadata["review"])
    extension["publication"] = metadata["publication"]
    if metadata.get("mcp_url") != DIRECTORY_MCP_URL:
        raise ValueError("The directory package must use the restricted directory endpoint")
    if demo_recording_url is not None:
        extension["review"]["demo_recording_url"] = public_url(demo_recording_url)
    recording = extension["review"].get("demo_recording_url")
    if recording:
        public_url(recording)
    elif require_demo_recording:
        raise ValueError("Record and verify the restricted directory walkthrough before final packaging")
    assert len(extension["review"]["test_cases"]["positive"]) == 5
    assert len(extension["review"]["test_cases"]["negative"]) == 3
    assert extension["review"]["commerce"] is False
    assert extension["publication"]["countries"] == []
    contents = {p: (folder / p).read_bytes() for p in FILES}
    # The internal source is deliberately preserved. Only this public archive
    # receives the restricted workflow; an imported private skill must not add
    # generic queries, another connection, or document lookup to this surface.
    public_content = Path(public_content).resolve()
    actual = {p.relative_to(public_content).as_posix()
              for p in public_content.rglob("*") if p.is_file()}
    if actual != set(PUBLIC_OVERRIDES):
        raise ValueError("Unexpected files in directory-edition content")
    for relative in PUBLIC_OVERRIDES:
        source_path = public_content / relative
        if source_path.is_symlink() or not source_path.resolve().is_relative_to(public_content):
            raise ValueError("Linked directory-edition content is not allowed")
        contents[relative] = source_path.read_bytes()
    skill = contents["skills/consultar-vimarx/SKILL.md"].decode("utf-8")
    skill_metadata = yaml.safe_load(skill.split("---", 2)[1])
    if skill_metadata.get("name") != "consultar-vimarx" or not skill_metadata.get("description"):
        raise ValueError("Missing directory-edition skill metadata")
    # Re-encode the approved website JPEG losslessly as PNG. No crop, padding,
    # resize or pixel editing: the decoded RGB pixel arrays must remain equal.
    with Image.open(BytesIO(contents.pop("assets/icon.jpeg"))) as source:
        source = source.convert("RGB")
        buffer = BytesIO()
        source.save(buffer, format="PNG")
        icon = buffer.getvalue()
        with Image.open(BytesIO(icon)) as result:
            assert result.size == source.size and result.tobytes() == source.tobytes()
            assert result.width == result.height and result.width >= 256
    contents["assets/icon.png"] = icon
    extension["interface"]["logo"] = extension["interface"]["composerIcon"] = "./assets/icon.png"
    mcp = json.loads(contents["mcp.json"])
    server = mcp["mcpServers"]["vimarx-celesol"]
    server["url"] = metadata["mcp_url"]
    server["extensions"] = {"com.openai": {"auth": {"type": "oauth"}}}
    # The public surface is a distinct MCP declaration, not a URL migration of
    # the internal App. Portal conversion/binding must still be verified there.
    mcp["mcpServers"] = {DIRECTORY_SERVER_NAME: server}
    contents["mcp.json"] = (json.dumps(mcp,ensure_ascii=False,indent=2)+"\n").encode()
    contents["plugin.json"] = (json.dumps(manifest,ensure_ascii=False,indent=2)+"\n").encode()
    assert not any(p in contents for p in (".app.json", ".mcp.json", ".codex-plugin/plugin.json"))
    for p, data in contents.items():
        if p.endswith((".json", ".md", ".yaml")):
            assert b"asdk_app_" not in data and b"clientSecret" not in data
    output.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(output,"w",zipfile.ZIP_DEFLATED) as archive:
        for p,data in sorted(contents.items()):
            entry=zipfile.ZipInfo("vimarx-celesol/"+p,date_time=(2026,1,1,0,0,0))
            entry.external_attr=0o100644 << 16
            entry.compress_type=zipfile.ZIP_DEFLATED
            archive.writestr(entry,data)
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
    gaps = ["verify restricted endpoint and public listing URLs",
            "verify current recording playback" if recording else "record the restricted directory walkthrough",
            "connect and test this saved version in the submission portal",
            "complete reviewer access, scans and publisher attestations"]
    return {"version":manifest["version"],"files":len(contents),"sha256":hashlib.sha256(output.read_bytes()).hexdigest(),
            "mcp_url":server["url"],"demo_recording_included":bool(recording),
            "readiness":"DRAFT: not an approved directory release", "remaining_checks":gaps}

if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",required=True)
    parser.add_argument("--demo-recording-url", help="New restricted-profile recording, after verifying public playback")
    parser.add_argument("--require-demo-recording", action="store_true",
                        help="Refuse to build a final candidate without its recording URL")
    args=parser.parse_args()
    print(json.dumps(build(args.output, demo_recording_url=args.demo_recording_url,
                           require_demo_recording=args.require_demo_recording)))
