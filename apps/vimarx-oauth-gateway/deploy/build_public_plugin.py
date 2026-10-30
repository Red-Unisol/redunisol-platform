"""Build a public-review DRAFT; never uploads, publishes, or rewrites a private App."""
import argparse
from copy import deepcopy
import hashlib
from io import BytesIO
import json
from pathlib import Path
import zipfile
from PIL import Image
from build_plugin import PACKAGE, FILES, validate

METADATA = PACKAGE.parent / "public-submission.json"

def build(output, folder=PACKAGE, metadata_path=METADATA):
    folder, output = Path(folder).resolve(), Path(output).resolve()
    if output.is_relative_to(folder):
        raise ValueError("Write the archive outside its source")
    manifest = deepcopy(validate(folder))
    metadata = json.loads(Path(metadata_path).read_text(encoding="utf-8"))
    manifest["version"] = metadata["version"]
    manifest["author"] = {"name": metadata["publisher"]}
    extension = manifest["extensions"]["com.openai"]
    extension.pop("apps", None)
    extension["interface"].update(metadata["interface"])
    extension["review"] = metadata["review"]
    extension["publication"] = metadata["publication"]
    assert len(extension["review"]["test_cases"]["positive"]) == 5
    assert len(extension["review"]["test_cases"]["negative"]) == 3
    assert extension["review"]["commerce"] is False
    assert extension["publication"]["countries"] == []
    contents = {p: (folder / p).read_bytes() for p in FILES}
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
    server["extensions"] = {"com.openai": {"auth": {"type": "oauth"}}}
    contents["mcp.json"] = (json.dumps(mcp,ensure_ascii=False,indent=2)+"\n").encode()
    contents["plugin.json"] = (json.dumps(manifest,ensure_ascii=False,indent=2)+"\n").encode()
    contents["README.md"] = ("# Celesol · Vimarx\n\nPublic-review draft, not an approved directory release. Requires an authorized Vimarx account. Read-only access. Install the approved listing after publication; OAuth connection is individual. The original private App-bound installation is unchanged.\n").encode()
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
    return {"version":manifest["version"],"files":len(contents),"sha256":hashlib.sha256(output.read_bytes()).hexdigest(),"readiness":"DRAFT: verify public URLs, developer/domain verification, demo recording, dedicated test account and reviewer cases before submission"}

if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",required=True)
    args=parser.parse_args()
    print(json.dumps(build(args.output)))
