"""Install the pinned official Restic test binary without system privileges."""
import argparse
import bz2
import hashlib
import os
from pathlib import Path
import platform
import tempfile
import urllib.request


VERSION = "0.18.0"
ARCHIVE_SHA256 = "98f6dd8bf5b59058d04bfd8dab58e196cc2a680666ccee90275a3b722374438e"
URL = (
    f"https://github.com/restic/restic/releases/download/v{VERSION}/"
    f"restic_{VERSION}_linux_amd64.bz2"
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    if platform.system() != "Linux" or platform.machine() not in {"x86_64", "amd64"}:
        parser.error("The pinned test artifact requires Linux amd64.")
    with urllib.request.urlopen(URL, timeout=60) as response:
        archive = response.read(32 * 1024 * 1024 + 1)
    if hashlib.sha256(archive).hexdigest() != ARCHIVE_SHA256:
        raise SystemExit("Official Restic archive checksum mismatch; nothing installed.")
    binary = bz2.decompress(archive)
    directory = args.directory.expanduser().resolve()
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = directory / "restic"
    if target.exists():
        if target.is_symlink() or target.read_bytes() != binary:
            raise SystemExit("Refusing to replace a different existing test binary.")
        print(f"Verified Restic {VERSION}: {target}")
        return
    with tempfile.NamedTemporaryFile(dir=directory, delete=False) as temporary:
        staging = Path(temporary.name)
        try:
            temporary.write(binary)
            temporary.flush()
            os.fchmod(temporary.fileno(), 0o700)
            os.link(staging, target)
        finally:
            staging.unlink(missing_ok=True)
    print(f"Installed checksum-verified Restic {VERSION}: {target}")


if __name__ == "__main__":
    main()
