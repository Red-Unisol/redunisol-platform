#!/usr/bin/env python3
"""Read-only guards for the one isolated shadow project; never print environment values."""
import argparse
import http.client
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import sys

PROJECT = "metamap-webhook-shadow"
IMAGE = "ghcr.io/red-unisol/metamap-platform-server@sha256:f7ecf3631daf2ee5dddf7a4f1772ef6fd71fa0eb00c43add4152de4d7f7b54a5"
PLATFORM = Path("/srv/redunisol/platform/metamap-shadow")
STATE = Path("/srv/redunisol/state/metamap-shadow")
PRIVATE = Path("/etc/redunisol-metamap-shadow")
RUN = Path("/run/redunisol-metamap-shadow")
SOCKET = RUN / "receiver.sock"
MARKER = '{"scope":"metamap-webhook-shadow","version":1}\n'
ENV_KEYS = {"METAMAP_SHADOW_WEBHOOK_SECRET", "METAMAP_SHADOW_DELIVERY_TOKEN",
            "METAMAP_SHADOW_DATABASE_URL", "METAMAP_SHADOW_REVISION"}
COMMAND = ["python", "-m", "uvicorn", "shadow_app:app", "--uds", "/run/shadow/receiver.sock", "--no-access-log"]
DOCKER = ["docker", "--host", "unix:///var/run/docker.sock"]


def private_file(path):
    descriptor = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 16384:
            raise ValueError("Environment must be a small regular file")
        if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077:
            raise ValueError("Environment must be owned by the operator and private")
        return stream.read().decode("utf-8")


def parse_environment(text, revision):
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Reviewed revision must be SHA40")
    result = {}
    for line in text.splitlines():
        if not line:
            continue
        key, separator, value = line.partition("=")
        if not separator or key not in ENV_KEYS or key in result or "\x00" in value:
            raise ValueError("Environment must contain exactly the four shadow keys")
        result[key] = value
    if set(result) != ENV_KEYS:
        raise ValueError("Environment must contain exactly the four shadow keys")
    if len(result["METAMAP_SHADOW_WEBHOOK_SECRET"].encode("utf-8")) < 16:
        raise ValueError("Webhook signing secret is too short")
    if len(result["METAMAP_SHADOW_DELIVERY_TOKEN"].encode("utf-8")) < 32:
        raise ValueError("Shadow delivery token is too short")
    if result["METAMAP_SHADOW_DATABASE_URL"] != "sqlite+pysqlite:////data/shadow.sqlite":
        raise ValueError("Shadow database must use its isolated SQLite path")
    if result["METAMAP_SHADOW_REVISION"] != revision:
        raise ValueError("Shadow environment revision differs from the reviewed revision")
    return result


def docker(arguments, json_output=False):
    completed = subprocess.run(DOCKER + arguments, capture_output=True, text=True, timeout=10, check=False)
    if completed.returncode:
        raise ValueError("Local Docker read failed")
    return json.loads(completed.stdout) if json_output else completed.stdout.strip()


def owned_snapshot():
    names = docker(["container", "ls", "--all", "--filter", "name=^/" + PROJECT + "$", "--quiet"]).splitlines()
    project_ids = docker(["container", "ls", "--all", "--filter", "label=com.docker.compose.project=" + PROJECT,
                          "--quiet"]).splitlines()
    if not names:
        if project_ids:
            raise ValueError("Unexpected extra container in the shadow project")
        return None
    if len(names) != 1 or set(names) != set(project_ids):
        raise ValueError("Shadow name or project belongs to an unexpected container")
    snapshot = docker(["container", "inspect", names[0]], json_output=True)[0]
    labels = snapshot.get("Config", {}).get("Labels") or {}
    if labels.get("com.docker.compose.project") != PROJECT or labels.get("redunisol.shadow.scope") != "webhook-replay-only":
        raise ValueError("Refusing to adopt a container without the shadow ownership labels")
    return snapshot


def check_paths():
    paths = [Path("/srv"), Path("/srv/redunisol"), Path("/srv/redunisol/platform"), Path("/srv/redunisol/state"),
             PLATFORM, PLATFORM / "code", STATE, STATE / "data", Path("/etc"), Path("/etc/tmpfiles.d"), PRIVATE,
             Path("/run"), RUN]
    for path in paths:
        if str(path.resolve()) != str(path):
            raise ValueError("Shadow path has a symlinked ancestor")
        if path.exists():
            info = path.lstat()
            owner = 10090 if path in (STATE / "data", RUN) else 0
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner or info.st_mode & 0o022:
                raise ValueError("Existing shadow path has unsafe type, owner or permissions")
            if path == RUN and (info.st_gid != 33 or stat.S_IMODE(info.st_mode) != 0o750):
                raise ValueError("Shadow socket directory must be 10090:www-data mode 0750")
    for path in [PLATFORM / "compose.yml", PLATFORM / "shadow-control.py", PLATFORM / "code/shadow_app.py",
                 PRIVATE / "runtime.env", STATE / ".shadow-state.json", Path("/etc/tmpfiles.d/redunisol-metamap-shadow.conf")]:
        if path.is_symlink() or (path.exists() and (not path.is_file() or path.lstat().st_uid != 0)):
            raise ValueError("Existing shadow file has an unsafe type or owner")
    if SOCKET.exists() or SOCKET.is_symlink():
        validate_socket(SOCKET)
    marker = STATE / ".shadow-state.json"
    if marker.exists():
        if marker.stat().st_size != len(MARKER) or marker.read_text(encoding="utf-8") != MARKER:
            raise ValueError("Shadow state marker is not recognized")
    elif (STATE / "data").exists() and any((STATE / "data").iterdir()):
        raise ValueError("Refusing to adopt existing data without the shadow state marker")


def validate_socket(path):
    info = path.lstat()
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid != 10090 or str(path.resolve()) != str(path):
        raise ValueError("Existing shadow endpoint must be a canonical Unix socket owned by 10090")


def runtime_differences(snapshot, revision, adapter_hash, environment, image_environment):
    config = snapshot.get("Config", {})
    host = snapshot.get("HostConfig", {})
    labels = config.get("Labels") or {}
    differences = []

    def require(condition, label):
        if not condition:
            differences.append(label)

    require(config.get("Image") == IMAGE, "image")
    require(config.get("User") == "10090:10090", "user")
    require(config.get("Cmd") == COMMAND, "command")
    require(config.get("Entrypoint") in (None, []), "entrypoint")
    require(labels.get("redunisol.shadow.revision") == revision, "revision")
    require(labels.get("redunisol.shadow.adapter-sha256") == adapter_hash, "adapter")
    require(host.get("ReadonlyRootfs") is True, "read_only_root")
    require(set(host.get("CapDrop") or []) == {"ALL"} and not host.get("CapAdd"), "capabilities")
    require("no-new-privileges:true" in (host.get("SecurityOpt") or []), "no_new_privileges")
    require(not host.get("Privileged"), "privileged")
    require(not host.get("PidMode") and not host.get("UTSMode") and host.get("IpcMode") == "private",
            "host_namespaces")
    require(not host.get("VolumesFrom") and not host.get("ExtraHosts") and not host.get("GroupAdd"), "host_access")
    require(host.get("PidsLimit") == 64 and host.get("Memory") == 536870912 and host.get("NanoCpus") == 500000000,
            "resource_limits")
    require(host.get("RestartPolicy", {}).get("Name") == "unless-stopped", "restart_policy")
    require(host.get("Init") is True, "init")
    require(not host.get("PortBindings"), "ports")
    require(not host.get("Binds") and not host.get("Devices"), "unmanaged_mounts_or_devices")
    expected_mounts = {(str(PLATFORM / "code/shadow_app.py"), "/shadow/shadow_app.py", False),
                       (str(STATE / "data"), "/data", True), (str(RUN), "/run/shadow", True)}
    binds = [item for item in snapshot.get("Mounts", []) if item.get("Type") == "bind"]
    require({(item.get("Source"), item.get("Destination"), item.get("RW")) for item in binds} == expected_mounts,
            "bind_mounts")
    require(all(item.get("Type") in ("bind", "tmpfs") for item in snapshot.get("Mounts", [])), "extra_mounts")
    require(set(host.get("Tmpfs") or {}) == {"/tmp"}, "tmpfs")
    temporary = set((host.get("Tmpfs") or {}).get("/tmp", "").split(","))
    require({"noexec", "nosuid"} <= temporary and bool({"size=16777216", "size=16m"} & temporary), "tmpfs_limits")
    settings = snapshot.get("NetworkSettings", {})
    require(host.get("NetworkMode") == "none", "network_mode")
    require(set(settings.get("Networks") or {}) == {"none"}, "networks")
    addresses = ("IPAddress", "Gateway", "GlobalIPv6Address", "IPv6Gateway", "MacAddress")
    require(not any(settings.get(name) for name in addresses) and
            not any(item.get(name) for item in (settings.get("Networks") or {}).values() for name in addresses), "network_addresses")
    # The base image exposes 8000/tcp as metadata; null has no host publication.
    require(all(value is None for value in (settings.get("Ports") or {}).values()), "published_ports")
    actual = {}
    for item in config.get("Env") or []:
        key, separator, value = item.partition("=")
        if key in actual:
            differences.append("duplicate_environment_key")
        if separator:
            actual[key] = value
    # Compare every key against this immutable image plus our explicit settings,
    # without emitting either environment. The image declares its build SHA.
    desired = dict(item.split("=", 1) for item in image_environment)
    desired.update(environment)
    desired.update(PYTHONPATH="/shadow:/app", PYTHONDONTWRITEBYTECODE="1", PYTHONUNBUFFERED="1")
    require(actual == desired, "application_environment")
    require(actual.get("PYTHONPATH") == "/shadow:/app", "python_path")
    require(actual.get("PYTHONDONTWRITEBYTECODE") == "1" and actual.get("PYTHONUNBUFFERED") == "1", "python_runtime")
    return differences


def read_health(revision, socket_path=SOCKET):
    values = {}
    for endpoint in ("health", "stats"):
        connection = http.client.HTTPConnection("localhost", timeout=3)
        connection.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        connection.sock.settimeout(3)
        try:
            connection.sock.connect(str(socket_path))
            connection.request("GET", "/" + endpoint)
            response = connection.getresponse()
            if response.status != 200:
                raise ValueError("Shadow health or stats did not return 200")
            body = response.read(8193)
            if len(body) > 8192:
                raise ValueError("Shadow aggregate response is too large")
            value = json.loads(body)
        finally:
            connection.close()
        common = {"shadow_only": True, "enrichment_enabled": False, "revision": revision,
                  "recommended_trial_days": 7, "automatic_retention": False}
        if not isinstance(value, dict) or any(type(value.get(key)) is not type(expected) or value[key] != expected
                                              for key, expected in common.items()):
            raise ValueError("Shadow response differs from the isolated runtime contract")
        if endpoint == "health":
            if value.get("status") != "ok" or set(value) != set(common) | {"status"}:
                raise ValueError("Shadow health contract is unknown")
        else:
            names = {"deliveries", "duplicates", "rejections", "processing_failures", "validations", "receipts"}
            if (set(value) != set(common) | names | {"status", "volatile_counters"} or value.get("status") != "ok" or
                    value.get("volatile_counters") != ["envelope_rejections", "processing_failures"] or
                    any(type(value.get(key)) is not int or value[key] < 0 for key in names)):
                raise ValueError("Shadow stats must contain only the agreed aggregate counters")
        values[endpoint] = value
    return values


def inspect_runtime(revision, adapter_hash, with_health=False):
    snapshot = owned_snapshot()
    if snapshot is None:
        return {"exists": False, "running": False, "matches": False, "needs_recreate": False, "container_id": None,
                "differences": ["absent"]}
    environment = parse_environment(private_file(PRIVATE / "runtime.env"), revision)
    image = docker(["image", "inspect", IMAGE], json_output=True)[0]
    differences = runtime_differences(snapshot, revision, adapter_hash, environment,
                                      image.get("Config", {}).get("Env") or [])
    running = snapshot.get("State", {}).get("Running") is True
    result = {"exists": True, "running": running, "matches": not differences and running,
              "needs_recreate": bool(differences), "container_id": snapshot["Id"], "differences": differences,
              "docker_health": snapshot.get("State", {}).get("Health", {}).get("Status"),
              "restart_count": snapshot.get("RestartCount")}
    if with_health:
        if not result["matches"] or result["docker_health"] != "healthy":
            raise ValueError("Shadow runtime configuration, state or Docker health differs")
        validate_socket(SOCKET)
        result.update(read_health(revision))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["environment", "preflight", "inspect", "owned"])
    parser.add_argument("--file")
    parser.add_argument("--revision", default="")
    parser.add_argument("--adapter-sha256", default="")
    parser.add_argument("--health", action="store_true")
    args = parser.parse_args()
    try:
        if args.operation == "environment":
            parse_environment(private_file(Path(args.file)), args.revision)
            result = {"valid": True, "keys": sorted(ENV_KEYS)}
        elif args.operation == "preflight":
            check_paths()
            snapshot = owned_snapshot()
            cached = docker(["image", "inspect", IMAGE], json_output=True)[0]
            if IMAGE not in cached.get("RepoDigests", []):
                raise ValueError("The reviewed image is not already cached by exact digest")
            networks = docker(["network", "ls", "--filter", "name=^" + PROJECT + "-internal$", "--quiet"]).splitlines()
            if networks:
                if len(networks) != 1:
                    raise ValueError("Unexpected shadow network identities")
                network = docker(["network", "inspect", networks[0]], json_output=True)[0]
                allowed = {snapshot["Id"]} if snapshot else set()
                if (network.get("Internal") is not True or
                        (network.get("Labels") or {}).get("com.docker.compose.project") != PROJECT or
                        not set(network.get("Containers") or {}) <= allowed):
                    raise ValueError("Refusing to adopt a foreign shared or nonisolated shadow network")
            result = {"valid": True, "container_exists": snapshot is not None}
        elif args.operation == "owned":
            snapshot = owned_snapshot()
            result = {"exists": snapshot is not None, "running": bool(snapshot and snapshot.get("State", {}).get("Running")),
                      "container_id": snapshot["Id"] if snapshot else None}
        else:
            if not re.fullmatch(r"[0-9a-f]{40}", args.revision) or not re.fullmatch(r"[0-9a-f]{64}", args.adapter_sha256):
                raise ValueError("Inspect requires the reviewed SHA40 and adapter SHA256")
            result = inspect_runtime(args.revision, args.adapter_sha256, args.health)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (ValueError, OSError, http.client.HTTPException, subprocess.SubprocessError, KeyError, TypeError, json.JSONDecodeError):
        # Docker errors may contain environment/configuration; never reproduce stderr or inspected values.
        print(json.dumps({"valid": False, "error": "Shadow guard failed; inspect the reviewed inputs and isolated runtime."}))
        return 2


if __name__ == "__main__":
    sys.exit(main())
