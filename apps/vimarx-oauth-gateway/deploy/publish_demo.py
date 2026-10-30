"""Publish only the checksum-approved synthetic video; preserve gateway sessions.

Python 3.6+. Run on the authorized VPS after uploading source and approved MP4.
No media is discovered recursively and no credential directory is exposed.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path("/opt/vimarx-oauth-gateway")
VHOST = Path("/opt/apache/conf.d/25-mcp-redunisol.conf")


def publish(media):
    deploy = Path(__file__).resolve().parent
    manifest = json.loads((deploy / "demo-media.json").read_text(encoding="utf-8"))
    media = Path(media)
    if media.is_symlink() or not media.is_file():
        raise ValueError("An ordinary approved media file is required")
    if (media.stat().st_size != manifest["bytes"] or
            hashlib.sha256(media.read_bytes()).hexdigest() != manifest["sha256"]):
        raise ValueError("Media is not the approved synthetic recording")
    if Path(manifest["filename"]).name != manifest["filename"]:
        raise ValueError("Invalid media filename")
    target = ROOT / "public-demo"
    if target.is_symlink() or target.resolve().parent != ROOT.resolve():
        raise ValueError("Unsafe publication directory")
    old_vhost = VHOST.read_text(encoding="utf-8")
    if "ServerName mcp.redunisol.com.ar" not in old_vhost:
        raise ValueError("Refusing to replace an unrelated virtual host")
    target.mkdir(mode=0o755, exist_ok=True)
    # Refuse symlink destinations even when the directory itself is ordinary.
    for name in (manifest["filename"], "index.html", "style.css"):
        if (target / name).is_symlink():
            raise ValueError("Unsafe publication file")
    shutil.copyfile(str(media), str(target / manifest["filename"]))
    shutil.copyfile(str(deploy / "demo-index.html"), str(target / "index.html"))
    shutil.copyfile(str(deploy / "demo-style.css"), str(target / "style.css"))
    target.chmod(0o755)
    for name in (manifest["filename"], "index.html", "style.css"):
        (target / name).chmod(0o644)
    desired = (deploy / "apache-mcp.conf").read_text(encoding="utf-8")
    try:
        VHOST.write_text(desired, encoding="utf-8")
        subprocess.run(["/opt/apache/bin/apachectl", "-t"], check=True)
        subprocess.run(["/opt/apache/bin/apachectl", "graceful"], check=True)
    except Exception:
        VHOST.write_text(old_vhost, encoding="utf-8")
        subprocess.run(["/opt/apache/bin/apachectl", "-t"], check=True)
        subprocess.run(["/opt/apache/bin/apachectl", "graceful"], check=True)
        raise
    print(json.dumps({"published": manifest["public_url"], "sha256": manifest["sha256"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--media", required=True)
    args = parser.parse_args()
    publish(args.media)
