from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest
import json
import sqlite3

FILES_ROOT = (
    Path(__file__).resolve().parent.parent / "files"
)
if str(FILES_ROOT) not in sys.path:
    sys.path.insert(0, str(FILES_ROOT))

from consulta_quiebra_credix.service import (  # noqa: E402
    SearchRequest,
    build_cache_entry,
    build_cache_lookup,
    _find_detail_next_control,
    _normalize_report_section,
    _refresh_online_updates_if_available,
    build_error_result,
    build_output_payload,
    build_single_result,
    cache_key_for_cuil,
    cache_key_for_name,
    cached_result_if_fresh,
    find_cached_result_in_payloads,
    _is_detail_summary_page,
    normalize_cuit,
    normalize_name,
    parse_search_request,
)
from consulta_quiebra_credix.sqlite_cache import write_cache_entries  # noqa: E402


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
                    "index": 1,
                    "title": "Datos Filiatorios",
                    "source": "",
                    "headers": [],
                    "rows": [["Cuil", "20-12345678-3"]],
                    "records": [{"Cuil": "20-12345678-3"}],
                    "text": "Datos Filiatorios Cuil 20-12345678-3",
                }
            ],
        )

        output = build_output_payload(result)

        self.assertTrue(output["ok"])
        self.assertEqual(output["status"], "single")
        self.assertIn('"persona"', output["normalized_json"])
        self.assertEqual(
            output["response_json"],
            '{"status":"single","data":[{"index":1,"title":"Datos Filiatorios","source":"","headers":[],"rows":[["Cuil","20-12345678-3"]],"records":[{"Cuil":"20-12345678-3"}],"text":"Datos Filiatorios Cuil 20-12345678-3"}]}',
        )

    def test_build_output_payload_normalizes_priority_sections(self) -> None:
        request = SearchRequest(cuit="27364371980", nombre="")
        result = build_single_result(
            request,
            [
                {
                    "index": 1,
                    "title": "Datos Filiatorios",
                    "source": "",
                    "headers": [],
                    "rows": [
                        ["Datos Filiatorios"],
                        ["Documento", "36.437.198"],
                        ["Sexo", "Femenino"],
                        ["Edad", "34 (07/11/1991)"],
                        ["Nombre", "VALDEZ MARIANA DEL VALLE"],
                        ["Domicilio", "60 VIV C 21 - TINOGASTA - TINOGASTA - CATAMARCA"],
                    ],
                    "records": [
                        {"Documento": "36.437.198"},
                        {"Sexo": "Femenino"},
                        {"Edad": "34 (07/11/1991)"},
                        {"Nombre": "VALDEZ MARIANA DEL VALLE"},
                        {"Domicilio": "60 VIV C 21 - TINOGASTA - TINOGASTA - CATAMARCA"},
                    ],
                    "text": "",
                },
                {
                    "index": 2,
                    "title": "Resumen (*)",
                    "source": "",
                    "headers": [],
                    "rows": [
                        ["Resumen (*)"],
                        ["Resumen (*)", "Rojo"],
                        ["Código: 81079 Detalle (*)", "Situacion Historica ultimos 24 meses en Sistema Financiero (5)"],
                    ],
                    "records": [
                        {"Resumen (*)": "Rojo"},
                        {"Código: 81079 Detalle (*)": "Situacion Historica ultimos 24 meses en Sistema Financiero (5)"},
                    ],
                    "text": "",
                },
                {
                    "index": 3,
                    "title": "Deudas Vigentes Sistema Financiero Fuente: BCRA",
                    "source": "BCRA",
                    "headers": [],
                    "rows": [
                        ["Deudas Vigentes Sistema Financiero Fuente: BCRA"],
                        ["Situación", "Entidad", "Período", "Monto ($)"],
                        ["1", "100.0%", "BANCO DE LA NACION ARGENTINA", "03 / 2026", "7.371.000", "95.9%"],
                        ["TARJETA NARANJA S.A.", "03 / 2026", "317.000", "4.1%"],
                        ["TOTAL Deudas Vigentes", "$ 7.688.000"],
                    ],
                    "records": [],
                    "text": "",
                },
                {
                    "index": 4,
                    "title": "Situación Previsional - Empleador 1 (*) Fuente: Afip - Aportes en línea",
                    "source": "Afip - Aportes en línea",
                    "headers": [],
                    "rows": [
                        ["Situación Previsional - Empleador 1 (*) Fuente: Afip - Aportes en línea"],
                        ["Empleador", "30-63651135-4 - TESORERIA GENERAL DE LA PROVINCIA"],
                        ["Actividad", "SERVICIOS GENERALES DE LA ADMINISTRACIÓN PÚBLICA"],
                        ["Domicilio", "AVENIDA REPUBLICA DE VENEZUELA S/N - SAN FERNANDO DEL VALLE DE CATAMARCA - CATAMARCA"],
                    ],
                    "records": [
                        {"Empleador": "30-63651135-4 - TESORERIA GENERAL DE LA PROVINCIA"},
                        {"Actividad": "SERVICIOS GENERALES DE LA ADMINISTRACIÓN PÚBLICA"},
                        {"Domicilio": "AVENIDA REPUBLICA DE VENEZUELA S/N - SAN FERNANDO DEL VALLE DE CATAMARCA - CATAMARCA"},
                    ],
                    "text": "",
                },
                {
                    "index": 5,
                    "title": "Registraciones - Período: 03/2026 al 05/2026 Fuente: Anses en línea",
                    "source": "Anses en línea",
                    "headers": [],
                    "rows": [
                        ["Registraciones - Período: 03/2026 al 05/2026 Fuente: Anses en línea"],
                        ["Declaraciones Juradas como Trabajador en Actividad."],
                    ],
                    "records": [],
                    "text": "",
                },
                {
                    "index": 6,
                    "title": "Edictos judiciales",
                    "source": "",
                    "headers": [],
                    "rows": [
                        ["Edictos judiciales"],
                        ["20/02/2017", "B.O. Santa Fe", "", "Resumen del edicto"],
                    ],
                    "records": [],
                    "text": "",
                },
            ],
            cuit="27364371980",
            nombre="VALDEZ MARIANA DEL VALLE",
        )

        output = build_output_payload(result)
        normalized = json.loads(output["normalized_json"])

        self.assertEqual(normalized["persona"]["nombre_completo"], "VALDEZ MARIANA DEL VALLE")
        self.assertEqual(normalized["persona"]["edad"], "34")
        self.assertEqual(normalized["persona"]["fecha_nacimiento"], "07/11/1991")
        self.assertEqual(normalized["persona"]["localidad"], "TINOGASTA")
        self.assertEqual(normalized["bcra"]["resumen"]["color"], "Rojo")
        self.assertEqual(normalized["bcra"]["deuda_vigente_total"], "$ 7.688.000")
        self.assertEqual(normalized["bcra"]["deudas_vigentes"][0]["entidad"], "BANCO DE LA NACION ARGENTINA")
        self.assertEqual(normalized["previsional"]["empleadores"][0]["cuit"], "30636511354")
        self.assertEqual(normalized["aportes"]["registraciones"][0]["periodo"], "03/2026 al 05/2026")
        self.assertEqual(normalized["quiebras"]["edictos"][0]["fuente"], "B.O. Santa Fe")

    def test_build_output_payload_normalizes_bcra_24_month_history(self) -> None:
        result = build_single_result(
            SearchRequest(cuit="20284049846", nombre=""),
            [
                {
                    "index": 1,
                    "title": "Deudas en el Sistema Financiero (Ultimos 24 meses publicados) Fuente: BCRA",
                    "source": "BCRA",
                    "headers": ["Entidad", "2026", "2025", "2024", "Ultimo monto informado", "Obs."],
                    "rows": [
                        ["Deudas en el Sistema Financiero (Ultimos 24 meses publicados) Fuente: BCRA"],
                        ["Entidad", "2026", "2025", "2024", "Ultimo monto informado", "Obs."],
                        ["Mar", "Feb", "Ene", "Dic", "Nov", "Oct", "Set", "Ago", "Jul", "Jun", "May", "Abr", "Mar", "Feb", "Ene", "Dic", "Nov", "Oct", "Set", "Ago", "Jul", "Jun", "May", "Abr"],
                        ["GPAT COMPAÑIA FINANCIERA S.A.U.", "5", "5", "4", "4", "4", "4", "4", "4", "3", "2", "2", "1", "1", "1", "1", "1", "-", "-", "-", "-", "-", "-", "-", "-", "2.886.000"],
                        ["CREDLAP S.A.", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "1", "-", "-", "-", "-", "-", "317.000"],
                    ],
                    "records": [],
                    "text": "",
                },
                {
                    "index": 2,
                    "title": "Deudas Vigentes Sistema Financiero Fuente: BCRA",
                    "source": "BCRA",
                    "headers": ["Situación", "Entidad", "Período", "Monto ($)"],
                    "rows": [
                        ["Deudas Vigentes Sistema Financiero Fuente: BCRA"],
                        ["Situación", "Entidad", "Período", "Monto ($)"],
                        ["5", "35.1%", "GPAT COMPAÑIA FINANCIERA S.A.U.", "03 / 2026", "2.886.000", "17.1%"],
                        ["TOTAL Deudas Vigentes", "$ 2.886.000"],
                    ],
                    "records": [],
                    "text": "",
                },
            ],
            cuit="20284049846",
            nombre="GRAMOY ELIAS SAUL",
        )

        normalized = json.loads(build_output_payload(result)["normalized_json"])
        history = normalized["bcra"]["deudas_24_meses"]

        self.assertEqual(history["anios"], [
            {"anio": "2026", "span": 3},
            {"anio": "2025", "span": 12},
            {"anio": "2024", "span": 9},
        ])
        self.assertEqual(history["meses"][:4], ["Mar", "Feb", "Ene", "Dic"])
        self.assertEqual(history["filas"][0]["ultimo_monto_informado"], "2.886.000")
        self.assertTrue(history["filas"][0]["activa"])
        self.assertFalse(history["filas"][1]["activa"])

    def test_build_output_payload_normalizes_bcra_entity_evolution_matrix(self) -> None:
        result = build_single_result(
            SearchRequest(cuit="20284049846", nombre=""),
            [
                {
                    "index": 1,
                    "title": "Deudas en el Sistema Financiero (Ultimos 24 meses publicados) Fuente: BCRA",
                    "source": "BCRA",
                    "headers": ["Entidad", "2026", "2025", "Ultimo monto informado", "Obs."],
                    "rows": [
                        ["Deudas en el Sistema Financiero (Ultimos 24 meses publicados) Fuente: BCRA"],
                        ["Entidad", "2026", "2025", "Ultimo monto informado", "Obs."],
                        ["Mar", "Feb", "Ene", "Dic"],
                        ["GPAT COMPAÑIA FINANCIERA S.A.U.", "5", "5", "4", "4", "2.886.000"],
                        ["BANCO DE LA PROVINCIA DE CORDOBA S.A.", "1", "1", "1", "1", "10.603.000"],
                        ["CREDLAP S.A.", "-", "-", "-", "1", "317.000"],
                    ],
                    "records": [],
                    "text": "",
                },
                {
                    "index": 2,
                    "title": "Evolución deuda Sistema Financiero por Entidad Fuente: BCRA",
                    "source": "BCRA",
                    "headers": [
                        "Período",
                        "GPAT COMPAÑIA FINANCIERA",
                        "BANCO PROVINCIA DE CORDOBA",
                        "CREDLAP S.A.",
                    ],
                    "rows": [
                        ["Evolución deuda Sistema Financiero por Entidad Fuente: BCRA"],
                        [
                            "Período",
                            "GPAT COMPAÑIA FINANCIERA",
                            "BANCO PROVINCIA DE CORDOBA",
                            "CREDLAP S.A.",
                        ],
                        ["03/2026", "$ 2.886.000", "$ 10.603.000"],
                        ["12/2025", "$ 2.886.000", "$ 10.990.000", "$ 317.000"],
                    ],
                    "records": [],
                    "text": "",
                },
            ],
            cuit="20284049846",
            nombre="GRAMOY ELIAS SAUL",
        )

        normalized = json.loads(build_output_payload(result)["normalized_json"])
        evolution = normalized["bcra"]["evolucion_deuda_por_entidad"]

        self.assertEqual(evolution["entidades"][1], "BANCO PROVINCIA DE CORDOBA")
        self.assertEqual(evolution["filas"][0]["celdas"][0]["monto"], "$ 2.886.000")
        self.assertEqual(evolution["filas"][0]["celdas"][1]["monto"], "$ 10.603.000")
        self.assertEqual(evolution["filas"][0]["celdas"][2]["monto"], "")
        self.assertEqual(evolution["filas"][1]["celdas"][2]["monto"], "$ 317.000")
        self.assertEqual(evolution["filas"][0]["celdas"][0]["situacion"], "5")
        self.assertEqual(evolution["filas"][0]["celdas"][1]["situacion"], "1")

    def test_build_output_payload_normalizes_previsional_employer_period_table(self) -> None:
        result = build_single_result(
            SearchRequest(cuit="20284049846", nombre=""),
            [
                {
                    "index": 25,
                    "title": "Situación Previsional - Empleador 1 Fuente: Afip - Aportes en línea",
                    "source": "Afip - Aportes en línea",
                    "headers": [],
                    "rows": [
                        ["Situación Previsional - Empleador 1 Fuente: Afip - Aportes en línea"],
                        ["Empleador", "33-99925244-9 - MINISTERIO DE EDUCACION"],
                        [
                            "Actividad",
                            "SERVICIOS GENERALES DE LA ADMINISTRACIÓN PÚBLICA",
                        ],
                        [
                            "Domicilio",
                            "SANTA ROSA 751 Piso:3 - (5000) BARRIO CENTRO NORTE - CORDOBA",
                        ],
                    ],
                    "records": [
                        {"Empleador": "33-99925244-9 - MINISTERIO DE EDUCACION"},
                        {"Actividad": "SERVICIOS GENERALES DE LA ADMINISTRACIÓN PÚBLICA"},
                        {"Domicilio": "SANTA ROSA 751 Piso:3 - (5000) BARRIO CENTRO NORTE - CORDOBA"},
                    ],
                    "text": "",
                },
                {
                    "index": 26,
                    "title": "Período",
                    "source": "",
                    "headers": [
                        "Período",
                        "Incluído en declaración jurada",
                        "Aportes de seguridad social",
                        "Aportes de obra social",
                        "Contribución patronal de obra social",
                    ],
                    "rows": [
                        [
                            "Período",
                            "Incluído en declaración jurada",
                            "Aportes de seguridad social",
                            "Aportes de obra social",
                            "Contribución patronal de obra social",
                        ],
                        ["04/2025", "SI", "INFORMATIVO", "INFORMATIVO", "INFORMATIVO"],
                        ["05/2025", "SI", "INFORMATIVO", "INFORMATIVO", "INFORMATIVO"],
                    ],
                    "records": [
                        {
                            "Período": "04/2025",
                            "Incluído en declaración jurada": "SI",
                            "Aportes de seguridad social": "INFORMATIVO",
                            "Aportes de obra social": "INFORMATIVO",
                            "Contribución patronal de obra social": "INFORMATIVO",
                        }
                    ],
                    "text": "",
                },
            ],
            cuit="20284049846",
            nombre="GRAMOY ELIAS SAUL",
        )

        normalized = json.loads(build_output_payload(result)["normalized_json"])
        situations = normalized["previsional"]["situaciones_por_empleador"]

        self.assertEqual(len(situations), 1)
        self.assertEqual(situations[0]["indice"], "1")
        self.assertEqual(situations[0]["fuente"], "Afip - Aportes en línea")
        self.assertEqual(situations[0]["empleador"]["cuit"], "33999252449")
        self.assertEqual(situations[0]["periodos"][0]["periodo"], "04/2025")
        self.assertEqual(situations[0]["periodos"][0]["incluido_declaracion_jurada"], "SI")
        self.assertEqual(
            situations[0]["periodos"][1]["contribucion_patronal_obra_social"],
            "INFORMATIVO",
        )

    def test_build_output_payload_enriches_cached_previsional_period_table(self) -> None:
        result = {
            "status": "single",
            "cuit": "20284049846",
            "nombre": "GRAMOY ELIAS SAUL",
            "normalized": {
                "persona": {},
                "bcra": {},
                "previsional": {
                    "mensaje": "",
                    "registraciones": [],
                    "empleadores": [
                        {
                            "indice": "1",
                            "cuit": "33999252449",
                            "nombre": "MINISTERIO DE EDUCACION",
                        }
                    ],
                    "obra_sociales": [],
                },
                "aportes": {},
                "quiebras": {},
            },
            "data": [
                {
                    "index": 25,
                    "title": "Situación Previsional - Empleador 1 Fuente: Afip - Aportes en línea",
                    "source": "Afip - Aportes en línea",
                    "rows": [
                        ["Situación Previsional - Empleador 1 Fuente: Afip - Aportes en línea"],
                        ["Empleador", "33-99925244-9 - MINISTERIO DE EDUCACION"],
                    ],
                    "records": [
                        {"Empleador": "33-99925244-9 - MINISTERIO DE EDUCACION"},
                    ],
                },
                {
                    "index": 26,
                    "title": "Período",
                    "rows": [
                        [
                            "Período",
                            "Incluído en declaración jurada",
                            "Aportes de seguridad social",
                            "Aportes de obra social",
                            "Contribución patronal de obra social",
                        ],
                        ["03/2026", "SI", "INFORMATIVO", "INFORMATIVO", "INFORMATIVO"],
                    ],
                    "records": [],
                },
            ],
        }

        normalized = json.loads(build_output_payload(result)["normalized_json"])
        situations = normalized["previsional"]["situaciones_por_empleador"]

        self.assertEqual(len(situations), 1)
        self.assertEqual(situations[0]["empleador"]["cuit"], "33999252449")
        self.assertEqual(situations[0]["empleador"]["nombre"], "MINISTERIO DE EDUCACION")
        self.assertEqual(situations[0]["periodos"][0]["periodo"], "03/2026")

    def test_normalize_report_section_builds_key_value_records(self) -> None:
        section = _normalize_report_section(
            {
                "index": 5,
                "text": "Datos Filiatorios Cuil 20-12345678-3 Documento 12.345.678",
                "rows": [
                    {"cells": [{"text": "Datos Filiatorios", "header": True}], "has_header": True},
                    {
                        "cells": [
                            {"text": "Cuil", "header": True},
                            {"text": "20-12345678-3", "header": False},
                        ],
                        "has_header": True,
                    },
                    {
                        "cells": [
                            {"text": "Documento", "header": True},
                            {"text": "12.345.678", "header": False},
                        ],
                        "has_header": True,
                    },
                ],
            }
        )

        self.assertEqual(section["index"], 5)
        self.assertEqual(section["title"], "Datos Filiatorios")
        self.assertEqual(
            section["records"],
            [{"Cuil": "20-12345678-3"}, {"Documento": "12.345.678"}],
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

    def test_cache_lookup_builds_cuil_and_name_keys(self) -> None:
        lookup = build_cache_lookup({"cuit": "20-12345678-3", "nombre": "  José  Pérez "})

        self.assertEqual(lookup["cuil_cache_key"], "credixsa.cuil.20123456783")
        self.assertEqual(lookup["name_cache_key"], cache_key_for_name("Jose Perez"))
        self.assertNotEqual(lookup["name_cache_lookup_key"], "credixsa.cache.lookup.none")

    def test_cache_entry_round_trips_when_fresh(self) -> None:
        result = build_single_result(
            SearchRequest(cuit="20123456783", nombre=""),
            [{"title": "Datos Filiatorios", "rows": [["Cuil", "20-12345678-3"]]}],
            cuit="20123456783",
            nombre="Juan Perez",
        )

        entry = build_cache_entry(result)
        self.assertIsNotNone(entry)
        cached = cached_result_if_fresh(entry)

        self.assertIsNotNone(cached)
        self.assertEqual(cached["status"], "single")
        self.assertEqual(cached["cuit"], "20123456783")

    def test_cache_key_for_name_is_accent_insensitive(self) -> None:
        self.assertEqual(cache_key_for_name("José   Pérez"), cache_key_for_name("jose perez"))
        self.assertEqual(cache_key_for_cuil("20-12345678-3"), "credixsa.cuil.20123456783")

    def test_find_cached_result_in_payloads_rejects_mismatched_name_hit(self) -> None:
        result = build_single_result(
            SearchRequest(cuit="20999999999", nombre=""),
            [{"title": "Datos Filiatorios", "rows": [["Cuil", "20-99999999-9"]]}],
            cuit="20999999999",
            nombre="Juan Perez",
        )
        cache_entry = build_cache_entry(result)

        cached = find_cached_result_in_payloads(
            SearchRequest(cuit="20123456783", nombre="Juan Perez"),
            None,
            cache_entry,
        )

        self.assertIsNone(cached)

    def test_find_cached_result_in_payloads_returns_cuil_hit(self) -> None:
        result = build_single_result(
            SearchRequest(cuit="20123456783", nombre=""),
            [{"title": "Datos Filiatorios", "rows": [["Cuil", "20-12345678-3"]]}],
            cuit="20123456783",
            nombre="Juan Perez",
        )
        cache_entry = build_cache_entry(result)

        cached = find_cached_result_in_payloads(
            SearchRequest(cuit="20123456783", nombre=""),
            cache_entry,
            None,
        )

        self.assertIsNotNone(cached)
        self.assertTrue(cached["cache_hit"])
        self.assertEqual(cached["cache_source"], "cuil")

    def test_write_cache_entries_persists_sqlite_lookup_rows(self) -> None:
        result = build_single_result(
            SearchRequest(cuit="20123456783", nombre=""),
            [{"title": "Datos Filiatorios", "rows": [["Cuil", "20-12345678-3"]]}],
            cuit="20123456783",
            nombre="Juan Perez",
        )
        cache_entry = build_cache_entry(result)
        self.assertIsNotNone(cache_entry)

        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp_dir:
            db_path = str(Path(tmp_dir) / "credixsa.sqlite")
            written = write_cache_entries(
                db_path,
                [
                    {
                        "key": "credixsa.cuil.20123456783",
                        "value": json.dumps(cache_entry, ensure_ascii=True),
                    }
                ],
            )

            self.assertEqual(written, 1)
            with sqlite3.connect(db_path) as connection:
                row = connection.execute(
                    "SELECT cuit, nombre, payload_json FROM credixsa_cache WHERE lookup_key = ?",
                    ("credixsa.cuil.20123456783",),
                ).fetchone()

        self.assertIsNotNone(row)
        self.assertEqual(row[0], "20123456783")
        self.assertEqual(row[1], "Juan Perez")
        self.assertIn('"version"', row[2])

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

    def test_refresh_online_updates_clicks_update_all_when_available(self) -> None:
        class StubLocator:
            def __init__(self, *, visible=True, text="", enabled=True):
                self.visible = visible
                self.text = text
                self.enabled = enabled
                self.clicked = False
                self.first = self

            def count(self):
                return 1 if self.visible else 0

            def is_visible(self):
                return self.visible

            def is_enabled(self):
                return self.enabled

            def click(self):
                self.clicked = True

            def inner_text(self, timeout=None):
                return self.text

        class StubPage:
            url = "https://www.credixsa.com/nuevo/con_cuit_pde_ajax.php"

            def __init__(self):
                self.update_all = StubLocator()
                self.next_button = StubLocator(enabled=True)
                self.body = StubLocator(text="PASO 3: Actualizaciones en linea")

            def locator(self, selector, has_text=None):
                if selector == "#procesar_todo_auto":
                    return self.update_all
                if selector == "#btn_siguiente":
                    return self.next_button
                if selector == "body":
                    return self.body
                return StubLocator(visible=False)

            def wait_for_load_state(self, state):
                return None

        config = type(
            "Config",
            (),
            {"timeout_ms": 1000, "debug_enabled": False},
        )()
        page = StubPage()

        _refresh_online_updates_if_available(
            page,
            config,
            SearchRequest(cuit="20123456783", nombre=""),
        )

        self.assertTrue(page.update_all.clicked)

    def test_refresh_online_updates_clicks_visible_individual_updates_when_update_all_hidden(self) -> None:
        class StubLocator:
            def __init__(self, *, count=1, visible=True, text="", enabled=True):
                self._count = count
                self.visible = visible
                self.text = text
                self.enabled = enabled
                self.first = self

            def count(self):
                return self._count

            def is_visible(self):
                return self.visible

            def is_enabled(self):
                return self.enabled

            def inner_text(self, timeout=None):
                return self.text

        class StubPage:
            url = "https://www.credixsa.com/nuevo/con_cuit_pde_ajax.php"

            def __init__(self):
                self.update_all = StubLocator(count=1, visible=False)
                self.update_buttons = StubLocator(count=3, visible=True)
                self.next_button = StubLocator(count=1, enabled=True)
                self.body = StubLocator(text="PASO 3: Actualizaciones en linea")
                self.evaluate_calls = []

            def locator(self, selector, has_text=None):
                if selector == "#procesar_todo_auto":
                    return self.update_all
                if selector == "button.btn_actualizar.btn-info":
                    return self.update_buttons
                if selector == "#btn_siguiente":
                    return self.next_button
                if selector == "body":
                    return self.body
                return StubLocator(count=0, visible=False)

            def evaluate(self, script):
                self.evaluate_calls.append(script)
                return 3

        config = type(
            "Config",
            (),
            {"timeout_ms": 1000, "debug_enabled": False},
        )()
        page = StubPage()

        _refresh_online_updates_if_available(
            page,
            config,
            SearchRequest(cuit="20123456783", nombre=""),
        )

        self.assertEqual(len(page.evaluate_calls), 1)
        self.assertIn("fns_afip_aportes_ajax.php", page.evaluate_calls[0])
        self.assertIn("fns_anses_ajax.php", page.evaluate_calls[0])
        self.assertIn("fns_negativa_ajax.php", page.evaluate_calls[0])


if __name__ == "__main__":
    unittest.main()
