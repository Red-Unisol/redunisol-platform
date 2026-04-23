from __future__ import annotations

from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

FILES_ROOT = Path(__file__).resolve().parent.parent / "files"
if str(FILES_ROOT) not in sys.path:
    sys.path.insert(0, str(FILES_ROOT))

from consulta_empleador.service import (  # noqa: E402
    ConsultaEmpleadorConfig,
    SearchRequest,
    build_error_result,
    build_output_payload,
    consultar_empleador,
    parse_search_request,
)


class ConsultaEmpleadorTests(unittest.TestCase):
    def test_parse_search_request_infers_dni_tipo(self) -> None:
        request = parse_search_request({"dni": "32.786.693"})

        self.assertEqual(request, SearchRequest(identifier="32786693", tipo="M"))

    def test_parse_search_request_infers_cuil_tipo(self) -> None:
        request = parse_search_request({"cuil": "20-32786693-2"})

        self.assertEqual(request, SearchRequest(identifier="20327866932", tipo="S"))

    def test_parse_search_request_accepts_explicit_tipo(self) -> None:
        request = parse_search_request({"cuit": "32786693", "tipo": "m"})

        self.assertEqual(request, SearchRequest(identifier="32786693", tipo="M"))

    def test_build_output_payload_preserves_raw_data(self) -> None:
        payload = build_output_payload(
            {
                "ok": True,
                "found": True,
                "identifier": "32786693",
                "tipo": "M",
                "token_source": "cache",
                "data": {"nombre": "JUAN PEREZ"},
                "error": "",
            }
        )

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["data_json"], '{"nombre":"JUAN PEREZ"}')
        self.assertIn('"source":"pypdatos_persona"', payload["response_json"])

    def test_build_error_result_uses_request_context(self) -> None:
        result = build_error_result(SearchRequest(identifier="32786693", tipo="M"), "boom")

        self.assertFalse(result["ok"])
        self.assertEqual(result["identifier"], "32786693")
        self.assertEqual(result["tipo"], "M")
        self.assertEqual(result["error"], "boom")

    def test_consultar_empleador_reuses_cached_token(self) -> None:
        config = ConsultaEmpleadorConfig(
            usuario="user",
            password="pass",
            login_url="https://example.test/login",
            persona_url="https://example.test/persona",
            timeout_seconds=30.0,
            cached_token="cached-token",
        )
        response = Mock()
        response.status_code = 200
        response.json.return_value = {"empleador": "ACME"}
        session = Mock()
        session.post.return_value = response

        with patch("consulta_empleador.service.requests.Session", return_value=session):
            result = consultar_empleador(SearchRequest("32786693", "M"), config)

        self.assertTrue(result["ok"])
        self.assertEqual(result["token_source"], "cache")
        self.assertFalse(result["token_cache_should_persist"])
        session.post.assert_called_once()

    def test_consultar_empleador_refreshes_expired_cached_token(self) -> None:
        config = ConsultaEmpleadorConfig(
            usuario="user",
            password="pass",
            login_url="https://example.test/login",
            persona_url="https://example.test/persona",
            timeout_seconds=30.0,
            cached_token="expired-token",
        )
        expired = Mock()
        expired.status_code = 401
        expired.json.return_value = {"msg": "Token no valido"}
        login = Mock()
        login.status_code = 200
        login.json.return_value = {"token": "fresh-token"}
        ok = Mock()
        ok.status_code = 200
        ok.json.return_value = {"empleador": "ACME"}
        session = Mock()
        session.post.side_effect = [expired, login, ok]

        with patch("consulta_empleador.service.requests.Session", return_value=session):
            result = consultar_empleador(SearchRequest("32786693", "M"), config)

        self.assertTrue(result["ok"])
        self.assertEqual(result["token_source"], "login")
        self.assertTrue(result["token_cache_should_persist"])


if __name__ == "__main__":
    unittest.main()
