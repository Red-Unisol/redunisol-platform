"""Publish an already signed, code-only release to the VPS using pinned SSH trust."""
import argparse
import base64
import hashlib
import json
import os
import re
import shlex
import uuid
from pathlib import Path

import paramiko
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

ROOT = "/srv/redunisol-updates/transferencias"


def verified(envelope: bytes, public_key: bytes) -> dict:
    value = json.loads(envelope)
    raw = base64.b64decode(value["manifest"], validate=True)
    Ed25519PublicKey.from_public_bytes(public_key).verify(
        base64.b64decode(value["signature"], validate=True), raw)
    return json.loads(raw)


def publish(directory: Path, public_key_path: Path) -> None:
    public_key = base64.b64decode(public_key_path.read_text().strip(), validate=True)
    latest = (directory / "latest.json").read_bytes()
    manifest = verified(latest, public_key)
    version = manifest["version"]
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("Invalid version")
    binary = directory / version / "transferencias-celesol.exe"
    if (hashlib.sha256(binary.read_bytes()).hexdigest() != manifest["sha256"]
            or binary.stat().st_size != manifest["size"]):
        raise ValueError("Invalid binary")
    client = paramiko.SSHClient()
    client.load_host_keys(os.environ["UPDATE_KNOWN_HOSTS_FILE"])
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect(os.environ["SSH_HOST"], port=int(os.environ["SSH_PORT"]),
                   username=os.environ["SSH_USER"], allow_agent=True,
                   look_for_keys=False, timeout=15)
    stage = ROOT + "/.upload-" + uuid.uuid4().hex
    try:
        _, stdout, stderr = client.exec_command("mkdir -p " + shlex.quote(ROOT))
        if stdout.channel.recv_exit_status():
            raise RuntimeError(stderr.read().decode())
        with client.open_sftp() as sftp:
            try:
                with sftp.open(ROOT + "/latest.json", "rb") as stream:
                    previous_envelope = stream.read()
                    previous = verified(previous_envelope, public_key)
                if version == previous["version"]:
                    if any(previous.get(key) != manifest[key] for key in manifest.keys() - {"published_at", "expires_at"}):
                        raise ValueError("Cannot overwrite an existing release with different content")
                    (directory / "latest.json").write_bytes(previous_envelope)
                    print(f"Transferencias {version} already published with the same signed content")
                    return
                if tuple(map(int, version.split("."))) < tuple(map(int, previous["version"].split("."))):
                    raise ValueError("Releases must advance monotonically; never overwrite an existing version")
            except FileNotFoundError:
                pass
            existing = None
            try:
                with sftp.open(ROOT + "/" + version + "/manifest.json", "rb") as stream:
                    raw = stream.read()
                with sftp.open(ROOT + "/" + version + "/manifest.sig", "r") as stream:
                    signature = stream.read().decode().strip()
                original_envelope = json.dumps({"manifest": base64.b64encode(raw).decode(),
                                                "signature": signature}).encode()
                existing = verified(original_envelope, public_key)
                for key in manifest.keys() - {"published_at", "expires_at"}:
                    if existing.get(key) != manifest[key]:
                        raise ValueError("An immutable release with different content already exists")
                # Resume a publish interrupted after the version directory was promoted.
                latest = original_envelope
                (directory / "latest.json").write_bytes(latest)
            except FileNotFoundError:
                pass
            if existing is None:
                sftp.mkdir(stage)
                # Explicit allowlist: no archive, environment, key, or workspace upload.
                for name in ("transferencias-celesol.exe", "manifest.json", "manifest.sig"):
                    sftp.put(str(directory / version / name), stage + "/" + name)
            candidate = ROOT + "/" + version if existing else stage
            with sftp.open(candidate + "/transferencias-celesol.exe", "rb") as stream:
                remote_hash = hashlib.sha256()
                while block := stream.read(1024 * 1024):
                    remote_hash.update(block)
            if remote_hash.hexdigest() != manifest["sha256"]:
                raise ValueError("Uploaded binary hash mismatch")
            # SFTP rename fails if this immutable release directory already exists.
            if existing is None:
                sftp.rename(stage, ROOT + "/" + version)
            temporary_latest = ROOT + "/.latest-" + uuid.uuid4().hex
            with sftp.open(temporary_latest, "wb") as stream:
                stream.write(latest)
            sftp.posix_rename(temporary_latest, ROOT + "/latest.json")
    finally:
        client.close()
    print(f"Published signed Transferencias {version}; no application configuration uploaded")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--public-key", type=Path, required=True)
    args = parser.parse_args()
    publish(args.directory, args.public_key)
