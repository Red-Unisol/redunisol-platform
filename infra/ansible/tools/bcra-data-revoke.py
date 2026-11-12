#!/usr/bin/env python3
"""Revoke the one-shot BCRA receiver before application startup (Python 3.6)."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

RUNTIME = Path("/run/redunisol-bcra-transfer")
DATA = Path("/srv/redunisol/state/bcra-file-api")
ALIAS = Path("/var/lib/redunisol-bcra-transfer/data")
MARKER = Path("/srv/redunisol/platform/bcra-file-api/data-transfer-receiver.json")
KEYS = Path("/var/lib/redunisol-bcra-transfer/.ssh/authorized_keys")


class RevokeError(Exception):
    pass


def load(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_uid != 0 or path.stat().st_size > 1024 * 1024:
        raise RevokeError("invalid_control_file")
    with path.open() as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise RevokeError("invalid_control_file")
    return value


def public_key(value):
    if not isinstance(value, str) or not re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/=]+", value):
        raise RevokeError("invalid_public_key")
    return value


def source_check():
    if RUNTIME.is_symlink() or RUNTIME.resolve() != RUNTIME or RUNTIME.stat().st_uid != 0 or stat.S_IMODE(RUNTIME.stat().st_mode) != 0o700:
        raise RevokeError("unsafe_source_runtime")
    config = load(RUNTIME / "config.json")
    helper = RUNTIME / "transfer.py"
    if helper.is_symlink() or not helper.is_file() or hashlib.sha256(helper.read_bytes()).hexdigest() != config.get("transfer_helper_sha256"):
        raise RevokeError("unknown_source_helper")
    spec = importlib.util.spec_from_file_location("reviewed_bcra_transfer", str(helper))
    transfer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(transfer)
    status = transfer.safe_status()
    state = status["state"]
    if status.get("phase") != "complete" or state.get("copy_returncode") != 0 or status["worker_active"] or status["rsync_active"]:
        raise RevokeError("source_transfer_not_complete_or_still_active")
    transfer.stopped_container(config["source_container_id"])
    key_file = RUNTIME / "id_ed25519.pub"
    if key_file.is_symlink() or not key_file.is_file():
        raise RevokeError("missing_source_public_key")
    key = public_key(" ".join(key_file.read_text().split()[:2]))
    private = RUNTIME / "id_ed25519"
    if private.exists():
        if private.is_symlink() or private.stat().st_uid != 0 or stat.S_IMODE(private.stat().st_mode) != 0o600:
            raise RevokeError("unsafe_source_private_key")
        derived = transfer.command(["ssh-keygen", "-y", "-f", str(private)])
        if derived != key:
            raise RevokeError("source_key_pair_mismatch")
    for name in ("source_manifest_sha256", "tree_sha256"):
        if not re.fullmatch(r"[0-9a-f]{64}", state.get(name, "")):
            raise RevokeError("missing_completed_source_manifest")
    return {"version": 1, "status": "source_complete", "public_key": key,
            "source_container_id": config["source_container_id"], "cutoff_at": state["cutoff_at"],
            "source_manifest_sha256": state["source_manifest_sha256"], "tree_sha256": state["tree_sha256"],
            "private_key_present": private.exists(), "private_key_exported": False}


def destination_revoke(key):
    key = public_key(key)
    marker = load(MARKER)
    if marker.get("version") != 1 or marker.get("destination_root") != str(DATA) or marker.get("receiver_alias") != str(ALIAS) or marker.get("source_host") != "66.97.34.158" or marker.get("public_key_sha256") != hashlib.sha256(key.encode()).hexdigest():
        raise RevokeError("receiver_identity_mismatch")
    process = subprocess.run(["pgrep", "-u", "10001", "-x", "rsync|rrsync"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if process.returncode != 1:
        raise RevokeError("receiver_process_active_or_unknown")
    identifiers = subprocess.run(["docker", "ps", "-q"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, universal_newlines=True)
    if identifiers.returncode != 0:
        raise RevokeError("docker_inspection_failed")
    for ident in identifiers.stdout.splitlines():
        if not re.fullmatch(r"[0-9a-f]{12,64}", ident):
            raise RevokeError("docker_inspection_failed")
        result = subprocess.run(["docker", "inspect", "--format", "{{json .Mounts}}", ident], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, universal_newlines=True)
        if result.returncode != 0:
            raise RevokeError("docker_inspection_failed")
        for mount in json.loads(result.stdout):
            source = mount.get("Source")
            if mount.get("RW") and source and (source == str(DATA) or str(DATA).startswith(source.rstrip("/") + "/") or source.startswith(str(DATA) + "/")):
                raise RevokeError("destination_writer_active")
    expected = 'from="66.97.34.158",restrict,command="/usr/bin/rrsync -wo /var/lib/redunisol-bcra-transfer/data" ' + key
    if KEYS.exists():
        if KEYS.is_symlink() or not KEYS.is_file() or KEYS.stat().st_uid != 0 or KEYS.read_text().strip() != expected:
            raise RevokeError("unknown_authorization_will_not_be_removed")
        KEYS.unlink()
    elif not marker.get("authorization_revoked"):
        raise RevokeError("authorization_missing_without_revocation_evidence")
    marker.update(authorization_revoked=True, authorization_revoked_at=datetime.now(timezone.utc).isoformat())
    write_marker(marker)
    remove_alias()
    marker.update(receiver_alias_removed=True)
    write_marker(marker)
    return {"version": 1, "status": "revoked", "transfer_authorization_revoked": True,
            "receiver_alias_removed": True, "public_key_sha256": marker["public_key_sha256"],
            "authorization_revoked_at": marker["authorization_revoked_at"]}


def write_marker(marker):
    temporary = MARKER.with_name(MARKER.name + ".tmp")
    descriptor = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(marker, handle, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(str(temporary), str(MARKER))


def alias_mounts():
    return [line.split() for line in Path("/proc/self/mountinfo").read_text().splitlines()
            if len(line.split()) >= 6 and line.split()[4] == str(ALIAS)]


def remove_alias():
    mounts = alias_mounts()
    if mounts:
        if len(mounts) != 1 or ALIAS.is_symlink() or not ALIAS.is_dir():
            raise RevokeError("unknown_receiver_alias_mount")
        actual, expected = ALIAS.stat(), DATA.stat()
        if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino) or actual.st_uid != 10001 or actual.st_gid != 10001:
            raise RevokeError("receiver_alias_identity_mismatch")
        result = subprocess.run(["umount", "--", str(ALIAS)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode != 0 or alias_mounts():
            raise RevokeError("receiver_alias_unmount_failed")
    if ALIAS.exists():
        info = ALIAS.lstat()
        if ALIAS.is_symlink() or not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or any(ALIAS.iterdir()):
            raise RevokeError("unknown_unmounted_alias_contents")
        ALIAS.rmdir()


def source_remove_private(key):
    status = source_check()
    if status["public_key"] != public_key(key):
        raise RevokeError("source_public_key_changed")
    private = RUNTIME / "id_ed25519"
    if private.exists():
        private.unlink()
    return {"version": 1, "status": "source_private_key_removed", "private_key_present": False,
            "source_manifest_preserved": True, "private_key_exported": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command")
    sub.required = True
    sub.add_parser("check-source")
    for name in ("destination", "source"):
        item = sub.add_parser(name)
        item.add_argument("--public-key", required=True)
    args = parser.parse_args(argv)
    try:
        if not hasattr(os, "geteuid") or os.geteuid() != 0:
            raise RevokeError("linux_root_required")
        if args.command == "check-source":
            result = source_check()
        elif args.command == "destination":
            result = destination_revoke(args.public_key)
        else:
            result = source_remove_private(args.public_key)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        print(json.dumps({"version": 1, "status": "failed", "reason": str(error) if isinstance(error, RevokeError) else "operation_failed"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
