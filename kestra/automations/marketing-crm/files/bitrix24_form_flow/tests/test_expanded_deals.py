from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from bitrix24_form_flow.form_processor.catamarca_deal_qualification import (
    qualify_catamarca_deal, select_next_pending_catamarca_deal, process_distribution_queue,
)
from bitrix24_form_flow.form_processor.config import load_config
from bitrix24_form_flow.form_processor.lead_won_deal_service import process_lead_update_event
from bitrix24_form_flow.form_processor.routing_bucket import resolve_routing_bucket
import test_business_logic as fixtures
from test_business_logic import FakeBitrixClient, SilentLogger

NOW = datetime(2026, 10, 26, 15, 0, tzinfo=timezone.utc)


class ExpandedDealTests(unittest.TestCase):
    def setUp(self):
        self.env = {"BITRIX24_BASE_URL": "https://example.bitrix24.com/rest",
                    "BITRIX24_WEBHOOK_PATH": "1/token", "BITRIX24_CONTACT_CUIL_FIELD": "UF_CONTACT_CUIL",
                    "BITRIX24_LEAD_STATUS_QUALIFIED": "QUALIFIED", "BITRIX24_LEAD_STATUS_REJECTED": "LOST",
                    "BITRIX24_LEAD_BCRA_DATA_RAW_FIELD": "UF_CRM_BCRA_DATA_RAW",
                    "BITRIX24_LEAD_BCRA_CHECKED_AT_FIELD": "UF_CRM_BCRA_CHECKED_AT"}
        self.config = load_config(self.env)
        self.client = FakeBitrixClient()
        self.client.online_user_ids = {10451, 29, 116561, 58913}

    def seed(self, province="279", employment="3745", count=7):
        entities = [{"entidad": f"Entidad {index}", "situacion": 5} for index in range(count)]
        lead = fixtures.BusinessLogicTests._catamarca_enriched_lead(self, 950, bcra_entities=entities)
        lead[self.config.fields.lead_province] = province
        lead[self.config.fields.lead_employment_status] = employment
        lead[self.config.fields.lead_bcra_checked_at] = NOW.isoformat()
        self.client.leads[950] = lead
        self.client.deals[960] = fixtures.BusinessLogicTests._pending_deal(self, 960, 950)
        self.client.deals[960]["createdTime"] = NOW.isoformat()
        return lead

    def qualify(self):
        return qualify_catamarca_deal(960, env=self.env, bitrix_client=self.client,
                                     logger=SilentLogger(), now=NOW)

    def test_anses_has_national_priority_and_needs_no_bcra_vimarx_identity_or_bank(self):
        for province in ("209", "215", "213", "279", "221", None):
            with self.subTest(province=province):
                lead = self.seed(province=province, employment="2567", count=30)
                for key in (self.config.fields.lead_cuil, self.config.fields.lead_payment_bank,
                            self.config.fields.lead_bcra_data_raw, self.config.fields.lead_bcra_checked_at,
                            "EMAIL", "BIRTHDATE", self.config.fields.lead_vimarx_creditos_activos_raw):
                    lead.pop(key, None)
                with patch("bitrix24_form_flow.form_processor.catamarca_deal_qualification.sync_lead_bcra") as bcra, \
                     patch("bitrix24_form_flow.form_processor.catamarca_deal_qualification.refresh_deal_vimarx") as vimarx:
                    result = self.qualify()
                self.assertEqual(result["commercial_action"], "approved")
                self.assertEqual(result["commercial_line"], "Red Mutual - paii")
                self.assertEqual(result["routing_bucket"], "santa_fe_anses")
                self.assertEqual(result["assigned_by_id"], 10451)
                self.assertEqual(result["bcra_refresh_outcome"], "not_required")
                self.assertEqual(result["vimarx_refresh_outcome"], "not_required")
                bcra.assert_not_called()
                vimarx.assert_not_called()

    def test_neuquen_ignores_negative_bcra_and_assigns_only_ludmila(self):
        self.seed(province="213", count=30)
        with patch("bitrix24_form_flow.form_processor.catamarca_deal_qualification.sync_lead_bcra") as bcra, \
             patch("bitrix24_form_flow.form_processor.catamarca_deal_qualification.refresh_deal_vimarx") as vimarx:
            result = self.qualify()
        self.assertEqual(result["commercial_line"], "MUDON")
        self.assertEqual(result["commercial_action"], "approved")
        self.assertEqual(result["routing_bucket"], "neuquen")
        self.assertEqual(result["assigned_by_id"], 58913)
        bcra.assert_not_called()
        vimarx.assert_not_called()

    def test_santa_fe_accepts_seven_entities_even_all_situation_five_and_rejects_eight(self):
        for count, action, line in ((0, "approved", "Haberes Premium"),
                                     (7, "approved", "Haberes Premium"), (8, "rejected", None)):
            with self.subTest(count=count):
                self.seed(count=count)
                result = self.qualify()
                self.assertEqual(result["commercial_action"], action)
                self.assertEqual(result["commercial_line"], line)
                self.assertEqual(result["routing_bucket"], "santa_fe_anses")
                if action == "rejected":
                    self.assertEqual(result["stage_id"], "C1:5")
                    self.assertEqual(result["distribution_action"], "not_applicable")

    def test_santa_fe_not_found_counts_as_zero_but_invalid_snapshot_does_not(self):
        for outcome, action in (("not_found", "approved"), ("invalid_identification", "manual_review")):
            with self.subTest(outcome=outcome):
                lead = self.seed()
                lead[self.config.fields.lead_bcra_data_raw] = json.dumps({"outcome": outcome})
                result = self.qualify()
                self.assertEqual(result["commercial_action"], action)
                if action == "approved":
                    self.assertEqual(result["commercial_line"], "Haberes Premium")

    def test_santa_fe_counts_only_the_latest_bcra_period(self):
        lead = self.seed(count=7)
        snapshot = json.loads(lead[self.config.fields.lead_bcra_data_raw])
        snapshot["payload"]["results"]["periodos"].insert(0, {
            "periodo": "202601", "entidades": [{"entidad": str(n), "situacion": 5} for n in range(20)],
        })
        lead[self.config.fields.lead_bcra_data_raw] = json.dumps(snapshot)
        self.assertEqual(self.qualify()["commercial_action"], "approved")

    def test_santa_fe_does_not_treat_malformed_entities_as_zero(self):
        for entities in (None, "unavailable", [{"entidad": "A"}, None]):
            with self.subTest(entities=entities):
                lead = self.seed()
                snapshot = json.loads(lead[self.config.fields.lead_bcra_data_raw])
                snapshot["payload"]["results"]["periodos"][0]["entidades"] = entities
                lead[self.config.fields.lead_bcra_data_raw] = json.dumps(snapshot)
                self.assertEqual(self.qualify()["commercial_action"], "manual_review")

    def test_provider_retry_timers_do_not_block_selection_for_unrestricted_families(self):
        for province, employment in (("213", "3745"), ("209", "2567")):
            with self.subTest(province=province):
                self.seed(province=province, employment=employment)
                with patch("bitrix24_form_flow.form_processor.catamarca_deal_qualification.bcra_retry_waiting", return_value=True) as bcra, \
                     patch("bitrix24_form_flow.form_processor.catamarca_deal_qualification.vimarx_retry_waiting", return_value=True) as vimarx:
                    result = select_next_pending_catamarca_deal(env=self.env, bitrix_client=self.client,
                                                               logger=SilentLogger(), now=NOW)
                self.assertEqual(result["deal_id"], 960)
                bcra.assert_not_called()
                vimarx.assert_not_called()

    def test_neuquen_assigns_ludmila_while_offline_without_entering_queue(self):
        self.seed(province="213")
        self.client.online_user_ids = {10451, 29, 116561}
        result = self.qualify()
        self.assertEqual(result["distribution_action"], "assigned")
        self.assertEqual(result["routing_bucket"], "neuquen")
        self.assertEqual(result["assigned_by_id"], 58913)
        self.assertEqual(self.client.deals[960]["stageId"], "C1:NEW")
        self.assertEqual(self.client.leads[950]["ASSIGNED_BY_ID"], 58913)

    def test_new_families_create_pending_deals_under_provisional_assignee(self):
        for province, employment in (("279", "3745"), ("213", "3745"), (None, "2567")):
            with self.subTest(province=province):
                lead = self.seed(province=province, employment=employment)
                lead["STATUS_ID"] = "QUALIFIED"
                self.client.deals.clear()
                result = process_lead_update_event({"event": "ONCRMLEADUPDATE", "data": {"FIELDS": {"ID": 950}},
                                                    "auth": {"application_token": "test-token"}},
                    env=self.env, bitrix_client=self.client, expected_application_token="test-token", logger=SilentLogger())
                self.assertTrue(result["ok"], result)
                deal = self.client.deals[result["deal_id"]]
                self.assertEqual(deal["stageId"], "C1:KESTRA_PENDING")
                self.assertEqual(deal["assignedById"], 57)

    @patch("bitrix24_form_flow.form_processor.config.urlopen")
    def test_remote_new_pools_allow_pauses_and_use_the_approved_fallbacks(self, urlopen):
        self.assertEqual(self.config.deal.santa_fe_anses_user_ids, (10451, 29, 116561))
        self.assertEqual(self.config.deal.neuquen_user_ids, (58913,))
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"santa_fe_anses": [29], "neuquen": []}'
        urlopen.return_value = response
        config = load_config({**self.env, "BITRIX24_ROUTING_CONFIG_URL": "https://example.test/pools"})
        lead = self.seed(province="213")
        self.assertEqual(resolve_routing_bucket(config, lead).bucket.seller_ids, ())
        lead[self.config.fields.lead_employment_status] = "2567"
        self.assertEqual(resolve_routing_bucket(config, lead).bucket.seller_ids, (29,))


if __name__ == "__main__":
    unittest.main()
