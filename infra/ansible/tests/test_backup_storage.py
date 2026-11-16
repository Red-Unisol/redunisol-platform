"""Exercise read-only one-disk decisions; never mount, format or contact SSH."""
import copy
import importlib.util
from pathlib import Path
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "roles/backup_storage/files/probe.py"
SPEC = importlib.util.spec_from_file_location("backup_storage_probe", MODULE_PATH)
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)
UUID = "df29bb35-b77f-4355-a93c-c53a32580267"


def blank():
    return {
        "hostname": PROBE.HOSTNAME,
        "machine_id": PROBE.MACHINE_ID,
        "by_id": PROBE.BY_ID,
        "resolved": "/dev/sdb",
        "is_block": True,
        "stat_maj_min": "8:16",
        "target": {
            "kname": "/dev/sdb", "pkname": None, "maj:min": "8:16",
            "serial": PROBE.SERIAL, "model": PROBE.MODEL, "size": PROBE.SIZE,
            "type": "disk", "ro": False, "mountpoints": [None],
            "fstype": None, "uuid": None, "label": None,
        },
        "root_ancestors": ["nvme0n1", "nvme0n1p3"],
        "swap_ancestors": ["nvme0n1", "nvme0n1p2"],
        "holders": [], "slaves": [], "signatures": [],
        "blkid_rc": 2, "blkid": {}, "uuid_devices": [],
        "mounts": [{
            "target": "/", "maj:min": "259:3", "uuid": "root-uuid",
            "fstype": "xfs", "options": "rw",
        }],
        "mountpoint": {
            "canonical": PROBE.MOUNTPOINT, "has_symlink": False,
            "exists": False, "is_dir": False, "empty": True,
        },
        "fstab_conflicts": [], "mount_unit": PROBE.UNIT,
    }


def prepared(mounted=False):
    data = blank()
    data["blkid_rc"] = 0
    data["blkid"] = {"TYPE": "xfs", "UUID": UUID, "LABEL": PROBE.LABEL}
    data["signatures"] = [{"type": "xfs", "uuid": UUID}]
    data["uuid_devices"] = ["/dev/sdb"]
    data["target"].update(fstype="xfs", uuid=UUID, label=PROBE.LABEL)
    if mounted:
        data["mounts"].append({
            "target": PROBE.MOUNTPOINT, "maj:min": "8:16", "uuid": UUID,
            "fstype": "xfs", "options": "rw,nodev,nosuid,noexec,relatime",
        })
        data["target"]["mountpoints"] = [PROBE.MOUNTPOINT]
        data["mountpoint"].update(exists=True, is_dir=True, empty=False)
    return data


class BackupStorageGuardTests(unittest.TestCase):
    def rejected(self, data):
        with self.assertRaises(PROBE.GuardError):
            PROBE.classify(data, UUID)

    def test_only_verified_blank_disk_requests_creation(self):
        result = PROBE.classify(blank(), UUID)
        self.assertEqual(result["state"], "blank")
        self.assertTrue(result["should_format"])
        self.assertFalse(result["mounted"])

    def test_retry_after_creation_never_formats_again(self):
        result = PROBE.classify(prepared(), UUID)
        self.assertEqual(result["state"], "prepared")
        self.assertFalse(result["should_format"])
        self.assertFalse(result["mounted"])

    def test_mounted_filesystem_is_an_idempotent_preserving_decision(self):
        data = prepared(mounted=True)
        original = copy.deepcopy(data)
        first = PROBE.classify(data, UUID)
        second = PROBE.classify(data, UUID)
        self.assertEqual(first, second)
        self.assertEqual(data, original)
        self.assertFalse(second["should_format"])
        self.assertTrue(second["mounted"])

    def test_missing_evidence_is_not_a_blank_disk(self):
        data = blank()
        del data["holders"]
        self.rejected(data)

    def test_host_and_physical_identity_must_match(self):
        for field, value in [
            ("hostname", "another-host"),
            ("machine_id", "0" * 32),
            ("by_id", "/dev/sdb"),
            ("is_block", False),
        ]:
            with self.subTest(field=field):
                data = blank()
                data[field] = value
                self.rejected(data)
        for field, value in [
            ("serial", "ZWD0RXD6"),  # The other SATA must remain unmanaged.
            ("model", "CT500P3SSD8"),
            ("size", PROBE.SIZE - 512),
            ("type", "part"),
            ("ro", True),
            ("pkname", "/dev/another"),
            ("maj:min", "8:0"),
        ]:
            with self.subTest(field=field):
                data = blank()
                data["target"][field] = value
                self.rejected(data)

    def test_kernel_name_change_does_not_retarget_the_persistent_identity(self):
        data = blank()
        data["resolved"] = "/dev/sdc"
        data["target"]["kname"] = "/dev/sdc"
        self.assertEqual(PROBE.classify(data, UUID)["device"], "/dev/sdc")

    def test_root_swap_holders_slaves_and_partitions_are_rejected(self):
        for field, value in [
            ("root_ancestors", ["sdb"]),
            ("root_ancestors", []),
            ("swap_ancestors", ["sdb", "sdb1"]),
            ("holders", ["dm-0"]),
            ("slaves", ["another"]),
        ]:
            with self.subTest(field=field, value=value):
                data = blank()
                data[field] = value
                self.rejected(data)
        data = blank()
        data["target"]["children"] = [{"kname": "/dev/sdb1"}]
        self.rejected(data)

    def test_unknown_or_ambiguous_signatures_block_creation(self):
        for signature in [
            {"type": "gpt"},
            {"type": "linux_raid_member"},
            {"type": "ext4", "uuid": UUID},
            {"type": "xfs", "uuid": UUID},
        ]:
            with self.subTest(signature=signature):
                data = blank()
                data["signatures"] = [signature]
                self.rejected(data)
        data = blank()
        data["blkid_rc"] = 8
        self.rejected(data)

    def test_disagreeing_lsblk_metadata_never_authorizes_creation_or_adoption(self):
        for field, value in [("fstype", "xfs"), ("uuid", UUID), ("label", PROBE.LABEL)]:
            with self.subTest(state="blank", field=field):
                data = blank()
                data["target"][field] = value
                self.rejected(data)
        for field, value in [
            ("fstype", "ext4"), ("uuid", "another-uuid"), ("label", "unrelated"),
            ("fstype", None), ("uuid", None), ("label", None),
        ]:
            with self.subTest(state="prepared", field=field):
                data = prepared()
                data["target"][field] = value
                self.rejected(data)

    def test_existing_unrelated_filesystem_cannot_be_adopted(self):
        for field, value in [
            ("TYPE", "ext4"),
            ("UUID", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"),
            ("LABEL", "unrelated"),
            ("PTTYPE", "gpt"),
        ]:
            with self.subTest(field=field):
                data = prepared()
                data["blkid"][field] = value
                self.rejected(data)
        data = prepared()
        data["signatures"] = [{"type": "gpt"}]
        self.rejected(data)

    def test_duplicate_uuid_on_another_disk_is_rejected(self):
        for data in [blank(), prepared()]:
            with self.subTest(state=data["blkid_rc"]):
                data["uuid_devices"] = ["/dev/sda"]
                self.rejected(data)

    def test_symlinks_nonempty_fallback_and_foreign_mount_are_rejected(self):
        for field, value in [
            ("has_symlink", True),
            ("canonical", "/elsewhere"),
            ("empty", False),
        ]:
            with self.subTest(field=field):
                data = blank()
                data["mountpoint"][field] = value
                self.rejected(data)
        data = blank()
        data["mountpoint"].update(exists=True, is_dir=False)
        self.rejected(data)
        data = blank()
        data["mounts"].append({
            "target": PROBE.MOUNTPOINT, "maj:min": "8:0", "fstype": "ext4",
        })
        self.rejected(data)

    def test_mount_aliases_wrong_options_and_existing_fstab_are_rejected(self):
        data = prepared(mounted=True)
        data["mounts"][-1]["target"] = "/elsewhere"
        self.rejected(data)
        data = prepared(mounted=True)
        data["mounts"][-1]["options"] = "rw"
        self.rejected(data)
        data = prepared()
        data["fstab_conflicts"] = ["UUID=another /srv/redunisol-backups xfs defaults 0 0"]
        self.rejected(data)
        data = prepared()
        data["mount_unit"] = "../../another.mount"
        self.rejected(data)

    def test_ancestry_fails_closed_on_missing_or_cyclic_nodes(self):
        with self.assertRaises(PROBE.GuardError):
            PROBE.ancestors("unknown", {})
        with self.assertRaises(PROBE.GuardError):
            PROBE.ancestors("sdb", {"sdb": {"pkname": "/dev/sdb"}})

    def test_invalid_uuid_is_rejected_before_any_probe(self):
        for value in ["", "random", "main", UUID.upper()]:
            with self.subTest(value=value):
                with self.assertRaises(PROBE.GuardError):
                    PROBE.classify(blank(), value)


class BackupStoragePlaybookBoundaryTests(unittest.TestCase):
    def test_only_separate_prepare_contains_creation_and_never_force(self):
        prepare = yaml.safe_load((ROOT / "roles/backup_storage/tasks/prepare.yml").read_text())
        creation = [
            task for task in prepare
            if task.get("ansible.builtin.command", {}).get("argv", [None])[0] == "/usr/sbin/mkfs.xfs"
        ]
        self.assertEqual(len(creation), 1)
        self.assertNotIn("-f", creation[0]["ansible.builtin.command"]["argv"])
        self.assertIn("not ansible_check_mode", creation[0]["when"])
        self.assertIn("foundation_backup_storage_probe.state == 'blank'", creation[0]["when"])
        main = (ROOT / "roles/backup_storage/tasks/main.yml").read_text()
        self.assertNotIn("prepare.yml", main)
        self.assertNotIn("mkfs", main)
        self.assertNotIn("restic", (ROOT / "playbooks/storage-prepare.yml").read_text())

    def test_initialization_needs_serial_uuid_and_revision_authorization(self):
        prepare = yaml.safe_load((ROOT / "roles/backup_storage/tasks/prepare.yml").read_text())
        gate = next(
            task["ansible.builtin.assert"]
            for task in prepare if "ansible.builtin.assert" in task
            and "foundation_backup_storage_prepare_authorized" in str(task)
        )
        text = str(gate["that"])
        self.assertIn("foundation_apply_authorized", text)
        self.assertIn("foundation_backup_storage_confirmation", text)
        self.assertIn("foundation_backup_storage_serial", text)
        self.assertIn("foundation_backup_storage_uuid", text)
        self.assertIn("foundation_revision", text)


if __name__ == "__main__":
    unittest.main()
