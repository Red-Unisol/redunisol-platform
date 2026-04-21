from __future__ import annotations

from pathlib import Path
import sys
import unittest

FILES_ROOT = (
    Path(__file__).resolve().parent.parent / "files"
)
if str(FILES_ROOT) not in sys.path:
    sys.path.insert(0, str(FILES_ROOT))

from consulta_quiebra_credix.service import (  # noqa: E402
    SearchRequest,
    _find_detail_next_control,
    build_error_result,
    build_output_payload,
    build_single_result,
    _is_detail_summary_page,
    normalize_cuit,
    normalize_name,
    parse_search_request,
)


class ConsultaQuiebraCredixTests(unittest.TestCase):
    def test_parse_search_request_normalizes_fields(self) -> None:
        request = parse_search_request(
            {
                "cuit": "20-12345678-3",
                "nombre": "  Juan   Perez  ",
            }
        )

        self.assertEqual(request.cuit, "20123456783")
        self.assertEqual(request.nombre, "Juan Perez")

    def test_parse_search_request_accepts_plain_string_as_cuit(self) -> None:
        request = parse_search_request("20-12345678-3")

        self.assertEqual(request.cuit, "20123456783")
        self.assertEqual(request.nombre, "")

    def test_parse_search_request_requires_at_least_one_criterion(self) -> None:
        with self.assertRaisesRegex(ValueError, "At least one of 'cuit' or 'nombre' is required."):
            parse_search_request({"cuit": "", "nombre": " "})

    def test_build_output_payload_for_single_result_preserves_legacy_shape(self) -> None:
        request = SearchRequest(cuit="20123456783", nombre="Juan Perez")
        result = build_single_result(
            request,
            [
                {
                    "fecha": "2026-04-06",
                    "fuente": "Boletin",
                    "id": "123",
                    "resumen": "Sin novedades",
                }
            ],
        )

        output = build_output_payload(result)

        self.assertTrue(output["ok"])
        self.assertEqual(output["status"], "single")
        self.assertEqual(
            output["response_json"],
            '{"status":"single","data":[{"fecha":"2026-04-06","fuente":"Boletin","id":"123","resumen":"Sin novedades"}]}',
        )

    def test_build_single_result_prefers_scraped_name_when_provided(self) -> None:
        request = SearchRequest(cuit="26967652", nombre="")

        result = build_single_result(
            request,
            [],
            nombre="GORONDON MARCELA VIVIANA",
        )

        self.assertEqual(result["nombre"], "GORONDON MARCELA VIVIANA")

    def test_build_output_payload_for_errors_sets_error_response(self) -> None:
        result = build_error_result(None, "boom")

        output = build_output_payload(result)

        self.assertFalse(output["ok"])
        self.assertEqual(output["status"], "error")
        self.assertEqual(output["response_json"], '{"status":"error","error":"boom"}')
        self.assertEqual(output["error"], "boom")

    def test_normalizers_strip_noise(self) -> None:
        self.assertEqual(normalize_cuit("20-12345678-3"), "20123456783")
        self.assertEqual(normalize_name("  Maria   del  Mar "), "Maria del Mar")

    def test_is_detail_summary_page_detects_credix_detail_view(self) -> None:
        class BodyLocator:
            def inner_text(self, timeout=None):
                return "Resumen (*)\nDatos Filiatorios\nDatos Fiscales"

        class StubPage:
            url = "https://www.credixsa.com/nuevo/con_cuit3.php"

            def locator(self, selector):
                self.last_selector = selector
                return BodyLocator()

        self.assertTrue(_is_detail_summary_page(StubPage()))

    def test_find_detail_next_control_accepts_visible_button_with_text(self) -> None:
        class StubLocator:
            def __init__(self, visible):
                self.visible = visible
                self.first = self

            def count(self):
                return 1 if self.visible else 0

            def is_visible(self):
                return self.visible

        class StubPage:
            def locator(self, selector, has_text=None):
                if selector == "button" and has_text == "Siguiente":
                    return StubLocator(True)
                return StubLocator(False)

        self.assertIsNotNone(_find_detail_next_control(StubPage()))


if __name__ == "__main__":
    unittest.main()
