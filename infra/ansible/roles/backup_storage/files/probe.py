#!/usr/bin/python3
"""Read-only guard for this host's single reviewed backup SATA.

No filesystem creation, mounting, device writes or probe cache is implemented
here. A separate approved Ansible task may initialize only the "blank" state.
"""
import argparse
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import uuid

HOSTNAME = "sd-6598683-l.dattaweb.com"
MACHINE_ID = "6143066aad8c4c6ab415872a6ba7e726"
BY_ID = "/dev/disk/by-id/ata-ST2000VN003-3CW102_ZWD0RX9Q"
SERIAL = "ZWD0RX9Q"
MODEL = "ST2000VN003-3CW102"
SIZE = 2000398934016
MOUNTPOINT = "/srv/redunisol-backups"
LABEL = "ru-backups"
UNIT = r"srv-redunisol\x2dbackups.mount"


class GuardError(ValueError):
    """Missing or conflicting evidence is never permission to initialize."""


def require(condition, message):
    if not condition:
        raise GuardError(message)


def canonical_uuid(value):
    try:
        result = str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise GuardError("Expected a fixed canonical filesystem UUID") from None
    require(result == value, "UUID must be canonical lowercase")
    return result


def classify(data, expected_uuid):
    """Accept only blank or the already prepared expected filesystem."""
    expected_uuid = canonical_uuid(expected_uuid)
    required = {
        "hostname", "machine_id", "by_id", "resolved", "is_block", "stat_maj_min",
        "target", "root_ancestors", "swap_ancestors", "holders", "slaves",
        "signatures", "blkid_rc", "blkid", "uuid_devices", "mounts",
        "mountpoint", "fstab_conflicts", "mount_unit",
    }
    require(not required.difference(data), "Incomplete read-only disk evidence")
    require(data["hostname"] == HOSTNAME and data["machine_id"] == MACHINE_ID,
            "Dedicated host identity mismatch")
    require(data["by_id"] == BY_ID and data["is_block"], "Unexpected persistent device identity")
    require(data["resolved"].startswith("/dev/"), "Device did not resolve inside /dev")
    target = data["target"]
    require(str(target.get("serial") or "").strip() == SERIAL, "SATA serial mismatch")
    require(str(target.get("model") or "").strip() == MODEL, "SATA model mismatch")
    require(target.get("size") == SIZE, "SATA size mismatch")
    require(target.get("type") == "disk" and not target.get("pkname"), "Expected a physical whole disk")
    require(target.get("ro") in (0, False), "Disk is not writable")
    require(not target.get("children"), "Partitions or child devices are not supported")
    require(target.get("maj:min") == data["stat_maj_min"], "Device metadata is inconsistent")
    name = os.path.basename(target.get("kname", ""))
    require(name and data["root_ancestors"], "Root device ancestry was not established")
    require(name not in data["root_ancestors"], "Backup disk belongs to the root device stack")
    require(name not in data["swap_ancestors"], "Backup disk is in use by swap")
    require(not data["holders"] and not data["slaves"], "Device has active holders or slaves")
    require(not data["fstab_conflicts"], "fstab already claims this mountpoint or UUID")
    require(all(path == data["resolved"] for path in data["uuid_devices"]),
            "Expected UUID is already used by a different device")
    point = data["mountpoint"]
    require(not point.get("has_symlink", True), "Mountpoint or an ancestor is a symlink")
    require(point.get("canonical") == MOUNTPOINT, "Mountpoint canonical path mismatch")
    require(not point.get("exists") or point.get("is_dir"), "Mountpoint is not a directory")
    require(data["mount_unit"] == UNIT, "Unexpected native mount unit name")

    own_mounts = [
        entry for entry in data["mounts"]
        if entry.get("maj:min") == data["stat_maj_min"] or entry.get("uuid") == expected_uuid
    ]
    at_point = [entry for entry in data["mounts"] if entry.get("target") == MOUNTPOINT]
    mounted = bool(own_mounts)
    require(len(own_mounts) <= 1, "Backup filesystem has multiple mountpoints")
    require(len(at_point) <= 1, "Mountpoint has multiple owners")
    if mounted:
        entry = own_mounts[0]
        require(entry.get("target") == MOUNTPOINT and entry.get("uuid") == expected_uuid
                and entry.get("fstype") == "xfs", "Filesystem is mounted elsewhere or has unexpected identity")
        require(at_point == own_mounts, "Mountpoint belongs to another filesystem")
        require({"nodev", "nosuid", "noexec"}.issubset(set(entry.get("options", "").split(","))),
                "An existing mount has unexpected security options; no automatic remount is allowed")
    else:
        require(not at_point, "Another filesystem occupies the backup mountpoint")
        require(point.get("empty") is True, "Mounting would hide existing directory contents")
    declared_mounts = [value for value in (target.get("mountpoints") or []) if value]
    require(not declared_mounts or declared_mounts == [MOUNTPOINT], "Unexpected block-device mountpoints")

    signatures = data["signatures"]
    if data["blkid_rc"] == 2:
        require(all(target.get(field) in (None, "") for field in ("fstype", "uuid", "label")),
                "lsblk filesystem metadata contradicts the blank-device probes")
        require(not data["blkid"] and not signatures and not mounted and not declared_mounts,
                "A blank disk must have no detected signatures or active mounts")
        require(not data["uuid_devices"], "UUID collision on an apparently blank disk")
        state = "blank"
    else:
        require(data["blkid_rc"] == 0, "Filesystem probe failed or was ambiguous")
        fs = data["blkid"]
        require(target.get("fstype") == "xfs" and target.get("uuid") == expected_uuid
                and target.get("label") == LABEL,
                "lsblk and direct filesystem metadata do not agree")
        require(fs.get("TYPE") == "xfs" and fs.get("UUID") == expected_uuid
                and fs.get("LABEL") == LABEL and not fs.get("PTTYPE"),
                "Existing filesystem does not match the reviewed XFS UUID and label")
        require(signatures and all(
            item.get("type") == "xfs" and item.get("uuid") == expected_uuid
            for item in signatures
        ), "Unexpected or missing filesystem signatures")
        state = "prepared"
    return {
        "state": state, "mounted": mounted, "should_format": state == "blank",
        "device": data["resolved"], "by_id": BY_ID, "serial": SERIAL,
        "size_bytes": SIZE, "uuid": expected_uuid, "mountpoint": MOUNTPOINT,
        "mount_unit": data["mount_unit"], "kname": name,
    }


def command(argv, allowed=(0,)):
    result = subprocess.run(
        argv, capture_output=True, text=True, timeout=30,
        env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C"}, check=False,
    )
    require(result.returncode in allowed, "Read-only probe failed: " + argv[0])
    return result.returncode, result.stdout


def flatten(entries):
    for entry in entries:
        yield entry
        yield from flatten(entry.get("children", []))


def ancestors(name, nodes):
    result = set()
    while name:
        require(name in nodes and name not in result, "Unknown or cyclic block-device ancestry")
        result.add(name)
        name = os.path.basename(nodes[name].get("pkname") or "")
    return result


def collect(expected_uuid):
    expected_uuid = canonical_uuid(expected_uuid)
    require(os.path.islink(BY_ID), "Expected persistent by-id symlink is absent")
    resolved = os.path.realpath(BY_ID)
    device_stat = os.stat(BY_ID)
    require(stat.S_ISBLK(device_stat.st_mode), "Persistent identity is not a block device")
    major_minor = f"{os.major(device_stat.st_rdev)}:{os.minor(device_stat.st_rdev)}"
    _, raw = command([
        "/usr/bin/lsblk", "--json", "--bytes", "--paths", "--output",
        "NAME,KNAME,PKNAME,MAJ:MIN,TYPE,RO,SIZE,MODEL,SERIAL,FSTYPE,UUID,LABEL,MOUNTPOINTS",
    ])
    entries = list(flatten(json.loads(raw)["blockdevices"]))
    nodes = {}
    for entry in entries:
        name = os.path.basename(entry["kname"])
        require(name not in nodes, "Ambiguous block device tree")
        nodes[name] = entry
    matching = [entry for entry in entries if entry.get("maj:min") == major_minor]
    require(len(matching) == 1, "Persistent identity has no unique block device")
    target = matching[0]
    kname = os.path.basename(target["kname"])
    _, raw = command([
        "/usr/bin/findmnt", "--json", "--output", "SOURCE,TARGET,MAJ:MIN,UUID,FSTYPE,OPTIONS",
    ])
    mounts = list(flatten(json.loads(raw)["filesystems"]))
    root = [item for item in mounts if item.get("target") == "/"]
    require(len(root) == 1, "Could not establish the root filesystem")
    root_nodes = [os.path.basename(item["kname"]) for item in entries
                  if item.get("maj:min") == root[0]["maj:min"]]
    require(len(root_nodes) == 1, "Root filesystem has no unique block-device ancestry")
    root_ancestors = ancestors(root_nodes[0], nodes)

    swap_ancestors = set()
    swap_lines = Path("/proc/swaps").read_text().splitlines()
    require(swap_lines and swap_lines[0].split()[0] == "Filename", "Invalid /proc/swaps evidence")
    for line in swap_lines[1:]:
        fields = line.split()
        require(len(fields) == 5, "Invalid active swap entry")
        swap_stat = os.stat(fields[0])
        dev = swap_stat.st_rdev if stat.S_ISBLK(swap_stat.st_mode) else swap_stat.st_dev
        swap_id = f"{os.major(dev)}:{os.minor(dev)}"
        names = [os.path.basename(item["kname"]) for item in entries if item.get("maj:min") == swap_id]
        require(len(names) == 1, "Active swap has unknown block-device ancestry")
        swap_ancestors.update(ancestors(names[0], nodes))

    _, raw = command([
        "/usr/sbin/wipefs", "--no-act", "--json", "--output", "TYPE,UUID,LABEL,OFFSET", BY_ID,
    ])
    signatures = json.loads(raw)["signatures"]
    blkid_rc, raw = command([
        "/usr/sbin/blkid", "-p", "-c", "/dev/null", "-o", "export", BY_ID,
    ], allowed=(0, 2))
    blkid = dict(line.split("=", 1) for line in raw.splitlines() if "=" in line)
    _, owners = command([
        "/usr/sbin/blkid", "-c", "/dev/null", "-t", "UUID=" + expected_uuid, "-o", "device",
    ], allowed=(0, 2))
    uuid_devices = []
    for owner in owners.splitlines():
        require(stat.S_ISBLK(os.stat(owner).st_mode), "UUID owner is not a block device")
        uuid_devices.append(os.path.realpath(owner))

    point = Path(MOUNTPOINT)
    has_symlink = any(parent.is_symlink() for parent in [point, *point.parents])
    exists, is_dir = point.exists(), point.is_dir()
    mounted_here = any(item.get("target") == MOUNTPOINT for item in mounts)
    empty = True
    if exists and is_dir and not mounted_here:
        with os.scandir(point) as listing:
            empty = next(listing, None) is None
    conflicts = []
    for line in Path("/etc/fstab").read_text().splitlines():
        words = line.split()
        if not words or words[0].startswith("#"):
            continue
        require(len(words) >= 2, "Malformed fstab entry")
        if words[1] == MOUNTPOINT or words[0] in {BY_ID, resolved, "UUID=" + expected_uuid}:
            conflicts.append(line)
    _, mount_unit = command(["/usr/bin/systemd-escape", "--path", "--suffix=mount", MOUNTPOINT])
    return {
        "hostname": os.uname().nodename,
        "machine_id": Path("/etc/machine-id").read_text().strip(),
        "by_id": BY_ID, "resolved": resolved, "is_block": True,
        "stat_maj_min": major_minor, "target": target,
        "root_ancestors": sorted(root_ancestors), "swap_ancestors": sorted(swap_ancestors),
        "holders": os.listdir("/sys/class/block/" + kname + "/holders"),
        "slaves": os.listdir("/sys/class/block/" + kname + "/slaves"),
        "signatures": signatures, "blkid_rc": blkid_rc, "blkid": blkid,
        "uuid_devices": uuid_devices, "mounts": mounts,
        "mountpoint": {
            "canonical": os.path.realpath(MOUNTPOINT), "has_symlink": has_symlink,
            "exists": exists, "is_dir": is_dir, "empty": empty,
        },
        "fstab_conflicts": conflicts, "mount_unit": mount_unit.strip(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uuid", required=True)
    args = parser.parse_args()
    try:
        result = classify(collect(args.uuid), args.uuid)
    except (GuardError, OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({"state": "other", "error": str(exc)}))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
