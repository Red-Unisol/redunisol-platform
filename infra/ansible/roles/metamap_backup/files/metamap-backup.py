#!/usr/bin/python3
"""Separate local Restic preparation; only synthetic fixtures, never live MetaMap."""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import socket
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import uuid

try:
    import fcntl
except ImportError:
    fcntl = None

RESTIC_BINARY = "/usr/bin/restic"
SCOPE = "metamap-synthetic-restic-canary"
PRODUCTION_PATHS = {
    "mountpoint": "/srv/redunisol-backups",
    "repository": "/srv/redunisol-backups/restic/metamap",
    "password_file": "/etc/redunisol-metamap/restic-password",
    "state_dir": "/var/lib/redunisol-foundation/metamap-backup",
    "restore_dir": "/srv/redunisol/state/metamap-server/restores/backup-canary",
}


class RecoveryError(ValueError):
    """Unverified recovery must not produce a success receipt."""


def require(condition, message):
    if not condition:
        raise RecoveryError(message)


def private(path, *, directory=False, mode=None):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path, "Noncanonical private path")
    info = path.lstat()
    require((stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            and info.st_uid == os.geteuid(), "Unexpected private path type or owner")
    expected = (0o700,) if directory else (0o400, 0o600)
    require(stat.S_IMODE(info.st_mode) in ((mode,) if mode is not None else expected),
            "Private path permissions differ")
    return path


def atomic_json(path, data):
    path = Path(path)
    require(not path.exists() and not path.is_symlink(), "Refusing to replace existing evidence")
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
        staging = Path(output.name)
        try:
            os.fchmod(output.fileno(), 0o600)
            output.write((json.dumps(data, sort_keys=True) + "\n").encode())
            output.flush()
            os.fsync(output.fileno())
            os.link(staging, path)
        finally:
            staging.unlink(missing_ok=True)


def read_record(path):
    private(path, mode=0o600)
    require(path.stat().st_size < 1024 * 1024, "Unexpected evidence size")
    return json.loads(path.read_text(encoding="utf-8"))


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def catalog(source):
    source = private(source, directory=True)
    entries = []
    for path in sorted(source.rglob("*")):
        info = path.lstat()
        require(not path.is_symlink() and (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)),
                "Synthetic fixture contains an unexpected link or special file")
        if path == source / "manifest.json":
            continue
        entry = dict(path=path.relative_to(source).as_posix(), mode=format(stat.S_IMODE(info.st_mode), "04o"),
                     uid=info.st_uid, gid=info.st_gid, type="directory" if path.is_dir() else "file")
        if path.is_file():
            entry.update(size=info.st_size, sha256=digest(path))
        entries.append(entry)
    return entries


def sqlite_proof(source):
    path = source / "data" / "canary.sqlite"
    require(path.is_file() and not path.is_symlink(), "Synthetic SQLite fixture is absent")
    connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    try:
        require(connection.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "Synthetic SQLite integrity failed")
        require(connection.execute("SELECT id,payload FROM canary").fetchall() == [(1, "synthetic-metamap-only")],
                "Synthetic SQLite content differs")
    finally:
        connection.close()
    return {"integrity": "ok", "rows": 1, "scope": "clean-closed-synthetic-sqlite"}


def command(arguments, timeout):
    environment = {key: value for key, value in os.environ.items() if not key.startswith("RESTIC_")}
    return subprocess.run(arguments, capture_output=True, stdin=subprocess.DEVNULL,
                          env=environment, timeout=timeout, check=False)


def validate_mount(args):
    def inspect(arguments):
        result = command(["findmnt", "--json", *arguments, "--output", "TARGET,UUID,MAJ:MIN,FSTYPE"], 20)
        require(result.returncode == 0, "Could not inspect the selected filesystem")
        values = json.loads(result.stdout)["filesystems"]
        require(len(values) == 1, "Ambiguous filesystem identity")
        return values[0]
    selected = inspect(["--mountpoint", str(args.mountpoint)])
    root = inspect(["--target", "/"])
    require(selected["target"] == str(args.mountpoint) and selected["uuid"] == args.mount_uuid
            and selected["fstype"] == "xfs" and selected["maj:min"] != root["maj:min"],
            "Backup mount is absent, changed or resolves to root")


def validate_layout(args):
    require(re.fullmatch(r"[0-9a-f]{40}", args.revision), "Reviewed Git SHA40 required")
    require(60 <= args.timeout_seconds <= 1800, "Bounded recovery timeout required")
    require(args.mountpoint.is_absolute() and args.mountpoint.resolve(strict=True) == args.mountpoint,
            "Canonical backup mount required")
    require(args.repository == args.mountpoint / "restic" / "metamap",
            "Only the separate MetaMap repository is allowed")
    require(args.repository.resolve() == args.repository and args.repository.parent.is_dir(),
            "Canonical existing repository parent required")
    for path in (args.state_dir, args.restore_dir):
        private(path, directory=True)
        require(not path.is_relative_to(args.repository) and not args.repository.is_relative_to(path),
                "Evidence/restore paths and repository must not overlap")
    private(args.password_file.parent, directory=True)
    private(args.password_file)
    raw = args.password_file.read_bytes()
    password = raw[:-1] if raw.endswith(b"\n") else raw
    require(32 <= len(password) <= 4096 and not any(value in password for value in (b"\n", b"\r", b"\0")),
            "Invalid private repository password")
    validate_mount(args)
    version = command([RESTIC_BINARY, "version"], 20)
    require(version.returncode == 0 and version.stdout.startswith(b"restic 0.18.0 "),
            "Reviewed Restic 0.18.0 is required")


class Restic:
    def __init__(self, args):
        self.args = args
        self.deadline = time.monotonic() + args.timeout_seconds

    def run(self, *arguments, readonly=False, password=None, expect_success=True):
        remaining = self.deadline - time.monotonic()
        require(remaining > 0, "Recovery operation exceeded its time budget")
        prefix = [RESTIC_BINARY, "--no-cache", "--repo", str(self.args.repository),
                  "--password-file", str(password or self.args.password_file)]
        if readonly:
            prefix.append("--no-lock")
        result = command([*prefix, *arguments], remaining)
        if expect_success:
            require(result.returncode == 0, "Restic operation failed; no new recovery proof is accepted")
        return result

    def json(self, *arguments):
        return json.loads(self.run(*arguments, readonly=True).stdout)

    def identity(self):
        value = self.json("cat", "config")["id"]
        require(re.fullmatch(r"[0-9a-f]{64}", value), "Invalid repository identity")
        return value


@contextmanager
def operation_lock(args, write):
    require(fcntl is not None, "Linux file locking is required")
    path = args.state_dir / "operation.lock"
    flags = os.O_NOFOLLOW | (os.O_RDWR | os.O_CREAT if write else os.O_RDONLY)
    descriptor = os.open(path, flags, 0o600)
    try:
        private(path, mode=0o600)
        try:
            fcntl.flock(descriptor, (fcntl.LOCK_EX if write else fcntl.LOCK_SH) | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RecoveryError("Another MetaMap recovery operation is in progress") from None
        yield
    finally:
        os.close(descriptor)


def ensure_repository(args, restic):
    record_path = args.state_dir / "repository.json"
    config = args.repository / "config"
    if config.exists() or config.is_symlink():
        private(args.repository, directory=True)
        require(config.is_file() and not config.is_symlink(), "Repository configuration is not a regular file")
        require(record_path.exists(), "Unrecognized initialized repository requires operator review; it is never adopted")
        record = read_record(record_path)
        require(record["scope"] == "metamap-separate-local-repository"
                and record["repository"] == str(args.repository) and record["mount_uuid"] == args.mount_uuid
                and record["repository_id"] == restic.identity(), "Existing repository proof differs")
        return record
    require(args.initialize_authorized, "Separate repository initialization authorization is required")
    require(not record_path.exists() and not record_path.is_symlink(),
            "Repository disappeared; existing evidence cannot authorize reinitialization")
    if args.repository.exists():
        private(args.repository, directory=True)
        require(not list(args.repository.iterdir()), "Refusing initialization over unrelated files")
    else:
        args.repository.mkdir(mode=0o700)
    restic.run("init")
    record = dict(schema_version=1, scope="metamap-separate-local-repository",
                  repository=str(args.repository), repository_id=restic.identity(), mount_uuid=args.mount_uuid,
                  revision=args.revision, initialized_at=int(time.time()))
    atomic_json(record_path, record)
    return record


def check_repository_record(args, restic):
    private(args.repository, directory=True)
    require((args.repository / "config").is_file() and not (args.repository / "config").is_symlink(),
            "Initialized repository is absent")
    record = read_record(args.state_dir / "repository.json")
    require(record["scope"] == "metamap-separate-local-repository"
            and record["repository"] == str(args.repository) and record["mount_uuid"] == args.mount_uuid
            and record["repository_id"] == restic.identity(), "Repository identity differs from its initialization proof")
    return record


def verify_canary(args, restic, repository):
    receipt = read_record(args.state_dir / "canary.json")
    require(receipt["schema_version"] == 1 and receipt["scope"] == SCOPE
            and receipt["repository_id"] == repository["repository_id"]
            and receipt["production_data_protected"] is False and receipt["offsite"] is False
            and receipt["continuous_backup"] is False and receipt["repository_integrity_verified"] is True
            and receipt["read_data"] is True and receipt["wrong_key_rejected"] is True,
            "Unexpected synthetic recovery receipt")
    require(re.fullmatch(r"[0-9a-f]{40}", receipt["revision"])
            and re.fullmatch(r"[0-9a-f]{64}", receipt["snapshot_id"]), "Invalid recovery identity")
    source = private(Path(receipt["source"]), directory=True)
    restored = private(Path(receipt["restored_source"]), directory=True)
    require(source.parent == args.state_dir / "canaries" and re.fullmatch(r"[0-9a-f]{32}", source.name),
            "Canary source is outside the owned fixture directory")
    restore_target = private(args.restore_dir / source.name, directory=True)
    require(restored == restore_target / str(source).lstrip("/"), "Restore is outside its isolated target")
    manifest = read_record(source / "manifest.json")
    private(restored / "manifest.json", mode=0o600)
    require(manifest["scope"] == "metamap-synthetic-fixture" and manifest["schema_version"] == 1,
            "Unexpected fixture manifest")
    require(digest(source / "manifest.json") == receipt["source_manifest_sha256"]
            and digest(restored / "manifest.json") == receipt["source_manifest_sha256"],
            "Canary manifest differs")
    require(catalog(source) == catalog(restored) == manifest["entries"], "Restored hashes or metadata differ")
    require(sqlite_proof(source) == sqlite_proof(restored) == receipt["sqlite_check"], "Synthetic SQLite restore differs")
    snapshots = restic.json("snapshots", "--json", receipt["snapshot_id"])
    require(len(snapshots) == 1 and snapshots[0]["id"] == receipt["snapshot_id"]
            and snapshots[0]["paths"] == [str(source)] and snapshots[0]["hostname"] == socket.gethostname()
            and "metamap-synthetic-canary" in snapshots[0]["tags"], "Synthetic snapshot identity differs")
    dumped = restic.run("dump", receipt["snapshot_id"], str(source / "manifest.json"), readonly=True).stdout
    require(hashlib.sha256(dumped).hexdigest() == receipt["source_manifest_sha256"],
            "Snapshot manifest differs from the restored proof")
    return receipt


def create_canary(args, restic, repository):
    canaries = args.state_dir / "canaries"
    if not canaries.exists():
        canaries.mkdir(mode=0o700)
    private(canaries, directory=True)
    source = canaries / uuid.uuid4().hex
    source.mkdir(mode=0o700)
    for child in ("data", "updates"):
        (source / child).mkdir(mode=0o700)
    database = source / "data" / "canary.sqlite"
    connection = sqlite3.connect(database)
    try:
        connection.execute("CREATE TABLE canary(id INTEGER PRIMARY KEY,payload TEXT NOT NULL)")
        connection.execute("INSERT INTO canary VALUES(1,'synthetic-metamap-only')")
        connection.commit()
    finally:
        connection.close()
    database.chmod(0o600)
    payload = source / "data" / "payload.bin"
    payload.write_bytes(secrets.token_bytes(65536))
    payload.chmod(0o600)
    atomic_json(source / "updates" / "fixture.json", {"synthetic_only": True, "not_a_desktop_release": True})
    manifest = dict(schema_version=1, scope="metamap-synthetic-fixture", entries=catalog(source))
    atomic_json(source / "manifest.json", manifest)
    sqlite_check = sqlite_proof(source)
    result = restic.run("backup", "--json", "--tag", "metamap-synthetic-canary",
                        "--tag", "revision:" + args.revision, "--", str(source))
    identifiers = [row["snapshot_id"] for row in map(json.loads, result.stdout.splitlines())
                   if row.get("message_type") == "summary"]
    require(len(identifiers) == 1 and re.fullmatch(r"[0-9a-f]{64}", identifiers[0]), "Snapshot acknowledgement missing")
    snapshot = identifiers[0]
    wrong = args.state_dir / ("wrong-password-" + source.name)
    try:
        wrong.write_text(secrets.token_urlsafe(48) + "\n", encoding="utf-8")
        wrong.chmod(0o600)
        require(restic.run("cat", "config", readonly=True, password=wrong, expect_success=False).returncode != 0,
                "Repository accepted an unrelated password")
    finally:
        wrong.unlink(missing_ok=True)
    restic.run("check", "--read-data")
    target = args.restore_dir / source.name
    target.mkdir(mode=0o700)
    restic.run("restore", snapshot, "--target", str(target), "--verify")
    restored = target / str(source).lstrip("/")
    require(catalog(source) == catalog(restored) == manifest["entries"]
            and digest(restored / "manifest.json") == digest(source / "manifest.json"),
            "Synthetic restore hashes or metadata differ")
    require(sqlite_proof(restored) == sqlite_check, "Restored SQLite fixture differs")
    receipt = dict(schema_version=1, scope=SCOPE, revision=args.revision, created_at=int(time.time()),
                   repository_id=repository["repository_id"], snapshot_id=snapshot, source=str(source),
                   restored_source=str(restored), source_manifest_sha256=digest(source / "manifest.json"),
                   repository_integrity_verified=True, read_data=True, wrong_key_rejected=True,
                   sqlite_check=sqlite_check, production_data_protected=False, offsite=False, continuous_backup=False)
    atomic_json(args.state_dir / "canary.json", receipt)
    return receipt


def execute(args, *, prepare):
    validate_layout(args)
    with operation_lock(args, prepare):
        restic = Restic(args)
        repository = ensure_repository(args, restic) if prepare else check_repository_record(args, restic)
        receipt_path = args.state_dir / "canary.json"
        created = prepare and not (receipt_path.exists() or receipt_path.is_symlink())
        if created:
            create_canary(args, restic, repository)
        receipt = verify_canary(args, restic, repository)
    return dict(scope=SCOPE, created=created, repository_id=repository["repository_id"],
                snapshot_id=receipt["snapshot_id"], receipt_revision=receipt["revision"],
                verified_by_revision=args.revision, proof_created_at=receipt["created_at"],
                production_data_protected=False, offsite=False, continuous_backup=False)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("prepare", "verify"))
    for name in ("revision", "mount-uuid"):
        parser.add_argument("--" + name, required=True)
    for name in ("mountpoint", "repository", "password-file", "state-dir", "restore-dir"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--timeout-seconds", type=int, default=600)
    parser.add_argument("--initialize-authorized", action="store_true")
    args = parser.parse_args(argv)
    try:
        require(os.geteuid() == 0, "The dedicated recovery coordinator must run as root")
        require(all(str(getattr(args, name)) == value for name, value in PRODUCTION_PATHS.items())
                and args.mount_uuid == "df29bb35-b77f-4355-a93c-c53a32580267",
                "Only the fixed dedicated MetaMap repository and private canary paths are allowed")
        require(not (args.operation == "verify" and args.initialize_authorized), "Verify never initializes repositories")
        print(json.dumps(execute(args, prepare=args.operation == "prepare"), sort_keys=True))
        return 0
    except Exception as error:
        message = str(error) if isinstance(error, RecoveryError) else "Recovery observation failed: " + type(error).__name__
        print(json.dumps({"accepted": False, "error": message, "production_data_protected": False}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
