#!/usr/bin/python3
"""Validate a staged mount unit under its real escaped filename."""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--unit", required=True)
parser.add_argument("candidate")
args = parser.parse_args()
expected = subprocess.check_output([
    "/usr/bin/systemd-escape", "--path", "--suffix=mount", "/srv/redunisol-backups",
], text=True).strip()
if args.unit != expected:
    raise SystemExit("Unexpected backup mount unit name")
with tempfile.TemporaryDirectory(prefix="redunisol-backup-unit-") as directory:
    destination = Path(directory) / expected
    shutil.copyfile(args.candidate, destination)
    result = subprocess.run(
        ["/usr/bin/systemd-analyze", "verify", str(destination)],
        check=False, capture_output=True, text=True,
    )
    if result.returncode:
        sys.stderr.write(result.stderr)
    raise SystemExit(result.returncode)
