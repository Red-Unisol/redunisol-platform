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
    SearchRequest,
    build_error_result,
    build_login_ticket_request,
    build_output_payload,
    build_ta_cache_ttl,
    format_duration_iso8601,
    get_ta,
    is_ta_valid,
    parse_search_request,
)


class ArcaPadronA13Tests(unittest.TestCase):
    def test_parse_search_request_accepts_cuit_cuil_key(self) -> None:
        request = parse_search_request({"cuit_cuil": "20-35966130-5"})
        self.assertEqual(request.cuit_cuil, "20359661305")

    def test_parse_search_request_accepts_string_body(self) -> None:
        request = parse_search_request("20-35966130-5")
        self.assertEqual(request.cuit_cuil, "20359661305")

    def test_parse_search_request_rejects_non_11_digit_identifiers(self) -> None:
        with self.assertRaises(ValueError):
            parse_search_request({"cuit_cuil": "35966130"})

    def test_build_login_ticket_request_embeds_service_name(self) -> None:
        xml = build_login_ticket_request("ws_sr_padron_a13").decode("utf-8")
        self.assertIn("<service>ws_sr_padron_a13</service>", xml)
        self.assertIn("<loginTicketRequest version=\"1.0\">", xml)

    def test_build_output_payload_preserves_persona_fields(self) -> None:
        payload = build_output_payload(
            {
                "ok": True,
                "cuit_cuil": "20359661305",
                "cuit_representada": "33708707029",
                "ta_expiration_time": "2026-04-17T00:34:22.465-03:00",
                "response": {"metadata": {"servidor": "linux11b"}},
                "persona": {
                    "idPersona": "20359661305",
                    "nombre": "NICOLAS",
                    "apellido": "SALLITTO",
                    "estadoClave": "ACTIVO",
                    "tipoPersona": "FISICA",
                    "tipoClave": "CUIT",
                    "numeroDocumento": "35966130",
                },
                "error": "",
            }
        )

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["nombre"], "NICOLAS")
        self.assertEqual(payload["apellido"], "SALLITTO")
        self.assertEqual(payload["id_persona"], "20359661305")

    def test_build_error_result_defaults_to_empty_request(self) -> None:
        payload = build_output_payload(build_error_result(None, "boom"))
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"], "boom")
        self.assertEqual(payload["cuit_cuil"], "")

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
