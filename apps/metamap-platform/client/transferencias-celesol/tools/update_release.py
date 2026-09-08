"""Code-only signed releases. Never reads or packages application environments."""
import argparse
import base64
import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def keygen(path: Path) -> str:
    key = Ed25519PrivateKey.generate()
    # Exclusive creation: an existing production key must never be replaced.
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as output:
        output.write(base64.b64encode(key.private_bytes(
            serialization.Encoding.Raw, serialization.PrivateFormat.Raw,
            serialization.NoEncryption())))
    return base64.b64encode(key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()


def release(exe: Path, version: str, output: Path, public_key: Path) -> None:
    import re
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("Only stable numeric versions are publishable")
    key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(
        os.environ["TRANSFERENCIAS_UPDATE_SIGNING_KEY"].strip(), validate=True))
    actual_public = key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    if actual_public != base64.b64decode(public_key.read_text().strip(), validate=True):
        raise ValueError("Signing key does not match the embedded public key")
    binary = exe.read_bytes()
    if not binary.startswith(b"MZ"):
        raise ValueError("Expected Windows executable")
    now = datetime.now(timezone.utc)
    manifest = {
        "schema": 1, "application": "transferencias-celesol",
        "version": version, "channel": "production",
        "target": "x86_64-pc-windows-msvc", "key_id": "production-2026",
        "filename": f"{version}/transferencias-celesol.exe",
        "sha256": hashlib.sha256(binary).hexdigest(), "size": len(binary),
        "published_at": now.isoformat(),
        "expires_at": (now + timedelta(days=90)).isoformat(),
    }
    raw = json.dumps(manifest, separators=(",", ":"), sort_keys=True).encode()
    envelope = {"manifest": base64.b64encode(raw).decode(),
                "signature": base64.b64encode(key.sign(raw)).decode()}
    target = output / version
    target.mkdir(parents=True, exist_ok=False)
    (target / "transferencias-celesol.exe").write_bytes(binary)
    (target / "manifest.json").write_bytes(raw)
    (target / "manifest.sig").write_text(envelope["signature"], encoding="ascii")
    (output / "latest.json").write_text(json.dumps(envelope), encoding="ascii")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    gen = commands.add_parser("keygen")
    gen.add_argument("--private-key", type=Path, required=True)
    pub = commands.add_parser("release")
    pub.add_argument("--exe", type=Path, required=True)
    pub.add_argument("--version", required=True)
    pub.add_argument("--output", type=Path, required=True)
    pub.add_argument("--public-key", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "keygen":
        print(keygen(args.private_key))  # Only the public key is displayed.
    else:
        release(args.exe, args.version, args.output, args.public_key)
