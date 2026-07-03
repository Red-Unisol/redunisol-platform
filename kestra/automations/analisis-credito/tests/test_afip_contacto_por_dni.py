from __future__ import annotations

from pathlib import Path
import sys
import unittest

FILES_ROOT = Path(__file__).resolve().parent.parent / "files"
if str(FILES_ROOT) not in sys.path:
    sys.path.insert(0, str(FILES_ROOT))

from afip_contacto_por_dni.service import (  # noqa: E402
    SearchRequest,
    build_error_result,
    build_output_payload,
    parse_search_request,
)


class AfipContactoPorDniTests(unittest.TestCase):
    def test_flow_uses_safe_trigger_body_fallback_for_manual_runs(self) -> None:
        flow_source = (
            Path(__file__).resolve().parent.parent
            / "flows"
            / "afip_contacto_por_dni.yaml"
        ).read_text(encoding="utf-8")

        expected = "trigger is defined and trigger.body is defined"
        self.assertEqual(flow_source.count(expected), 1)
        self.assertIn(
            "({'dni': inputs.dni ?? '', 'tipo_doc': inputs.tipo_doc ?? ''} | json)",
            flow_source,
        )
        self.assertNotIn(
            "TRIGGER_BODY_JSON: \"{{ trigger.body | json }}\"",
            flow_source,
        )

    def test_parse_search_request_accepts_object(self) -> None:
        request = parse_search_request({"dni": "34.838.205", "tipo_doc": 96})

        self.assertEqual(request, SearchRequest(dni="34838205", tipo_doc="96"))

    def test_parse_search_request_accepts_scalar(self) -> None:
        request = parse_search_request("34.838.205")

        self.assertEqual(request, SearchRequest(dni="34838205", tipo_doc="96"))

    def test_build_output_payload_preserves_minimal_response_shape(self) -> None:
        payload = build_output_payload(
            {
                "ok": True,
                "status": "found",
                "found": True,
                "dni": "34838205",
                "tipo_doc": "96",
                "cuil": "27348382050",
                "nombre": "LOPEZ MARINA VICTORIA BELEN",
                "raw_response": {"result": "success"},
                "error": "",
            }
        )

        self.assertEqual(
            payload["response_json"],
            '{"ok":true,"found":true,"dni":"34838205","tipo_doc":"96","cuil":"27348382050","nombre":"LOPEZ MARINA VICTORIA BELEN","error":"","source":"afip_crmcit"}',
        )
        self.assertEqual(payload["status"], "found")

    def test_build_error_result_marks_request_as_failed(self) -> None:
        result = build_error_result(SearchRequest(dni="34838205", tipo_doc="96"), "boom")

        self.assertFalse(result["ok"])
        self.assertFalse(result["found"])
        self.assertEqual(result["dni"], "34838205")
        self.assertEqual(result["error"], "boom")


if __name__ == "__main__":
    unittest.main()
