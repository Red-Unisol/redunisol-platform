"""One initial cold BCRA snapshot in an existing repository; no retention or init."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import sys
import tempfile
import time

try:
    import fcntl
except ImportError:
    fcntl = None

sys.dont_write_bytecode = True


class BackupError(ValueError):
    pass


def require(condition, reason):
    if not condition:
        raise BackupError(reason)


class TimeBudget:
    def __init__(self, seconds, *, clock=time.monotonic):
        require(60 <= seconds <= 21600, "bounded_backup_timeout_required")
        self.clock = clock
        self.deadline = clock() + seconds

    def remaining(self, maximum=None):
        remaining = self.deadline - self.clock()
        require(remaining > 0, "cold_backup_time_budget_exhausted")
        return remaining if maximum is None else min(remaining, maximum)


class BudgetReadLimiter:
    def __init__(self, inventory, budget, rate):
        self.limiter = inventory.ReadLimiter(rate * 1024 ** 2)
        self.budget = budget

    @property
    def bytes(self):
        return self.limiter.bytes

    @property
    def rate(self):
        return self.limiter.rate

    def consume(self, count):
        self.budget.remaining()
        self.limiter.consume(count)
        self.budget.remaining()


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(arguments, *, timeout=60):
    environment = {key: value for key, value in os.environ.items() if not key.startswith("RESTIC_")}
    result = subprocess.run(arguments, capture_output=True, timeout=timeout, env=environment, check=False)
    require(result.returncode == 0, "command_failed")
    return result.stdout


def restic(prefix, *arguments, timeout=60):
    return run([*prefix, *arguments], timeout=timeout)


def repository_id(prefix, timeout=60):
    value = json.loads(restic(prefix, "cat", "config", timeout=timeout))
    require(isinstance(value.get("id"), str) and re.fullmatch(r"[0-9a-f]{64}", value["id"]), "repository_identity_invalid")
    return value["id"]


def verify_snapshot(prefix, snapshot_id, sources, tags, timeout=60):
    require(re.fullmatch(r"[0-9a-f]{64}", snapshot_id), "full_snapshot_id_required")
    values = json.loads(restic(prefix, "snapshots", "--json", snapshot_id, timeout=timeout))
    require(len(values) == 1 and values[0].get("id") == snapshot_id, "snapshot_identity_mismatch")
    value = values[0]
    require(set(value.get("paths", [])) == {str(path) for path in sources}, "snapshot_source_paths_mismatch")
    require(set(tags).issubset(value.get("tags", [])), "snapshot_tags_mismatch")
    require(value.get("hostname") == socket.gethostname(), "snapshot_host_mismatch")
    return value


def matching_snapshots(prefix, sources, tags, timeout=60):
    values = json.loads(restic(prefix, "snapshots", "--json", "--tag", "redunisol-bcra-cold", timeout=timeout))
    matches = [row["id"] for row in values if set(tags).issubset(row.get("tags", []))
               and set(row.get("paths", [])) == {str(path) for path in sources}
               and row.get("hostname") == socket.gethostname()]
    require(len(matches) <= 1, "ambiguous_existing_cold_snapshots")
    return matches


def create_snapshot(prefix, sources, tags, timeout):
    arguments = ["backup", "--json", "--one-file-system", "--host", socket.gethostname()]
    for tag in tags:
        arguments.extend(["--tag", tag])
    output = restic(prefix, *arguments, "--", *(str(path) for path in sources), timeout=timeout)
    summaries = [json.loads(line) for line in output.splitlines() if line.strip()]
    ids = [row.get("snapshot_id") for row in summaries if row.get("message_type") == "summary"]
    require(len(ids) == 1 and isinstance(ids[0], str) and re.fullmatch(r"[0-9a-f]{64}", ids[0]), "backup_acknowledgement_missing")
    return ids[0]


def verify_repository_integrity(prefix, timeout):
    # A snapshot listing proves metadata only. Read and authenticate every pack
    # before claiming a verified encrypted repository or allowing initial startup.
    restic(prefix, "check", "--read-data", timeout=timeout)
    return {"repository_integrity_verified": True, "read_data": True,
            "repository_integrity_verified_at": datetime.now(timezone.utc).isoformat()}


def restore_manifest(prefix, snapshot_id, manifest_path, target, expected_sha256, timeout=120):
    require(not target.exists(), "restore_target_must_be_new")
    target.mkdir(mode=0o700)
    restic(prefix, "restore", snapshot_id, "--target", str(target), "--verify", "--include", str(manifest_path), timeout=timeout)
    restored = target / str(manifest_path).lstrip("/")
    require(restored.is_file() and not restored.is_symlink(), "restored_manifest_missing")
    require(hashlib.sha256(restored.read_bytes()).hexdigest() == expected_sha256, "restored_manifest_hash_mismatch")
    return restored


def validate_destination(repository, mountpoint, mount_uuid, password_file):
    require(mountpoint.is_dir() and mountpoint.resolve() == mountpoint and mountpoint != Path("/"), "backup_mount_invalid")
    actual_uuid = run(["findmnt", "-rn", "--mountpoint", str(mountpoint), "-o", "UUID"]).decode().strip()
    require(actual_uuid == mount_uuid and mountpoint.stat().st_dev != Path("/").stat().st_dev, "backup_mount_identity_mismatch")
    require(repository.is_dir() and repository.resolve() == repository and repository.is_relative_to(mountpoint),
            "existing_repository_not_on_backup_mount")
    require((repository / "config").is_file() and not (repository / "config").is_symlink(), "existing_repository_required")
    info = password_file.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) in {0o400, 0o600},
            "private_existing_password_file_required")


def assert_container_cold(container, data_dir):
    require(container.get("name", "").lstrip("/") != "redunisol-bcra-file-api", "bcra_application_must_be_stopped")
    for mount in container.get("mounts", []):
        source = Path(mount.get("Source") or "/nonexistent-mount-source").resolve()
        overlap = source == data_dir or source.is_relative_to(data_dir) or data_dir.is_relative_to(source)
        require(not (mount.get("RW") is True and overlap), "running_container_can_write_bcra_data")


def assert_cold(data_dir):
    ids = run(["docker", "ps", "--quiet"]).decode().split()
    if not ids:
        return
    template = '{"name":{{json .Name}},"mounts":{{json .Mounts}}}'
    for container in ids:
        metadata = json.loads(run(["docker", "container", "inspect", "--format", template, container]))
        assert_container_cold(metadata, data_dir)


def atomic_receipt(path, record):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False, encoding="utf-8") as stream:
        temporary = Path(stream.name)
        os.fchmod(stream.fileno(), 0o600)
        json.dump(record, stream, sort_keys=True, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def execute(arguments):
    budget = TimeBudget(arguments.timeout_seconds)
    platform, data, state = arguments.platform_dir, arguments.data_dir, arguments.state_dir
    require(platform == Path("/srv/redunisol/platform/bcra-file-api")
            and data == Path("/srv/redunisol/state/bcra-file-api")
            and state == Path("/var/lib/redunisol-foundation/bcra-cold-backup"), "reviewed_backup_paths_required")
    require(platform.resolve() == platform and data.resolve() == data and state.resolve() == state, "symlinked_backup_paths_forbidden")
    require(re.fullmatch(r"[0-9a-f]{40}", arguments.revision), "reviewed_revision_required")
    require(0 < arguments.read_mib_per_second <= 128, "bounded_destination_reads_required")
    validate_destination(arguments.repository, arguments.mountpoint, arguments.mount_uuid, arguments.password_file)
    contract = load_module(platform / "bcra-contract.py", "bcra_application_contract")
    inventory = load_module(platform / "bcra-data-manifest.py", "bcra_data_inventory")
    manifest_path = platform / "data-migration.json"
    migration = contract.read_migration(manifest_path, arguments.manifest_sha256, arguments.image)
    final, final_hash = inventory.checked_manifest(platform / "post-recovery-manifest.json")
    require(final_hash == migration["post_recovery_manifest_sha256"] and final["tree_sha256"] == migration["tree_sha256"],
            "post_recovery_copy_evidence_mismatch")
    assert_cold(data)
    before = inventory.inventory(data, limiter=BudgetReadLimiter(inventory, budget, arguments.read_mib_per_second))
    require(before["entries"] == final["entries"] and before["tree_sha256"] == migration["tree_sha256"], "cold_tree_changed_since_validation")
    state.joinpath("cache").mkdir(mode=0o700, exist_ok=True)
    prefix = ["/usr/bin/restic", "--repo", str(arguments.repository), "--password-file", str(arguments.password_file),
              "--cache-dir", str(state / "cache")]
    identity = repository_id(prefix, budget.remaining(60))
    sources = [data, manifest_path, platform / "docker-compose.yml"]
    small_hashes = {str(path): hashlib.sha256(contract.private_bytes(path)).hexdigest() for path in sources[1:]}
    tags = ["redunisol-bcra-cold", "service:bcra-file-api", "manifest:" + arguments.manifest_sha256,
            "cutoff:" + migration["cutoff_at"], "compose:" + small_hashes[str(platform / "docker-compose.yml")]]
    receipt_path = platform / "cold-backup.json"
    if receipt_path.exists():
        raw = contract.private_bytes(receipt_path)
        record = contract.cold_backup_document(raw, hashlib.sha256(raw).hexdigest(), migration, arguments.manifest_sha256)
        require(record["repository_id"] == identity, "cold_repository_changed")
        verify_snapshot(prefix, record["snapshot_id"], sources, tags, budget.remaining(60))
        contract.read_cold_backup(receipt_path, hashlib.sha256(raw).hexdigest(), migration, arguments.manifest_sha256)
        # Reuse the initial full-read proof and its original timestamp. This is
        # not a recurring repository health check and must not renew freshness.
        return {"ok": True, "created": False, "snapshot_created": False, "snapshot_id": record["snapshot_id"],
                "receipt_sha256": hashlib.sha256(raw).hexdigest()}
    require(arguments.mountpoint.stat().st_dev != data.stat().st_dev, "cold_copy_must_be_on_another_device")
    free = os.statvfs(arguments.mountpoint)
    require(free.f_bavail * free.f_frsize > before["unique_bytes_read"] * 1.1 + 1073741824, "backup_free_space_insufficient")
    candidates = matching_snapshots(prefix, sources, tags, budget.remaining(60))
    snapshot = candidates[0] if candidates else create_snapshot(prefix, sources, tags, budget.remaining())
    verify_snapshot(prefix, snapshot, sources, tags, budget.remaining(60))
    integrity = verify_repository_integrity(prefix, budget.remaining())
    assert_cold(data)
    after = inventory.inventory(data, limiter=BudgetReadLimiter(inventory, budget, arguments.read_mib_per_second))
    require(after["entries"] == before["entries"] and after["tree_sha256"] == migration["tree_sha256"], "cold_tree_changed_during_backup")
    require(small_hashes == {str(path): hashlib.sha256(contract.private_bytes(path)).hexdigest() for path in sources[1:]},
            "cold_configuration_changed_during_backup")
    restore_base = state / "restore"
    restore_base.mkdir(mode=0o700, exist_ok=True)
    run_directory = Path(tempfile.mkdtemp(prefix="proof-", dir=restore_base))
    restored = restore_manifest(prefix, snapshot, manifest_path, run_directory / "files", arguments.manifest_sha256,
                                budget.remaining(120))
    assert_cold(data)
    record = {"version": 1, "scope": "initial-cold-bcra-local", "status": "verified", "git_revision": arguments.revision,
              "repository_id": identity, "snapshot_id": snapshot, "snapshot_verified": True,
              "migration_manifest_sha256": arguments.manifest_sha256, "tree_sha256": migration["tree_sha256"],
              "image": arguments.image, "cutoff_at": migration["cutoff_at"], "source_paths": [str(path) for path in sources],
              "compose_sha256": small_hashes[str(platform / "docker-compose.yml")],
              "restored_manifest_path": str(restored), "restored_manifest_sha256": arguments.manifest_sha256,
              "restored_manifest_verified": True, "offsite": False, "continuous_backup": False}
    record.update(integrity)
    budget.remaining()
    atomic_receipt(receipt_path, record)
    return {"ok": True, "created": True, "snapshot_created": not candidates, "snapshot_id": snapshot,
            "receipt_sha256": hashlib.sha256(receipt_path.read_bytes()).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply-authorized", action="store_true", required=True)
    parser.add_argument("--revision", required=True)
    for name in ("platform-dir", "data-dir", "state-dir", "repository", "password-file", "mountpoint", "lock-file"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--mount-uuid", required=True)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--read-mib-per-second", type=float, default=128)
    parser.add_argument("--timeout-seconds", type=int, default=14400)
    arguments = parser.parse_args()
    try:
        require(fcntl is not None, "linux_backup_host_required")
        require(arguments.lock_file == Path("/var/lib/redunisol-foundation/backup-state/job.lock"), "foundation_repository_lock_required")
        flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        with os.fdopen(os.open(arguments.lock_file, flags, 0o600), "r+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            print(json.dumps(execute(arguments), sort_keys=True))
        return 0
    except Exception:
        # Never expose restic diagnostics, file contents, credentials or dataset records.
        print(json.dumps({"ok": False, "reason": "cold_backup_not_verified"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
