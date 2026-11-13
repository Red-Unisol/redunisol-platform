#!/usr/bin/python3
"""Cold MetaMap SQLite/update bundles; never start a container or install state."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time


class StateError(ValueError):
    """Unverified state must never produce an accepted receipt."""


def require(condition, message):
    if not condition:
        raise StateError(message)


def revision(value):
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value), "A full reviewed Git revision is required")
    return value


def checksum(value):
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value), "A full SHA-256 is required")
    return value


def canonical_directory(value):
    path = Path(value)
    require(path.is_absolute() and path.is_dir() and not path.is_symlink()
            and path.resolve(strict=True) == path, "An existing canonical directory is required")
    return path


def new_target(value, forbidden=()):
    path = Path(value)
    require(path.is_absolute() and path.name not in ("", ".", ".."), "An absolute new target is required")
    canonical_directory(path.parent)
    require(path.parent / path.name == path and path.resolve() == path,
            "Target must be canonical and must not follow symlinks")
    require(not path.exists() and not path.is_symlink(), "Refusing to overwrite an existing target")
    for source in forbidden:
        source = Path(source)
        require(not path.is_relative_to(source) and not source.is_relative_to(path),
                "Target must be outside the source trees")
    return path


def relative_path(value, *, directory=False):
    require(isinstance(value, str) and "\x00" not in value and "\\" not in value, "Invalid manifest path")
    if directory and value == "":
        return value
    path = PurePosixPath(value)
    require(value and not path.is_absolute() and ".." not in path.parts
            and str(path) == value and value != ".", "Unsafe manifest path")
    return value


def stat_identity(info):
    return tuple(getattr(info, key) for key in (
        "st_dev", "st_ino", "st_size", "st_mode", "st_uid", "st_gid", "st_mtime_ns", "st_ctime_ns"))


def metadata(info):
    return {"mode": format(stat.S_IMODE(info.st_mode), "04o"), "uid": info.st_uid, "gid": info.st_gid}


def scan_tree(root, label):
    files, directories, identities = [], [], {}

    def walk(path, relative):
        before = path.lstat()
        require(not path.is_symlink(), "Symbolic links are not accepted")
        identities[relative] = stat_identity(before)
        entry = {"root": label, "path": relative, **metadata(before)}
        if stat.S_ISDIR(before.st_mode):
            directories.append(entry)
            for child in sorted(path.iterdir(), key=lambda item: item.name):
                require(child.name not in (".env", "runtime.env", "credentials.txt")
                        and not child.name.startswith(".env."), "Runtime credentials must not enter a state bundle")
                walk(child, child.relative_to(root).as_posix())
        else:
            require(stat.S_ISREG(before.st_mode), "Only regular files and directories are accepted")
            digest = hashlib.sha256()
            with path.open("rb") as stream:
                require(stat_identity(os.fstat(stream.fileno())) == stat_identity(before), "Source changed while opening")
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
                require(stat_identity(os.fstat(stream.fileno())) == stat_identity(before), "Source changed during capture")
            files.append({**entry, "size": before.st_size, "sha256": digest.hexdigest()})
        require(stat_identity(path.lstat()) == stat_identity(before), "Source tree changed during capture")

    walk(root, "")
    return {"files": files, "directories": directories}, identities


def scan_roots(roots):
    catalog, identities = {"files": [], "directories": []}, {}
    for label in ("data", "updates"):
        tree, identity = scan_tree(roots[label], label)
        for kind in catalog:
            catalog[kind].extend(tree[kind])
        identities[label] = identity
    return catalog, identities


def apply_metadata(path, entry):
    current = path.lstat()
    if (current.st_uid, current.st_gid) != (entry["uid"], entry["gid"]):
        os.chown(path, entry["uid"], entry["gid"], follow_symlinks=False)
    path.chmod(int(entry["mode"], 8))


def copy_catalog(roots, destination, catalog):
    for entry in catalog["directories"]:
        target = destination / entry["root"] / entry["path"]
        target.mkdir(mode=0o700)
    for entry in catalog["files"]:
        source = roots[entry["root"]] / entry["path"]
        target = destination / entry["root"] / entry["path"]
        # Exclusive creation and earlier nonsymlink scans prevent adoption.
        descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, "rb") as incoming, target.open("xb") as outgoing:
            require(stat.S_ISREG(os.fstat(incoming.fileno()).st_mode), "Source is no longer a regular file")
            shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
        apply_metadata(target, entry)
    for entry in reversed(catalog["directories"]):
        apply_metadata(destination / entry["root"] / entry["path"], entry)


def sqlite_relative(environment):
    values = [item.split("=", 1)[1] for item in environment
              if isinstance(item, str) and item.startswith("METAMAP_SERVER_DATABASE_URL=")]
    require(len(values) == 1, "Exactly one explicit SQLite database setting is required")
    match = re.fullmatch(r"sqlite(?:\+pysqlite)?:////data/([^?#%]+)", values[0])
    require(match is not None, "Only an absolute SQLite database under /data is supported")
    return relative_path(match[1])


def docker_json(arguments):
    result = subprocess.run(["docker", "--host", "unix:///var/run/docker.sock", *arguments],
                            env=docker_environment(), capture_output=True, text=True, timeout=30, check=False)
    require(result.returncode == 0, "Read-only Docker inspection failed")
    return json.loads(result.stdout)


def docker_environment():
    environment = dict(os.environ)
    for key in ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"):
        environment.pop(key, None)
    return environment


def inspect_runtime(container):
    """The CLI always uses real, read-only inspection; tests inject this function."""
    source = docker_json(["container", "inspect", container])
    require(isinstance(source, list) and len(source) == 1, "Ambiguous source container inspection")
    running = subprocess.run(["docker", "--host", "unix:///var/run/docker.sock", "container", "ls", "--quiet", "--no-trunc"],
                             env=docker_environment(), capture_output=True, text=True, timeout=30, check=False)
    require(running.returncode == 0, "Could not inspect other active containers")
    active = []
    for identifier in running.stdout.splitlines():
        require(re.fullmatch(r"[0-9a-f]{64}", identifier), "Invalid active container identity")
        active.extend(docker_json(["container", "inspect", identifier]))
    return {"container": source[0], "active_containers": active}


def inspect_guard(observation, image_id, roots):
    source = observation["container"]
    state = source["State"]
    require(source["Image"] == image_id, "Source image ID differs from the reviewed image")
    require(re.fullmatch(r"[0-9a-f]{64}", source["Id"]), "Invalid source container identity")
    require(state.get("Status") in ("created", "exited") and state.get("Running") is False
            and state.get("Paused") is False and state.get("Restarting") is False
            and not state.get("Dead", False) and state.get("Pid", 0) == 0,
            "The source container must be stopped, not paused or restarting")
    require(all(isinstance(state.get(key), str) and state[key] for key in ("StartedAt", "FinishedAt"))
            and type(source.get("RestartCount")) is int and source["RestartCount"] >= 0,
            "Container lifecycle evidence is missing")
    lifecycle = {"started_at": state["StartedAt"], "finished_at": state["FinishedAt"],
                 "restart_count": source["RestartCount"]}
    matched = {}
    for mount in source["Mounts"]:
        target = mount["Destination"]
        require(isinstance(target, str) and target.startswith("/"), "Invalid container mount")
        if target in ("/data", "/updates"):
            label = target[1:]
            require(label not in matched and mount.get("Type") in ("volume", "bind")
                    and mount["Source"] == str(roots[label]), "Source mount differs from the declared root")
            matched[label] = {"source": mount["Source"], "type": mount["Type"], "rw": mount.get("RW")}
        else:
            location = PurePosixPath(target)
            require(all(not location.is_relative_to(base) and not PurePosixPath(base).is_relative_to(location)
                        for base in ("/data", "/updates")), "Overlapping container mounts are not supported")
    require(set(matched) == {"data", "updates"}, "Both state mounts must be inspected")
    database = sqlite_relative(source["Config"]["Env"])
    for other in observation["active_containers"]:
        require(other["State"].get("Running") is True, "Ambiguous active-container inspection")
        for mount in other.get("Mounts", []):
            value = mount.get("Source", "")
            if not value.startswith("/"):
                continue
            path = Path(value).resolve()
            require(all(not path.is_relative_to(root) and not root.is_relative_to(path) for root in roots.values()),
                    "Another active container shares a source tree")
    return {"container_id": source["Id"], "image_id": image_id, "mounts": matched,
            "sqlite_path": database, "container_lifecycle": lifecycle}


def check_sqlite(data_root, database):
    """Normal recovery happens only in a disposable copy, including WAL/journal."""
    source = data_root / relative_path(database)
    require(source.is_file() and not source.is_symlink(), "The declared SQLite database is missing")
    with tempfile.TemporaryDirectory(prefix="metamap-sqlite-check-") as directory:
        copied = Path(directory) / "data"
        shutil.copytree(data_root, copied)
        for path in copied.rglob("*"):
            path.chmod(0o700 if path.is_dir() else 0o600)
        copied.chmod(0o700)
        connection = sqlite3.connect(copied / database, timeout=5)
        try:
            require(connection.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "SQLite integrity check failed")
            tables = [row[0] for row in connection.execute(
                "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")]
            user_version = connection.execute("PRAGMA user_version").fetchone()[0]
        finally:
            connection.close()
    return {"integrity": "ok", "table_names": tables, "user_version": user_version}


def write_json_new(path, value):
    encoded = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        staging = Path(stream.name)
        try:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
            os.link(staging, path)
        finally:
            staging.unlink(missing_ok=True)
    return hashlib.sha256(encoded).hexdigest()


def snapshot(container, expected_image_id, source_data, source_updates, bundle, reviewed_revision,
             writers_stopped_confirmed, *, inspector=inspect_runtime):
    revision(reviewed_revision)
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", expected_image_id), "A reviewed image ID is required")
    require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", container), "Invalid source container name")
    require(writers_stopped_confirmed is True, "All external writers must be explicitly confirmed stopped")
    roots = {"data": canonical_directory(source_data), "updates": canonical_directory(source_updates)}
    require(not roots["data"].is_relative_to(roots["updates"])
            and not roots["updates"].is_relative_to(roots["data"]), "Source trees must be disjoint")
    output = new_target(bundle, roots.values())
    before_inspection = inspect_guard(inspector(container), expected_image_id, roots)
    before, before_identity = scan_roots(roots)
    database = before_inspection["sqlite_path"]
    require(any(entry["root"] == "data" and entry["path"] == database for entry in before["files"]),
            "The declared database is not a regular captured file")
    output.mkdir(mode=0o700)
    output.chmod(0o700)
    copy_catalog(roots, output, before)
    copied, _ = scan_roots({label: output / label for label in roots})
    require(copied == before, "Copied bytes or metadata differ from the source")
    sqlite_check = check_sqlite(output / "data", database)
    after_inspection = inspect_guard(inspector(container), expected_image_id, roots)
    after, after_identity = scan_roots(roots)
    require(before == after and before_identity == after_identity
            and before_inspection == after_inspection, "Source changed during the cold snapshot")
    manifest = {"schema_version": 1, "scope": "metamap-cold-state", "revision": reviewed_revision,
                "container": container, **before_inspection,
                "source_roots": {label: str(path) for label, path in roots.items()}, **before,
                "sqlite_check": sqlite_check, "writers_stopped_confirmed": True}
    manifest_sha256 = write_json_new(output / "manifest.json", manifest)
    receipt = {"schema_version": 1, "scope": "metamap-cold-snapshot", "revision": reviewed_revision,
               "manifest_sha256": manifest_sha256, "file_count": len(before["files"]),
               "image_id": expected_image_id, "sqlite_check": sqlite_check, "created_at": int(time.time())}
    write_json_new(output / "receipt.json", receipt)
    return receipt


def load_manifest(bundle, expected_hash):
    checksum(expected_hash)
    raw = (bundle / "manifest.json").read_bytes()
    require(hashlib.sha256(raw).hexdigest() == expected_hash, "Manifest checksum differs from the reviewed bundle")
    manifest = json.loads(raw)
    require(isinstance(manifest, dict) and set(manifest) == {
        "schema_version", "scope", "revision", "container", "container_id", "image_id", "mounts",
        "sqlite_path", "source_roots", "files", "directories", "sqlite_check",
        "writers_stopped_confirmed",
        "container_lifecycle",
    }, "Unexpected bundle manifest fields")
    require(manifest.get("schema_version") == 1 and manifest.get("scope") == "metamap-cold-state",
            "Unsupported bundle manifest")
    revision(manifest["revision"])
    require(manifest["writers_stopped_confirmed"] is True, "Missing external-writer confirmation")
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", manifest["image_id"]), "Invalid manifest image ID")
    require(set(manifest["source_roots"]) == {"data", "updates"}, "Invalid manifest roots")
    require(all(isinstance(value, str) and Path(value).is_absolute() and ".." not in Path(value).parts
                for value in manifest["source_roots"].values()), "Invalid original source path")
    seen = set()
    for kind in ("directories", "files"):
        require(isinstance(manifest[kind], list), "Invalid manifest entries")
        for entry in manifest[kind]:
            required = {"root", "path", "mode", "uid", "gid"} | ({"size", "sha256"} if kind == "files" else set())
            require(isinstance(entry, dict) and set(entry) == required, "Unexpected manifest entry fields")
            require(entry["root"] in ("data", "updates"), "Invalid manifest root")
            relative_path(entry["path"], directory=kind == "directories")
            key = entry["root"], entry["path"]
            require(key not in seen, "Duplicate manifest entry")
            seen.add(key)
            require(isinstance(entry["mode"], str) and re.fullmatch(r"[0-7]{4}", entry["mode"]), "Invalid file mode")
            require(all(type(entry[name]) is int and entry[name] >= 0 for name in ("uid", "gid")), "Invalid ownership")
            if kind == "files":
                checksum(entry["sha256"])
                require(type(entry["size"]) is int and entry["size"] >= 0, "Invalid file size")
    require({(entry["root"], entry["path"]) for entry in manifest["directories"]}
            >= {("data", ""), ("updates", "")}, "Missing tree roots")
    relative_path(manifest["sqlite_path"])
    return manifest


def verify(bundle, expected_manifest_sha256):
    root = canonical_directory(bundle)
    require({path.name for path in root.iterdir()} == {"data", "updates", "manifest.json", "receipt.json"},
            "Incomplete or unexpected bundle contents")
    require(stat.S_IMODE(root.stat().st_mode) == 0o700, "Bundle root must be private")
    for name in ("manifest.json", "receipt.json"):
        info = (root / name).lstat()
        require(stat.S_ISREG(info.st_mode), "Bundle metadata must be regular files")
    manifest = load_manifest(root, expected_manifest_sha256)
    receipt = json.loads((root / "receipt.json").read_bytes())
    require(receipt.get("scope") == "metamap-cold-snapshot"
            and receipt.get("manifest_sha256") == expected_manifest_sha256
            and receipt.get("revision") == manifest["revision"]
            and receipt.get("image_id") == manifest["image_id"]
            and receipt.get("file_count") == len(manifest["files"]), "Snapshot receipt does not match the manifest")
    roots = {label: canonical_directory(root / label) for label in ("data", "updates")}
    actual, _ = scan_roots(roots)
    require(actual == {key: manifest[key] for key in ("files", "directories")}, "Bundle content or metadata checksum mismatch")
    sqlite_check = check_sqlite(roots["data"], manifest["sqlite_path"])
    require(sqlite_check == manifest["sqlite_check"] == receipt["sqlite_check"], "SQLite recovery differs from the snapshot")
    # Recovery must not mutate the accepted bundle, even if WAL/journals exist.
    final, _ = scan_roots(roots)
    require(final == actual, "Bundle changed during verification")
    require(hashlib.sha256((root / "manifest.json").read_bytes()).hexdigest() == expected_manifest_sha256,
            "Manifest changed during verification")
    return manifest


def restore(bundle, expected_manifest_sha256, destination, reviewed_revision):
    revision(reviewed_revision)
    root = canonical_directory(bundle)
    output = new_target(destination, [root])
    manifest = verify(root, expected_manifest_sha256)
    new_target(output, [root, *manifest["source_roots"].values()])
    output.mkdir(mode=0o700)
    output.chmod(0o700)
    copy_catalog({label: root / label for label in ("data", "updates")}, output, manifest)
    actual, _ = scan_roots({label: output / label for label in ("data", "updates")})
    require(actual == {key: manifest[key] for key in ("files", "directories")}, "Restored bytes or metadata differ from the bundle")
    sqlite_check = check_sqlite(output / "data", manifest["sqlite_path"])
    require(sqlite_check == manifest["sqlite_check"], "Restored SQLite recovery differs")
    verify(root, expected_manifest_sha256)
    receipt = {"schema_version": 1, "scope": "metamap-isolated-restore", "revision": reviewed_revision,
               "source_revision": manifest["revision"], "manifest_sha256": expected_manifest_sha256,
               "file_count": len(manifest["files"]), "sqlite_check": sqlite_check,
               "destination": str(output), "created_at": int(time.time()), "runtime_activated": False}
    write_json_new(output / "restore-receipt.json", receipt)
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    operations = parser.add_subparsers(dest="operation", required=True)
    backup = operations.add_parser("snapshot")
    for flag in ("container", "expected-image-id", "source-data", "source-updates", "bundle", "revision"):
        backup.add_argument("--" + flag, required=True)
    backup.add_argument("--writers-stopped-confirmed", action="store_true")
    inspect = operations.add_parser("verify")
    inspect.add_argument("--bundle", required=True)
    inspect.add_argument("--expected-manifest-sha256", required=True)
    recovery = operations.add_parser("restore")
    for flag in ("bundle", "expected-manifest-sha256", "destination", "revision"):
        recovery.add_argument("--" + flag, required=True)
    args = parser.parse_args(argv)
    try:
        if args.operation == "snapshot":
            result = snapshot(args.container, args.expected_image_id, args.source_data, args.source_updates,
                              args.bundle, args.revision, args.writers_stopped_confirmed)
        elif args.operation == "verify":
            manifest = verify(args.bundle, args.expected_manifest_sha256)
            result = {"scope": "metamap-cold-verification", "manifest_sha256": args.expected_manifest_sha256,
                      "revision": manifest["revision"], "file_count": len(manifest["files"]),
                      "sqlite_check": manifest["sqlite_check"]}
        else:
            result = restore(args.bundle, args.expected_manifest_sha256, args.destination, args.revision)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        message = str(error) if isinstance(error, StateError) else "State operation failed: " + type(error).__name__
        print(json.dumps({"error": message, "accepted": False}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
