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

    def test_invalid_optional_secret_is_removed_without_shell_injection(self):
        self.env.write_bytes(b"MISTRAL_API_KEY=unsafe;echo-token\nOTHER=value\n")
        key, _ = m.prepare(self.env, self.key, self.source)
        self.assertEqual(key, "")
        self.assertNotIn(b"unsafe", self.env.read_bytes())
        self.assertEqual(m.env_value(self.env.read_bytes(), "MISTRAL_API_KEY"), "")
        self.assertIn(b"OTHER=value", self.env.read_bytes())

    def test_missing_ciphered_secret_keeps_manual_operation_available(self):
        self.env.write_bytes(b"APP_ORIGIN=https://example.test\n")
        self.source.write_bytes(encrypt_env_lines(load_aessiv(self.key), b"SECRET_OTHER=value\n"))
        key, _ = m.prepare(self.env, self.key, self.source)
        self.assertEqual(key, "")
        self.assertIn(b"MISTRAL_API_KEY=", self.env.read_bytes())
        self.assertIn(b"APP_ORIGIN=https://example.test", self.env.read_bytes())

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

    def test_explicit_manual_check_still_reports_annotation_failure(self):
        import io, json
        responses = [io.BytesIO(json.dumps({"data": [{"id": "mistral-ocr-latest"}]}).encode()),
                     io.BytesIO(json.dumps({"pages": [], "document_annotation": None}).encode())]
        with patch.object(m.urllib.request, "urlopen", side_effect=responses):
            with self.assertRaises(ValueError):
                m.check_connection("fixture-key", "mistral-ocr-latest")

    def test_default_preparation_never_calls_provider(self):
        self.env.write_bytes(b"MISTRAL_API_KEY=own-key\nOTHER=value\n")
        args = ["prepare_mistral_env.py", "--env-file", str(self.env),
                "--key-file", str(self.key), "--kestra-env", str(self.source)]
        with patch.object(m.sys, "argv", args), patch.object(m.urllib.request, "urlopen") as request:
            self.assertEqual(m.main(), 0)
            request.assert_not_called()

    def test_missing_optional_files_do_not_prevent_preparation(self):
        self.env.write_bytes(b"OTHER=value\n")
        key, _ = m.prepare(self.env, Path("missing-key"), Path("missing-source"))
        self.assertEqual(key, "")
        self.assertIn(b"OTHER=value", self.env.read_bytes())

    def test_invalid_ciphered_optional_secret_does_not_prevent_preparation(self):
        self.env.write_bytes(b"OTHER=value\n")
        self.source.write_bytes(b"SECRET_MISTRAL_API_KEY=invalid-ciphertext\n")
        key, _ = m.prepare(self.env, self.key, self.source)
        self.assertEqual(key, "")
        self.assertIn(b"OTHER=value", self.env.read_bytes())

    def test_dev_workflow_does_not_request_live_provider_check(self):
        workflow = m.REPO_ROOT / ".github/workflows/deploy-solicitudes-web-dev.yml"
        content = workflow.read_text(encoding="utf-8")
        self.assertIn("prepare_mistral_env.py", content)
        self.assertNotIn("--check-connection", content)


    def test_unreadable_required_application_env_still_fails(self):
        import contextlib, io
        args = ["prepare_mistral_env.py", "--env-file", str(self.folder / "missing-app.env"),
                "--key-file", str(self.key), "--kestra-env", str(self.source)]
        with patch.object(m.sys, "argv", args), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(m.main(), 1)

    def test_manual_check_is_explicit_and_reports_only_safe_http_status(self):
        import contextlib, io
        self.env.write_bytes(b"MISTRAL_API_KEY=own-key\n")
        args = ["prepare_mistral_env.py", "--env-file", str(self.env),
                "--key-file", str(self.key), "--kestra-env", str(self.source), "--check-connection"]
        error = m.urllib.error.HTTPError("https://api.mistral.ai/v1/ocr", 429,
                                        "private-provider-details", {}, None)
        output = io.StringIO()
        with patch.object(m.sys, "argv", args), patch.object(m, "check_connection", side_effect=error) as check, contextlib.redirect_stderr(output):
            self.assertEqual(m.main(), 1)
            check.assert_called_once_with("own-key", "mistral-ocr-latest")
        self.assertIn("HTTP 429", output.getvalue())
        self.assertNotIn("private-provider-details", output.getvalue())
        self.assertNotIn("own-key", output.getvalue())


    def test_dedicated_secret_avoids_kestra_and_is_written_privately(self):
        self.env.write_bytes(b"MISTRAL_API_KEY=\n")
        with patch.dict(m.os.environ, {"SOLICITUDES_MISTRAL_API_KEY": "dedicated-fixture-key"}):
            key, source = m.prepare(self.env, Path("missing"), Path("missing"))
        self.assertEqual(key, "dedicated-fixture-key")
        self.assertEqual(source, "secreto dedicado de Solicitudes")
        self.assertEqual(m.env_value(self.env.read_bytes(), "MISTRAL_API_KEY"), key)
        self.assertEqual(self.env.stat().st_mode & 0o777, 0o600)

    def test_explicit_application_key_is_not_overwritten_by_dedicated_secret(self):
        self.env.write_bytes(b"MISTRAL_API_KEY=existing-fixture-key\n")
        with patch.dict(m.os.environ, {"SOLICITUDES_MISTRAL_API_KEY": "dedicated-fixture-key"}):
            key, _ = m.prepare(self.env, Path("missing"), Path("missing"))
        self.assertEqual(key, "existing-fixture-key")

    def test_invalid_dedicated_secret_preserves_manual_fallback(self):
        self.env.write_bytes(b"MISTRAL_API_KEY=\n")
        with patch.dict(m.os.environ, {"SOLICITUDES_MISTRAL_API_KEY": "invalid;command"}):
            key, _ = m.prepare(self.env, self.key, self.source)
        self.assertEqual(key, "")
        self.assertNotIn(b"invalid;command", self.env.read_bytes())

if __name__ == "__main__":
    unittest.main()
