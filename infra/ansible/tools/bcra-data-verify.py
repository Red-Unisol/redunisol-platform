#!/usr/bin/env python3
"""Persist public source evidence and verify the stopped destination in stages.

No source volume reads or network calls occur here. Original pre-recovery
reports are immutable. A completed verification is reused only after a fresh,
bounded destination inventory confirms that its final tree is unchanged.
Interrupted recovery without its atomic success report fails closed for review.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile

try:
    import fcntl
except ImportError:
    fcntl = None

PLATFORM = Path("/srv/redunisol/platform/bcra-file-api")
DATA = Path("/srv/redunisol/state/bcra-file-api")


class VerificationError(Exception):
    pass


def require(value, reason):
    if not value:
        raise VerificationError(reason)


def load_module(name):
    path = Path(__file__).with_name(name + ".py")
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), str(path))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def encoded_json(value):
    try:
        raw = base64.b64decode(value, validate=True)
        require(len(raw) <= 16 * 1024 ** 2, "evidence_size_limit")
        parsed = json.loads(raw)
    except (ValueError, UnicodeError):
        raise VerificationError("invalid_encoded_evidence")
    require(isinstance(parsed, dict), "evidence_must_be_object")
    return raw, parsed


def public_completion(value, receipt):
    receipt.version_one(value)
    require(value.get("status") == "source_complete" and value.get("private_key_exported") is False, "source_not_complete")
    import re
    require(isinstance(value.get("source_container_id"), str) and re.fullmatch(r"[0-9a-f]{64}", value["source_container_id"]), "full_source_container_required")
    require(receipt.hash64(value.get("source_manifest_sha256")) and receipt.hash64(value.get("tree_sha256")), "source_manifest_evidence_required")
    require(isinstance(value.get("public_key"), str) and re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/=]+", value["public_key"]), "source_public_key_required")
    receipt.utc(value.get("cutoff_at"))
    require("private_key_present" not in value or type(value["private_key_present"]) is bool, "invalid_private_key_presence")
    fields = ("version", "status", "public_key", "source_container_id", "cutoff_at", "private_key_exported",
              "source_manifest_sha256", "tree_sha256", "private_key_present")
    return {key: value[key] for key in fields if key in value}


def write_once(path, raw):
    require(not path.is_symlink(), "existing_evidence_differs")
    if path.exists():
        require(not path.is_symlink() and path.is_file() and path.read_bytes() == raw, "existing_evidence_differs")
        require(path.stat().st_uid == 0 and stat.S_IMODE(path.stat().st_mode) == 0o600, "existing_evidence_not_private")
        return False
    temporary = path.with_name(path.name + ".tmp")
    descriptor = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(str(temporary), str(path))
    return True


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()


def stage_source(completion_base64, manifest_base64):
    inventory, receipt = load_module("bcra-data-manifest"), load_module("bcra-data-receipt")
    _, value = encoded_json(completion_base64)
    raw, manifest = encoded_json(manifest_base64)
    completion = public_completion(value, receipt)
    require(hashlib.sha256(raw).hexdigest() == completion["source_manifest_sha256"]
            and manifest.get("tree_sha256") == completion["tree_sha256"], "source_manifest_binding_mismatch")
    path = PLATFORM / "source-manifest.json"
    with tempfile.TemporaryDirectory(prefix=".source-evidence-", dir=str(PLATFORM)) as temporary:
        candidate = Path(temporary) / "source-manifest.json"
        write_once(candidate, raw)
        parsed, checksum = inventory.checked_manifest(candidate)
        receipt.version_one(parsed)
    require(parsed == manifest and checksum == completion["source_manifest_sha256"], "invalid_source_inventory")
    changed = write_once(path, raw)
    completion_path = PLATFORM / "source-completion.json"
    if completion_path.exists():
        previous, _ = receipt.report(completion_path)
        previous = public_completion(previous, receipt)
        # Private key presence changes legitimately after cleanup; preserve the
        # original observation and bind every immutable case field.
        require({k: v for k, v in previous.items() if k != "private_key_present"}
                == {k: v for k, v in completion.items() if k != "private_key_present"}, "existing_source_case_differs")
    else:
        changed = write_once(completion_path, json_bytes(completion)) or changed
    return {"version": 1, "status": "source_staged", "changed": changed,
            "source_manifest_sha256": completion["source_manifest_sha256"], "source_container_id": completion["source_container_id"]}


def stage_image(image_base64):
    receipt = load_module("bcra-data-receipt")
    raw, value = encoded_json(image_base64)
    completion, _ = receipt.report(PLATFORM / "source-completion.json")
    require(value.get("id") == completion.get("source_container_id") and value.get("running") is False
            and value.get("data_root") == receipt.SOURCE_ROOT and receipt.APPROVED_IMAGE in value.get("repo_digests", []), "source_image_binding_mismatch")
    import re
    require(isinstance(value.get("image_id"), str) and re.fullmatch(r"sha256:[0-9a-f]{64}", value["image_id"])
            and isinstance(value.get("image_tag"), str) and re.fullmatch(r"ghcr\.io/red-unisol/bcra-file-api:sha-[0-9a-f]{40}", value["image_tag"]), "invalid_source_image_metadata")
    receipt.utc(value.get("observed_at"))
    receipt.utc(value.get("finished_at"))
    safe = {key: value[key] for key in ("observed_at", "id", "running", "finished_at", "image_tag", "image_id", "repo_digests", "data_root")}
    safe["origin_artifact_sha256"] = hashlib.sha256(raw).hexdigest()
    safe["repo_digests"] = [receipt.APPROVED_IMAGE]
    changed = write_once(PLATFORM / "source-image.json", json_bytes(safe))
    return {"version": 1, "status": "image_staged", "changed": changed}


def assert_stopped():
    transfer = load_module("bcra-data-transfer")
    transfer.assert_destination_stopped()
    process = subprocess.run(["pgrep", "-u", "10001", "-x", "rsync|rrsync"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    require(process.returncode == 1, "destination_receiver_active_or_unknown")


def verify_destination(max_read_mib_per_sec=128, sqlite_timeout_seconds=3600):
    inventory, receipt = load_module("bcra-data-manifest"), load_module("bcra-data-receipt")
    assert_stopped()
    source, source_hash = inventory.checked_manifest(PLATFORM / "source-manifest.json")
    completion, _ = receipt.report(PLATFORM / "source-completion.json")
    completion = public_completion(completion, receipt)
    require(source_hash == completion["source_manifest_sha256"] and source["tree_sha256"] == completion["tree_sha256"], "staged_source_binding_mismatch")
    state_path = PLATFORM / "data-verification.json"
    state = receipt.report(state_path)[0] if state_path.exists() else {"version": 1, "phase": "preparing",
                "source_manifest_sha256": source_hash, "source_container_id": completion["source_container_id"], "cutoff_at": completion["cutoff_at"]}
    require(state.get("version") == 1 and state.get("source_manifest_sha256") == source_hash
            and state.get("source_container_id") == completion["source_container_id"]
            and state.get("cutoff_at") == completion["cutoff_at"], "verification_case_mismatch")
    pre_path, compare_path = PLATFORM / "destination-manifest.json", PLATFORM / "copy-comparison.json"
    sql_path, final_path = PLATFORM / "sqlite-verification.json", PLATFORM / "post-recovery-manifest.json"
    reused = state.get("phase") == "verified"
    if reused:
        for name, path in (("destination_manifest_sha256", pre_path), ("comparison_sha256", compare_path),
                           ("sqlite_report_sha256", sql_path), ("post_recovery_manifest_sha256", final_path)):
            require(receipt.report(path)[1] == state.get(name), "completed_verification_report_changed")
        final, _ = inventory.checked_manifest(final_path)
        pre, pre_hash = inventory.checked_manifest(pre_path)
        comparison, _ = receipt.report(compare_path)
        require(comparison.get("status") == "verified" and comparison.get("copy_verified") is True
                and comparison.get("differences") == [] and comparison.get("source_manifest_sha256") == source_hash
                and comparison.get("destination_manifest_sha256") == pre_hash
                and comparison.get("tree_sha256") == source["tree_sha256"] == pre["tree_sha256"]
                and source["entries"] == pre["entries"], "completed_copy_proof_invalid")
        receipt.sqlite_contract(receipt.report(sql_path)[0], pre, final, inventory)
        current = inventory.inventory(DATA, max_read_mib_per_sec)
        require(current["entries"] == final["entries"] and current["tree_sha256"] == state.get("tree_sha256"), "verified_destination_tree_changed")
        assert_stopped()
        return {"version": 1, "status": "verified", "changed": False, "reused": True,
                "tree_sha256": state["tree_sha256"], "verification_receipt_sha256": receipt.report(state_path)[1]}
    if state_path.exists():
        require(state.get("phase") in ("preparing", "copied", "recovering", "sqlite_verified"), "unknown_verification_phase")
    else:
        require(not any(path.exists() for path in (pre_path, compare_path, sql_path, final_path)), "unknown_existing_verification_reports")
        inventory.write_report(state_path, state)
    created_pre = False
    if not pre_path.exists():
        require(state["phase"] == "preparing", "missing_original_destination_inventory")
        inventory.write_report(pre_path, inventory.inventory(DATA, max_read_mib_per_sec))
        created_pre = True
    pre, pre_hash = inventory.checked_manifest(pre_path)
    require(state.get("destination_manifest_sha256", pre_hash) == pre_hash, "original_destination_manifest_changed")
    comparison = inventory.compare(PLATFORM / "source-manifest.json", pre_path)
    require(comparison["copy_verified"] is True, "destination_does_not_match_source")
    if compare_path.exists():
        previous, _ = receipt.report(compare_path)
        require(all(previous.get(key) == comparison[key] for key in ("version", "status", "copy_verified", "source_manifest_sha256", "destination_manifest_sha256", "tree_sha256", "differences")), "existing_comparison_differs")
    else:
        inventory.write_report(compare_path, comparison)
    if not sql_path.exists():
        require(state["phase"] != "recovering", "interrupted_sqlite_recovery_requires_review")
        require(not final_path.exists(), "final_inventory_without_sqlite_proof")
        if not created_pre:
            current = inventory.inventory(DATA, max_read_mib_per_sec)
            require(current["entries"] == pre["entries"], "destination_changed_before_recovery")
        state.update(phase="recovering", destination_manifest_sha256=pre_hash)
        inventory.write_report(state_path, state)
        assert_stopped()
        sql = inventory.verify_sqlite(DATA, sqlite_timeout_seconds)
        inventory.write_report(sql_path, sql)
    require(state["phase"] in ("recovering", "sqlite_verified"), "sqlite_proof_without_recovery_intent")
    sql, sql_hash = receipt.report(sql_path)
    require(state.get("sqlite_report_sha256", sql_hash) == sql_hash, "sqlite_report_changed")
    state.update(phase="sqlite_verified", sqlite_report_sha256=sql_hash, destination_manifest_sha256=pre_hash)
    inventory.write_report(state_path, state)
    if final_path.exists():
        final, final_hash = inventory.checked_manifest(final_path)
        current = inventory.inventory(DATA, max_read_mib_per_sec)
        require(current["entries"] == final["entries"], "post_recovery_destination_changed")
    else:
        final = inventory.inventory(DATA, max_read_mib_per_sec)
        inventory.write_report(final_path, final)
        _, final_hash = inventory.checked_manifest(final_path)
    receipt.sqlite_contract(sql, pre, final, inventory)
    assert_stopped()
    state.update(phase="verified", status="verified", copy_verified=True, sqlite_verified=True,
                 comparison_sha256=receipt.report(compare_path)[1], post_recovery_manifest_sha256=final_hash,
                 copy_tree_sha256=source["tree_sha256"], tree_sha256=final["tree_sha256"])
    inventory.write_report(state_path, state)
    return {"version": 1, "status": "verified", "changed": True, "reused": False,
            "tree_sha256": state["tree_sha256"], "verification_receipt_sha256": receipt.report(state_path)[1]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command")
    sub.required = True
    source = sub.add_parser("stage-source")
    source.add_argument("--completion-base64", required=True)
    source.add_argument("--manifest-base64", required=True)
    image = sub.add_parser("stage-image")
    image.add_argument("--image-base64", required=True)
    verify = sub.add_parser("verify")
    verify.add_argument("--max-read-mib-per-sec", type=float, default=128)
    verify.add_argument("--sqlite-timeout-seconds", type=float, default=3600)
    args = parser.parse_args(argv)
    lock = None
    try:
        require(fcntl is not None and hasattr(os, "geteuid") and os.geteuid() == 0, "linux_root_required")
        require(PLATFORM.is_dir() and not PLATFORM.is_symlink() and PLATFORM.resolve() == PLATFORM
                and PLATFORM.stat().st_uid == 0 and stat.S_IMODE(PLATFORM.stat().st_mode) == 0o700, "unsafe_platform_directory")
        lock = (PLATFORM / "data-verification.lock").open("a+")
        os.chmod(str(PLATFORM / "data-verification.lock"), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.command == "stage-source":
            result = stage_source(args.completion_base64, args.manifest_base64)
        elif args.command == "stage-image":
            result = stage_image(args.image_base64)
        else:
            result = verify_destination(args.max_read_mib_per_sec, args.sqlite_timeout_seconds)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        print(json.dumps({"version": 1, "status": "failed", "reason": str(error) if isinstance(error, VerificationError) else "invalid_or_unavailable_evidence"}))
        return 1
    finally:
        if lock is not None:
            lock.close()


if __name__ == "__main__":
    sys.exit(main())
