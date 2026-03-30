import base64
import importlib.util
from pathlib import Path
import tempfile
import unittest

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.ciphers.aead import AESSIV


REPO_ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = REPO_ROOT / "kestra" / "tools" / "manage_encrypted_env.py"
SPEC = importlib.util.spec_from_file_location("manage_encrypted_env", MODULE_PATH)
manage_encrypted_env = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(manage_encrypted_env)


class ManageEncryptedEnvTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.key_file = self.root / "runtime.key"
        key = base64.urlsafe_b64encode(AESSIV.generate_key(bit_length=256))
        self.key_file.write_bytes(key + b"\n")

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def test_encrypt_decrypt_roundtrip_preserves_comments(self) -> None:
        plaintext = (
            b"# Header\n"
            b"ENV_ALPHA=value-a\n"
            b"\n"
            b"SECRET_BETA=value=b\n"
        )

        encrypted = manage_encrypted_env.encrypt_env_lines(
            manage_encrypted_env.load_aessiv(self.key_file),
            plaintext,
        )
        decrypted = manage_encrypted_env.decrypt_env_lines(
            manage_encrypted_env.load_aessiv(self.key_file),
            encrypted,
        )

        self.assertEqual(decrypted, plaintext)

    def test_encrypt_is_deterministic_per_key_and_value(self) -> None:
        plaintext = b"ENV_ALPHA=value-a\nENV_BETA=value-b\n"

        encrypted_once = manage_encrypted_env.encrypt_env_lines(
            manage_encrypted_env.load_aessiv(self.key_file),
            plaintext,
        )
        encrypted_twice = manage_encrypted_env.encrypt_env_lines(
            manage_encrypted_env.load_aessiv(self.key_file),
            plaintext,
        )

        self.assertEqual(encrypted_once, encrypted_twice)

    def test_same_value_under_different_keys_produces_different_ciphertext(self) -> None:
        plaintext = b"ENV_ALPHA=same-value\nENV_BETA=same-value\n"

        encrypted = manage_encrypted_env.encrypt_env_lines(
            manage_encrypted_env.load_aessiv(self.key_file),
            plaintext,
        ).decode("utf-8")

        alpha_ciphertext = encrypted.splitlines()[0].split("=", 1)[1]
        beta_ciphertext = encrypted.splitlines()[1].split("=", 1)[1]
        self.assertNotEqual(alpha_ciphertext, beta_ciphertext)

    def test_decrypt_supports_legacy_blob_format(self) -> None:
        plaintext = b"ENV_ALPHA=value-a\nSECRET_BETA=value-b\n"
        legacy_blob = Fernet(self.key_file.read_bytes().strip()).encrypt(plaintext)
        encrypted_path = self.root / "legacy.env.enc"
        decrypted_path = self.root / "legacy.env"
        encrypted_path.write_bytes(legacy_blob + b"\n")

        result = manage_encrypted_env.decrypt_file(
            self.key_file,
            encrypted_path,
            decrypted_path,
            force=True,
        )

        self.assertEqual(result, 0)
        self.assertEqual(decrypted_path.read_bytes(), plaintext)

    def test_legacy_blob_is_not_misdetected_as_line_encrypted_env(self) -> None:
        plaintext = b"ENV_ALPHA=value-a\n"
        legacy_blob = Fernet(self.key_file.read_bytes().strip()).encrypt(plaintext) + b"\n"

        self.assertFalse(manage_encrypted_env.is_line_encrypted_env(legacy_blob))


if __name__ == "__main__":
    unittest.main()
