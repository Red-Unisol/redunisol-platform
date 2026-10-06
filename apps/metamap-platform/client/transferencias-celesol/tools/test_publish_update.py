import importlib.util
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from test_update_release import release

spec = importlib.util.spec_from_file_location("publish_update", Path(__file__).with_name("publish_update.py"))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class FakeSFTP:
    def __init__(self, root):
        self.root = root
        self.fail_pointer_once = False

    def path(self, name):
        assert name.startswith(publisher.ROOT + "/")
        return self.root / name[len(publisher.ROOT) + 1:]

    def __enter__(self): return self
    def __exit__(self, *_): pass
    def open(self, name, mode):
        # Paramiko SFTPFile reads bytes even for mode='r'.
        return self.path(name).open(mode if 'b' in mode else mode + 'b')
    def mkdir(self, name): self.path(name).mkdir()
    def put(self, source, target): shutil.copyfile(source, self.path(target))
    def rename(self, source, target): self.path(source).rename(self.path(target))
    def posix_rename(self, source, target):
        if self.fail_pointer_once:
            self.fail_pointer_once = False
            raise ConnectionError("Simulated interruption before pointer promotion")
        os.replace(self.path(source), self.path(target))


class FakeSSH:
    def __init__(self, sftp): self.sftp = sftp
    def load_host_keys(self, *_): pass
    def set_missing_host_key_policy(self, *_): pass
    def connect(self, *_, **__): pass
    def close(self): pass
    def open_sftp(self): return self.sftp
    def exec_command(self, command):
        assert command.startswith("mkdir -p ")
        class Output:
            def recv_exit_status(self): return 0
            @property
            def channel(self): return self
        return None, Output(), None


class PublishTests(unittest.TestCase):
    def test_resume_interrupted_promotion_idempotency_and_no_downgrade(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            private = root / "signing.key"
            public = root / "public.key"
            public.write_text(release.keygen(private))
            exe = root / "app.exe"
            exe.write_bytes(b"MZ signed fixture")
            remote = root / "remote"
            remote.mkdir()
            sftp = FakeSFTP(remote)
            values = {"TRANSFERENCIAS_UPDATE_SIGNING_KEY": private.read_text(),
                      "UPDATE_KNOWN_HOSTS_FILE": "unused", "SSH_HOST": "fixture", "SSH_PORT": "22", "SSH_USER": "fixture"}
            with patch.dict(os.environ, values), patch.object(publisher.paramiko, "SSHClient", lambda: FakeSSH(sftp)):
                release.release(exe, "2.1.0", root / "first", public)
                publisher.publish(root / "first", public)
                original = (remote / "latest.json").read_bytes()
                publisher.publish(root / "first", public)  # Idempotent after promotion.
                self.assertEqual((remote / "latest.json").read_bytes(), original)
                release.release(exe, "2.2.0", root / "second", public)
                sftp.fail_pointer_once = True
                with self.assertRaises(ConnectionError):
                    publisher.publish(root / "second", public)
                self.assertEqual((remote / "latest.json").read_bytes(), original)
                self.assertTrue((remote / "2.2.0/transferencias-celesol.exe").exists())
                publisher.publish(root / "second", public)  # Resume without overwriting version.
                self.assertEqual((remote / "latest.json").read_bytes(), (root / "second/latest.json").read_bytes())
                with self.assertRaises(ValueError):
                    publisher.publish(root / "first", public)
                # Same version with different bytes cannot replace immutable content.
                exe.write_bytes(b"MZ changed fixture")
                release.release(exe, "2.2.0", root / "changed", public)
                with self.assertRaises(ValueError):
                    publisher.publish(root / "changed", public)
