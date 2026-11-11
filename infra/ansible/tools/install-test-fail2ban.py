"""Extract the pinned official Debian Fail2ban test package without installing it.

The SHA-256 is the fail2ban 1.1.0-8 entry in Debian trixie's official
main/binary-amd64/Packages.xz. No maintainer script or package manager runs.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import tarfile
import tempfile
import urllib.request


VERSION = "1.1.0-8"
ARCHIVE_SHA256 = "ac35080546f1a1581163b2ebcb9796b08eb4abca3d3643082b76dce505cbd6d8"
URL = f"https://deb.debian.org/debian/pool/main/f/fail2ban/fail2ban_{VERSION}_all.deb"
MAX_DOWNLOAD = 2 * 1024 * 1024
MAX_UNPACKED = 16 * 1024 * 1024
MARKER = ".foundation-test-artifact.json"


def data_archive(package):
    """Read the fixed .deb ar container without invoking external extractors."""
    if not package.startswith(b"!<arch>\n"):
        raise ValueError("Invalid Debian ar archive")
    offset, archives = 8, []
    while offset < len(package):
        header = package[offset:offset + 60]
        if len(header) != 60 or header[58:60] != b"`\n":
            raise ValueError("Invalid Debian ar member")
        name = header[:16].decode("ascii").strip().rstrip("/")
        size = int(header[48:58])
        start, end = offset + 60, offset + 60 + size
        if size < 0 or end > len(package):
            raise ValueError("Invalid Debian ar member size")
        if name == "data.tar.xz":
            archives.append(package[start:end])
        offset = end + size % 2
    if offset != len(package) or len(archives) != 1:
        raise ValueError("Expected exactly one Debian data.tar.xz")
    return archives[0]


def inspect(archive):
    """Reject traversal, special files and unexpected links before extraction."""
    manifest, total = {}, 0
    for member in archive.getmembers():
        path = PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("Unsafe Debian archive path")
        name = str(path)
        if name == "." and member.isdir():
            continue
        if name in manifest or member.size < 0:
            raise ValueError("Duplicate path or invalid Debian member")
        total += member.size
        if total > MAX_UNPACKED:
            raise ValueError("Debian data archive exceeds the test limit")
        if member.isdir():
            manifest[name] = {"type": "directory"}
        elif member.isfile():
            source = archive.extractfile(member)
            if source is None:
                raise ValueError("Unreadable Debian archive member")
            manifest[name] = {"type": "file", "sha256": hashlib.sha256(source.read()).hexdigest()}
        elif member.issym() and (name, member.linkname) == ("usr/bin/fail2ban-python", "python3"):
            manifest[name] = {"type": "symlink", "target": member.linkname}
        else:
            raise ValueError("Unexpected Debian archive link or special file")
    return manifest


def verify_existing(directory, manifest):
    for name, entry in manifest.items():
        path = directory / name
        if entry["type"] == "symlink":
            valid = path.is_symlink() and os.readlink(path) == entry["target"]
        elif entry["type"] == "directory":
            valid = path.is_dir() and not path.is_symlink()
        else:
            valid = (path.is_file() and not path.is_symlink()
                     and hashlib.sha256(path.read_bytes()).hexdigest() == entry["sha256"])
        if not valid:
            raise ValueError("Refusing to reuse modified test package: " + name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    if platform.system() != "Linux":
        parser.error("The isolated Fail2ban integration tests require Linux.")
    with urllib.request.urlopen(URL, timeout=60) as response:
        package = response.read(MAX_DOWNLOAD + 1)
    if len(package) > MAX_DOWNLOAD or hashlib.sha256(package).hexdigest() != ARCHIVE_SHA256:
        raise SystemExit("Official Debian package checksum mismatch; nothing extracted.")
    compressed = data_archive(package)
    with tarfile.open(fileobj=io.BytesIO(compressed), mode="r:xz") as archive:
        manifest = inspect(archive)
        directory = args.directory.expanduser().absolute()
        if directory.is_symlink():
            raise SystemExit("Refusing a symlink extraction target.")
        if directory.exists():
            marker = directory / MARKER
            if marker.is_symlink() or not marker.is_file():
                raise SystemExit("Refusing to adopt an existing non-fixture directory.")
            if json.loads(marker.read_text())["archive_sha256"] != ARCHIVE_SHA256:
                raise SystemExit("Refusing a different existing test package.")
            verify_existing(directory, manifest)
            print(f"Verified Debian Fail2ban {VERSION}: {directory}")
            return
        directory.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        staging = Path(tempfile.mkdtemp(prefix=".fail2ban-test-", dir=directory.parent))
        try:
            archive.extractall(staging, filter="data")
            verify_existing(staging, manifest)
            (staging / MARKER).write_text(json.dumps({
                "version": VERSION, "archive_sha256": ARCHIVE_SHA256,
            }, sort_keys=True) + "\n")
            if directory.exists() or directory.is_symlink():
                raise ValueError("Extraction target appeared during verification")
            staging.rename(directory)
        finally:
            if staging.exists():
                shutil.rmtree(staging)
    print(f"Extracted checksum-verified Debian Fail2ban {VERSION}: {directory}")


if __name__ == "__main__":
    main()
