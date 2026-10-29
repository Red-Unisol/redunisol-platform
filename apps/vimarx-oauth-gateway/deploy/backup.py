"""Private SQLite snapshots; never decrypt data or copy encryption keys."""
import argparse
import os
from pathlib import Path
import re
import subprocess
import time

ROOT = Path("/opt/vimarx-oauth-gateway")


def prune(folder):
    if not folder.exists():
        return
    base = folder.resolve()
    for path in folder.glob("gateway-*.db"):
        if (re.fullmatch(r"gateway-[0-9]+-[a-f0-9]{12}\.db", path.name)
                and not path.is_symlink() and path.resolve().parent == base
                and path.stat().st_mtime < time.time() - 7 * 86400):
            path.unlink()


def snapshot(revision):
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("A full revision is required")
    folder = ROOT / "backups"
    folder.mkdir(mode=0o700, exist_ok=True)
    folder.chmod(0o700)
    path = folder / ("gateway-" + str(int(time.time())) + "-" + revision[:12] + ".db")
    code = ("import os,sqlite3,tempfile,sys; "
            "fd,p=tempfile.mkstemp(); os.close(fd); "
            "source=sqlite3.connect('file:/data/gateway.db?mode=ro',uri=True); "
            "target=sqlite3.connect(p); source.backup(target); target.close(); source.close(); "
            "sys.stdout.buffer.write(open(p,'rb').read()); os.unlink(p)")
    result = subprocess.run(["docker", "exec", "vimarx-oauth-gateway-gateway-1", "python", "-c", code],
                            check=True, stdout=subprocess.PIPE)
    if not result.stdout.startswith(b"SQLite format 3"):
        raise RuntimeError("Invalid SQLite snapshot")
    with path.open("wb") as destination:
        destination.write(result.stdout)
    path.chmod(0o600)
    prune(folder)
    return path


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--prune", action="store_true")
    args = parser.parse_args()
    if args.prune:
        prune(ROOT / "backups")
