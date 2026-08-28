from __future__ import annotations

from pathlib import Path
import sys
import unittest

FILES_ROOT = (
    Path(__file__).resolve().parent.parent / "files"
)
if str(FILES_ROOT) not in sys.path:
    sys.path.insert(0, str(FILES_ROOT))

from consulta_quiebra_credix.service import cache_key_for_name  # noqa: E402
from consulta_quiebra_credix.warmup_entrypoint import (  # noqa: E402
    CoreSolicitud,
    build_error_output,
    build_success_output,
    decode_daily_index,
    mark_daily_index,
    register_oid_failure,
    select_candidates,
)


class ConsultaCredixsaWarmupTests(unittest.TestCase):
    def test_decode_daily_index_resets_other_dates(self) -> None:
        index = decode_daily_index(
            '{"date":"2026-05-12","processed_oids":["1"],"cuils":["201"],"name_keys":["n"]}',
            "2026-05-13",
        )

        self.assertEqual(index["date"], "2026-05-13")
        self.assertEqual(index["processed_oids"], [])
        self.assertEqual(index["cuils"], [])
        self.assertEqual(index["name_keys"], [])

    def test_select_candidates_skips_already_processed_today(self) -> None:
        solicitudes = [
            CoreSolicitud("1", "2026-05-13", "Nueva", "20111111112", "11111111", "Uno"),
            CoreSolicitud("2", "2026-05-13", "Nueva", "20222222223", "22222222", "Dos"),
            CoreSolicitud("3", "2026-05-13", "Nueva", "", "33333333", "Tres"),
        ]
        index = {
            "date": "2026-05-13",
            "processed_oids": ["1"],
            "cuils": ["20222222223"],
            "name_keys": [],
        }

        selected = select_candidates(solicitudes, index, 5)

        self.assertEqual([item.oid for item in selected], ["3"])

    def test_register_oid_failure_cuenta_intentos(self) -> None:
        index = {"date": "2026-05-13"}

        self.assertEqual(register_oid_failure(index, "248745"), 1)
        self.assertEqual(register_oid_failure(index, "248745"), 2)
        self.assertEqual(register_oid_failure(index, "otro"), 1)
        self.assertEqual(index["failed_oids"], {"248745": 2, "otro": 1})

    def test_register_oid_failure_tolera_formato_viejo(self) -> None:
        index = {"date": "2026-05-13", "failed_oids": ["248745"]}

        self.assertEqual(register_oid_failure(index, "248745"), 1)
        self.assertEqual(index["failed_oids"], {"248745": 1})

    def test_select_candidates_descarta_oid_agotado(self) -> None:
        solicitudes = [
            CoreSolicitud("248745", "2026-05-13", "Nueva", "20111111112", "11111111", "Uno"),
            CoreSolicitud("248746", "2026-05-13", "Nueva", "20222222223", "22222222", "Dos"),
        ]
        index = {
            "date": "2026-05-13",
            "processed_oids": [],
            "cuils": [],
            "name_keys": [],
            "failed_oids": {"248745": 3},
        }

        selected = select_candidates(solicitudes, index, 5)

        self.assertEqual([item.oid for item in selected], ["248746"])

    def test_select_candidates_reintenta_debajo_del_tope(self) -> None:
        solicitudes = [
            CoreSolicitud("248745", "2026-05-13", "Nueva", "20111111112", "11111111", "Uno"),
        ]
        index = {
            "date": "2026-05-13",
            "processed_oids": [],
            "cuils": [],
            "name_keys": [],
            "failed_oids": {"248745": 2},
        }

        selected = select_candidates(solicitudes, index, 5)

        self.assertEqual([item.oid for item in selected], ["248745"])

    def test_decode_daily_index_inicializa_failed_oids(self) -> None:
        index = decode_daily_index("", "2026-05-13")

        self.assertEqual(index["failed_oids"], {})

    def test_decode_daily_index_normaliza_failed_oids_invalido(self) -> None:
        index = decode_daily_index(
            '{"date":"2026-05-13","failed_oids":["248745"]}',
            "2026-05-13",
        )

        self.assertEqual(index["failed_oids"], {})

        solicitudes = [
            CoreSolicitud("248745", "2026-05-13", "Nueva", "20111111112", "11111111", "Uno"),
        ]
        self.assertEqual(
            [item.oid for item in select_candidates(solicitudes, index, 5)],
            ["248745"],
        )

    def test_mark_daily_index_records_cuil_and_name_key(self) -> None:
        index = {"date": "2026-05-13", "processed_oids": [], "cuils": [], "name_keys": []}
        solicitud = CoreSolicitud("10", "2026-05-13", "Nueva", "20123456783", "12345678", "Juan Perez")

        mark_daily_index(index, solicitud, {"nombre": "Juan Perez"})

        self.assertEqual(index["processed_oids"], ["10"])
        self.assertEqual(index["cuils"], ["20123456783"])
        self.assertEqual(index["name_keys"], [cache_key_for_name("Juan Perez")])

    def test_build_success_output_marks_completed_with_errors_without_being_fatal(self) -> None:
        output = build_success_output(
            daily_index={"date": "2026-05-13", "processed_oids": [], "cuils": [], "name_keys": []},
            cache_entries=[],
            solicitudes_count=4,
            candidate_count=2,
            processed_count=1,
            skipped_count=2,
            error_count=1,
            errors=["1:TimeoutError:boom"],
        )

        self.assertFalse(output["ok"])
        self.assertTrue(output["has_errors"])
        self.assertFalse(output["fatal_error"])
        self.assertEqual(output["status"], "completed_with_errors")

    def test_build_error_output_marks_fatal_error(self) -> None:
        output = build_error_output("Missing CREDIX_CLIENTE.")

        self.assertFalse(output["ok"])
        self.assertTrue(output["has_errors"])
        self.assertTrue(output["fatal_error"])
        self.assertEqual(output["status"], "fatal_error")
        self.assertEqual(output["error"], "Missing CREDIX_CLIENTE.")

    def test_flow_fails_explicitly_when_worker_reports_errors(self) -> None:
        flow_source = (
            Path(__file__).resolve().parent.parent
            / "flows"
            / "precalentar_cache_credixsa_v2_sondeo.yaml"
        ).read_text(encoding="utf-8")

        self.assertIn("type: io.kestra.plugin.core.execution.Fail", flow_source)
        self.assertIn("outputs.precalentar_cache.vars.has_errors", flow_source)
        self.assertIn("not outputs.precalentar_cache.vars.fatal_error", flow_source)
        self.assertEqual(flow_source.count("CREDIX_WARMUP_MAX_OID_FAILURES:"), 2)


if __name__ == "__main__":
    unittest.main()
