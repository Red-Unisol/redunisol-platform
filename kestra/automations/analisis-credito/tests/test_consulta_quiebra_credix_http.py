from __future__ import annotations

from pathlib import Path
import sys
import unittest

FILES_ROOT = (
    Path(__file__).resolve().parent.parent / "files"
)
if str(FILES_ROOT) not in sys.path:
    sys.path.insert(0, str(FILES_ROOT))

from consulta_quiebra_credix_http.service import (  # noqa: E402
    CredixConfig,
    SearchRequest,
    _build_login_payload,
    _extract_candidates,
    _extract_edicts,
    _is_detail_summary_page,
    build_output_payload,
    build_single_result,
    parse_search_request,
)


class ConsultaQuiebraCredixHttpTests(unittest.TestCase):
    def test_parse_search_request_normalizes_fields(self) -> None:
        request = parse_search_request({"cuit": "20-12345678-3", "nombre": "  Juan   Perez "})

        self.assertEqual(request.cuit, "20123456783")
        self.assertEqual(request.nombre, "Juan Perez")

    def test_build_login_payload_preserves_hidden_inputs(self) -> None:
        html = """
        <html>
          <body>
            <form action="login.php">
              <input type="hidden" name="token" value="abc123" />
              <input type="text" name="cdxcliente" value="" />
              <input type="text" name="cdxusername" value="" />
              <input type="password" name="cdxpassword" value="" />
            </form>
          </body>
        </html>
        """

        config = CredixConfig(
            cliente="cliente",
            usuario="usuario",
            password="secreto",
            login_url="https://www.credixsa.com/nuevo/login.php",
            timeout_ms=30000,
            debug_enabled=False,
        )

        payload, action = _build_login_payload(html, config.login_url, config)

        self.assertEqual(action, "https://www.credixsa.com/nuevo/login.php")
        self.assertEqual(payload["token"], "abc123")
        self.assertEqual(payload["cdxcliente"], "cliente")
        self.assertEqual(payload["cdxusername"], "usuario")
        self.assertEqual(payload["cdxpassword"], "secreto")

    def test_extract_candidates_reads_result_rows(self) -> None:
        html = """
        <html>
          <body>
            <table>
              <tbody>
                <tr>
                  <td><a href="con_cuit_pde_ajax.php?tipo=Rg==">27-26967652-9</a></td>
                  <td>GORONDON MARCELA VIVIANA</td>
                  <td>26.967.652</td>
                </tr>
              </tbody>
            </table>
          </body>
        </html>
        """

        rows = _extract_candidates(html, "https://www.credixsa.com/nuevo/con_cuit.php")

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].cuit, "27-26967652-9")
        self.assertEqual(rows[0].nombre, "GORONDON MARCELA VIVIANA")
        self.assertEqual(rows[0].documento, "26.967.652")
        self.assertEqual(
            rows[0].link_url,
            "https://www.credixsa.com/nuevo/con_cuit_pde_ajax.php?tipo=Rg==",
        )

    def test_extract_edicts_reads_detail_rows(self) -> None:
        html = """
        <html>
          <body>
            <table class="table table-sm table-striped table-bordered">
              <thead>
                <tr><th colspan="4">Edictos judiciales</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>20/02/2017</td>
                  <td>B.O. Santa Fe</td>
                  <td></td>
                  <td>Resumen del edicto</td>
                </tr>
              </tbody>
            </table>
          </body>
        </html>
        """

        data = _extract_edicts(html)

        self.assertEqual(
            data,
            [
                {
                    "fecha": "20/02/2017",
                    "fuente": "B.O. Santa Fe",
                    "id": "",
                    "resumen": "Resumen del edicto",
                }
            ],
        )

    def test_is_detail_summary_page_detects_credix_detail_view(self) -> None:
        html = "<html><body>Resumen (*) Datos Filiatorios Datos Fiscales</body></html>"
        self.assertTrue(_is_detail_summary_page(html, "https://www.credixsa.com/nuevo/con_cuit3.php"))

    def test_build_output_payload_for_single_result_preserves_legacy_shape(self) -> None:
        request = SearchRequest(cuit="20123456783", nombre="Juan Perez")
        result = build_single_result(
            request,
            [{"fecha": "2026-04-06", "fuente": "Boletin", "id": "123", "resumen": "Sin novedades"}],
        )

        output = build_output_payload(result)

        self.assertTrue(output["ok"])
        self.assertEqual(output["status"], "single")
        self.assertEqual(
            output["response_json"],
            '{"status":"single","data":[{"fecha":"2026-04-06","fuente":"Boletin","id":"123","resumen":"Sin novedades"}]}',
        )


if __name__ == "__main__":
    unittest.main()