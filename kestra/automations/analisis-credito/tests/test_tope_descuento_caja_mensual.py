from __future__ import annotations

import tempfile
import os
import sys
import types
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

if "Crypto" not in sys.modules:
    crypto_module = types.ModuleType("Crypto")
    cipher_module = types.ModuleType("Crypto.Cipher")

    class DummyAES:
        MODE_CBC = 1

        @staticmethod
        def new(*args, **kwargs):  # pragma: no cover - encryption is integration-tested
            raise NotImplementedError

    cipher_module.AES = DummyAES
    crypto_module.Cipher = cipher_module
    sys.modules["Crypto"] = crypto_module
    sys.modules["Crypto.Cipher"] = cipher_module

from tope_descuento_caja_mensual.caja_client import (
    CajaPersonNotFoundError,
    CajaResult,
    CajaTechnicalError,
)
from tope_descuento_caja_mensual.checkpoint import Checkpoint, ResultRow
from tope_descuento_caja_mensual import kestra_entrypoint as entrypoint
from tope_descuento_caja_mensual.kestra_entrypoint import resolve_run_month
from tope_descuento_caja_mensual.report import atomic_publish, build_workbook, save_workbook
from tope_descuento_caja_mensual.runner import run_candidates
from tope_descuento_caja_mensual.sources import (
    BITRIX_ENUMS,
    BitrixClient,
    Candidate,
    SourceStats,
    VimarxClient,
    merge_candidates,
    normalize_cuil,
)


class FakeResponse:
    def __init__(self, payload, status_code: int = 200) -> None:
        self.payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self.payload


class FakeVimarxSession:
    def __init__(self, rows) -> None:
        self.rows = rows
        self.trust_env = True
        self.payload = None

    def post(self, url, **kwargs):
        self.payload = kwargs["json"]
        return FakeResponse(self.rows)


class FakeBitrixClient(BitrixClient):
    def __init__(self) -> None:
        super().__init__(
            "https://example.test",
            "1/token",
            lead_cuil_field="UF_CUIL",
            contact_cuil_field="UF_CONTACT_CUIL",
            province_field="UF_PROVINCE",
            employment_field="UF_EMPLOYMENT",
            payment_bank_field="UF_BANK",
        )
        self.validated = False
        self.contact_filters = []

    def validate_live_enums(self) -> None:
        self.validated = True

    def list_all(self, method, payload):
        employment = payload["filter"]["=UF_EMPLOYMENT"]
        if employment == BITRIX_ENUMS["employment_jubilado_provincial"]:
            return [
                {"ID": "1", "CONTACT_ID": "101", "UF_CUIL": "20-11111111-2"},
                {"ID": "2", "CONTACT_ID": "102", "UF_CUIL": "12345678"},
            ]
        return [
            {"ID": "3", "CONTACT_ID": "103", "UF_CUIL": "20-11111111-2"},
            {"ID": "4", "CONTACT_ID": "102", "UF_CUIL": ""},
        ]

    def call(self, method, payload):
        self.contact_filters.append(payload["filter"])
        return [
            {"ID": "102", "UF_CONTACT_CUIL": "27-22222222-3"},
        ]


class FakeCaja:
    def __init__(self, outcomes) -> None:
        self.outcomes = {key: list(values) for key, values in outcomes.items()}
        self.calls = []
        self.open_count = 1

    def query(self, cuil):
        self.calls.append(cuil)
        outcome = self.outcomes[cuil].pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class SourceTests(unittest.TestCase):
    def test_normalize_cuil_accepts_format_and_rejects_dni(self) -> None:
        self.assertEqual(normalize_cuil("20-11111111-2"), "20111111112")
        self.assertEqual(normalize_cuil(["", "27-22222222-3"]), "27222222223")
        self.assertEqual(normalize_cuil("12345678"), "")

    def test_merge_candidates_preserves_all_origins(self) -> None:
        merged = merge_candidates(
            [Candidate("20111111112", from_core=True, core_loan_ids={"10"})],
            [
                Candidate(
                    "20111111112",
                    from_bitrix_jubilado=True,
                    cuil_from_lead=True,
                    bitrix_lead_ids={"20"},
                )
            ],
        )
        self.assertEqual(len(merged), 1)
        self.assertTrue(merged[0].from_core)
        self.assertTrue(merged[0].from_bitrix_jubilado)
        self.assertEqual(merged[0].core_loan_ids, {"10"})
        self.assertEqual(merged[0].bitrix_lead_ids, {"20"})

    def test_vimarx_filters_by_stable_cordoba_parent_id(self) -> None:
        session = FakeVimarxSession(
            [
                [1, 2752, "Caja 1", "20-11111111-2"],
                [2, 2753, "Caja 2", "20-11111111-2"],
                [3, 2754, "Caja 3", None],
            ]
        )
        client = VimarxClient("https://vimarx.test", session=session)
        candidates, rows, missing = client.caja_candidates()
        self.assertEqual(session.payload["cmd"], "[LineaPrestamo.Superior.ID] = 2756")
        self.assertEqual(rows, 3)
        self.assertEqual(missing, 1)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].core_loan_ids, {"1", "2"})

    def test_bitrix_uses_contact_fallback_and_merges_criteria(self) -> None:
        client = FakeBitrixClient()
        candidates, stats = client.candidates()
        by_cuil = {candidate.cuil: candidate for candidate in candidates}
        self.assertTrue(client.validated)
        self.assertEqual(set(by_cuil), {"20111111112", "27222222223"})
        self.assertTrue(by_cuil["20111111112"].from_bitrix_jubilado)
        self.assertTrue(by_cuil["20111111112"].from_bitrix_pensionado_bancor)
        self.assertTrue(by_cuil["27222222223"].cuil_from_contact)
        self.assertEqual(by_cuil["27222222223"].bitrix_lead_ids, {"2", "4"})
        self.assertEqual(stats["without_direct_cuil"], 2)
        self.assertEqual(stats["contacts_recovered"], 1)
        self.assertEqual(client.contact_filters, [{"@ID": ["102"]}])


class CheckpointAndRunnerTests(unittest.TestCase):
    def test_checkpoint_is_append_only_and_latest_value_wins(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Checkpoint(Path(directory) / "state.jsonl")
            checkpoint.append(ResultRow("20111111112", "technical_error", "first"))
            checkpoint.append(ResultRow("20111111112", "completed", "second"))
            self.assertEqual(checkpoint.latest()["20111111112"].status, "completed")
            self.assertEqual(
                len(checkpoint.path.read_text(encoding="utf-8").splitlines()), 2
            )

    def test_runner_resumes_retries_and_keeps_not_found_as_resolved(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Checkpoint(Path(directory) / "state.jsonl")
            checkpoint.append(ResultRow("20111111112", "completed", "before"))
            caja = FakeCaja(
                {
                    "27222222223": [
                        CajaTechnicalError("temporal"),
                        CajaResult("27222222223", "Ana", "Perez", 100.0, 20.0),
                    ],
                    "20333333334": [CajaPersonNotFoundError("no encontrada")],
                }
            )
            sleeps = []
            summary = run_candidates(
                [
                    Candidate("20111111112"),
                    Candidate("27222222223"),
                    Candidate("20333333334"),
                ],
                checkpoint,
                caja=caja,
                now=lambda: datetime(2026, 8, 28, 12, 0),
                sleep=sleeps.append,
                pause_seconds=3,
                retry_delays=(5,),
            )
            self.assertTrue(summary.complete)
            self.assertEqual(summary.already_resolved, 1)
            self.assertEqual(summary.queried, 2)
            self.assertEqual(summary.completed, 1)
            self.assertEqual(summary.not_found, 1)
            self.assertEqual(sleeps, [5, 3])

    def test_limited_run_never_counts_as_complete(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Checkpoint(Path(directory) / "state.jsonl")
            caja = FakeCaja(
                {
                    "20111111112": [
                        CajaResult("20111111112", "", "", 1.0, 20.0)
                    ]
                }
            )
            summary = run_candidates(
                [Candidate("20111111112"), Candidate("27222222223")],
                checkpoint,
                caja=caja,
                now=lambda: datetime(2026, 8, 28, 12, 0),
                sleep=lambda _: None,
                limit=1,
            )
            self.assertTrue(summary.limited)
            self.assertFalse(summary.complete)
            self.assertEqual(summary.pending, 1)

    def test_limit_never_publishes_even_if_it_covers_the_whole_universe(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Checkpoint(Path(directory) / "state.jsonl")
            caja = FakeCaja(
                {
                    "20111111112": [
                        CajaResult("20111111112", "", "", 1.0, 20.0)
                    ]
                }
            )
            summary = run_candidates(
                [Candidate("20111111112")],
                checkpoint,
                caja=caja,
                now=lambda: datetime(2026, 8, 28, 12, 0),
                sleep=lambda _: None,
                limit=10,
            )
            self.assertTrue(summary.limited)
            self.assertFalse(summary.complete)
            self.assertEqual(summary.pending, 0)


class ReportTests(unittest.TestCase):
    def test_workbook_contains_traceability_and_summary(self) -> None:
        candidates = [
            Candidate(
                "20111111112",
                from_core=True,
                from_bitrix_jubilado=True,
                cuil_from_lead=True,
                core_loan_ids={"9"},
                core_line_names={"Caja"},
                bitrix_lead_ids={"11"},
            )
        ]
        results = {
            "20111111112": ResultRow(
                "20111111112", "completed", "2026-08-28T12:00:00", "Ana", "Perez", 10, 20
            )
        }
        workbook = build_workbook(
            candidates, results, SourceStats(core_rows=1), datetime(2026, 8, 28)
        )
        self.assertEqual(workbook.sheetnames, ["Resumen", "Resultados"])
        headers = [cell.value for cell in workbook["Resultados"][1]]
        self.assertIn("origen_core", headers)
        self.assertIn("origen_bitrix_jubilado", headers)
        self.assertEqual(workbook["Resumen"].cell(3, 2).value, 1)

    def test_publish_is_atomic_and_uses_month_for_history(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.xlsx"
            source.write_bytes(b"report")
            latest, history = atomic_publish(source, root / "reports", "2026-08")
            self.assertEqual(latest.read_bytes(), b"report")
            self.assertEqual(history.name, "2026-08.xlsx")
            self.assertEqual(history.read_bytes(), b"report")

    def test_saved_workbook_can_be_opened(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.xlsx"
            save_workbook(
                build_workbook([], {}, SourceStats(), datetime(2026, 8, 28)), path
            )
            self.assertTrue(path.exists())


class FlowContractTests(unittest.TestCase):
    def test_flow_is_monthly_prod_only_and_mounts_reports(self) -> None:
        flow = (
            Path(__file__).resolve().parent.parent
            / "flows"
            / "tope_descuento_caja_mensual.yaml"
        ).read_text(encoding="utf-8")
        self.assertIn('cron: "0 5 1 * *"', flow)
        self.assertIn("schedule_scope: prod_only", flow)
        self.assertIn('"/srv/redunisol-reports:/reports"', flow)
        self.assertIn("timeout: PT5H", flow)

    def test_run_month_validation(self) -> None:
        now = datetime(2026, 8, 28)
        self.assertEqual(resolve_run_month("", now), "2026-08")
        self.assertEqual(resolve_run_month("2026-07", now), "2026-07")
        with self.assertRaises(ValueError):
            resolve_run_month("2026-13", now)

    def test_empty_source_universe_fails_before_opening_caja(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with (
                patch.dict(
                    os.environ,
                    {
                        "REPORTS_ROOT": directory,
                        "REPORT_MIN_CANDIDATES": "100",
                    },
                    clear=False,
                ),
                patch.object(
                    entrypoint,
                    "collect_candidates",
                    return_value=([], SourceStats()),
                ),
                patch.object(entrypoint.CajaSession, "from_env") as caja_factory,
            ):
                with self.assertRaisesRegex(RuntimeError, "minimo de seguridad"):
                    entrypoint.generate(datetime(2026, 8, 28))
                caja_factory.assert_not_called()


if __name__ == "__main__":
    unittest.main()
