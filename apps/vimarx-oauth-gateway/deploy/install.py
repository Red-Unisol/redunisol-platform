"""Deploy one revision as isolated internal and directory gateway instances.

Internal runtime names stay unchanged. Each Compose project owns its environment
and data volume. Existing keys and sessions are preserved; directory keys are
independent. DNS is never changed. Python 3.6+.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import time

ROOT = Path("/opt/vimarx-oauth-gateway")
FRONTEND = Path("/opt/apache/conf.d/10-kestra-redunisol.conf")
VHOST = Path("/opt/apache/conf.d/25-mcp-redunisol.conf")
SYSTEMD = Path("/etc/systemd/system")
ISSUER = "https://mcp.redunisol.com.ar"
LEGACY_INCLUDE = "    IncludeOptional /opt/vimarx-oauth-gateway/deploy/apache-route.conf\n"
PROFILES = (
    dict(name="internal", project="vimarx-oauth-gateway", env=".env", port=3060, issuer=ISSUER),
    dict(name="directory", project="vimarx-oauth-directory", env=".env.directory", port=3061,
         issuer=ISSUER + "/directorio"),
)
UNITS = ("vimarx-oauth-cleanup.service", "vimarx-oauth-cleanup.timer",
         "vimarx-mcp-cert-renew.service", "vimarx-mcp-cert-renew.timer")
KEYS = ("GATEWAY_SECRET_KEY", "TOKEN_ENCRYPTION_KEY", "DEMO_TOKEN_KEY")
COMPOSE_VARIABLES = ("APP_IMAGE", "GATEWAY_ENV_FILE", "GATEWAY_PORT", "GATEWAY_PROFILE")


def run(*args):
    environment = os.environ.copy()
    if args[:2] == ("docker", "compose"):
        # The reviewed profile file, rather than inherited shell variables,
        # selects its image, environment and loopback port.
        for key in COMPOSE_VARIABLES:
            environment.pop(key, None)
    subprocess.run(args, check=True, cwd=str(ROOT), env=environment)


def apache_reload():
    run("/opt/apache/bin/apachectl", "-t")
    run("/opt/apache/bin/apachectl", "graceful")


def values(text):
    result = {}
    for line in text.splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            result[key.strip()] = value
    return result


def fernet_key():
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()


def write_private(path, content):
    path.write_text(content, encoding="utf-8")
    path.chmod(0o600)


def compose(profile):
    return ("docker", "compose", "-p", profile["project"], "--env-file",
            str(ROOT / profile["env"]), "-f", "deploy/docker-compose.yml")


def is_running(profile):
    result = subprocess.run(
        ["docker", "inspect", "--format", "{{.State.Running}}", profile["project"] + "-gateway-1"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=str(ROOT))
    return result.returncode == 0 and result.stdout.strip() == b"true"


def desired_environment(profile, previous, image, internal_values=None):
    if previous is not None:
        current = values(previous)
        if not all(current.get(key) for key in ("APP_IMAGE", "GATEWAY_SECRET_KEY", "TOKEN_ENCRYPTION_KEY")):
            raise ValueError("Existing environment is incomplete; preserve and repair it first")
        if current.get("GATEWAY_PROFILE", "internal") != profile["name"]:
            raise ValueError("Existing environment belongs to a different profile")
        if profile["name"] == "directory" and any(current.get(key) != value for key, value in (
                ("GATEWAY_ISSUER", profile["issuer"]), ("GATEWAY_PORT", "3061"),
                ("GATEWAY_ENV_FILE", "../.env.directory"))):
            raise ValueError("Directory environment must keep its dedicated issuer, port and file")
        result = re.sub(r"^APP_IMAGE=.*$", "APP_IMAGE=" + image, previous, flags=re.M)
        return re.sub(r"^GATEWAY_ISSUER=.*$", "GATEWAY_ISSUER=" + profile["issuer"], result, flags=re.M)
    entries = [
        ("APP_IMAGE", image), ("GATEWAY_PROFILE", profile["name"]),
        ("GATEWAY_ISSUER", profile["issuer"]),
        ("VIMARX_ORIGIN", "https://celesol.dyndns.org:35010"),
        ("GATEWAY_SECRET_KEY", secrets.token_urlsafe(48)),
        ("TOKEN_ENCRYPTION_KEY", fernet_key()), ("DATABASE_URL", "sqlite:////data/gateway.db"),
    ]
    if profile["name"] == "directory":
        entries.extend((("GATEWAY_ENV_FILE", "../.env.directory"), ("GATEWAY_PORT", "3061")))
        demo = internal_values or {}
        demo_hash = demo.get("DEMO_PASSWORD_HASH", "")
        if "'" in demo_hash or "\n" in demo_hash:
            raise ValueError("Unsupported synthetic demo password hash format")
        # Reuse only the approved synthetic login hash, never encryption keys.
        entries.extend((("DEMO_ENABLED", "1" if demo.get("DEMO_ENABLED") == "1" else "0"),
                        ("DEMO_PASSWORD_HASH", "'" + demo_hash + "'"),
                        ("DEMO_TOKEN_KEY", fernet_key())))
    return "".join(key + "=" + value + "\n" for key, value in entries)


def assert_isolated_environments(states):
    internal, directory = (values(state["desired"]) for state in states)
    all_keys = [environment[key] for environment in (internal, directory)
                for key in KEYS if environment.get(key)]
    if len(set(all_keys)) != len(all_keys):
        raise ValueError("Every gateway profile must use independent encryption and signing keys")
    if internal.get("GATEWAY_ENV_FILE", "../.env") != "../.env" or internal.get("GATEWAY_PORT", "3060") != "3060":
        raise ValueError("Internal runtime must keep its existing environment and loopback port")


def wait_ready(profile, revision):
    for _ in range(30):
        check = subprocess.run(
            ["curl", "-fsS", "-H", "Host: mcp.redunisol.com.ar",
             "http://127.0.0.1:" + str(profile["port"]) + profile["issuer"][len(ISSUER):] + "/health"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if check.returncode == 0:
            try:
                health = json.loads(check.stdout)
                if health.get("status") == "ok" and health.get("revision") == revision:
                    return
            except (ValueError, TypeError):
                pass
        time.sleep(2)
    raise RuntimeError("Gateway failed its revision/readiness check: " + profile["name"])


def verify_runtime(profile, desired, image):
    check = subprocess.run(
        ["docker", "inspect", profile["project"] + "-gateway-1"],
        check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    info = json.loads(check.stdout)[0]
    expected = values(desired)
    environment = dict(item.split("=", 1) for item in info["Config"]["Env"] if "=" in item)
    valid = (info["State"]["Running"] and info["Config"]["Image"] == image
             and environment.get("GATEWAY_PROFILE", "internal") == profile["name"]
             and environment.get("GATEWAY_ISSUER") == profile["issuer"]
             and (profile["name"] != "directory" or environment.get("VIMARX_ORIGIN") == "https://celesol.dyndns.org:35010")
             and environment.get("DATABASE_URL", "sqlite:////data/gateway.db") == "sqlite:////data/gateway.db"
             and all(environment.get(key, "") == expected.get(key, "")
                     for key in KEYS + ("DEMO_ENABLED", "DEMO_PASSWORD_HASH")))
    bindings = info["HostConfig"]["PortBindings"].get("8000/tcp")
    valid = valid and bindings == [{"HostIp": "127.0.0.1", "HostPort": str(profile["port"])}]
    mounts = [mount for mount in info["Mounts"] if mount["Destination"] == "/data"]
    valid = valid and len(mounts) == 1 and mounts[0]["Type"] == "volume"
    valid = valid and mounts[0].get("Name") == profile["project"] + "_gateway_data"
    if not valid:
        raise RuntimeError("Gateway runtime isolation check failed: " + profile["name"])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{40}", args.revision):
        raise SystemExit("A full Git commit SHA is required")
    if Path(__file__).resolve().parent.parent != ROOT:
        raise SystemExit("Install only under /opt/vimarx-oauth-gateway")
    os.umask(0o077)
    image = "redunisol/vimarx-oauth-gateway:" + args.revision
    states = []
    for profile in PROFILES:
        env = ROOT / profile["env"]
        if env.is_symlink():
            raise SystemExit("Refusing a symlink environment file")
        previous = env.read_text(encoding="utf-8") if env.exists() else None
        desired = desired_environment(profile, previous, image,
                                      values(states[0]["desired"]) if states else None)
        states.append(dict(profile=profile, path=env, previous=previous,
                           desired=desired, running=is_running(profile), started=False))
    assert_isolated_environments(states)
    old_vhost = VHOST.read_text() if VHOST.exists() else None
    if old_vhost is not None and "ServerName mcp.redunisol.com.ar" not in old_vhost:
        raise SystemExit("Refusing to overwrite an unrelated virtual host")
    old_frontend = FRONTEND.read_text()
    old_units = {name: (SYSTEMD / name).read_bytes() if (SYSTEMD / name).exists() else None for name in UNITS}
    for state in states:
        if state["running"]:
            from backup import snapshot
            snapshot(args.revision, profile=state["profile"]["name"])
    # Build and snapshot before changing either live profile or its publication.
    run("docker", "build", "--build-arg", "GIT_SHA=" + args.revision, "-t", image, ".")
    # Refuse an incomplete public contract before changing either environment.
    run("docker", "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges:true", "--entrypoint", "python", image,
        "-c", "from gateway import directory; assert directory.production_ready(), 'Directory contract is not ready'")
    frontend_changed = False
    units_changed = False
    cert = Path("/etc/letsencrypt/live/mcp.redunisol.com.ar/fullchain.pem")
    try:
        if not cert.exists():
            VHOST.write_text((ROOT / "deploy/apache-http.conf").read_text())
            apache_reload()
            run("certbot", "certonly", "--non-interactive", "--keep-until-expiring",
                "--webroot", "-w", "/opt/apache/htdocs", "-d", "mcp.redunisol.com.ar",
                "--deploy-hook", "/opt/apache/bin/apachectl graceful")
        for state in states:
            if state["previous"] is not None:
                write_private(state["path"].with_name(state["path"].name + ".previous"), state["previous"])
            write_private(state["path"], state["desired"])
        for state in states:
            run(*compose(state["profile"]), "config", "-q")
        for state in states:
            state["started"] = True
            run(*compose(state["profile"]), "up", "-d", "--no-build", "--pull", "never")
            wait_ready(state["profile"], args.revision)
            verify_runtime(state["profile"], state["desired"], image)
        VHOST.write_text((ROOT / "deploy/apache-mcp.conf").read_text())
        FRONTEND.write_text(old_frontend.replace(LEGACY_INCLUDE, ""))
        frontend_changed = True
        apache_reload()
        for state in states:
            run(*compose(state["profile"]), "exec", "-T", "gateway", "flask", "--app", "gateway.app:create_app", "cleanup")
        units_changed = True
        for name in UNITS:
            shutil.copy2(ROOT / "deploy" / name, SYSTEMD / name)
        run("systemctl", "daemon-reload")
        run("systemctl", "enable", "--now", "vimarx-oauth-cleanup.timer", "vimarx-mcp-cert-renew.timer")
        for state in states:
            run(*compose(state["profile"]), "ps")
        print("Deployed revision", args.revision, "at", ISSUER, "for internal and directory profiles")
    except Exception:
        if frontend_changed:
            FRONTEND.write_text(old_frontend)
        if old_vhost is None:
            if VHOST.exists():
                VHOST.unlink()
        else:
            VHOST.write_text(old_vhost)
        for state in reversed(states):
            if state["previous"] is not None:
                write_private(state["path"], state["previous"])
            # Retain bootstrap keys if a new volume was created; never orphan its
            # encrypted records or delete the volume as part of rollback.
            if state["started"]:
                if state["running"]:
                    run(*compose(state["profile"]), "up", "-d", "--no-build", "--pull", "never")
                else:
                    run(*compose(state["profile"]), "down")
        if units_changed:
            for name, previous in old_units.items():
                destination = SYSTEMD / name
                if previous is None:
                    if destination.exists():
                        destination.unlink()
                else:
                    destination.write_bytes(previous)
            run("systemctl", "daemon-reload")
        apache_reload()
        raise


if __name__ == "__main__":
    main()
