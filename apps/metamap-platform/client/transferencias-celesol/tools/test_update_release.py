import base64
import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

spec = importlib.util.spec_from_file_location("update_release", Path(__file__).with_name("update_release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def test_signing_and_exact_code_only_allowlist(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            private = root / "private.key"
            public = root / "public.key"
            public.write_text(release.keygen(private))
            exe = root / "app.exe"
            exe.write_bytes(b"MZfake executable")
            (root / "transferencias.env.enc").write_text("never package this")
            with patch.dict(os.environ, {"TRANSFERENCIAS_UPDATE_SIGNING_KEY": private.read_text()}):
                release.release(exe, "2.1.0", root / "output", public)
            files = {p.relative_to(root / "output").as_posix() for p in (root / "output").rglob("*") if p.is_file()}
            self.assertEqual(files, {"latest.json", "2.1.0/transferencias-celesol.exe",
                                     "2.1.0/manifest.json", "2.1.0/manifest.sig"})
            envelope = json.loads((root / "output/latest.json").read_text())
            raw = base64.b64decode(envelope["manifest"])
            Ed25519PublicKey.from_public_bytes(base64.b64decode(public.read_text())).verify(
                base64.b64decode(envelope["signature"]), raw)
            self.assertEqual(json.loads(raw)["sha256"], hashlib.sha256(exe.read_bytes()).hexdigest())
            self.assertEqual(raw, (root / "output/2.1.0/manifest.json").read_bytes())
            with self.assertRaises(FileExistsError):
                release.keygen(private)

    def test_rejects_wrong_key_and_invalid_version(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            private = root / "private.key"
            release.keygen(private)
            public = root / "public.key"
            public.write_text(release.keygen(root / "other.key"))
            exe = root / "app.exe"
            exe.write_bytes(b"MZfake")
            with patch.dict(os.environ, {"TRANSFERENCIAS_UPDATE_SIGNING_KEY": private.read_text()}):
                for version in ["2.1.0", "../escape", "2.1.0-beta"]:
                    with self.assertRaises(ValueError):
                        release.release(exe, version, root / "output", public)


if __name__ == "__main__":
    unittest.main()
