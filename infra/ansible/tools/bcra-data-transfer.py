#!/usr/bin/env python3
"""Python 3.6 compatible, one-shot BCRA transfer coordinator; no private output.

Runs only when invoked by the reviewed Ansible playbook. Source state/key live in
/run, destination receives only its public key, and rsync output is discarded.
The durable JSON log contains phase/result codes, never data or arbitrary names.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys

try:
    import fcntl
except ImportError:
    fcntl = None

RUNTIME = Path("/run/redunisol-bcra-transfer")
SOURCE = Path("/var/lib/docker/volumes/bcra-file-poc_bcra-file-data/_data")
DESTINATION = Path("/srv/redunisol/state/bcra-file-api")
RECEIVER_ALIAS = Path("/var/lib/redunisol-bcra-transfer/data")
RECEIVER_MARKER = Path("/srv/redunisol/platform/bcra-file-api/data-transfer-receiver.json")
TRANSFER_USER = "bcra-transfer"
DESTINATION_HOST = "168.197.51.104"
SOURCE_HOST = "66.97.34.158"
DESTINATION_PORT = 2241
ALLOWED_RUNTIME_FILES = {"id_ed25519", "id_ed25519.pub", "known_hosts", "config.json", "state.json",
                         "transfer.py", "data_tool.py", "source-manifest.json", "copy.log", "lock",
                         "state.json.tmp", "config.json.tmp"}


class TransferError(Exception):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def atomic_json(path, value):
    temporary = path.with_name(path.name + ".tmp")
    descriptor = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w") as handle:
            json.dump(value, handle, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(str(temporary), str(path))
    except Exception:
        if temporary.exists():
            temporary.unlink()
        raise


def read_json(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
        raise TransferError("invalid_control_file")
    try:
        with path.open() as handle:
            value = json.load(handle)
    except (ValueError, OSError):
        raise TransferError("invalid_control_file")
    if not isinstance(value, dict):
        raise TransferError("invalid_control_file")
    return value


def command(argv):
    process = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, universal_newlines=True)
    if process.returncode != 0:
        raise TransferError("command_failed")
    return process.stdout.strip()


def stopped_container(container):
    if not re.fullmatch(r"[0-9a-f]{12,64}", container):
        raise TransferError("invalid_source_container")
    value = command(["docker", "inspect", "--type", "container", "--format", "{{.Id}} {{json .State}}", container])
    ident, separator, state = value.partition(" ")
    if not separator or not re.fullmatch(r"[0-9a-f]{64}", ident) or not ident.startswith(container):
        raise TransferError("source_container_identity_changed")
    state = json.loads(state)
    if state.get("Running") or state.get("Paused") or state.get("Restarting") or state.get("Pid") != 0 or state.get("Status") not in ("exited", "created"):
        raise TransferError("source_container_not_stopped")
    return ident


def runtime_directory(create=False):
    if not RUNTIME.exists():
        if not create:
            raise TransferError("transfer_not_prepared")
        RUNTIME.mkdir(mode=0o700)
    info = RUNTIME.lstat()
    if RUNTIME.is_symlink() or not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700 or RUNTIME.resolve() != RUNTIME:
        raise TransferError("unsafe_runtime_directory")
    if any(path.name not in ALLOWED_RUNTIME_FILES or path.is_symlink() or not path.is_file() for path in RUNTIME.iterdir()):
        raise TransferError("unknown_runtime_contents")


def process_identity(pid):
    try:
        text = Path("/proc") / str(int(pid)) / "stat"
        raw = text.read_text()
        # A process comm may contain spaces: fields start after its closing ')'.
        fields = raw[raw.rfind(")") + 2:].split()
        return fields[19] if fields[0] != "Z" else None
    except (ValueError, OSError, IndexError):
        return None


def active(state, prefix):
    return bool(state.get(prefix + "_pid") and state.get(prefix + "_start_ticks")
                and process_identity(state[prefix + "_pid"]) == state[prefix + "_start_ticks"])


def safe_status():
    runtime_directory()
    config = read_json(RUNTIME / "config.json")
    state = read_json(RUNTIME / "state.json") if (RUNTIME / "state.json").exists() else {"phase": "prepared"}
    if state.get("config_sha256") not in (None, digest(config)):
        raise TransferError("state_config_mismatch")
    return {"version": 1, "phase": state.get("phase"), "state": state,
            "worker_active": active(state, "worker"), "rsync_active": active(state, "rsync"),
            "source_container_id": config["source_container_id"], "private_key_exported": False}


def install_owned(path, content):
    wanted = hashlib.sha256(content).hexdigest()
    if path.exists():
        if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != wanted:
            raise TransferError("refusing_unknown_file_overwrite")
    else:
        descriptor = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)


def source_prepare(args):
    if not re.fullmatch(r"[0-9a-f]{40}", args.revision) or args.bwlimit_kib <= 0 or not math.isfinite(args.hash_mib_per_sec) or args.hash_mib_per_sec <= 0:
        raise TransferError("invalid_transfer_contract")
    runtime_directory(create=True)
    ident = stopped_container(args.source_container)
    if SOURCE.resolve() != SOURCE or SOURCE.is_symlink() or not SOURCE.is_dir():
        raise TransferError("unexpected_source_volume")
    expected_host = "[{}]:{}".format(DESTINATION_HOST, DESTINATION_PORT)
    host_fields = args.known_host.strip().split()
    if len(host_fields) != 3 or host_fields[0] != expected_host or host_fields[1] != "ssh-ed25519" or not re.fullmatch(r"[A-Za-z0-9+/=]+", host_fields[2]):
        raise TransferError("invalid_pinned_destination_key")
    try:
        tool = base64.b64decode(args.tool_base64, validate=True)
    except ValueError:
        raise TransferError("invalid_tool_payload")
    if hashlib.sha256(tool).hexdigest() != args.tool_sha256:
        raise TransferError("tool_hash_mismatch")
    own_bytes = Path(__file__).read_bytes()
    config = {"version": 1, "revision": args.revision, "source_container_id": ident,
              "source_root": str(SOURCE), "destination_host": DESTINATION_HOST, "destination_port": DESTINATION_PORT,
              "destination_user": TRANSFER_USER, "destination_root": str(DESTINATION),
              "receiver_alias": str(RECEIVER_ALIAS),
              "host_key_sha256": hashlib.sha256((args.known_host.strip() + "\n").encode()).hexdigest(),
              "tool_sha256": args.tool_sha256, "transfer_helper_sha256": hashlib.sha256(own_bytes).hexdigest(),
              "bwlimit_kib": args.bwlimit_kib, "hash_mib_per_sec": args.hash_mib_per_sec}
    config_path = RUNTIME / "config.json"
    if config_path.exists():
        if read_json(config_path) != config:
            raise TransferError("existing_transfer_contract_differs")
    elif any(RUNTIME.iterdir()):
        raise TransferError("unknown_existing_transfer")
    else:
        atomic_json(config_path, config)
    install_owned(RUNTIME / "known_hosts", (args.known_host.strip() + "\n").encode())
    install_owned(RUNTIME / "data_tool.py", tool)
    install_owned(RUNTIME / "transfer.py", own_bytes)
    command([sys.executable, str(RUNTIME / "data_tool.py"), "layout", "--root", str(SOURCE), "--stopped-confirmed"])
    private = RUNTIME / "id_ed25519"
    public = RUNTIME / "id_ed25519.pub"
    if not private.exists() and not public.exists():
        command(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "redunisol-bcra-data-transfer", "-f", str(private)])
    if private.is_symlink() or public.is_symlink() or not private.is_file() or not public.is_file() or stat.S_IMODE(private.stat().st_mode) != 0o600 or private.stat().st_uid != 0:
        raise TransferError("unsafe_transfer_key")
    public_key = command(["ssh-keygen", "-y", "-f", str(private)])
    fields = public.read_text().split()
    if len(fields) < 2 or " ".join(fields[:2]) != public_key or not re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/=]+", public_key):
        raise TransferError("transfer_key_pair_mismatch")
    return {"version": 1, "status": "prepared", "public_key": public_key, "config_sha256": digest(config),
            "source_container_id": ident, "source_root_uid": SOURCE.stat().st_uid,
            "source_root_gid": SOURCE.stat().st_gid, "private_key_exported": False}


def rsync_command(config):
    ssh = "ssh -p {} -i {} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile={}".format(
        config["destination_port"], RUNTIME / "id_ed25519", RUNTIME / "known_hosts")
    return ["rsync", "-aH", "--numeric-ids", "--partial", "--bwlimit={}".format(config["bwlimit_kib"]),
            "--rsh", ssh, "--", str(SOURCE) + "/", "{}@{}:./".format(config["destination_user"], config["destination_host"])]


def save_state(state):
    state["updated_at"] = now()
    atomic_json(RUNTIME / "state.json", state)
    descriptor = os.open(str(RUNTIME / "copy.log"), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        handle.write(json.dumps({key: state[key] for key in ("phase", "updated_at", "reason", "copy_returncode") if key in state}) + "\n")


def lock_runtime(blocking=False):
    handle = (RUNTIME / "lock").open("a+")
    os.chmod(str(RUNTIME / "lock"), 0o600)
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
    except (BlockingIOError, OSError):
        handle.close()
        raise TransferError("transfer_lock_held")
    return handle


def source_start(resume=False):
    runtime_directory()
    lock = lock_runtime()
    try:
        config = read_json(RUNTIME / "config.json")
        state = read_json(RUNTIME / "state.json") if (RUNTIME / "state.json").exists() else {}
        if state.get("config_sha256") not in (None, digest(config)):
            raise TransferError("state_config_mismatch")
        if active(state, "worker") or active(state, "rsync"):
            return safe_status()
        if state.get("phase") == "complete":
            return safe_status()
        if state and not resume:
            raise TransferError("explicit_resume_required")
        stopped_container(config["source_container_id"])
        state.update(version=1, phase="launching", config_sha256=digest(config), cutoff_at=state.get("cutoff_at", now()))
        save_state(state)
        with open(os.devnull, "rb") as incoming, open(os.devnull, "ab") as outgoing:
            child = subprocess.Popen([sys.executable, str(RUNTIME / "transfer.py"), "worker"], stdin=incoming,
                                     stdout=outgoing, stderr=outgoing, close_fds=True, start_new_session=True)
        state.update(worker_pid=child.pid, worker_start_ticks=process_identity(child.pid))
        save_state(state)
        return {"version": 1, "status": "started", "worker_pid": child.pid, "phase": "launching", "private_key_exported": False}
    finally:
        lock.close()


def source_worker():
    runtime_directory()
    lock = lock_runtime(blocking=True)
    state = read_json(RUNTIME / "state.json")
    try:
        config = read_json(RUNTIME / "config.json")
        if state.get("config_sha256") != digest(config) or state.get("worker_pid") != os.getpid():
            raise TransferError("unexpected_worker_identity")
        stopped_container(config["source_container_id"])
        command([sys.executable, str(RUNTIME / "data_tool.py"), "layout", "--root", str(SOURCE), "--stopped-confirmed"])
        if state.get("copy_returncode") != 0:
            state.update(phase="copying")
            save_state(state)
            with open(os.devnull, "rb") as incoming, open(os.devnull, "ab") as outgoing:
                child = subprocess.Popen(rsync_command(config), stdin=incoming, stdout=outgoing, stderr=outgoing)
                state.update(rsync_pid=child.pid, rsync_start_ticks=process_identity(child.pid))
                save_state(state)
                code = child.wait()
            state.update(copy_returncode=code, copy_finished_at=now())
            save_state(state)
            if code != 0:
                raise TransferError("rsync_failed")
        stopped_container(config["source_container_id"])
        state.update(phase="hashing")
        save_state(state)
        command([sys.executable, str(RUNTIME / "data_tool.py"), "inventory", "--root", str(SOURCE),
                 "--output", str(RUNTIME / "source-manifest.json"), "--max-read-mib-per-sec", str(config["hash_mib_per_sec"]), "--stopped-confirmed"])
        stopped_container(config["source_container_id"])
        manifest = json.loads((RUNTIME / "source-manifest.json").read_text())
        state.update(phase="complete", source_manifest_sha256=hashlib.sha256((RUNTIME / "source-manifest.json").read_bytes()).hexdigest(),
                     tree_sha256=manifest["tree_sha256"], completed_at=now())
        save_state(state)
    except Exception as error:
        state.update(phase="failed", reason=str(error) if isinstance(error, TransferError) else "worker_failed")
        save_state(state)
        return 1
    finally:
        lock.close()
    return 0


def assert_destination_stopped():
    if command(["docker", "ps", "-q", "--filter", "name=^/redunisol-bcra-file-api$"]):
        raise TransferError("destination_service_running")
    identifiers = command(["docker", "ps", "-q"]).splitlines()
    destination = DESTINATION.as_posix()
    for ident in identifiers:
        if not re.fullmatch(r"[0-9a-f]{12,64}", ident):
            raise TransferError("invalid_container_listing")
        mounts = json.loads(command(["docker", "inspect", "--format", "{{json .Mounts}}", ident]))
        if any(mount.get("RW") and mount.get("Source") and (
            mount["Source"] == destination or destination.startswith(mount["Source"].rstrip("/") + "/")
            or mount["Source"].startswith(destination + "/")) for mount in mounts):
            raise TransferError("destination_has_running_writer")


def destination_guard(public_key):
    if not re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/=]+", public_key):
        raise TransferError("invalid_public_key")
    assert_destination_stopped()
    if not DESTINATION.exists() or DESTINATION.is_symlink() or DESTINATION.resolve() != DESTINATION or not DESTINATION.is_dir():
        raise TransferError("invalid_destination_root")
    info = DESTINATION.stat()
    if info.st_uid != 10001 or info.st_gid != 10001:
        raise TransferError("unexpected_destination_owner")
    marker = {"version": 1, "destination_root": str(DESTINATION), "source_host": SOURCE_HOST,
              "receiver_alias": str(RECEIVER_ALIAS),
              "public_key_sha256": hashlib.sha256(public_key.encode()).hexdigest()}
    if RECEIVER_MARKER.exists():
        if read_json(RECEIVER_MARKER) != marker:
            raise TransferError("receiver_contract_differs")
    else:
        if any(DESTINATION.iterdir()):
            raise TransferError("destination_not_empty_or_owned_resume")
        RECEIVER_MARKER.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        atomic_json(RECEIVER_MARKER, marker)
    return {"version": 1, "status": "receiver_validated", "public_key_sha256": marker["public_key_sha256"]}


def alias_mounts():
    rows = []
    for line in Path("/proc/self/mountinfo").read_text().splitlines():
        fields = line.split()
        if len(fields) >= 6 and fields[4] == str(RECEIVER_ALIAS):
            rows.append(fields)
    return rows


def assert_alias_identity():
    mounts = alias_mounts()
    if len(mounts) != 1 or RECEIVER_ALIAS.is_symlink() or not RECEIVER_ALIAS.is_dir():
        raise TransferError("receiver_alias_not_single_mount")
    actual, expected = RECEIVER_ALIAS.stat(), DESTINATION.stat()
    if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino) or actual.st_uid != 10001 or actual.st_gid != 10001:
        raise TransferError("receiver_alias_identity_mismatch")


def destination_alias():
    assert_destination_stopped()
    marker = read_json(RECEIVER_MARKER)
    if marker.get("destination_root") != str(DESTINATION) or marker.get("receiver_alias") != str(RECEIVER_ALIAS) or marker.get("authorization_revoked"):
        raise TransferError("receiver_contract_differs")
    parent = RECEIVER_ALIAS.parent
    if parent.is_symlink() or parent.resolve() != parent or parent.stat().st_uid != 0 or stat.S_IMODE(parent.stat().st_mode) != 0o755:
        raise TransferError("unsafe_receiver_home")
    if alias_mounts():
        assert_alias_identity()
        return {"version": 1, "status": "alias_verified", "receiver_alias": str(RECEIVER_ALIAS), "canonical_root": str(DESTINATION)}
    if RECEIVER_ALIAS.exists():
        if RECEIVER_ALIAS.is_symlink() or not RECEIVER_ALIAS.is_dir() or RECEIVER_ALIAS.stat().st_uid != 0 or RECEIVER_ALIAS.stat().st_gid != 0 or stat.S_IMODE(RECEIVER_ALIAS.stat().st_mode) != 0o700 or any(RECEIVER_ALIAS.iterdir()):
            raise TransferError("receiver_alias_not_empty_owned_directory")
    else:
        RECEIVER_ALIAS.mkdir(mode=0o700)
    command(["mount", "--bind", str(DESTINATION), str(RECEIVER_ALIAS)])
    assert_alias_identity()
    return {"version": 1, "status": "alias_created", "receiver_alias": str(RECEIVER_ALIAS), "canonical_root": str(DESTINATION)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command")
    commands.required = True
    prepare = commands.add_parser("prepare-source")
    prepare.add_argument("--source-container", required=True)
    prepare.add_argument("--revision", required=True)
    prepare.add_argument("--known-host", required=True)
    prepare.add_argument("--tool-base64", required=True)
    prepare.add_argument("--tool-sha256", required=True)
    prepare.add_argument("--bwlimit-kib", type=int, default=8192)
    prepare.add_argument("--hash-mib-per-sec", type=float, default=8)
    start = commands.add_parser("start")
    start.add_argument("--resume-confirmed", action="store_true")
    commands.add_parser("worker")
    commands.add_parser("status")
    commands.add_parser("prepare-alias")
    receiver = commands.add_parser("guard-destination")
    receiver.add_argument("--public-key", required=True)
    args = parser.parse_args(argv)
    try:
        if fcntl is None or not hasattr(os, "geteuid") or os.geteuid() != 0:
            raise TransferError("linux_root_required")
        if args.command == "prepare-source":
            result = source_prepare(args)
        elif args.command == "start":
            result = source_start(args.resume_confirmed)
        elif args.command == "worker":
            return source_worker()
        elif args.command == "guard-destination":
            result = destination_guard(args.public_key)
        elif args.command == "prepare-alias":
            result = destination_alias()
        else:
            result = safe_status()
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        print(json.dumps({"version": 1, "status": "failed", "reason": str(error) if isinstance(error, TransferError) else "operation_failed"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
