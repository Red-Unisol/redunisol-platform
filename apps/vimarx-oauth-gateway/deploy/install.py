"""Deploy a committed gateway revision and its dedicated HTTPS virtual host.

Requires the authorized mcp.redunisol.com.ar DNS record to resolve to this VPS.
Existing encryption keys and the SQLite volume are preserved. Python 3.6+.
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
ISSUER = "https://mcp.redunisol.com.ar"
LEGACY_INCLUDE = "    IncludeOptional /opt/vimarx-oauth-gateway/deploy/apache-route.conf\n"


def run(*args):
    subprocess.run(args, check=True, cwd=ROOT)


def apache_reload():
    run("/opt/apache/bin/apachectl", "-t")
    run("/opt/apache/bin/apachectl", "graceful")


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
    env_file = ROOT / ".env"
    old_env = env_file.read_text(encoding="utf-8") if env_file.exists() else None
    if old_env:
        if not all(re.search(r"^" + key + "=.+$", old_env, re.M) for key in
                   ("APP_IMAGE", "GATEWAY_SECRET_KEY", "TOKEN_ENCRYPTION_KEY")):
            raise SystemExit("Existing environment is incomplete; preserve and repair it first")
        new_env = re.sub(r"^APP_IMAGE=.*$", "APP_IMAGE=" + image, old_env, flags=re.M)
        new_env = re.sub(r"^GATEWAY_ISSUER=.*$", "GATEWAY_ISSUER=" + ISSUER, new_env, flags=re.M)
        env_file.with_suffix(".env.previous").write_text(old_env, encoding="utf-8")
    else:
        new_env = ("APP_IMAGE=" + image + "\nGATEWAY_ISSUER=" + ISSUER +
                   "\nVIMARX_ORIGIN=https://celesol.dyndns.org:35010\nGATEWAY_SECRET_KEY=" +
                   secrets.token_urlsafe(48) + "\nTOKEN_ENCRYPTION_KEY=" +
                   base64.urlsafe_b64encode(secrets.token_bytes(32)).decode() +
                   "\nDATABASE_URL=sqlite:////data/gateway.db\n")
    if old_env:
        from backup import snapshot
        snapshot(args.revision)
    # Finish the build before changing the running service or HTTPS publication.
    run("docker", "build", "--build-arg", "GIT_SHA=" + args.revision, "-t", image, ".")
    old_vhost = VHOST.read_text() if VHOST.exists() else None
    if old_vhost is not None and "ServerName mcp.redunisol.com.ar" not in old_vhost:
        raise SystemExit("Refusing to overwrite an unrelated virtual host")
    old_frontend = FRONTEND.read_text()
    frontend_changed = False
    cert = Path("/etc/letsencrypt/live/mcp.redunisol.com.ar/fullchain.pem")
    try:
        if not cert.exists():
            VHOST.write_text((ROOT / "deploy/apache-http.conf").read_text())
            apache_reload()
            run("certbot", "certonly", "--non-interactive", "--keep-until-expiring",
                "--webroot", "-w", "/opt/apache/htdocs", "-d", "mcp.redunisol.com.ar",
                "--deploy-hook", "/opt/apache/bin/apachectl graceful")
        env_file.write_text(new_env, encoding="utf-8")
        env_file.chmod(0o600)
        compose = ("docker", "compose", "-p", "vimarx-oauth-gateway", "--env-file", str(env_file),
                   "-f", "deploy/docker-compose.yml")
        run(*compose, "config", "-q")
        run(*compose, "up", "-d", "--no-build", "--pull", "never")
        for _ in range(30):
            check = subprocess.run(
                ["curl", "-fsS", "-H", "Host: mcp.redunisol.com.ar",
                 "http://127.0.0.1:3060/health"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if check.returncode == 0 and json.loads(check.stdout).get("revision") == args.revision:
                break
            time.sleep(2)
        else:
            raise RuntimeError("Gateway failed its revision/readiness check")
        VHOST.write_text((ROOT / "deploy/apache-mcp.conf").read_text())
        # Remove only our own legacy routing from the Kestra virtual host.
        old_frontend = FRONTEND.read_text()
        FRONTEND.write_text(old_frontend.replace(LEGACY_INCLUDE, ""))
        frontend_changed = True
        apache_reload()
        run(*compose, "exec", "-T", "gateway", "flask", "--app", "gateway.app:create_app", "cleanup")
        for name in ("vimarx-oauth-cleanup.service", "vimarx-oauth-cleanup.timer",
                     "vimarx-mcp-cert-renew.service", "vimarx-mcp-cert-renew.timer"):
            shutil.copy2(ROOT / "deploy" / name, Path("/etc/systemd/system") / name)
        run("systemctl", "daemon-reload")
        run("systemctl", "enable", "--now", "vimarx-oauth-cleanup.timer", "vimarx-mcp-cert-renew.timer")
        run("systemctl", "start", "vimarx-oauth-cleanup.service")
        run(*compose, "ps")
        print("Deployed revision", args.revision, "at", ISSUER)
    except Exception:
        if frontend_changed:
            FRONTEND.write_text(old_frontend)
        if old_vhost is None:
            if VHOST.exists():
                VHOST.unlink()
        else:
            VHOST.write_text(old_vhost)
        if old_env:
            env_file.write_text(old_env, encoding="utf-8")
            run("docker", "compose", "-p", "vimarx-oauth-gateway", "--env-file", str(env_file),
                "-f", "deploy/docker-compose.yml", "up", "-d", "--no-build", "--pull", "never")
        apache_reload()
        raise


if __name__ == "__main__":
    main()
