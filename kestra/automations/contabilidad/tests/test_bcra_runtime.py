import json
import os
import tempfile
import unittest
import zipfile
from datetime import date
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from bcra_deudores import kestra_entrypoint as runtime
from bcra_deudores import process


def request(**changes):
    data = {"run_id": str(uuid4()), "period": "2026-07", "declared_by": "Tefi",
        "selected_line_ids": ["10"], "normal_until_66_superior_ids": [],
        "excluded_cuits": [], "excluded_accounts": [], "rate": "112,00",
        "presentation_type": "NORMAL", "granted_without_real_guarantee": True}
    return data | changes


LINES = {"10": {"id": "10", "name": "PRODUCTO", "superior_id": "1", "superior_name": "COMUN"}}


def row(account="P1", cuit="20123456789", balance=100000, **changes):
    values = [account, "COMUN", "PRODUCTO", cuit, "PERSONA DE PRUEBA", balance,
        "2026-07-01", None, 1, 1000, 112, 10, "2026-01-01"]
    for key, value in changes.items():
        values[int(key.removeprefix("col"))] = value
    return values


class BcraRuntimeTest(unittest.TestCase):
    def test_unnamed_catalog_lines_keep_their_ids_selection_and_source_description(self):
        config = process.ProcessConfig(fecha_corte=date(2026, 7, 31))
        with patch.object(process, "fetch_api_payload", return_value=[
            [10, "   ", 1, "COMUN"], [11, None, None, " "], [12, "0", None, None],
        ]):
            lines = runtime.catalog(config)
        self.assertEqual(set(lines), {"10", "11", "12"})
        self.assertEqual(lines["10"]["name"], "Sin descripción (#10)")
        self.assertEqual(lines["10"]["source_name"], "")
        self.assertEqual(lines["10"]["superior_name"], "COMUN")
        self.assertEqual(lines["11"]["superior_name"], "Sin descripción (#11)")
        self.assertEqual(lines["12"]["name"], "0")
        prepared = runtime.prepare_rows([row()], runtime.validate_request(request()), lines)
        self.assertEqual(prepared[0][2], "Sin descripción (#10)")

    def test_inputs_require_closed_month_ids_rate_and_exclusion_reasons(self):
        self.assertEqual(runtime.validate_request(request(), date(2026, 8, 1))["cutoff"], "2026-07-31")
        for changes in [{"period": "2026-08"}, {"period": "2026-13"}, {"run_id": "../../bad"},
            {"selected_line_ids": []}, {"selected_line_ids": ["10) OR True"]},
            {"rate": "112.00"}, {"excluded_cuits": [{"value": "20123456789", "reason": ""}]}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                runtime.validate_request(request(**changes), date(2026, 8, 1))
        self.assertEqual(runtime.validate_request(request(granted_without_real_guarantee=False, rate=""))["rate"], "000,00")

    def test_defensive_selection_and_emission_cutoff_even_when_source_ignores_filter(self):
        data = runtime.validate_request(request())
        rows = [row(), row("LATER", col12="2026-08-01"), row("OTHER", col11=99), row("ZERO", balance=0)]
        prepared = runtime.prepare_rows(rows, data, LINES)
        self.assertEqual([r[0] for r in prepared], ["P1"])
        self.assertEqual(len(prepared[0]), 11)
        with self.assertRaisesRegex(ValueError, "fecha de emisión"):
            runtime.prepare_rows([row(col12=None)], data, LINES)

    def test_explicit_exclusions_are_applied_before_bad_source_dates(self):
        data = runtime.validate_request(request(excluded_cuits=[{"value": "20123456789", "reason": "Exclusión documentada"}]))
        self.assertEqual(runtime.prepare_rows([row(col12=None)], data, LINES), [])

    def test_threshold_is_per_debtor_and_includes_exactly_25000(self):
        config = process.ProcessConfig(fecha_corte=date(2026, 7, 31), max=100)
        raw = [r[:11] for r in [row("P1", balance=10000), row("P2", balance=15000),
            row("P3", cuit="27123456789", balance=24999)]]
        result = process.process_rows(raw, config)
        self.assertEqual(len(result["debtors"]), 1)
        self.assertEqual(result["debtors"]["20123456789"].total_deuda, Decimal("25000"))
        self.assertEqual(len(result["included_loans"]), 2)
        self.assertEqual(result["report"]["cantidad_deudores_bajo_minimo"], 1)

    def execute(self, data, root, rows, max_rows=1000000):
        env = {"BCRA_CORE_URL": "https://source.test", "BCRA_CORE_TOKEN": "test-secret-only", "BCRA_REPORTS_MOUNT": str(root)}
        config = runtime.source_config(date(2026, 7, 31), env)
        config.max = max_rows
        with patch.object(runtime, "source_config", return_value=config), patch.object(runtime, "catalog", return_value=LINES), \
            patch.object(process, "fetch_api", return_value=rows) as fetch:
            result = runtime.execute(data, root / "runs", env)
            self.assertEqual(fetch.call_count, 1)
            self.assertNotIn("25000", fetch.call_args.args[0].cmd)
            self.assertIn("FechaEmision < #2026-08-01#", fetch.call_args.args[0].cmd)
            return result

    def test_real_engine_zip_controls_frozen_config_and_no_credentials_in_artifacts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data = request()
            metadata = self.execute(data, root, [row()])
            self.assertEqual(metadata["status"], "SUCCESS")
            self.assertEqual(metadata["debtors"], 1)
            self.assertEqual(metadata["balance_basis"], "VIMARX_CURRENT_BALANCE")
            directory = root / "runs" / data["run_id"]
            config = (directory / "config_aplicada.json").read_text(encoding="utf-8")
            self.assertNotIn("test-secret-only", config)
            self.assertNotIn("https://source.test", config)
            with zipfile.ZipFile(directory / "output/informacion.zip") as archive:
                self.assertIsNone(archive.testzip())
                self.assertEqual(archive.namelist(), ["detalle.xml", "20260731/IMPORTES.TXT", "20260731/PROVEEDORES.TXT", "20260731/TASA.TXT"])
                self.assertEqual(archive.read("20260731/TASA.TXT"), b"1;112,00\r\n")
            self.assertEqual(set(metadata["artifacts"]), {"zip", "config", "control", "errors", "excel"})
            with self.assertRaises(FileExistsError):
                self.execute(data, root, [row(balance=999999)])
            self.assertEqual(json.loads((directory / "metadata.json").read_text())["total_miles"], 100)

    def test_each_new_run_refetches_changing_debts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = self.execute(request(), root, [row(balance=100000)])
            second = self.execute(request(), root, [row(balance=50000)])
            self.assertEqual((first["total_miles"], second["total_miles"]), (100, 50))
            self.assertNotEqual(first["run_id"], second["run_id"])

    def test_source_warnings_require_review_even_without_errors(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = self.execute(request(), Path(temporary), [row(col10=None)])
            self.assertEqual(result["status"], "NEEDS_REVIEW")
            self.assertEqual(result["errors"], 0)
            self.assertGreater(result["warnings"], 0)

    def test_failed_runs_publish_no_zip_and_keep_private_controls(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data = request()
            with self.assertRaisesRegex(ValueError, "fecha de emisión"):
                self.execute(data, root, [row(col12=None)])
            directory = root / "runs" / data["run_id"]
            metadata = json.loads((directory / "metadata.json").read_text())
            self.assertEqual(metadata["status"], "FAILED")
            self.assertNotIn("zip", metadata["artifacts"])
            self.assertIn("errors", metadata["artifacts"])
            self.assertIn("config", metadata["artifacts"])

    def test_truncated_api_and_missing_mount_fail_without_presentation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data = request()
            with self.assertRaisesRegex(ValueError, "límite"):
                self.execute(data, root, [row(), row("P2")], max_rows=2)
            self.assertFalse((root / "runs" / data["run_id"] / "output/informacion.zip").exists())
            with self.assertRaisesRegex(ValueError, "volumen persistente"):
                runtime.execute(request(), root / "bad", {"BCRA_REPORTS_MOUNT": str(root / "missing")})

    def test_kestra_json_string_and_object_inputs(self):
        result = {"run_id": str(uuid4()), "status": "SUCCESS", "debtors": 1, "loans": 1, "total_miles": 100}
        for body in [request(), json.dumps(request())]:
            with patch.dict(os.environ, {"BCRA_REQUEST": json.dumps(body), "BCRA_OUTPUT_ROOT": "/reports/test"}), \
                patch.object(runtime, "execute", return_value=result) as execute:
                self.assertEqual(runtime.main(), 0)
                self.assertIsInstance(execute.call_args.args[0], dict)
