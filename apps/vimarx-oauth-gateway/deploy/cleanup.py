"""Clean each configured profile without sharing its environment or data volume."""
from pathlib import Path
import os
import subprocess

ROOT = Path("/opt/vimarx-oauth-gateway")
PROFILES = (("vimarx-oauth-gateway", ".env"), ("vimarx-oauth-directory", ".env.directory"))


def cleanup():
    failures = []
    environment = os.environ.copy()
    for key in ("APP_IMAGE", "GATEWAY_ENV_FILE", "GATEWAY_PORT", "GATEWAY_PROFILE"):
        environment.pop(key, None)
    for project, filename in PROFILES:
        env = ROOT / filename
        if not env.is_file():
            continue
        result = subprocess.run([
            "docker", "compose", "-p", project, "--env-file", str(env),
            "-f", str(ROOT / "deploy/docker-compose.yml"), "exec", "-T", "gateway",
            "flask", "--app", "gateway.app:create_app", "cleanup",
        ], cwd=str(ROOT), env=environment)
        if result.returncode:
            failures.append(project)
    if failures:
        raise RuntimeError("Cleanup failed for: " + ", ".join(failures))


if __name__ == "__main__":
    cleanup()
