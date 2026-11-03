"""Update only an existing internal gateway from a verified Git export.

The caller must install the exact reviewed Git source under ROOT first. This
command never bootstraps profiles or changes Apache, timers, directory or media.
Python 3.6+; operational execution is restricted to the canonical VPS location.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import stat
import subprocess

import install


def mode(path):
    return stat.S_IMODE(path.stat().st_mode)


def require_location():
    root = install.ROOT
    if (str(root) != "/opt/vimarx-oauth-gateway" or root.is_symlink()
            or root.resolve() != root or Path(__file__).resolve().parent.parent != root):
        raise RuntimeError("Update only under /opt/vimarx-oauth-gateway")


def inspect(profile):
    result = subprocess.run(
        ["docker", "inspect", profile["project"] + "-gateway-1"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=str(install.ROOT))
    if result.returncode:
        raise RuntimeError("Both existing gateway profiles must be running")
    value = json.loads(result.stdout)[0]
    if not value["State"]["Running"]:
        raise RuntimeError("Both existing gateway profiles must be running")
    return value


def environment(info):
    return dict(value.split("=", 1) for value in info["Config"]["Env"] if "=" in value)


def existing(profile):
    path = install.ROOT / profile["env"]
    if path.is_symlink() or not path.is_file() or mode(path) != 0o600:
        raise RuntimeError("Existing private environment files with mode 0600 are required")
    raw = path.read_bytes()
    text = raw.decode("utf-8")
    settings = install.values(text)
    image = settings.get("APP_IMAGE")
    if (not image or settings.get("GATEWAY_ISSUER") != profile["issuer"]
            or settings.get("GATEWAY_PROFILE", "internal") != profile["name"]):
        raise RuntimeError("Existing profile environment is incomplete or mismatched")
    info = inspect(profile)
    actual = environment(info)
    if (not re.fullmatch(r"[a-f0-9]{40}", actual.get("GIT_SHA", ""))
            or any(actual.get(key) != value for key, value in settings.items())
            or info["HostConfig"].get("ReadonlyRootfs") is not True):
        raise RuntimeError("Existing profile provenance or environment does not match runtime")
    install.verify_runtime(profile, text, image)
    return dict(profile=profile, path=path, raw=raw, text=text, image=image, info=info,
                revision=actual["GIT_SHA"])


def identity(info):
    # Exclude changing healthcheck timestamps; all these fields must stay exact.
    return {key: info[key] for key in ("Id", "Image", "Config", "Mounts", "HostConfig")}


def media_state():
    result = {}
    for name in ("public-demo", "public-demo/directorio"):
        folder = install.ROOT / name
        if folder.is_symlink():
            raise RuntimeError("Refusing a symlink media directory")
        if not folder.exists():
            result[name] = None
            continue
        if not folder.is_dir():
            raise RuntimeError("Invalid media publication directory")
        files = {}
        for path in folder.iterdir():
            if path.is_symlink():
                raise RuntimeError("Refusing a symlink media file")
            if path.is_file():
                files[path.name] = (mode(path), hashlib.sha256(path.read_bytes()).hexdigest())
        result[name] = files
    return result


def unchanged_directory(directory, media):
    if (directory["path"].is_symlink() or mode(directory["path"]) != 0o600
            or directory["path"].read_bytes() != directory["raw"]
            or identity(inspect(directory["profile"])) != identity(directory["info"])
            or media_state() != media):
        raise RuntimeError("Protected directory runtime, environment or media changed")


def internal_preserved(before, desired, revision):
    info = inspect(before["profile"])
    actual = environment(info)
    original = install.values(before["text"])
    if (mode(before["path"]) != 0o600 or before["path"].read_bytes() != desired.encode("utf-8")
            or actual.get("GIT_SHA") != revision
            or any(actual.get(key) != value for key, value in original.items() if key != "APP_IMAGE")
            or info["Mounts"] != before["info"]["Mounts"]
            or info["HostConfig"].get("ReadonlyRootfs") is not True
            or info["HostConfig"]["PortBindings"] != before["info"]["HostConfig"]["PortBindings"]):
        raise RuntimeError("Internal environment, keys, volume or provenance were not preserved")


def update(revision):
    if not isinstance(revision, str) or not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("A full reviewed Git commit SHA is required")
    require_location()
    internal, directory = [existing(profile) for profile in install.PROFILES]
    media = media_state()
    image = "redunisol/vimarx-oauth-gateway:" + revision
    # Reuse the installer validation while retaining every byte outside APP_IMAGE.
    checked = install.desired_environment(internal["profile"], internal["text"], image)
    if install.values(checked).get("GATEWAY_ISSUER") != install.values(internal["text"])["GATEWAY_ISSUER"]:
        raise RuntimeError("The internal issuer must not change")
    desired, replacements = re.subn(r"(?m)^APP_IMAGE=[^\r\n]*", "APP_IMAGE=" + image, internal["text"])
    if replacements != 1:
        raise RuntimeError("Exactly one APP_IMAGE setting is required")
    install.run("docker", "build", "--build-arg", "GIT_SHA=" + revision, "-t", image, ".")
    from backup import snapshot
    backup = snapshot(revision, profile="internal")
    if backup.is_symlink() or not backup.is_file() or mode(backup) != 0o600:
        raise RuntimeError("The internal database backup must be private")
    unchanged_directory(directory, media)
    attempted = False
    started = False
    try:
        attempted = True
        install.write_private(internal["path"], desired)
        install.run(*install.compose(internal["profile"]), "config", "-q")
        started = True
        install.run(*install.compose(internal["profile"]), "up", "-d", "--no-build", "--pull", "never", "--no-deps", "gateway")
        install.wait_ready(internal["profile"], revision)
        install.verify_runtime(internal["profile"], desired, image)
        internal_preserved(internal, desired, revision)
        unchanged_directory(directory, media)
    except Exception:
        try:
            if attempted:
                install.write_private(internal["path"], internal["text"])
            if started:
                install.run(*install.compose(internal["profile"]), "up", "-d", "--no-build", "--pull", "never", "--no-deps", "gateway")
                install.wait_ready(internal["profile"], internal["revision"])
            install.verify_runtime(internal["profile"], internal["text"], internal["image"])
            internal_preserved(internal, internal["text"], internal["revision"])
            unchanged_directory(directory, media)
        except Exception:
            raise RuntimeError("Internal update failed and rollback verification failed; operator review required") from None
        raise
    return dict(internal_updated=True, revision=revision, directory_unchanged=True,
                internal_keys_and_volume_preserved=True, media_unchanged=True,
                apache_changed=False, systemd_changed=False, directory_restarted=False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()
    print(json.dumps(update(args.revision)))


if __name__ == "__main__":
    main()
