from __future__ import annotations

from pathlib import Path
import sys
import unittest

FILES_ROOT = Path(__file__).resolve().parent.parent / "files"
if str(FILES_ROOT) not in sys.path:
    sys.path.insert(0, str(FILES_ROOT))

from arca_padron_a13.service import (  # noqa: E402
    SearchRequest,
    build_error_result,
    build_login_ticket_request,
    build_output_payload,
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


if __name__ == "__main__":
    unittest.main()
