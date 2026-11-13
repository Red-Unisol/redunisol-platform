from __future__ import annotations

import contextlib
import io
import importlib.util
import json
import sys
import tempfile
import traceback
import types
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

import requests

# Encryption is mocked in these HTTP diagnostics tests, like the existing suite.
if "Crypto" not in sys.modules and importlib.util.find_spec("Crypto") is None:
    crypto = types.ModuleType("Crypto")
    cipher = types.ModuleType("Crypto.Cipher")
    cipher.AES = types.SimpleNamespace(MODE_CBC=1)
    crypto.Cipher = cipher
    sys.modules.update({"Crypto": crypto, "Crypto.Cipher": cipher})

from tope_descuento_caja_mensual.caja_client import (
    CajaRateLimitedError, CajaSession, CajaSessionExpiredError, CajaTechnicalError,
)
from tope_descuento_caja_mensual.checkpoint import Checkpoint
from tope_descuento_caja_mensual.diagnostics import MAX_BODY_CHARS, REDACTED, redact
from tope_descuento_caja_mensual.runner import run_candidates
from tope_descuento_caja_mensual.sources import Candidate


def response(status, body, **headers):
    result = requests.Response()
    result.status_code = status
    result._content = (body if isinstance(body, str) else json.dumps(body)).encode()
    result.headers.update({"Content-Type": "application/json; charset=utf-8", **headers})
    return result


class FakeHTTP:
    def __init__(self, *results):
        self.results = iter(results)
        self.cookies = requests.cookies.RequestsCookieJar()
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        result = next(self.results)
        if isinstance(result, Exception):
            raise result
        return result


def client(*results):
    return CajaSession(
        cidi_base_url="https://cidi.test", cidi_client_id="test-client",
        cidi_client_secret="unit-client-secret", cidi_user="20000000001",
        cidi_password="unit-pass#9", caja_base_url="https://caja.test",
        caja_encrypt_password="unit-encryption-secret", session=FakeHTTP(*results),
    )


class DiagnosticsTests(unittest.TestCase):
    def test_oauth_reason_nested_result_and_correlation_survive_redaction(self):
        details = "Explicacion completa " * 40
        body = {
            "error": "invalid_grant", "error_description": details,
            "resultado": {"errores": [{"codigo": "CIDI-42", "mensaje": "No pudo crear sesion"}],
                          "mensajeUsuario": "No pudo completar autenticacion",
                          "password": "different-server-secret", "access_token": "unknown-token"},
            "echo": "unit-pass#9 " + quote("unit-pass#9", safe=""),
            "cuil": "20111111112", "nombre": "Persona privada",
        }
        caja = client(response(400, body, **{
            "X-Request-ID": "correlation-123", "Set-Cookie": "unknown-cookie-value",
            "Authorization": "unknown-header-token",
        }))
        log = io.StringIO()
        with contextlib.redirect_stdout(log), self.assertRaises(CajaTechnicalError) as caught:
            caja._login_cidi()
        diagnostic = caught.exception.diagnostics
        self.assertEqual(diagnostic["stage"], "cidi_login")
        self.assertEqual(diagnostic["http_status"], 400)
        self.assertEqual(diagnostic["response_body"]["error_description"], details)
        self.assertEqual(diagnostic["response_body"]["resultado"]["errores"][0]["codigo"], "CIDI-42")
        self.assertEqual(diagnostic["response_body"]["resultado"]["mensajeUsuario"], "No pudo completar autenticacion")
        self.assertEqual(diagnostic["response_headers"]["x-request-id"], "correlation-123")
        self.assertFalse(diagnostic["response_body_truncated"])
        self.assertIn("duration_ms", diagnostic)
        retained = log.getvalue() + str(caught.exception) + json.dumps(diagnostic)
        for secret in ("unit-pass#9", quote("unit-pass#9", safe=""), "different-server-secret",
                       "unknown-token", "unknown-cookie-value", "unknown-header-token",
                       "20111111112", "Persona privada"):
            self.assertNotIn(secret, retained)

    def test_non_json_proxy_error_keeps_reason_and_removes_echoed_headers(self):
        caja = client(response(502, "<html>Servicio no disponible\nCookie: a=unknown; b=other\n"
                               "Authorization: Bearer opaque\nunit-pass%239</html>"))
        log = io.StringIO()
        with contextlib.redirect_stdout(log), self.assertRaises(CajaTechnicalError) as caught:
            caja._login_cidi()
        self.assertIn("Servicio no disponible", caught.exception.diagnostics["response_body"])
        for secret in ("a=unknown", "b=other", "opaque", "unit-pass%239"):
            self.assertNotIn(secret, log.getvalue())

    def test_success_status_with_missing_session_preserves_safe_server_reason(self):
        caja = client(response(200, {"access_token": "private-access", "refresh_token": "private-refresh",
                                     "resultado": {"datos": None, "error": "Missing session state"}}))
        log = io.StringIO()
        with contextlib.redirect_stdout(log), self.assertRaises(CajaTechnicalError) as caught:
            caja._login_cidi()
        self.assertEqual(caught.exception.diagnostics["http_status"], 200)
        self.assertIn("Missing session state", log.getvalue())
        self.assertNotIn("private-access", log.getvalue())
        self.assertNotIn("private-refresh", log.getvalue())

    def test_all_http_stages_and_error_classes_are_identified(self):
        cases = (
            ("caja_seed_login", CajaTechnicalError, 503, "_get_seed_token"),
            ("caja_permissions", CajaTechnicalError, 403, "_exchange_permissions"),
            ("caja_persona", CajaSessionExpiredError, 401, "persona"),
            ("caja_disponible", CajaRateLimitedError, 429, "disponible"),
        )
        for stage, error_type, status, method in cases:
            with self.subTest(stage=stage):
                caja = client(response(status, {"message": "External failure"}))
                with (
                    contextlib.redirect_stdout(io.StringIO()),
                    patch("tope_descuento_caja_mensual.caja_client.cifrar_permisos", return_value="encrypted-private"),
                    patch("tope_descuento_caja_mensual.caja_client.construir_payload_permisos", return_value={"idUsuario": 1}),
                    self.assertRaises(error_type) as caught,
                ):
                    if method == "_get_seed_token":
                        caja._get_seed_token()
                    elif method == "_exchange_permissions":
                        caja._exchange_permissions("seed-private")
                    else:
                        suffix = "utilidades/obtener-datos-persona" if method == "persona" else "transaccion/obtener-haber-disponible"
                        caja._post_encrypted("/api/" + suffix, {"cuil": "20111111112"})
                self.assertEqual(caught.exception.diagnostics["stage"], stage)

    def test_session_renewal_records_reason_and_failed_generation(self):
        caja = client(response(400, {"error": "invalid_grant", "error_description": "Cannot renew session"}))
        caja.cidi_cookie = "CiDi=old-private-session"
        caja.caja_token = "old-private-token"
        caja.opened_at = 100
        caja.open_count = 1
        log = io.StringIO()
        with contextlib.redirect_stdout(log), patch("time.monotonic", return_value=2500), self.assertRaises(CajaTechnicalError):
            caja.query("20111111112")
        events = [json.loads(line) for line in log.getvalue().splitlines()]
        self.assertEqual(events[0]["reason"], "max_age")
        self.assertEqual(events[0]["session_age_seconds"], 2400)
        self.assertEqual(events[-1]["event"], "caja_session_open_failed")
        self.assertEqual(events[1]["diagnostic_id"], events[-1]["diagnostic_id"])
        self.assertNotIn("20111111112", log.getvalue())

    def test_network_traceback_never_exposes_unsanitized_original_exception(self):
        caja = client(requests.Timeout("Failed https://user:unit-pass%239@host.test/?token=private"))
        log = io.StringIO()
        with contextlib.redirect_stdout(log):
            try:
                caja._login_cidi()
            except CajaTechnicalError as exc:
                trace = traceback.format_exc()
                self.assertEqual(exc.diagnostics["exception_type"], "Timeout")
                self.assertTrue(exc.diagnostics["diagnostic_id"])
            else:
                self.fail("Expected a tracked timeout")
        for secret in ("unit-pass%239", "token=private", "user:"):
            self.assertNotIn(secret, trace + log.getvalue())

    def test_full_error_is_redacted_before_explicit_size_limit(self):
        caja = client(response(400, {"error_description": "X" * MAX_BODY_CHARS + "unit-pass#9"}))
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(CajaTechnicalError) as caught:
            caja._login_cidi()
        self.assertTrue(caught.exception.diagnostics["response_body_truncated"])
        self.assertNotIn("unit-pass#9", json.dumps(caught.exception.diagnostics))

    def test_unknown_nested_sensitive_values_are_removed_by_key(self):
        for key in ("Password", "clientSecret", "accessToken", "refresh_token", "HashSesion",
                    "idUsuario", "CUIT", "email", "telefono"):
            with self.subTest(key=key):
                self.assertEqual(redact({"resultado": [{key: "unknown-sensitive-value"}]}),
                                 {"resultado": [{key: REDACTED}]})

    def test_secrets_from_successful_handshake_and_cookie_jar_are_redacted_later(self):
        private = ["private-access-value", "private-refresh-value", "private-session-hash",
                   "private-seed-value", "private-caja-value", "private-cookie-value",
                   "private-encrypted-body"]
        caja = client(
            response(200, {"access_token": private[0], "refresh_token": private[1],
                           "resultado": {"datos": {"hashSesion": private[2]}}}),
            response(200, {}, authorization=private[3]),
            response(200, {}, authorization=private[4]),
            response(500, {"message": "failure " + " ".join(private), "echo_number": 20000000001}),
        )
        caja.http.cookies.set("TS_cookie", private[5])
        log = io.StringIO()
        with (
            contextlib.redirect_stdout(log),
            patch("tope_descuento_caja_mensual.caja_client.cifrar_permisos", return_value=private[6]),
            patch("tope_descuento_caja_mensual.caja_client.construir_payload_permisos", return_value={"idUsuario": 1}),
        ):
            caja.open()
            with self.assertRaises(CajaTechnicalError) as caught:
                caja._post_encrypted("/api/transaccion/obtener-haber-disponible", {})
        retained = log.getvalue() + str(caught.exception) + json.dumps(caught.exception.diagnostics)
        for secret in private + ["20000000001"]:
            self.assertNotIn(secret, retained)

    def test_last_failure_survives_checkpoint_and_every_retry_is_logged(self):
        caja = client(response(400, {"error": "invalid_grant", "error_description": "Detailed CIDI reason"}))
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(CajaTechnicalError) as caught:
            caja._login_cidi()
        failure = caught.exception

        class FailingCaja:
            open_count = 0

            def query(self, cuil):
                raise failure

        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Checkpoint(Path(directory) / "state.jsonl")
            # Checkpoints created before the new diagnostic field remain readable.
            checkpoint.path.write_text(json.dumps({"cuil": "20111111112", "status": "technical_error",
                                                   "checked_at": "old", "error": "old failure"}) + "\n")
            self.assertIsNone(checkpoint.latest()["20111111112"].error_details)
            log = io.StringIO()
            sleeps = []
            with contextlib.redirect_stdout(log):
                summary = run_candidates(
                    [Candidate("20111111112")], checkpoint, caja=FailingCaja(),
                    now=lambda: datetime(2026, 11, 13), sleep=sleeps.append,
                    retry_delays=(5, 15), max_consecutive_errors=1,
                )
            events = [json.loads(line) for line in log.getvalue().splitlines()]
            self.assertEqual([event["attempt"] for event in events], [1, 2, 3])
            self.assertEqual(sleeps, [5, 15])
            self.assertIn("Detailed CIDI reason", summary.stop_reason)
            saved = checkpoint.latest()["20111111112"]
            self.assertEqual(saved.error_details, failure.diagnostics)
            self.assertEqual(saved.error_details["response_body"]["error"], "invalid_grant")


if __name__ == "__main__":
    unittest.main()
