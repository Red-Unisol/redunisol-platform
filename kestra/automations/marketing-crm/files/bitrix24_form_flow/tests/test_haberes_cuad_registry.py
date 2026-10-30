from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from bitrix24_form_flow.form_processor.business_logic import classify_lead
from bitrix24_form_flow.form_processor.config import load_config
from bitrix24_form_flow.form_processor.haberes_cuad_registry import (
    HaberesCuadRegistry, RegistryUnavailable, SNAPSHOT_PATH, load_registry,
)
from test_business_logic import FakeBitrixClient, SilentLogger


def registry_for(*cuits):
    return HaberesCuadRegistry(frozenset(hashlib.sha256(cuit.encode("ascii")).hexdigest()
                                        for cuit in cuits), "test-fixture")


class FrozenRegistryTests(unittest.TestCase):
    def test_frozen_registry_matches_formatted_cuil_exactly_without_partial_or_dni_matches(self) -> None:
        registry = registry_for("20123456786", "27123456780")
        self.assertTrue(registry.contains("20-12345678-6"))
        self.assertTrue(registry.contains(27123456780))
        self.assertFalse(registry.contains("12345678"))
        self.assertFalse(registry.contains("20123456789"))

    def test_missing_corrupt_incomplete_or_unfrozen_file_is_not_an_empty_registry(self) -> None:
        for value in (None, {}, {"frozen": False}, {"schema_version": 1, "linea_superior_id": 2703,
                    "complete": True, "frozen": True, "unique_cuits": 1, "cuit_sha256": []}):
            with self.subTest(value=value), TemporaryDirectory() as folder:
                path = Path(folder)/"registry.json"
                path.write_text(json.dumps(value), encoding="utf-8")
                with self.assertRaises(RegistryUnavailable):
                    load_registry(path)
        with TemporaryDirectory() as folder:
            with self.assertRaises(RegistryUnavailable):
                load_registry(Path(folder)/"missing.json")

    def test_frozen_source_contains_1945_hashes_and_no_plaintext_cuit_list(self) -> None:
        data = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
        self.assertTrue(data["frozen"])
        self.assertEqual(data["snapshot_date"], "2026-10-30")
        self.assertEqual(data["unique_cuits"], 1945)
        self.assertEqual(data["source_loans"], 5127)
        self.assertEqual(data["omitted_loans_without_cuit"], 398)
        self.assertEqual(len(load_registry().cuit_hashes), 1945)
        self.assertNotIn("cuits", data)

    @patch("bitrix24_form_flow.form_processor.vimarx_service.evaluate_list", side_effect=AssertionError("Vimarx must not be queried"))
    def test_frozen_registry_is_loaded_without_consulting_vimarx(self, evaluate):
        self.assertEqual(len(load_registry().cuit_hashes), 1945)
        evaluate.assert_not_called()


class RegistryLeadIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.env = {"BITRIX24_BASE_URL": "https://example.bitrix24.com/rest",
                    "BITRIX24_WEBHOOK_PATH": "1/token",
                    "BITRIX24_CONTACT_CUIL_FIELD": "UF_CONTACT_CUIL",
                    "BITRIX24_LEAD_STATUS_QUALIFIED": "QUALIFIED",
                    "BITRIX24_LEAD_STATUS_REJECTED": "UC_1P8I07"}
        self.config = load_config(self.env)
        self.client = FakeBitrixClient()
        self.lead = {"ID": "309", "STATUS_ID": "NEW", "NAME": "Ana", "LAST_NAME": "Gomez",
                     "TITLE": "Ana Gomez", "ASSIGNED_BY_ID": "57", "CONTACT_ID": "101",
                     self.config.fields.lead_commercial_owner: "4119",
                     self.config.fields.lead_cuil: "20123456786",
                     self.config.fields.lead_employment_status: "3745",
                     self.config.fields.lead_province: "279",
                     self.config.fields.lead_payment_bank: ["437"],
                     self.config.fields.lead_source: "2423"}
        self.client.leads[309] = self.lead
        registry = patch("bitrix24_form_flow.form_processor.business_logic.load_registry",
                         return_value=registry_for())
        self.registry_lookup = registry.start()
        self.addCleanup(registry.stop)

    def classify(self):
        return classify_lead(309, env=self.env, bitrix_client=self.client, logger=SilentLogger())

    def test_buenos_aires_incomplete_cuil_and_missing_bank_still_reaches_ganado(self) -> None:
        self.lead[self.config.fields.lead_province] = "221"
        self.lead[self.config.fields.lead_cuil] = "12345678"
        self.lead.pop(self.config.fields.lead_payment_bank)
        for employment in ("1269", "3745", "1239", "2565"):
            with self.subTest(employment=employment):
                self.lead["STATUS_ID"] = "NEW"
                self.lead[self.config.fields.lead_employment_status] = employment
                result = self.classify()
                self.assertTrue(result["ok"], result)
                self.assertEqual(result["action"], "qualified")
                self.assertEqual(result["lead_status"], "QUALIFIED")
        self.registry_lookup.assert_not_called()

    def test_buenos_aires_eligible_profile_with_cuad_history_is_external(self) -> None:
        self.lead[self.config.fields.lead_province] = "221"
        self.lead[self.config.fields.lead_employment_status] = "1269"
        self.lead.pop(self.config.fields.lead_payment_bank)
        self.registry_lookup.return_value = registry_for("20123456786")
        result = self.classify()
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["action"], "external_referral")
        self.assertEqual(result["lead_status"], "13")

    def test_matching_cuit_is_referred_in_any_province_even_with_missing_profile(self) -> None:
        self.registry_lookup.return_value = registry_for("20123456786")
        for key in (self.config.fields.lead_province, self.config.fields.lead_employment_status,
                    self.config.fields.lead_payment_bank):
            self.lead.pop(key)
        result = self.classify()
        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "external_referral")
        self.assertEqual(result["reason"], "haberes_cuad_history")
        self.assertEqual(self.lead["STATUS_ID"], "13")
        self.assertEqual(self.client.deals, {})

    def test_cuad_match_overrides_anses_in_other_province(self) -> None:
        self.registry_lookup.return_value = registry_for("20123456786")
        self.lead[self.config.fields.lead_province] = "221"
        self.lead[self.config.fields.lead_employment_status] = "2567"
        result = self.classify()
        self.assertEqual(result["action"], "external_referral")
        self.assertEqual(self.lead["STATUS_ID"], "13")

    def test_nonmember_santa_fe_docente_is_won(self) -> None:
        result = self.classify()
        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "qualified")
        self.assertEqual(self.lead["STATUS_ID"], self.config.lead_statuses.qualified)

    def test_nonmember_anses_is_won_without_province_and_payment_bank(self) -> None:
        self.lead[self.config.fields.lead_employment_status] = "2567"
        self.lead.pop(self.config.fields.lead_province)
        self.lead.pop(self.config.fields.lead_payment_bank)
        result = self.classify()
        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "qualified")
        self.assertEqual(self.lead["STATUS_ID"], self.config.lead_statuses.qualified)

    def test_incomplete_cuil_assumes_no_history_without_waiting_for_registry(self) -> None:
        self.lead[self.config.fields.lead_cuil] = "12345678"
        self.registry_lookup.side_effect = RegistryUnavailable("missing frozen file")
        result = self.classify()
        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "qualified")
        self.assertEqual(self.lead["STATUS_ID"], self.config.lead_statuses.qualified)
        self.registry_lookup.assert_not_called()

    def test_complete_cuil_with_missing_frozen_file_keeps_status_and_reports_error(self) -> None:
        self.registry_lookup.side_effect = RegistryUnavailable("missing frozen file")
        result = self.classify()
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "haberes_cuad_registry_unavailable")
        self.assertEqual(self.lead["STATUS_ID"], "NEW")


if __name__ == "__main__":
    unittest.main()
