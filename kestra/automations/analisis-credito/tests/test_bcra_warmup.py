from collections import Counter
from contextlib import closing
from copy import deepcopy
import importlib.util
import gc
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch, call

DOMAIN = Path(__file__).resolve().parent.parent
ROOT = DOMAIN.parents[2]
sys.path.insert(0, str(DOMAIN / "files"))
from consulta_quiebra_credix import bcra, warmup_entrypoint as warmup, kestra_webhook_entrypoint as webhook
from consulta_quiebra_credix.service import (
    SearchRequest, build_single_result, build_output_payload, cached_result_if_fresh,
)

CUIT = "20123456786"


def period(label, entities):
    return {"periodo": label, "entidades": [
        {"entidad": name, "situacion": situation, "monto": amount}
        for name, situation, amount in entities
    ]}


def payload(periods, cuit=CUIT):
    return {"status": 200, "results": {"identificacion": cuit, "periodos": periods}}


def source_result(cuit=CUIT, name="PERSONA DE PRUEBA"):
    return build_single_result(SearchRequest(cuit=cuit, nombre=""), [
        {"title": "Datos Filiatorios", "rows": [["Nombre", name]]},
    ], cuit=cuit, nombre=name)


def success(path):
    return 200, payload([period("202607", [("Banco", 2, 878)])], cuit=path.split("/")[-1])


def read_cache_api(db, cuit=CUIT):
    spec = importlib.util.spec_from_file_location("bcra_cache_api_test", ROOT / "apps/credixsa-cache-api/src/credixsa_cache_api/app.py")
    cache_api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cache_api)
    with patch.dict(os.environ, {"CREDIXSA_CACHE_DB_PATH": db, "CREDIXSA_CACHE_API_TOKEN": ""}):
        return cache_api.get_cached_report(cache_api.CacheRequest(cuit=cuit), None, None)


class BcraWarmupTests(unittest.TestCase):
    def setUp(self):
        self.sleep = patch.object(bcra.time, "sleep").start()
        self.addCleanup(patch.stopall)

    def test_retries_only_failed_endpoint_then_caches_normalized_pesos(self):
        calls = Counter()

        def fetch(path):
            calls[path] += 1
            if path.startswith("Historicas/") and calls[path] < 3:
                return 503, {}
            return success(path)

        with patch.object(bcra, "_fetch", side_effect=fetch):
            result = bcra.enrich_bcra(source_result())
        self.assertEqual(calls[CUIT], 1)
        self.assertEqual(calls["Historicas/" + CUIT], 3)
        self.assertEqual(self.sleep.call_args_list, [call(12), call(12)])
        output = build_output_payload(result)
        entry = json.loads(output["cache_value_json"])
        financial = entry["result"]["normalized"]["bcra"]
        self.assertEqual(financial["fuente"], "BCRA")
        self.assertEqual(financial["deuda_situacion_negativa_total"], "$ 878.000")
        self.assertEqual(len(financial["deudas_24_meses"]["meses"]), 24)
        self.assertEqual(financial["deudas_vigentes"][0]["periodo"], "07/2026")

    def test_latest_per_entity_is_not_double_counted_and_situation_two_counts(self):
        current = bcra._periods(200, payload([
            period("202606", [("Santander", 4, 900), ("Credikot", 5, 478)]),
            period("202607", [("Santander", 5, 878), ("Cordoba", 1, 15602), ("Otra", 2, 0.125)]),
        ]), CUIT)
        report = bcra._normalize(current, {})
        self.assertEqual(report["deuda_vigente_total"], "$ 16.958.125")
        self.assertEqual(report["deuda_situacion_negativa_total"], "$ 1.356.125")
        self.assertEqual(len(report["deudas_vigentes"]), 4)

    def test_failure_keeps_credix_and_no_partial_bcra_block(self):
        result = source_result()
        result["normalized"] = {"persona": {"cuit": CUIT}, "bcra": {
            "deudas_vigentes": [{"entidad": "Credix", "monto": "1.000", "situacion": "5"}],
            "deuda_vigente_total": "$ 1.000",
        }}
        original = deepcopy(result)
        with patch.object(bcra, "_fetch", side_effect=lambda path: success(path) if path == CUIT else (503, {})) as fetch:
            prepared = bcra.enrich_bcra(result)
        self.assertEqual(fetch.call_count, 4)
        self.assertEqual(result, original)
        financial = prepared["normalized"]["bcra"]
        self.assertEqual(financial["fuente"], "CredixSA")
        self.assertEqual(financial["consulta_directa_estado"], "unavailable")
        self.assertEqual(financial["deuda_vigente_total"], "$ 1.000")
        self.assertTrue(build_output_payload(prepared)["cache_should_persist"])

    def test_transport_errors_get_three_attempts_and_remain_cacheable(self):
        with patch.object(bcra, "_fetch", side_effect=TimeoutError) as fetch:
            prepared = bcra.enrich_bcra(source_result())
        self.assertEqual(fetch.call_count, 6)
        self.assertEqual(self.sleep.call_args_list, [call(12), call(12)])
        self.assertEqual(prepared["normalized"]["bcra"]["fuente"], "CredixSA")
        self.assertTrue(build_output_payload(prepared)["cache_should_persist"])

    def test_invalid_payloads_are_not_zero_debt(self):
        for data in [[], {}, payload([], "27999999999"), payload([period("202613", [])]),
                     payload([period("202607", [("Banco", 2, None)])]),
                     payload([period("202607", [("Banco", 2, "NaN")])])]:
            with self.subTest(data=data), self.assertRaises(Exception):
                bcra._periods(200, data, CUIT)
        with self.assertRaises(ValueError):
            bcra._periods(404, {}, CUIT)

    def test_documented_no_records_is_zero_not_a_fallback(self):
        missing = {"status": 404, "errorMessages": ["No se encontró datos para la identificación ingresada."]}
        original = source_result()
        original["data"].append({
            "title": "Deudas en el Sistema Financiero (Ultimos 24 meses publicados) Fuente: BCRA",
            "headers": [], "records": [], "text": "",
            "rows": [["Deudas en el Sistema Financiero"], ["Entidad", "2026", "Ultimo monto informado", "Obs."],
                     ["Mar", "Feb", "Ene"], ["Banco anterior", "5", "5", "4", "2.886.000"]],
        })
        self.assertTrue(json.loads(build_output_payload(original)["normalized_json"])["bcra"]["deudas_24_meses"]["filas"])
        with patch.object(bcra, "_fetch", return_value=(404, missing)):
            prepared = bcra.enrich_bcra(original)
        report = prepared["normalized"]["bcra"]
        self.assertEqual(report["fuente"], "BCRA")
        self.assertEqual(report["deuda_vigente_total"], "$ 0")
        self.assertEqual(report["deuda_situacion_negativa_total"], "$ 0")
        self.assertEqual(report["deudas_vigentes"], [])
        self.sleep.assert_not_called()
        # Re-reading a cache cannot reconstruct stale CredixSA financial tables.
        entry = json.loads(build_output_payload(prepared)["cache_value_json"])
        cached = cached_result_if_fresh(entry)
        reread = json.loads(build_output_payload({**cached, "cache_hit": True})["normalized_json"])
        self.assertEqual(reread["bcra"], report)
        with tempfile.TemporaryDirectory() as directory:
            db = str(Path(directory) / "cache.sqlite")
            output = build_output_payload(prepared)
            warmup.write_cache_entries(db, [{"key": output["cuil_cache_key"], "value": output["cache_value_json"]}])
            cached = read_cache_api(db)
            self.assertEqual(json.loads(cached["normalized_json"])["bcra"], report)
            gc.collect()

    def test_cache_read_does_not_retry_or_redate_success_or_fallback(self):
        for report in [source_result(), {**source_result(), "normalized": {"bcra": {"fuente": "BCRA"}}}]:
            report["cache_hit"] = True
            report["cached_at"] = "2026-09-16T12:00:00Z"
            with patch.object(bcra, "_fetch") as fetch:
                self.assertIs(bcra.enrich_bcra(report), report)
            fetch.assert_not_called()
            self.assertEqual(report["cached_at"], "2026-09-16T12:00:00Z")

    def test_invalid_or_ambiguous_identity_never_calls_bcra(self):
        for report in [{"ok": True, "status": "multiple"}, {"ok": True, "status": "none"},
                       source_result("12345678")]:
            with patch.object(bcra, "_fetch") as fetch:
                bcra.enrich_bcra(report)
            fetch.assert_not_called()

    def test_warmup_publishes_each_report_to_sqlite_before_next_candidate_and_returns_kv_entries(self):
        with tempfile.TemporaryDirectory() as directory:
            db = str(Path(directory) / "cache.sqlite")
            solicitudes = [warmup.CoreSolicitud("1", "", "Nueva", CUIT, "", "UNO"),
                           warmup.CoreSolicitud("2", "", "Nueva", "27999999999", "", "DOS")]

            def scrape(solicitud, config):
                if solicitud.oid == "2":
                    with closing(sqlite3.connect(db)) as connection:
                        row = connection.execute("SELECT payload_json FROM credixsa_cache WHERE cuit = ?", (CUIT,)).fetchone()
                    self.assertEqual(json.loads(row[0])["result"]["normalized"]["bcra"]["fuente"], "BCRA")
                return source_result(solicitud.cuil, solicitud.nombre)

            with (patch.dict(os.environ, {"CREDIX_CACHE_SQLITE_PATH": db, "CREDIX_DAILY_INDEX_JSON": ""}),
                  patch.object(warmup, "load_core_config"), patch.object(warmup, "load_credix_config"),
                  patch.object(warmup, "fetch_today_solicitudes", return_value=solicitudes),
                  patch.object(warmup, "complete_missing_cuils", side_effect=lambda _, rows: rows),
                  patch.object(warmup, "consultar_with_retry", side_effect=scrape),
                  patch.object(warmup, "_log_event"), patch.object(bcra, "_fetch", side_effect=success)):
                output = warmup.run_warmup()
            self.assertFalse(output["has_errors"])
            self.assertEqual(output["cache_entry_count"], "4")
            for index in range(1, 5):
                entry = json.loads(output[f"cache_entry_{index}_value"])
                self.assertEqual(entry["result"]["normalized"]["bcra"]["fuente"], "BCRA")
            # Exercise the real cache API reader with the warmup's SQLite file.
            with patch.object(bcra, "_fetch") as fetch:
                cached = read_cache_api(db)
            self.assertTrue(cached["cache_hit"])
            self.assertEqual(json.loads(cached["normalized_json"])["bcra"]["fuente"], "BCRA")
            fetch.assert_not_called()
            gc.collect()  # Existing SQLite writer closes connections on collection.

    def test_warmup_caches_fallback_and_does_not_repeat_it_in_next_daily_poll(self):
        solicitud = warmup.CoreSolicitud("1", "", "Nueva", CUIT, "", "UNO")
        with tempfile.TemporaryDirectory() as directory:
            db = str(Path(directory) / "cache.sqlite")
            with (patch.dict(os.environ, {"CREDIX_CACHE_SQLITE_PATH": db, "CREDIX_DAILY_INDEX_JSON": ""}),
                  patch.object(warmup, "load_core_config"), patch.object(warmup, "load_credix_config"),
                  patch.object(warmup, "fetch_today_solicitudes", return_value=[solicitud]),
                  patch.object(warmup, "complete_missing_cuils", side_effect=lambda _, rows: rows),
                  patch.object(warmup, "consultar_with_retry", return_value=source_result()) as scrape,
                  patch.object(warmup, "_log_event"), patch.object(bcra, "_fetch", side_effect=TimeoutError) as fetch):
                first = warmup.run_warmup()
                cached = read_cache_api(db)
                with patch.dict(os.environ, {"CREDIX_DAILY_INDEX_JSON": first["daily_index_json"]}):
                    second = warmup.run_warmup()
            self.assertFalse(first["has_errors"])
            self.assertEqual(second["cache_entry_count"], "0")
            scrape.assert_called_once()
            self.assertEqual(fetch.call_count, 6)
            financial = json.loads(cached["normalized_json"])["bcra"]
            self.assertEqual(financial["fuente"], "CredixSA")
            self.assertEqual(financial["consulta_directa_estado"], "unavailable")
            gc.collect()

    def test_sqlite_write_failure_keeps_candidate_eligible_for_next_poll(self):
        solicitud = warmup.CoreSolicitud("1", "", "Nueva", CUIT, "", "UNO")
        with (patch.dict(os.environ, {"CREDIX_CACHE_SQLITE_PATH": "unused.sqlite", "CREDIX_DAILY_INDEX_JSON": ""}),
              patch.object(warmup, "load_core_config"), patch.object(warmup, "load_credix_config"),
              patch.object(warmup, "fetch_today_solicitudes", return_value=[solicitud]),
              patch.object(warmup, "complete_missing_cuils", side_effect=lambda _, rows: rows),
              patch.object(warmup, "consultar_with_retry", return_value=source_result()),
              patch.object(warmup, "_log_event"), patch.object(bcra, "_fetch", side_effect=success),
              patch.object(warmup, "write_cache_entries", side_effect=OSError("storage unavailable"))):
            output = warmup.run_warmup()
        self.assertTrue(output["has_errors"])
        self.assertEqual(warmup.select_candidates([solicitud], json.loads(output["daily_index_json"]), 5), [solicitud])

    def test_first_uncached_query_uses_same_preparation_before_persistence(self):
        with (patch.object(webhook, "_load_trigger_body", return_value={"cuit": CUIT}),
              patch.object(webhook, "load_config_from_env"),
              patch.object(webhook, "consultar_tabla", return_value=source_result()),
              patch.object(webhook, "_write_sqlite_cache_if_configured") as write,
              patch.object(webhook, "_emit_outputs_if_available"), patch("sys.stdout.write"),
              patch.object(bcra, "_fetch", side_effect=success)):
            self.assertEqual(webhook.main(), 0)
        output = write.call_args.args[0]
        self.assertEqual(json.loads(output["cache_value_json"])["result"]["normalized"]["bcra"]["fuente"], "BCRA")


if __name__ == "__main__":
    unittest.main()
