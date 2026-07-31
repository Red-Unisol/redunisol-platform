from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

FILES_ROOT = Path(__file__).resolve().parent.parent / "files"
if str(FILES_ROOT) not in sys.path:
    sys.path.insert(0, str(FILES_ROOT))

from arca_padron_a13.service import (  # noqa: E402
    ArcaConfig,
    ConfigurationError,
    InvalidRequestError,
    SearchRequest,
    build_error_result,
    build_login_ticket_request,
    build_output_payload,
    build_ta_cache_ttl,
    consultar_padron,
    format_duration_iso8601,
    get_ta,
    is_ta_valid,
    load_config_from_env,
    parse_search_request,
)


class ArcaPadronA13Tests(unittest.TestCase):
    def test_flow_uses_safe_trigger_body_fallback_for_manual_runs(self) -> None:
        flow_source = (
            Path(__file__).resolve().parent.parent
            / "flows"
            / "consulta_padron_a13.yaml"
        ).read_text(encoding="utf-8")

        expected = "trigger is defined and trigger.body is defined"
        self.assertEqual(flow_source.count(expected), 1)
        self.assertIn(
            "({'cuit_cuil': inputs.cuit_cuil ?? ''} | json)",
            flow_source,
        )
        self.assertNotIn(
            "inputs.cuit_cuil ? ({'cuit_cuil': inputs.cuit_cuil} | json)",
            flow_source,
        )

    def test_parse_search_request_accepts_cuit_cuil_key(self) -> None:
        request = parse_search_request({"cuit_cuil": "20-35966130-5"})
        self.assertEqual(request.cuit_cuil, "20359661305")

    def test_parse_search_request_accepts_string_body(self) -> None:
        request = parse_search_request("20-35966130-5")
        self.assertEqual(request.cuit_cuil, "20359661305")

    def test_parse_search_request_rejects_non_11_digit_identifiers(self) -> None:
        with self.assertRaises(InvalidRequestError):
            parse_search_request({"cuit_cuil": "35966130"})

    def test_parse_search_request_missing_body_raises_invalid_request(self) -> None:
        with self.assertRaises(InvalidRequestError):
            parse_search_request(None)

    def test_build_login_ticket_request_embeds_service_name(self) -> None:
        xml = build_login_ticket_request("ws_sr_padron_a13").decode("utf-8")
        self.assertIn("<service>ws_sr_padron_a13</service>", xml)
        self.assertIn("<loginTicketRequest version=\"1.0\">", xml)

    def test_build_output_payload_preserves_persona_fields(self) -> None:
        payload = build_output_payload(
            {
                "ok": True,
                "found": True,
                "status": "found",
                "cuit_cuil": "20359661305",
                "cuit_representada": "33708707029",
                "ta_expiration_time": "2026-04-17T00:34:22.465-03:00",
                "response": {"metadata": {"servidor": "linux11b"}},
                "persona": {
                    "idPersona": "20359661305",
                    "nombre": "NICOLAS",
                    "apellido": "SALLITTO",
                    "estadoClave": "ACTIVO",
                    "fechaNacimiento": "1986-01-04T12:00:00-03:00",
                    "tipoPersona": "FISICA",
                    "tipoClave": "CUIT",
                    "numeroDocumento": "35966130",
                },
                "error": "",
            }
        )

        self.assertTrue(payload["ok"])
        self.assertTrue(payload["found"])
        self.assertEqual(payload["status"], "found")
        self.assertEqual(payload["nombre"], "NICOLAS")
        self.assertEqual(payload["apellido"], "SALLITTO")
        self.assertEqual(payload["id_persona"], "20359661305")
        self.assertEqual(payload["fecha_nacimiento"], "1986-01-04")
        self.assertIn('"source":"arca_padron_a13"', payload["response_json"])

    def test_build_error_result_defaults_to_empty_request(self) -> None:
        payload = build_output_payload(build_error_result(None, "boom"))
        self.assertFalse(payload["ok"])
        self.assertFalse(payload["found"])
        self.assertEqual(payload["status"], "technical_error")
        self.assertEqual(payload["error"], "boom")
        self.assertEqual(payload["cuit_cuil"], "")

    def test_consultar_padron_maps_clave_inexistente_to_not_found(self) -> None:
        config = ArcaConfig(
            cuit_representada="33708707029",
            cert_pem=b"cert",
            key_pem=b"key",
            timeout_seconds=60.0,
            cached_ta={},
        )

        with (
            patch(
                "arca_padron_a13.service.get_ta",
                return_value=(
                    {
                        "token": "cached-token",
                        "sign": "cached-sign",
                        "expirationTime": "2099-01-01T00:00:00+00:00",
                    },
                    "cache",
                    False,
                    "",
                ),
            ),
            patch(
                "arca_padron_a13.service.call_get_persona",
                side_effect=RuntimeError(
                    "A13 fault: La Clave (CUIT/CUIL) consultada es inexistente"
                ),
            ),
        ):
            result = consultar_padron(SearchRequest("20999999999"), config)

        self.assertTrue(result["ok"])
        self.assertFalse(result["found"])
        self.assertEqual(result["status"], "not_found")
        self.assertEqual(result["ta_source"], "cache")

    def test_load_config_from_env_missing_credentials_raises_configuration_error(
        self,
    ) -> None:
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(ConfigurationError):
                load_config_from_env()

    def test_get_ta_reuses_cached_ticket_when_still_valid(self) -> None:
        config = ArcaConfig(
            cuit_representada="33708707029",
            cert_pem=b"cert",
            key_pem=b"key",
            timeout_seconds=60.0,
            cached_ta={
                "token": "cached-token",
                "sign": "cached-sign",
                "expirationTime": "2099-01-01T00:00:00+00:00",
            },
        )

        with patch("arca_padron_a13.service.request_ta") as request_ta:
            ta, source, should_persist, ttl = get_ta(config)

        self.assertEqual(ta["token"], "cached-token")
        self.assertEqual(source, "cache")
        self.assertFalse(should_persist)
        self.assertEqual(ttl, "")
        request_ta.assert_not_called()

    def test_is_ta_valid_rejects_expiring_ticket(self) -> None:
        self.assertFalse(
            is_ta_valid(
                {
                    "token": "t",
                    "sign": "s",
                    "expirationTime": "2026-04-17T00:01:00+00:00",
                },
                now=datetime.fromisoformat("2026-04-17T00:00:00+00:00"),
            )
        )

    def test_build_ta_cache_ttl_returns_iso_duration(self) -> None:
        ttl = build_ta_cache_ttl(
            "2026-04-17T03:05:10+00:00",
            now=datetime.fromisoformat("2026-04-17T00:00:00+00:00"),
        )
        self.assertEqual(ttl, "PT3H4M10S")

    def test_format_duration_iso8601(self) -> None:
        duration = timedelta(hours=2, minutes=1, seconds=5)
        self.assertEqual(format_duration_iso8601(duration), "PT2H1M5S")


if __name__ == "__main__":
    unittest.main()
