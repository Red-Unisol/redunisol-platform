"""Publish only the checksum-approved synthetic video; preserve gateway sessions.

Python 3.6+. Run on the authorized VPS after uploading source and approved MP4.
No media is discovered recursively and no credential directory is exposed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path("/opt/vimarx-oauth-gateway")
VHOST = Path("/opt/apache/conf.d/25-mcp-redunisol.conf")
EDITIONS = {
    "internal": ("demo-media.json", "demo-index.html", ""),
    "directory": ("demo-directory-media.json", "demo-directory-index.html", "directorio"),
}


def publish(media, edition="internal"):
    deploy = Path(__file__).resolve().parent
    if edition not in EDITIONS:
        raise ValueError("Unknown demo edition")
    manifest_name, index_name, subdirectory = EDITIONS[edition]
    # No directory manifest is shipped until its recording has been reviewed.
    manifest = json.loads((deploy / manifest_name).read_text(encoding="utf-8"))
    media = Path(media)
    if media.is_symlink() or not media.is_file():
        raise ValueError("An ordinary approved media file is required")
    if (media.stat().st_size != manifest["bytes"] or
            hashlib.sha256(media.read_bytes()).hexdigest() != manifest["sha256"]):
        raise ValueError("Media is not the approved synthetic recording")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*\.mp4", manifest["filename"]):
        raise ValueError("Invalid media filename")
    public_root = ROOT / "public-demo"
    target = public_root / subdirectory if subdirectory else public_root
    if (public_root.is_symlink() or public_root.resolve().parent != ROOT.resolve()
            or target.is_symlink() or target.resolve().parent != (public_root if subdirectory else ROOT).resolve()):
        raise ValueError("Unsafe publication directory")
    expected_url = "https://mcp.redunisol.com.ar/demo/" + (subdirectory + "/" if subdirectory else "") + manifest["filename"]
    if manifest["public_url"] != expected_url:
        raise ValueError("Media URL does not match its edition")
    old_vhost = VHOST.read_text(encoding="utf-8")
    if "ServerName mcp.redunisol.com.ar" not in old_vhost:
        raise ValueError("Refusing to replace an unrelated virtual host")
    if subdirectory:
        # The installed parent Alias already serves this subtree. Publishing a
        # directory recording must never change or reload Apache configuration.
        alias = 'Alias "/demo/" "' + str(public_root).replace("\\", "/") + '/"'
        if (not re.search(r"(?m)^\s*" + re.escape(alias) + r"\s*$", old_vhost)
                or not re.search(r'(?m)^\s*ProxyPass "/demo/" "!"\s*$', old_vhost)):
            raise ValueError("The approved demo Alias must already be installed")
    # Refuse symlink destinations even when the directory itself is ordinary.
    names = (manifest["filename"], "style.css", "index.html")
    for name in names:
        if (target / name).is_symlink():
            raise ValueError("Unsafe publication file")
    index = (deploy / index_name).read_text(encoding="utf-8")
    if subdirectory:
        if "{{VIDEO_FILENAME}}" not in index:
            raise ValueError("Directory demo template is missing its media reference")
        index = index.replace("{{VIDEO_FILENAME}}", manifest["filename"])
    css = (deploy / "demo-style.css").read_bytes()
    target_existed, root_existed = target.exists(), public_root.exists()
    # Staging and rollback copies stay outside the public Alias. Only complete
    # files are moved into place; publish the index last so it cannot reference
    # a partially copied video. Existing recordings and subdirectories stay put.
    with tempfile.TemporaryDirectory(prefix=".demo-publish-", dir=str(ROOT)) as temporary:
        stage = Path(temporary)
        shutil.copyfile(str(media), str(stage / manifest["filename"]))
        if (stage / manifest["filename"]).stat().st_size != manifest["bytes"] or hashlib.sha256((stage / manifest["filename"]).read_bytes()).hexdigest() != manifest["sha256"]:
            raise ValueError("Media changed while preparing publication")
        (stage / "index.html").write_text(index, encoding="utf-8")
        (stage / "style.css").write_bytes(css)
        previous = {}
        for name in names:
            previous[name] = (target / name).exists()
            if previous[name]:
                shutil.copyfile(str(target / name), str(stage / (name + ".previous")))
            (stage / name).chmod(0o644)
        published = []
        apache_touched = False
        try:
            public_root.mkdir(mode=0o755, exist_ok=True)
            target.mkdir(mode=0o755, exist_ok=True)
            target.chmod(0o755)
            for name in names:
                os.replace(str(stage / name), str(target / name))
                published.append(name)
            if not subdirectory:
                desired = (deploy / "apache-mcp.conf").read_text(encoding="utf-8")
                apache_touched = True
                VHOST.write_text(desired, encoding="utf-8")
                subprocess.run(["/opt/apache/bin/apachectl", "-t"], check=True)
                subprocess.run(["/opt/apache/bin/apachectl", "graceful"], check=True)
        except Exception:
            for name in reversed(published):
                if previous[name]:
                    os.replace(str(stage / (name + ".previous")), str(target / name))
                else:
                    (target / name).unlink()
            if not target_existed and target.exists() and not any(target.iterdir()):
                target.rmdir()
            if not root_existed and public_root.exists() and not any(public_root.iterdir()):
                public_root.rmdir()
            if apache_touched:
                VHOST.write_text(old_vhost, encoding="utf-8")
                subprocess.run(["/opt/apache/bin/apachectl", "-t"], check=True)
                subprocess.run(["/opt/apache/bin/apachectl", "graceful"], check=True)
            raise
    print(json.dumps({"published": manifest["public_url"], "sha256": manifest["sha256"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--media", required=True)
    parser.add_argument("--edition", choices=sorted(EDITIONS), default="internal")
    args = parser.parse_args()
    publish(args.media, args.edition)
