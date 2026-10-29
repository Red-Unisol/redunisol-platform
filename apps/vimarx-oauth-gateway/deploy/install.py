"""Deploy a reviewed Git revision using an existing authenticated SSH connection.

Run on the VPS after uploading this app directory to /opt/vimarx-oauth-gateway.
Only the dedicated gateway and the explicit Apache include are modified.
"""
import argparse
import base64
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import time

ROOT = Path("/opt/vimarx-oauth-gateway")
FRONTEND = Path("/opt/apache/conf.d/10-kestra-redunisol.conf")
INCLUDE = '    IncludeOptional /opt/vimarx-oauth-gateway/deploy/apache-route.conf\n'
ANCHOR = '    ProxyPass "/" "http://127.0.0.1:8080/"'


def run(*args):
    subprocess.run(args, check=True, cwd=ROOT)


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
    if not env_file.exists():
        env_file.write_text(
            "APP_IMAGE=" + image + "\n"
            "GATEWAY_ISSUER=https://kestra.redunisol.com.ar/vimarx-oauth\n"
            "VIMARX_ORIGIN=https://celesol.dyndns.org:35010\n"
            "GATEWAY_SECRET_KEY=" + secrets.token_urlsafe(48) + "\n"
            "TOKEN_ENCRYPTION_KEY=" + base64.urlsafe_b64encode(secrets.token_bytes(32)).decode() + "\n"
            "DATABASE_URL=sqlite:////data/gateway.db\n", encoding="utf-8")
    else:
        text = env_file.read_text(encoding="utf-8")
        if not re.search(r"^APP_IMAGE=", text, re.M):
            raise SystemExit("Existing environment has no APP_IMAGE")
        updated = re.sub(r"^APP_IMAGE=.*$", "APP_IMAGE=" + image, text, flags=re.M)
        env_file.with_suffix(".env.previous").write_text(text, encoding="utf-8")
        env_file.write_text(updated, encoding="utf-8")
    env_file.chmod(0o600)
    run("docker", "build", "--build-arg", "GIT_SHA=" + args.revision, "-t", image, ".")
    compose = ("docker", "compose", "-p", "vimarx-oauth-gateway", "--env-file", str(env_file),
               "-f", "deploy/docker-compose.yml")
    run(*compose, "config", "-q")
    run(*compose, "up", "-d", "--no-build", "--pull", "never")
    for _ in range(30):
        result = subprocess.run(
            ["curl", "-fsS", "-H", "Host: kestra.redunisol.com.ar",
             "http://127.0.0.1:3060/vimarx-oauth/health"], capture_output=True)
        if result.returncode == 0:
            break
        time.sleep(2)
    else:
        raise SystemExit("Gateway failed its internal healthcheck; Apache was not changed")
    text = FRONTEND.read_text()
    updated = text
    if INCLUDE.strip() not in updated:
        if updated.count(ANCHOR) != 1:
            raise SystemExit("Apache anchor is not unique; inspect the vhost before publishing")
        updated = updated.replace(ANCHOR, INCLUDE + ANCHOR, 1)
    # dontlog is only set for the dedicated gateway/discovery routes. Keep all
    # existing application logging while excluding OAuth browser transactions.
    updated = re.sub(r'(?m)^(\s*CustomLog\s+[^\n]+?\s+combined)\s*$',
                     r'\1 env=!dontlog', updated)
    changed = updated != text
    if changed:
        backup = ROOT / "frontend.previous.conf"
        shutil.copy2(FRONTEND, backup)
        FRONTEND.write_text(updated)
    syntax = subprocess.run(["/opt/apache/bin/apachectl", "-t"], capture_output=True, text=True)
    if syntax.returncode:
        if changed:
            FRONTEND.write_text(text)
        raise SystemExit("Apache validation failed; original vhost restored: " + syntax.stderr)
    run("/opt/apache/bin/apachectl", "graceful")
    # Clear expired encrypted sessions on every deployment as well as on requests.
    run(*compose, "exec", "-T", "gateway", "flask", "--app", "gateway.app:create_app", "cleanup")
    run(*compose, "ps")
    print("Deployed revision", args.revision)


if __name__ == "__main__":
    main()
