import base64
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

MODULE_PATH = Path(__file__).with_name("prepare_mistral_env.py")
spec = importlib.util.spec_from_file_location("prepare_mistral_env", MODULE_PATH)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
from manage_encrypted_env import encrypt_env_lines, load_aessiv


class PrepareMistralTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.env = self.folder / "app.env"
        self.key = self.folder / "runtime.key"
        self.source = self.folder / "kestra.env.enc"
        self.key.write_bytes(base64.urlsafe_b64encode(b"x" * 32))
        self.source.write_bytes(encrypt_env_lines(load_aessiv(self.key), b"SECRET_MISTRAL_API_KEY=fixture-key\nSECRET_OTHER=must-not-copy\n"))

    def test_reuses_encrypted_key_without_copying_other_secrets(self):
        self.env.write_bytes(b"APP_ORIGIN=https://example.test\nMISTRAL_API_KEY=\n")
        key, _ = m.prepare(self.env, self.key, self.source)
        self.assertEqual(key, "fixture-key")
        self.assertIn(b"MISTRAL_API_KEY=fixture-key\n", self.env.read_bytes())
        self.assertNotIn(b"must-not-copy", self.env.read_bytes())
        self.assertNotIn(b"SECRET_OTHER", self.env.read_bytes())
        if os.name == "posix":
            self.assertEqual(self.env.stat().st_mode & 0o777, 0o600)

    def test_existing_key_is_preserved_without_reading_kestra(self):
        content = b"MISTRAL_API_KEY=own-key\nOTHER=value\n"
        self.env.write_bytes(content)
        key, _ = m.prepare(self.env, Path("missing-key"), Path("missing-source"))
        self.assertEqual(key, "own-key")
        self.assertEqual(self.env.read_bytes(), content)

    def test_invalid_secret_is_rejected_without_shell_injection(self):
        self.env.write_bytes(b"MISTRAL_API_KEY=unsafe;echo-token\n")
        with self.assertRaises(ValueError):
            m.prepare(self.env, self.key, self.source)

    def test_missing_ciphered_secret_does_not_create_an_empty_credential(self):
        self.env.write_bytes(b"APP_ORIGIN=https://example.test\n")
        self.source.write_bytes(encrypt_env_lines(load_aessiv(self.key), b"SECRET_OTHER=value\n"))
        with self.assertRaises(ValueError):
            m.prepare(self.env, self.key, self.source)
        self.assertNotIn(b"MISTRAL_API_KEY", self.env.read_bytes())

    def test_repeated_preparation_preserves_key(self):
        self.env.write_bytes(b"MISTRAL_API_KEY=\n")
        m.prepare(self.env, self.key, self.source)
        initial = self.env.read_bytes()
        m.prepare(self.env, self.key, self.source)
        self.assertEqual(self.env.read_bytes(), initial)

    def test_model_and_annotation_checked_with_synthetic_document(self):
        import io, json
        responses = [io.BytesIO(json.dumps({"data": [{"id": "mistral-ocr-latest"}]}).encode()),
                     io.BytesIO(json.dumps({"pages": [{"markdown": "Inventario"}], "document_annotation": '{"es_recibo": false}'}).encode())]
        with patch.object(m.urllib.request, "urlopen", side_effect=responses) as request:
            m.check_connection("fixture-key", "mistral-ocr-latest")
            self.assertEqual(request.call_count, 2)
            body = json.loads(request.call_args.args[0].data)
            self.assertEqual(body["document"]["type"], "document_url")
            self.assertNotIn("fixture-key", json.dumps(body))

    def test_ocr_annotation_failure_prevents_deploy(self):
        import io, json
        responses = [io.BytesIO(json.dumps({"data": [{"id": "mistral-ocr-latest"}]}).encode()),
                     io.BytesIO(json.dumps({"pages": [], "document_annotation": None}).encode())]
        with patch.object(m.urllib.request, "urlopen", side_effect=responses):
            with self.assertRaises(ValueError):
                m.check_connection("fixture-key", "mistral-ocr-latest")

if __name__ == "__main__":
    unittest.main()
