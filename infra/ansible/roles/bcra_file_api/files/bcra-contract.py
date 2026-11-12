"""Read-only validation of BCRA migration provenance and the confined runtime."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess


class ContractError(ValueError):
    pass


def require(condition, reason):
    if not condition:
        raise ContractError(reason)


def migration_document(raw, expected_sha256, image):
    require(re.fullmatch(r"[0-9a-f]{64}", expected_sha256 or ""), "manifest_checksum_required")
    require(hashlib.sha256(raw).hexdigest() == expected_sha256, "manifest_checksum_mismatch")
    require(len(raw) <= 65536, "manifest_too_large")
    document = json.loads(raw)
    require(isinstance(document, dict) and type(document.get("version")) is int and document["version"] == 1,
            "manifest_version_invalid")
    require(document.get("copy_verified") is True and document.get("sqlite_verified") is True,
            "copy_and_sqlite_validation_required")
    require(document.get("transfer_access_revoked") is True and document.get("receiver_alias_removed") is True,
            "temporary_transfer_access_must_be_revoked")
    for name in ("source_manifest_sha256", "destination_manifest_sha256", "post_recovery_manifest_sha256",
                 "copy_tree_sha256", "tree_sha256", "transfer_revocation_receipt_sha256"):
        require(isinstance(document.get(name), str) and re.fullmatch(r"[0-9a-f]{64}", document[name]),
                "migration_evidence_checksum_required")
    require(document.get("image") == image, "migration_image_mismatch")
    container = document.get("source_container_id")
    require(isinstance(container, str) and re.fullmatch(r"[0-9a-f]{12,64}", container), "source_container_required")
    cutoff = document.get("cutoff_at")
    require(isinstance(cutoff, str) and len(cutoff) <= 64, "migration_cutoff_required")
    try:
        moment = datetime.fromisoformat(cutoff.replace("Z", "+00:00"))
    except ValueError as error:
        raise ContractError("migration_cutoff_invalid") from error
    require(moment.tzinfo is not None and moment.utcoffset() == timedelta(0), "migration_cutoff_must_be_utc")
    return {name: document[name] for name in (
        "source_manifest_sha256", "destination_manifest_sha256", "post_recovery_manifest_sha256",
        "copy_tree_sha256", "tree_sha256", "transfer_revocation_receipt_sha256",
        "source_container_id", "cutoff_at", "image",
    )}


def private_bytes(path):
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    with os.fdopen(os.open(path, flags), "rb") as stream:
        metadata = os.fstat(stream.fileno())
        require(stat.S_ISREG(metadata.st_mode), "migration_report_must_be_regular")
        require(metadata.st_uid == 0 and metadata.st_gid == 0 and stat.S_IMODE(metadata.st_mode) == 0o600,
                "migration_report_must_be_private_root_owned")
        raw = stream.read(65537)
    return raw


def read_migration(path, expected_sha256, image):
    return migration_document(private_bytes(path), expected_sha256, image)


def cold_backup_document(raw, expected_sha256, migration, manifest_sha256):
    require(re.fullmatch(r"[0-9a-f]{64}", expected_sha256 or ""), "cold_backup_checksum_required")
    require(hashlib.sha256(raw).hexdigest() == expected_sha256, "cold_backup_checksum_mismatch")
    require(len(raw) <= 65536, "cold_backup_receipt_too_large")
    document = json.loads(raw)
    require(isinstance(document, dict), "cold_backup_receipt_invalid")
    require(type(document.get("version")) is int and document["version"] == 1
            and document.get("scope") == "initial-cold-bcra-local"
            and document.get("status") == "verified", "cold_backup_scope_invalid")
    require(document.get("snapshot_verified") is True and document.get("restored_manifest_verified") is True
            and document.get("offsite") is False and document.get("continuous_backup") is False,
            "cold_backup_restore_proof_required")
    require(document.get("repository_integrity_verified") is True and document.get("read_data") is True,
            "full_repository_read_data_check_required")
    checked_at = document.get("repository_integrity_verified_at")
    require(isinstance(checked_at, str) and len(checked_at) <= 64, "repository_integrity_check_time_required")
    try:
        moment = datetime.fromisoformat(checked_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise ContractError("repository_integrity_check_time_invalid") from error
    require(moment.tzinfo is not None and moment.utcoffset() == timedelta(0), "repository_integrity_check_time_must_be_utc")
    for name in ("repository_id", "snapshot_id"):
        require(isinstance(document.get(name), str) and re.fullmatch(r"[0-9a-f]{64}", document[name]),
                "cold_backup_repository_or_snapshot_invalid")
    require(document.get("migration_manifest_sha256") == manifest_sha256
            and document.get("restored_manifest_sha256") == manifest_sha256
            and document.get("image") == migration["image"]
            and document.get("tree_sha256") == migration["tree_sha256"]
            and document.get("cutoff_at") == migration["cutoff_at"], "cold_backup_migration_mismatch")
    return document


def read_cold_backup(path, receipt_sha256, migration, manifest_sha256):
    document = cold_backup_document(private_bytes(path), receipt_sha256, migration, manifest_sha256)
    restored = Path(document.get("restored_manifest_path", ""))
    base = Path("/var/lib/redunisol-foundation/bcra-cold-backup/restore")
    require(restored.is_absolute() and restored.resolve().is_relative_to(base), "cold_backup_restore_path_invalid")
    require(hashlib.sha256(private_bytes(restored)).hexdigest() == manifest_sha256, "restored_manifest_changed")
    return {"snapshot_id": document["snapshot_id"], "repository_id": document["repository_id"],
            "tree_sha256": document["tree_sha256"], "restored_manifest_verified": True,
            "repository_integrity_verified": True, "read_data": True,
            "repository_integrity_verified_at": document["repository_integrity_verified_at"]}


CONTAINER_FORMAT = r'''{"image_ref":{{json .Config.Image}},"image_id":{{json .Image}},"running":{{json .State.Running}},"user":{{json .Config.User}},"readonly":{{json .HostConfig.ReadonlyRootfs}},"privileged":{{json .HostConfig.Privileged}},"caps":{{json .HostConfig.CapDrop}},"security":{{json .HostConfig.SecurityOpt}},"pids":{{json .HostConfig.PidsLimit}},"memory":{{json .HostConfig.Memory}},"cpus":{{json .HostConfig.NanoCpus}},"ports":{{json .HostConfig.PortBindings}},"mounts":{{json .Mounts}},"tmpfs":{{json .HostConfig.Tmpfs}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"revision":{{json (index .Config.Labels "io.redunisol.applied-revision")}}}'''
IMAGE_FORMAT = r'''{"id":{{json .Id}},"digests":{{json .RepoDigests}}}'''


def docker_json(arguments):
    result = subprocess.run(["docker", *arguments], capture_output=True, text=True, timeout=30, check=False)
    require(result.returncode == 0, "docker_metadata_unavailable")
    return json.loads(result.stdout)


def runtime_document(container, local_image, image, data_dir, revision):
    require(container.get("running") is True, "container_not_running")
    require(container.get("image_ref") == image and image in (local_image.get("digests") or [])
            and container.get("image_id") == local_image.get("id"), "runtime_image_mismatch")
    require(container.get("project") == "bcra-file-api" and container.get("service") == "bcra-file-api"
            and container.get("revision") == revision, "runtime_ownership_mismatch")
    require(container.get("user") == "10001:10001" and container.get("readonly") is True
            and container.get("privileged") is False, "runtime_identity_or_rootfs_invalid")
    require(container.get("caps") == ["ALL"] and "no-new-privileges:true" in (container.get("security") or []),
            "runtime_privilege_confinement_invalid")
    require(container.get("pids") == 64 and container.get("memory") == 2147483648
            and container.get("cpus") == 1000000000, "runtime_resource_limits_invalid")
    require(container.get("ports") == {"8080/tcp": [{"HostIp": "127.0.0.1", "HostPort": "18082"}]},
            "runtime_listener_not_loopback_only")
    mounts = container.get("mounts") or []
    require(len(mounts) == 1 and mounts[0].get("Type") == "bind" and mounts[0].get("Source") == data_dir
            and mounts[0].get("Destination") == "/data" and mounts[0].get("RW") is True,
            "runtime_data_mount_invalid")
    tmpfs = container.get("tmpfs") or {}
    require(set(tmpfs) == {"/tmp"} and "mode=1777" in tmpfs["/tmp"]
            and any(size in tmpfs["/tmp"] for size in ("size=64m", "size=67108864")), "runtime_tmpfs_invalid")
    return {"image": image, "image_id": container["image_id"], "running": True, "confined": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="operation", required=True)
    migration = commands.add_parser("migration")
    migration.add_argument("--manifest", type=Path, required=True)
    migration.add_argument("--expected-sha256", required=True)
    migration.add_argument("--image", required=True)
    cold = commands.add_parser("cold-backup")
    cold.add_argument("--manifest", type=Path, required=True)
    cold.add_argument("--expected-sha256", required=True)
    cold.add_argument("--image", required=True)
    cold.add_argument("--receipt", type=Path, required=True)
    cold.add_argument("--receipt-sha256", required=True)
    runtime = commands.add_parser("runtime")
    runtime.add_argument("--image", required=True)
    runtime.add_argument("--data-dir", required=True)
    runtime.add_argument("--revision", required=True)
    arguments = parser.parse_args()
    try:
        if arguments.operation == "migration":
            result = read_migration(arguments.manifest, arguments.expected_sha256, arguments.image)
        elif arguments.operation == "cold-backup":
            migration = read_migration(arguments.manifest, arguments.expected_sha256, arguments.image)
            result = read_cold_backup(arguments.receipt, arguments.receipt_sha256, migration, arguments.expected_sha256)
        else:
            container = docker_json(["container", "inspect", "--format", CONTAINER_FORMAT, "redunisol-bcra-file-api"])
            image = docker_json(["image", "inspect", "--format", IMAGE_FORMAT, arguments.image])
            result = runtime_document(container, image, arguments.image, arguments.data_dir, arguments.revision)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (ContractError, OSError, ValueError, subprocess.TimeoutExpired) as error:
        reason = str(error) if isinstance(error, ContractError) else "invalid_or_unavailable_evidence"
        print(json.dumps({"ok": False, "reason": reason}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
