"""Python 3.6 compatible private-link reconciliation, invoked only by its role.

The client key is generated and kept on the VPS. Only public material is returned.
No BCRA token or data volume is accepted by this program.
"""
import argparse
import base64
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request


USER = "bcra-link"
HOME = Path("/var/lib/bcra-private-link")
CONFIG = Path("/etc/redunisol/bcra-private-link")
UNIT = Path("/etc/systemd/system/redunisol-bcra-private-link.service")
DROPIN = Path("/etc/ssh/sshd_config.d/80-redunisol-bcra-private-link.conf")
CONTAINER = "redunisol-bcra-private-proxy"
NETWORK = "kestra_net"
OWNER_LABEL = "io.redunisol.bcra-private-link"
HASH_LABEL = "io.redunisol.bcra-private-link-sha256"
FIELDS = set("side action apply_authorized revision server_host server_port server_host_key "
             "client_public_key client_source_ip expected_gateway expected_subnet proxy_image "
             "expected_hostname expected_machine_id".split())
APPROVED = {
    "client": ("vps-5779267-x.dattaweb.com", "38fb3a47ef83df9ec5ef8e3c71e5560d"),
    "server": ("sd-6598683-l.dattaweb.com", "6143066aad8c4c6ab415872a6ba7e726"),
}


class LinkError(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise LinkError(reason)


def public_key(value):
    fields = value.strip().split()
    require(len(fields) in (2, 3) and fields[0] == "ssh-ed25519", "invalid_public_key")
    try:
        wire = base64.b64decode(fields[1], validate=True)
    except (ValueError, TypeError):
        raise LinkError("invalid_public_key")
    require(wire[:19] == b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20" and len(wire) == 51,
            "invalid_public_key")
    return " ".join(fields[:2])


def validate(config):
    require(isinstance(config, dict) and not (set(config) - FIELDS), "invalid_config_fields")
    side, action = config.get("side"), config.get("action")
    require(side in ("client", "server"), "invalid_side")
    require(action in ("plan", "prepare_key", "apply", "verify"), "invalid_action")
    require(type(config.get("apply_authorized")) is bool, "authorization_must_be_boolean")
    if action in ("prepare_key", "apply"):
        require(config["apply_authorized"] and bool(re.fullmatch("[a-f0-9]{40}", config.get("revision", ""))),
                "explicit_authorization_and_revision_required")
    require(action != "prepare_key" or side == "client", "key_generation_is_client_only")
    if action == "plan":
        return config
    require((config.get("expected_hostname"), config.get("expected_machine_id")) == APPROVED[side],
            "expected_host_must_match_reviewed_side")
    if action == "prepare_key":
        return config
    if side == "server":
        public_key(config.get("client_public_key", ""))
        try:
            address = ipaddress.ip_address(config.get("client_source_ip", ""))
        except ValueError:
            raise LinkError("explicit_client_source_ip_required")
        require(address.version == 4 and not address.is_unspecified, "invalid_client_source_ip")
    else:
        host = config.get("server_host", "")
        require(bool(re.fullmatch("[A-Za-z0-9][A-Za-z0-9.-]{0,252}", host)), "invalid_server_host")
        require(type(config.get("server_port")) is int and 1 <= config["server_port"] <= 65535,
                "invalid_server_port")
        public_key(config.get("server_host_key", ""))
        require(bool(re.fullmatch("(?:ghcr.io/red-unisol/bcra-file-api@)?sha256:[a-f0-9]{64}", config.get("proxy_image", ""))),
                "proxy_requires_an_existing_immutable_local_image")
        try:
            gateway = ipaddress.ip_address(config.get("expected_gateway", ""))
            subnet = ipaddress.ip_network(config.get("expected_subnet", ""))
        except ValueError:
            raise LinkError("invalid_expected_bridge")
        require(gateway.version == 4 and gateway.is_private and not gateway.is_loopback
                and gateway in subnet, "bridge_must_be_private_and_explicit")
    return config


def run(argv, stdin=None, allowed=(0,), timeout=30):
    try:
        result = subprocess.run(argv, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                universal_newlines=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise LinkError("operation_unavailable_" + os.path.basename(argv[0]))
    require(result.returncode in allowed, "operation_failed_" + os.path.basename(argv[0]))
    return result.stdout


def no_symlink(path):
    for entry in [path] + list(path.parents):
        require(not entry.is_symlink(), "managed_path_is_a_symlink")


def directory(path, mode, uid=0, gid=0):
    no_symlink(path)
    changed = not path.exists()
    path.mkdir(parents=True, exist_ok=True)
    require(path.is_dir(), "managed_directory_conflict")
    current = path.stat()
    if stat.S_IMODE(current.st_mode) != mode:
        os.chmod(str(path), mode)
        changed = True
    if (current.st_uid, current.st_gid) != (uid, gid):
        os.chown(str(path), uid, gid)
        changed = True
    return changed


def write(path, content, mode, uid=0, gid=0):
    no_symlink(path)
    data = content.encode() if isinstance(content, str) else content
    old = path.read_bytes() if path.is_file() else None
    changed = old != data
    if changed:
        descriptor, temporary = tempfile.mkstemp(prefix=".bcra-link-", dir=str(path.parent))
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temporary, mode)
            os.chown(temporary, uid, gid)
            os.replace(temporary, str(path))
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    current = path.stat()
    if stat.S_IMODE(current.st_mode) != mode:
        os.chmod(str(path), mode)
        changed = True
    if (current.st_uid, current.st_gid) != (uid, gid):
        os.chown(str(path), uid, gid)
        changed = True
    return changed


def account(create):
    import pwd
    try:
        user = pwd.getpwnam(USER)
    except KeyError:
        require(create, "service_account_missing")
        run(["/usr/sbin/useradd", "--system", "--user-group", "--create-home",
             "--home-dir", str(HOME), "--shell", "/usr/sbin/nologin", USER])
        user = pwd.getpwnam(USER)
    require(user.pw_uid != 0 and user.pw_dir == str(HOME) and user.pw_shell == "/usr/sbin/nologin",
            "existing_account_is_not_the_dedicated_service_account")
    return user


def prepare_key():
    existed = run(["/usr/bin/getent", "passwd", USER], allowed=(0, 2)).strip() != ""
    user = account(True)
    changed = directory(HOME, 0o700, user.pw_uid, user.pw_gid) or not existed
    private = HOME / "id_ed25519"
    no_symlink(private)
    if not private.exists():
        run(["/usr/bin/ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "bcra-private-link",
             "-f", str(private)])
        changed = True
    require(private.is_file(), "private_key_missing")
    current = private.stat()
    changed = changed or stat.S_IMODE(current.st_mode) != 0o600 or (current.st_uid, current.st_gid) != (user.pw_uid, user.pw_gid)
    os.chmod(str(private), 0o600)
    os.chown(str(private), user.pw_uid, user.pw_gid)
    # Derive only the public part; the private file never crosses this process/host.
    key = public_key(run(["/usr/bin/ssh-keygen", "-y", "-f", str(private)]))
    changed = write(HOME / "id_ed25519.pub", key + " bcra-private-link\n", 0o644,
                    user.pw_uid, user.pw_gid) or changed
    return {"changed": changed, "public_key": key, "private_key_exported": False}


def ssh_policy():
    return """# Managed only for the dedicated BCRA tunnel user.
Match User bcra-link
    AuthenticationMethods publickey
    PubkeyAuthentication yes
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    DisableForwarding no
    AllowTcpForwarding local
    AllowStreamLocalForwarding no
    PermitOpen 127.0.0.1:18082
    PermitListen none
    AllowAgentForwarding no
    X11Forwarding no
    PermitTTY no
    PermitTunnel no
    PermitUserRC no
    MaxSessions 0
    ForceCommand /usr/sbin/nologin
Match all
"""


def authorized_key(config):
    return ('from="' + config["client_source_ip"] + '",restrict,port-forwarding,'
            'permitopen="127.0.0.1:18082",no-agent-forwarding,no-X11-forwarding,no-pty '
            + public_key(config["client_public_key"]) + " bcra-private-link\n")


def effective(user, address):
    return run(["/usr/sbin/sshd", "-T", "-C", "user=" + user + ",host=localhost,addr=" + address])


def server_verify(config):
    user = account(False)
    require((HOME / ".ssh/authorized_keys").read_text() == authorized_key(config), "authorized_key_drift")
    require(DROPIN.read_text() == ssh_policy(), "sshd_dropin_drift")
    run(["/usr/sbin/sshd", "-t"])
    policy = effective(USER, config["client_source_ip"])
    for line in ["authenticationmethods publickey", "pubkeyauthentication yes", "passwordauthentication no",
                 "kbdinteractiveauthentication no", "disableforwarding no", "allowtcpforwarding local",
                 "allowstreamlocalforwarding no", "permitopen 127.0.0.1:18082", "permitlisten none", "allowagentforwarding no",
                 "x11forwarding no", "permittty no", "permittunnel no", "permituserrc no", "maxsessions 0",
                 "forcecommand /usr/sbin/nologin"]:
        require(line in policy.splitlines(), "effective_sshd_tunnel_policy_mismatch")
    return {"changed": False, "restricted_user_policy_verified": True, "uid": user.pw_uid}


def server_apply(config):
    root_before = effective("root", config["client_source_ip"])
    user = account(True)
    changed = directory(HOME, 0o700, user.pw_uid, user.pw_gid)
    changed = directory(HOME / ".ssh", 0o700, user.pw_uid, user.pw_gid) or changed
    changed = write(HOME / ".ssh/authorized_keys", authorized_key(config), 0o600,
                    user.pw_uid, user.pw_gid) or changed
    require(DROPIN.parent.is_dir(), "sshd_dropin_directory_missing")
    no_symlink(DROPIN)
    previous = DROPIN.read_bytes() if DROPIN.is_file() else None
    policy_changed = write(DROPIN, ssh_policy(), 0o644)
    try:
        verification = server_verify(config)
        require(effective("root", config["client_source_ip"]) == root_before, "root_ssh_policy_would_change")
    except Exception:
        if policy_changed:
            if previous is None:
                DROPIN.unlink()
            else:
                write(DROPIN, previous, 0o644)
        raise
    if policy_changed:
        run(["/bin/systemctl", "reload", "ssh"])
    verification.update(changed=changed or policy_changed, root_ssh_policy_preserved=True)
    return verification


def network(config):
    records = json.loads(run(["/usr/bin/docker", "network", "inspect", NETWORK]))
    require(len(records) == 1 and records[0].get("Driver") == "bridge", "expected_docker_bridge_missing")
    blocks = [x for x in records[0].get("IPAM", {}).get("Config", []) if ":" not in x.get("Subnet", "")]
    require(len(blocks) == 1 and blocks[0].get("Gateway") == config["expected_gateway"]
            and blocks[0].get("Subnet") == config["expected_subnet"], "docker_bridge_identity_changed")
    return blocks[0]["Gateway"]


def tunnel_unit(config):
    return """[Unit]
Description=Private BCRA TCP transport to the dedicated host
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=bcra-link
Group=bcra-link
ExecStart=/usr/bin/ssh -F /dev/null -a -x -N -T -p {port} -i /var/lib/bcra-private-link/id_ed25519 -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/redunisol/bcra-private-link/known_hosts -o UpdateHostKeys=no -o ExitOnForwardFailure=yes -o ConnectTimeout=10 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L {gateway}:18083:127.0.0.1:18082 bcra-link@{host}
Restart=always
RestartSec=5
TimeoutStopSec=15
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
LockPersonality=true
CapabilityBoundingSet=

[Install]
WantedBy=multi-user.target
""".format(port=config["server_port"], gateway=config["expected_gateway"], host=config["server_host"])


def known_host(config):
    host = config["server_host"] if config["server_port"] == 22 else "[" + config["server_host"] + "]:" + str(config["server_port"])
    return host + " " + public_key(config["server_host_key"]) + "\n"


def unit_runtime():
    fields = ["User", "Group", "NoNewPrivileges", "ProtectSystem", "ProtectHome", "PrivateTmp",
              "PrivateDevices", "ProtectKernelTunables", "ProtectKernelModules", "ProtectControlGroups",
              "LockPersonality", "CapabilityBoundingSet", "RestrictAddressFamilies", "ExecStart",
              "NeedDaemonReload", "MainPID"]
    output = run(["/bin/systemctl", "show", UNIT.name] + ["--property=" + name for name in fields],
                 allowed=(0, 1, 3, 4))
    return dict(line.split("=", 1) for line in output.splitlines() if "=" in line)


def loaded_unit_matches(properties, config):
    expected = {"User": USER, "Group": USER, "NoNewPrivileges": "yes", "ProtectSystem": "strict",
                "ProtectHome": "yes", "PrivateTmp": "yes", "PrivateDevices": "yes",
                "ProtectKernelTunables": "yes", "ProtectKernelModules": "yes", "ProtectControlGroups": "yes",
                "LockPersonality": "yes", "CapabilityBoundingSet": ""}
    if any(properties.get(key) != value for key, value in expected.items()):
        return False
    if set(properties.get("RestrictAddressFamilies", "").split()) != {"AF_UNIX", "AF_INET", "AF_INET6"}:
        return False
    command = re.search(r"argv\[\]=(.*?) ;", properties.get("ExecStart", ""))
    expected_command = next(line.split("=", 1)[1] for line in tunnel_unit(config).splitlines()
                            if line.startswith("ExecStart="))
    return command is not None and shlex.split(command.group(1)) == shlex.split(expected_command)


def process_identity(properties, uid):
    pid = properties.get("MainPID", "")
    require(bool(re.fullmatch("[1-9][0-9]*", pid)), "tunnel_process_missing")
    try:
        lines = Path("/proc/" + pid + "/status").read_text().splitlines()
    except OSError:
        raise LinkError("tunnel_process_not_stable")
    fields = dict(line.split(":", 1) for line in lines if ":" in line)
    require(fields.get("Uid", "").split()[:2] == [str(uid), str(uid)]
            and fields.get("NoNewPrivs", "").strip() == "1", "tunnel_process_privilege_drift")


def proxy_spec(config, source):
    return hashlib.sha256(json.dumps({"image": config["proxy_image"], "gateway": config["expected_gateway"],
                                     "script": hashlib.sha256(source).hexdigest(), "network": NETWORK,
                                     "alias": "bcra-file-api-poc", "ports": "127.0.0.1:18082:8080"},
                                    sort_keys=True).encode()).hexdigest()


def local_image(config):
    image = json.loads(run(["/usr/bin/docker", "image", "inspect", config["proxy_image"]]))
    require(len(image) == 1, "immutable_local_image_missing")
    item = image[0]
    pinned = config["proxy_image"]
    require((pinned.startswith("sha256:") and item.get("Id") == pinned)
            or pinned in (item.get("RepoDigests") or []), "immutable_local_image_missing")
    return item["Id"]


def inspect_proxy():
    result = run(["/usr/bin/docker", "container", "inspect", CONTAINER], allowed=(0, 1))
    if not result.strip():
        return None
    records = json.loads(result)
    require(len(records) == 1, "proxy_inspection_ambiguous")
    item = records[0]
    require(item.get("Config", {}).get("Labels", {}).get(OWNER_LABEL) == "true", "proxy_name_owned_by_another_service")
    return item


def proxy_matches(item, config, source, image_id):
    settings = item.get("Config", {})
    host = item.get("HostConfig", {})
    mounts = item.get("Mounts", [])
    networks = item.get("NetworkSettings", {}).get("Networks", {})
    security = set(host.get("SecurityOpt") or [])
    return (settings.get("Labels", {}).get(HASH_LABEL) == proxy_spec(config, source)
            and item.get("Image") == image_id and settings.get("User") == "10001:10001"
            and settings.get("Entrypoint") == ["python"]
            and settings.get("Cmd") == ["/proxy.py", "--upstream-host", config["expected_gateway"], "--upstream-port", "18083"]
            and not any(value.startswith("BCRA_FILE_API_TOKEN=") for value in settings.get("Env", []))
            and host.get("ReadonlyRootfs") is True and host.get("Privileged") is False
            and set(host.get("CapDrop") or []) == {"ALL"} and not host.get("CapAdd")
            and security in ({"no-new-privileges:true"}, {"no-new-privileges"})
            and host.get("PortBindings") == {"8080/tcp": [{"HostIp": "127.0.0.1", "HostPort": "18082"}]}
            and host.get("Memory") == 64 * 1024 * 1024 and host.get("NanoCpus") == 100000000
            and host.get("PidsLimit") == 40 and host.get("LogConfig", {}).get("Type") == "none"
            and host.get("RestartPolicy", {}).get("Name") == "unless-stopped"
            and len(mounts) == 1 and mounts[0].get("Type") == "bind"
            and mounts[0].get("Destination") == "/proxy.py" and mounts[0].get("RW") is False
            and mounts[0].get("Source") == str(CONFIG / "proxy.py")
            and set(networks) == {NETWORK}
            and "bcra-file-api-poc" in (networks[NETWORK].get("Aliases") or []))


def proxy_args(config, spec):
    return ["/usr/bin/docker", "run", "--detach", "--name", CONTAINER, "--pull=never",
            "--label", OWNER_LABEL + "=true", "--label", HASH_LABEL + "=" + spec,
            "--restart", "unless-stopped", "--network", NETWORK, "--network-alias", "bcra-file-api-poc",
            "--publish", "127.0.0.1:18082:8080", "--read-only", "--user", "10001:10001",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--memory", "64m",
            "--cpus", "0.10", "--pids-limit", "40", "--log-driver", "none",
            "--mount", "type=bind,src=" + str(CONFIG / "proxy.py") + ",dst=/proxy.py,readonly",
            "--entrypoint", "python", config["proxy_image"], "/proxy.py",
            "--upstream-host", config["expected_gateway"], "--upstream-port", "18083"]


def health():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open("http://127.0.0.1:18082/health", timeout=8) as response:
        require(response.status == 200, "private_link_health_failed")
        body = json.loads(response.read(1024).decode())
        require(body == {"status": "up"}, "unexpected_private_link_health_contract")


def client_verify(config, source):
    user = account(False)
    gateway = network(config)
    require(UNIT.read_text() == tunnel_unit(config), "tunnel_unit_drift")
    require((CONFIG / "known_hosts").read_text() == known_host(config), "pinned_host_key_drift")
    require((CONFIG / "proxy.py").read_bytes() == source, "proxy_script_drift")
    run(["/bin/systemctl", "is-active", "--quiet", UNIT.name])
    run(["/bin/systemctl", "is-enabled", "--quiet", UNIT.name])
    properties = unit_runtime()
    require(properties.get("NeedDaemonReload") == "no" and loaded_unit_matches(properties, config),
            "tunnel_loaded_unit_policy_drift")
    process_identity(properties, user.pw_uid)
    item = inspect_proxy()
    require(item is not None and item.get("State", {}).get("Running"), "proxy_not_running")
    require(proxy_matches(item, config, source, local_image(config)), "proxy_security_or_configuration_drift")
    endpoint = item.get("NetworkSettings", {}).get("Networks", {}).get(NETWORK, {})
    require("bcra-file-api-poc" in (endpoint.get("Aliases") or []), "proxy_dns_alias_missing")
    # Test the name from the existing Kestra container, not a replacement runner.
    ids = run(["/usr/bin/docker", "ps", "--filter", "label=com.docker.compose.project=kestra",
               "--filter", "label=com.docker.compose.service=kestra", "--format", "{{.ID}}"])
    containers = [x for x in ids.splitlines() if re.fullmatch("[a-f0-9]{12,64}", x)]
    require(len(containers) == 1, "kestra_container_not_unique")
    resolved = run(["/usr/bin/docker", "exec", containers[0], "getent", "ahostsv4", "bcra-file-api-poc"])
    addresses = set(line.split()[0] for line in resolved.splitlines() if line.split())
    require(addresses == {endpoint.get("IPAddress")}, "kestra_dns_has_old_or_ambiguous_endpoint")
    health()
    return {"changed": False, "tunnel_active": True, "gateway": gateway, "proxy_health": "up",
            "kestra_dns_verified": True, "data_mounts": 0, "bcra_tokens_used": False,
            "loaded_unit_policy_verified": True, "process_identity_verified": True}


def client_apply(config, source):
    user = account(False)
    require((HOME / "id_ed25519").is_file(), "prepare_key_must_run_on_vps_first")
    gateway = network(config)
    image_id = local_image(config)
    old = run(["/usr/bin/docker", "ps", "--filter", "label=com.docker.compose.project=bcra-file-poc",
               "--filter", "label=com.docker.compose.service=bcra-file-api-poc", "--format", "{{.ID}}"])
    require(not old.strip(), "old_importer_must_remain_stopped_before_proxy_cutover")
    changed = directory(CONFIG, 0o755)
    changed = write(CONFIG / "known_hosts", known_host(config), 0o644) or changed
    changed = write(CONFIG / "proxy.py", source, 0o644) or changed
    unit_changed = write(UNIT, tunnel_unit(config), 0o644)
    properties = unit_runtime()
    loaded_changed = properties.get("NeedDaemonReload") != "no" or not loaded_unit_matches(properties, config)
    if unit_changed or loaded_changed:
        run(["/bin/systemctl", "daemon-reload"])
    state = run(["/bin/systemctl", "is-active", UNIT.name], allowed=(0, 3, 4)).strip()
    enabled = run(["/bin/systemctl", "is-enabled", UNIT.name], allowed=(0, 1, 3, 4)).strip()
    if unit_changed or loaded_changed or changed or state != "active":
        run(["/bin/systemctl", "restart", UNIT.name])
        changed = True
    if enabled != "enabled":
        run(["/bin/systemctl", "enable", UNIT.name])
        changed = True
    require(loaded_unit_matches(unit_runtime(), config), "tunnel_loaded_unit_policy_drift")
    spec = proxy_spec(config, source)
    existing = inspect_proxy()
    if existing is not None and not proxy_matches(existing, config, source, image_id):
        run(["/usr/bin/docker", "container", "rm", "--force", CONTAINER])
        existing = None
        changed = True
    if existing is None:
        run(proxy_args(config, spec))
        changed = True
    elif not existing.get("State", {}).get("Running"):
        run(["/usr/bin/docker", "container", "start", CONTAINER])
        changed = True
    # No automatic request replay or application refresh; readiness may still await SSH.
    ready = False
    for _ in range(12):
        try:
            health()
            ready = True
            break
        except (OSError, ValueError, LinkError):
            time.sleep(1)
    require(ready, "ssh_or_proxy_not_ready_no_application_request_replayed")
    verified = client_verify(config, source)
    verified.update(changed=changed or unit_changed, gateway=gateway, service_uid=user.pw_uid)
    return verified


def execute(config, source):
    validate(config)
    side, action = config["side"], config["action"]
    if action == "plan":
        return {"changed": False, "side": side, "action": action, "writes_enabled": False}
    import socket
    require(socket.gethostname() == config["expected_hostname"]
            and Path("/etc/machine-id").read_text().strip() == config["expected_machine_id"],
            "actual_host_identity_mismatch")
    require(hasattr(os, "geteuid") and os.geteuid() == 0, "root_required_for_selected_operation")
    if action == "prepare_key":
        result = prepare_key()
    elif side == "server":
        result = server_apply(config) if action == "apply" else server_verify(config)
    else:
        require(source.startswith(b'"""Bounded transparent TCP relay.'), "unexpected_proxy_source")
        result = client_apply(config, source) if action == "apply" else client_verify(config, source)
    result.update(side=side, action=action, revision=config.get("revision"),
                  helper_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--proxy", required=True)
    args = parser.parse_args()
    try:
        config = json.loads(base64.b64decode(args.config, validate=True).decode())
        source = base64.b64decode(args.proxy, validate=True)
        print(json.dumps(execute(config, source), sort_keys=True))
    except Exception as error:
        reason = str(error) if isinstance(error, LinkError) else type(error).__name__
        print(json.dumps({"changed": False, "failed": True, "reason": reason}))
        sys.exit(1)
