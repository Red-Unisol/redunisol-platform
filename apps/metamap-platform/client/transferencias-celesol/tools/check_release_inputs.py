"""Fail CI if an application environment or local installation data enters Git."""
import subprocess

files = subprocess.check_output(["git", "ls-files", "-z", "."], text=True).split("\0")
for name in filter(None, files):
    leaf = name.rsplit("/", 1)[-1].lower()
    if ("package-input/" in name or "/dist/" in "/" + name
            or leaf.endswith((".env", ".env.enc", ".key", ".pem", ".jsonl"))
            or leaf in {"lineas.toml", "acreedores-confiables.toml", "coinag_tunnel_key"}):
        raise SystemExit(f"Local-only input must not be tracked: {name}")
print("No application environments, private keys, or installation data tracked")
