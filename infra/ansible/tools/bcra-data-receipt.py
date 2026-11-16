#!/usr/bin/env python3
"""Consolidate BCRA migration evidence; never reads data volumes or calls APIs.

Inputs are the actual JSON reports/manifests from the stopped-volume migration.
The output is deterministic: no success flag, cutoff, tree or source identity is
accepted as a CLI assertion. The approved image must be present in the sanitized
source Docker evidence. Run beside bcra-data-manifest.py on the controller or
destination; preserve the input reports for audit.
"""
import argparse
from datetime import datetime, timedelta
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys

APPROVED_IMAGE = "ghcr.io/red-unisol/bcra-file-api@sha256:78d3b2536caf2c9a281804b9a5fe21aa5e030c8240cad75a88a7d339481af6e4"
SOURCE_ROOT = "/var/lib/docker/volumes/bcra-file-poc_bcra-file-data/_data"
DESTINATION_ROOT = "/srv/redunisol/state/bcra-file-api"
RECEIVER_ALIAS = "/var/lib/redunisol-bcra-transfer/data"
HASH = r"[0-9a-f]{64}"


class ReceiptError(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise ReceiptError(reason)


def hash64(value):
    return isinstance(value, str) and re.fullmatch(HASH, value) is not None


def no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate_report_key")
        result[key] = value
    return result


def report(path):
    require(not path.is_symlink() and path.is_file(), "report_must_be_regular")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0) | getattr(os, "O_NONBLOCK", 0)
    with os.fdopen(os.open(str(path), flags), "rb") as handle:
        metadata = os.fstat(handle.fileno())
        require(stat.S_ISREG(metadata.st_mode), "report_must_be_regular")
        raw = handle.read(16 * 1024 * 1024 + 1)
    require(len(raw) <= 16 * 1024 * 1024, "report_size_limit")
    try:
        value = json.loads(raw, object_pairs_hook=no_duplicate_keys)
    except (ValueError, UnicodeError):
        raise ReceiptError("invalid_report_json")
    require(isinstance(value, dict), "report_must_be_object")
    return value, hashlib.sha256(raw).hexdigest()


def utc(value):
    require(isinstance(value, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})", value), "invalid_evidence_timestamp")
    text = value.replace("Z", "+00:00")
    # Docker emits nanoseconds; datetime stores microseconds. Preserve original
    # strings in the receipt and truncate only for ordering these observations.
    text = re.sub(r"(\.[0-9]{6})[0-9]+(?=[+-])", r"\1", text)
    text = text[:-3] + text[-2:]
    try:
        moment = datetime.strptime(text, "%Y-%m-%dT%H:%M:%S.%f%z" if "." in text else "%Y-%m-%dT%H:%M:%S%z")
    except ValueError:
        raise ReceiptError("invalid_evidence_timestamp")
    require(moment.utcoffset() == timedelta(0), "evidence_timestamp_must_be_utc")
    return moment


def version_one(value):
    require(type(value.get("version")) is int and value["version"] == 1, "invalid_report_version")


def load_inventory_module():
    path = Path(__file__).with_name("bcra-data-manifest.py")
    spec = importlib.util.spec_from_file_location("bcra_receipt_inventory", str(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def inventories(source_path, destination_path, final_path, inventory_module):
    result = []
    for path in (source_path, destination_path, final_path):
        original, actual_hash = report(path)
        parsed, validated_hash = inventory_module.checked_manifest(path)
        version_one(parsed)
        require(parsed == original and validated_hash == actual_hash, "inventory_changed_during_validation")
        require(all(entry["uid"] == 10001 and entry["gid"] == 10001 for entry in parsed["entries"]), "inventory_numeric_owner_mismatch")
        utc(parsed.get("generated_at"))
        result.append((parsed, actual_hash))
    return result


def sqlite_contract(sqlite_report, pre, final, inventory_module):
    version_one(sqlite_report)
    require(sqlite_report.get("status") == "verified" and sqlite_report.get("sqlite_verified") is True
            and sqlite_report.get("destination_only") is True and sqlite_report.get("freshness_refreshed") is False,
            "sqlite_report_not_verified")
    before = {entry["path"]: entry for entry in pre["entries"]}
    after = {entry["path"]: entry for entry in final["entries"]}
    components = sqlite_report.get("published_components")
    pending = sqlite_report.get("pending_recovered")
    publications = sqlite_report.get("publications")
    require(isinstance(components, list) and components and isinstance(pending, list) and isinstance(publications, list), "sqlite_report_missing_results")
    publication_names = {path for path in ("current.json", "active.json") if path in before}
    require({item.get("manifest") for item in publications if isinstance(item, dict)} == publication_names
            and len(publications) == len(publication_names), "sqlite_publication_coverage_mismatch")
    seen_components, checked_kinds = set(), set()
    safe_components = []
    for component in components:
        require(isinstance(component, dict), "invalid_sqlite_component")
        path, kind = component.get("path"), component.get("kind")
        require(path not in seen_components and path in before and before[path]["kind"] == "file"
                and before[path] == after.get(path) and component.get("quick_check") == "ok", "published_component_changed_or_unchecked")
        require(hash64(component.get("version")) and type(component.get("rows")) is int and component["rows"] >= 0
                and inventory_module.valid_month(component.get("period")), "invalid_sqlite_component")
        if kind == "legacy":
            require(path == "snapshot.sqlite", "invalid_legacy_component_path")
        else:
            require(kind in inventory_module.KINDS and path == "components/{}/{}.sqlite".format(kind, component["version"]), "invalid_sqlite_component_path")
        seen_components.add(path)
        checked_kinds.add(kind)
        safe_components.append({key: component[key] for key in ("path", "kind", "version", "period", "rows", "quick_check")})
    if "current.json" in publication_names:
        require("current" in checked_kinds, "sqlite_current_not_checked")
    if "active.json" in publication_names:
        require(inventory_module.KINDS.issubset(checked_kinds), "sqlite_active_bundle_not_checked")
    if "snapshot.sqlite" in before:
        require("snapshot.sqlite" in seen_components, "sqlite_legacy_not_checked")
    changes_allowed, seen_pending = {}, set()
    for component in pending:
        require(isinstance(component, dict), "invalid_pending_result")
        path, kind, version = component.get("path"), component.get("kind"), component.get("version")
        require(kind in inventory_module.KINDS and hash64(version) and path == "pending/{}-{}.sqlite".format(kind, version)
                and path not in seen_pending and path in before and before[path]["kind"] == "file"
                and path in after and after[path]["kind"] == "file", "invalid_pending_result")
        for field in ("complete", "journal_present_before", "journal_present_after"):
            require(type(component.get(field)) is bool, "invalid_pending_result")
        journal = path + "-journal"
        require(component["journal_present_before"] == (journal in before)
                and component["journal_present_after"] == (journal in after), "pending_journal_evidence_mismatch")
        require(not component["journal_present_after"] or component["journal_present_before"], "unexpected_pending_journal_created")
        if component["journal_present_before"]:
            changes_allowed[path] = {"size", "sha256"}
            if not component["journal_present_after"]:
                changes_allowed[journal] = {"removed"}
        seen_pending.add(path)
    all_pending = {path for path in before if re.fullmatch(r"pending/(?:current|history|corrections|normal|padron)-" + HASH + r"\.sqlite", path)}
    require(seen_pending == all_pending, "pending_sqlite_coverage_mismatch")
    for path in before.keys() | after.keys():
        a, b = before.get(path), after.get(path)
        if a == b:
            continue
        if b is None:
            require(changes_allowed.get(path) == {"removed"}, "unexpected_post_recovery_removal")
        else:
            require(a is not None and set(key for key in a.keys() | b.keys() if a.get(key) != b.get(key)).issubset(changes_allowed.get(path, set())), "unexpected_post_recovery_change")
    safe_publications = []
    for publication in publications:
        require(hash64(publication.get("version")) and inventory_module.valid_month(publication.get("period")), "invalid_sqlite_publication")
        capabilities = publication.get("capabilities")
        require(isinstance(capabilities, dict) and set(capabilities) == {"current", "history", "padron", "normal_since"}
                and all(type(value) is bool for value in capabilities.values()), "invalid_sqlite_publication")
        utc(publication.get("checked_at"))
        safe_publications.append({key: publication[key] for key in ("manifest", "version", "period", "checked_at", "capabilities")})
    return safe_publications, safe_components


def consolidate(paths, image=APPROVED_IMAGE, inventory_module=None):
    require(image == APPROVED_IMAGE, "unapproved_image")
    require(len({path.absolute().resolve() for path in paths.values()}) == len(paths), "reports_must_have_distinct_paths")
    module = inventory_module or load_inventory_module()
    (source, source_hash), (pre, pre_hash), (final, final_hash) = inventories(
        paths["source_manifest"], paths["destination_manifest"], paths["post_recovery_manifest"], module)
    reports, hashes = {}, {}
    for name in ("comparison", "sqlite_report", "source_completion", "source_image", "revocation", "source_key_cleanup"):
        reports[name], hashes[name] = report(paths[name])
    comparison = reports["comparison"]
    version_one(comparison)
    require(comparison.get("status") == "verified" and comparison.get("copy_verified") is True and comparison.get("differences") == [], "copy_report_not_verified")
    require(source["entries"] == pre["entries"] and comparison.get("source_manifest_sha256") == source_hash
            and comparison.get("destination_manifest_sha256") == pre_hash
            and comparison.get("tree_sha256") == source["tree_sha256"] == pre["tree_sha256"], "copy_report_manifest_mismatch")
    completion = reports["source_completion"]
    version_one(completion)
    require(completion.get("status") == "source_complete" and completion.get("private_key_exported") is False,
            "source_completion_not_verified")
    require(completion.get("source_manifest_sha256") == source_hash and completion.get("tree_sha256") == source["tree_sha256"], "source_completion_manifest_mismatch")
    container = completion.get("source_container_id")
    require(isinstance(container, str) and re.fullmatch(r"[0-9a-f]{64}", container), "full_source_container_required")
    key = completion.get("public_key")
    require(isinstance(key, str) and re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/=]+", key), "source_public_key_required")
    key_hash = hashlib.sha256(key.encode()).hexdigest()
    source_image = reports["source_image"]
    require(source_image.get("id") == container and source_image.get("running") is False
            and source_image.get("data_root") == SOURCE_ROOT, "source_image_container_or_volume_mismatch")
    require(isinstance(source_image.get("repo_digests"), list) and image in source_image["repo_digests"], "source_image_digest_mismatch")
    require(isinstance(source_image.get("image_id"), str) and re.fullmatch(r"sha256:" + HASH, source_image["image_id"]), "source_image_id_required")
    require(isinstance(source_image.get("image_tag"), str) and re.fullmatch(r"ghcr\.io/red-unisol/bcra-file-api:sha-[0-9a-f]{40}", source_image["image_tag"]), "source_image_tag_required")
    revocation = reports["revocation"]
    version_one(revocation)
    if revocation.get("status") == "revoked":
        require(revocation.get("transfer_authorization_revoked") is True, "transfer_authorization_not_revoked")
    else:
        require(revocation.get("authorization_revoked") is True and revocation.get("destination_root") == DESTINATION_ROOT
                and revocation.get("receiver_alias") == RECEIVER_ALIAS and revocation.get("source_host") == "66.97.34.158", "transfer_authorization_not_revoked")
    require(revocation.get("receiver_alias_removed") is True and revocation.get("public_key_sha256") == key_hash,
            "receiver_alias_or_key_revocation_mismatch")
    cleanup = reports["source_key_cleanup"]
    version_one(cleanup)
    require(cleanup.get("status") == "source_private_key_removed" and cleanup.get("private_key_present") is False
            and cleanup.get("source_manifest_preserved") is True and cleanup.get("private_key_exported") is False,
            "source_private_key_cleanup_required")
    publications, components = sqlite_contract(reports["sqlite_report"], pre, final, module)
    times = {"source_stopped": utc(source_image.get("finished_at")), "source_observed": utc(source_image.get("observed_at")),
             "cutoff": utc(completion.get("cutoff_at")), "source_inventory": utc(source.get("generated_at")),
             "destination_inventory": utc(pre.get("generated_at")), "comparison": utc(comparison.get("checked_at")),
             "sqlite": utc(reports["sqlite_report"].get("verified_at")), "final_inventory": utc(final.get("generated_at")),
             "revocation": utc(revocation.get("authorization_revoked_at"))}
    require(times["source_stopped"] <= times["source_observed"] <= times["cutoff"]
            <= min(times["source_inventory"], times["destination_inventory"]), "source_copy_chronology_invalid")
    require(max(times["source_inventory"], times["destination_inventory"]) <= times["comparison"]
            <= times["sqlite"] <= times["final_inventory"] and times["cutoff"] <= times["revocation"], "verification_chronology_invalid")
    return {"version": 1, "scope": "stopped-bcra-volume-migration", "status": "verified",
            "copy_verified": True, "sqlite_verified": True, "transfer_access_revoked": True, "receiver_alias_removed": True,
            "source_private_key_removed": True, "source_manifest_sha256": source_hash,
            "destination_manifest_sha256": pre_hash, "post_recovery_manifest_sha256": final_hash,
            "copy_tree_sha256": source["tree_sha256"], "tree_sha256": final["tree_sha256"],
            "copy_comparison_receipt_sha256": hashes["comparison"], "sqlite_verification_receipt_sha256": hashes["sqlite_report"],
            "transfer_revocation_receipt_sha256": hashes["revocation"], "source_completion_receipt_sha256": hashes["source_completion"],
            "source_image_receipt_sha256": hashes["source_image"], "source_key_cleanup_receipt_sha256": hashes["source_key_cleanup"],
            "source_container_id": container, "cutoff_at": completion["cutoff_at"], "source_stopped_at": source_image["finished_at"],
            "image": image, "source_image_id": source_image["image_id"], "source_image_tag": source_image["image_tag"],
            "source_public_key_sha256": key_hash, "evidence_complete_at": max(times.values()).isoformat(),
            "publications": publications, "published_components": components, "freshness_refreshed": False}


def save_receipt(path, receipt):
    for volume in (SOURCE_ROOT, DESTINATION_ROOT, RECEIVER_ALIAS):
        try:
            path.absolute().resolve().relative_to(Path(volume).absolute().resolve())
        except ValueError:
            continue
        raise ReceiptError("receipt_must_be_outside_data_volume")
    raw = (json.dumps(receipt, sort_keys=True, indent=2) + "\n").encode()
    if path.exists():
        require(not path.is_symlink() and path.is_file(), "receipt_must_be_regular")
        require(path.read_bytes() == raw, "refusing_different_existing_receipt")
        return hashlib.sha256(raw).hexdigest()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    descriptor = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(str(temporary), str(path))
    except Exception:
        if temporary.exists():
            temporary.unlink()
        raise
    return hashlib.sha256(raw).hexdigest()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source-manifest", "destination-manifest", "comparison", "sqlite-report", "post-recovery-manifest",
                 "source-completion", "source-image", "revocation", "source-key-cleanup"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--image", default=APPROVED_IMAGE)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    paths = {name: getattr(args, name) for name in ("source_manifest", "destination_manifest", "comparison", "sqlite_report",
                                                  "post_recovery_manifest", "source_completion", "source_image", "revocation", "source_key_cleanup")}
    try:
        receipt = consolidate(paths, args.image)
        checksum = save_receipt(args.output, receipt)
        print(json.dumps({"version": 1, "status": "verified", "receipt_sha256": checksum,
                          "copy_tree_sha256": receipt["copy_tree_sha256"], "tree_sha256": receipt["tree_sha256"]}))
        return 0
    except Exception as error:
        reason = str(error) if isinstance(error, ReceiptError) else "invalid_or_unavailable_evidence"
        print(json.dumps({"version": 1, "status": "failed", "reason": reason}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
