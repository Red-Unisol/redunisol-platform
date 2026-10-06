from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import test_business_logic as fixtures
from test_business_logic import FakeBitrixClient, SilentLogger
from bitrix24_form_flow.form_processor.catamarca_deal_qualification import (
    qualify_catamarca_deal, select_next_pending_catamarca_deal,
)
from bitrix24_form_flow.form_processor.config import load_config
from bitrix24_form_flow.form_processor.deal_service import (
    DEAL_DIRECT_FIELD_MAPPINGS, DEAL_ENUM_FIELD_MAPPINGS, DEAL_SOCIO_NUEVO_FIELD,
)
from bitrix24_form_flow.form_processor.deal_vimarx_refresh import (
    RAW_DEAL_FIELD, refresh_deal_vimarx,
)
from bitrix24_form_flow.form_processor.vimarx_service import (
    VimarxEnrichment, build_error_enrichment, evaluate_list, load_vimarx_config_from_env,
)

PROVIDER = "bitrix24_form_flow.form_processor.deal_vimarx_refresh.consult_vimarx_enrichment"


class DealVimarxRefreshTests(unittest.TestCase):
    def setUp(self):
        # Use only the existing fake Bitrix and data builders, without its refresh mock.
        self.env = {
            "BITRIX24_BASE_URL": "https://example.bitrix24.com/rest",
            "BITRIX24_WEBHOOK_PATH": "1/test",
            "BITRIX24_CONTACT_CUIL_FIELD": "UF_CONTACT_CUIL",
            "BITRIX24_LEAD_STATUS_QUALIFIED": "QUALIFIED",
            "BITRIX24_LEAD_STATUS_REJECTED": "UC_1P8I07",
            "BITRIX24_LEAD_BCRA_DATA_RAW_FIELD": "UF_CRM_BCRA_DATA_RAW",
            "BITRIX24_LEAD_BCRA_CHECKED_AT_FIELD": "UF_CRM_BCRA_CHECKED_AT",
            "VIMARX_EVAL_BASE_URL": "https://vimarx.example.test",
            "VIMARX_BEARER_TOKEN": "test-token",
            "BITRIX24_DISTRIBUTION_BUSINESS_HOURS_ONLY": "false",
        }
        self.config = load_config(self.env)
        self.now = datetime(2026, 9, 11, 13, tzinfo=timezone.utc)
        self.client = FakeBitrixClient()
        self.client.leads[920] = fixtures.BusinessLogicTests._catamarca_enriched_lead(
            self, 920, bcra_entities=[{"entidad": "BANCO DE LA NACION ARGENTINA", "situacion": 1}],
        )
        self.client.leads[920]["UF_CRM_BCRA_CHECKED_AT"] = self.now.isoformat()
        self.client.deals[930] = fixtures.BusinessLogicTests._pending_deal(self, 930, 920)
        self.logger = SilentLogger()

    def snapshot(self, member=False, credits=None):
        credits = credits or []
        return VimarxEnrichment(
            ok=True, es_socio=member,
            socio={"nro_socio": "100", "edad": 40} if member else {},
            cantidad_creditos_activos=len(credits), creditos=credits,
            detalle_human="Resultado actual de Vimarx", raw_json="", error="",
        )

    def qualify(self, now=None, env=None):
        return qualify_catamarca_deal(
            930, env=self.env if env is None else env, bitrix_client=self.client,
            logger=self.logger, now=now or self.now,
        )

    def refresh(self, now=None):
        return refresh_deal_vimarx(
            self.client, self.config, dict(self.client.leads[920]),
            deal=dict(self.client.deals[930]), lead_id=920, deal_id=930,
            source=self.env, processed_at=now or self.now, logger=self.logger,
        )

    def test_old_converted_lead_without_prefill_is_refreshed_and_approved(self):
        lead = self.client.leads[920]
        lead["DATE_CREATE"] = "2024-01-01T10:00:00-03:00"
        lead[self.config.fields.lead_es_socio] = ""
        lead[self.config.fields.lead_vimarx_creditos_activos_count] = ""
        with patch(PROVIDER, return_value=self.snapshot()) as provider:
            result = self.qualify()
        provider.assert_called_once()
        self.assertEqual(result["commercial_action"], "approved")
        self.assertEqual(result["reason"], "amejuca_premium")
        self.assertEqual(lead["STATUS_ID"], "CONVERTED")
        self.assertEqual(result["vimarx_refresh_outcome"], "not_found")
        self.assertEqual(lead[self.config.fields.lead_es_socio], "2619")
        raw = json.loads(self.client.deals[930][RAW_DEAL_FIELD])
        self.assertEqual(raw["queried_cuil"], lead[self.config.fields.lead_cuil])
        self.assertEqual(raw["qualification_refresh"]["deal_id"], 930)
        self.assertTrue(raw["queried_at"])
        self.assertEqual(raw, json.loads(lead[self.config.fields.lead_vimarx_creditos_activos_raw]))

    def test_recent_lead_bypassing_prefill_is_identified_as_member_before_deciding(self):
        lead = self.client.leads[920]
        lead["DATE_CREATE"] = "2026-09-11T09:00:00-03:00"
        lead[self.config.fields.lead_es_socio] = ""
        with patch(PROVIDER, return_value=self.snapshot(member=True)):
            result = self.qualify()
        self.assertEqual(result["commercial_action"], "manual_review")
        self.assertEqual(result["reason"], "missing_recurrent_membership_data")
        self.assertEqual(result["vimarx_refresh_outcome"], "member")
        deal = self.client.deals[930]
        self.assertEqual(deal[DEAL_ENUM_FIELD_MAPPINGS["es_socio"]], "2629")
        self.assertEqual(deal[DEAL_SOCIO_NUEVO_FIELD], "2601")
        self.assertEqual(deal[DEAL_DIRECT_FIELD_MAPPINGS["vimarx_nro_socio"]], "100")

    def test_cordoba_classifies_with_refreshed_credit_data(self):
        self.client.leads[920] = fixtures.BusinessLogicTests()._cordoba_enriched_lead(
            920, employment_id="1239", bcra_entities=[], vimarx={"ok": False},
        )
        self.client.leads[920]["UF_CRM_BCRA_CHECKED_AT"] = self.now.isoformat()
        with patch(PROVIDER, return_value=self.snapshot()):
            result = self.qualify()
        self.assertEqual(result["commercial_action"], "approved")
        self.assertEqual(result["reason"], "cbu_approved")
        self.assertEqual(result["routing_bucket"], "cordoba_general")
        self.assertTrue(json.loads(self.client.deals[930][RAW_DEAL_FIELD])["ok"])

    def test_current_vimarx_success_preserves_bcra_rejection_rules(self):
        lead = self.client.leads[920]
        raw = json.loads(lead["UF_CRM_BCRA_DATA_RAW"])
        raw["payload"]["results"]["periodos"][0]["entidades"][0]["situacion"] = 3
        lead["UF_CRM_BCRA_DATA_RAW"] = json.dumps(raw)
        with patch(PROVIDER, return_value=self.snapshot()):
            result = self.qualify()
        self.assertEqual(result["commercial_action"], "rejected")
        self.assertEqual(result["reason"], "payment_bank_situation_above_two")
        self.assertEqual(result["vimarx_refresh_outcome"], "not_found")

    def test_previous_member_and_credit_data_are_replaced_by_current_not_found(self):
        lead = self.client.leads[920]
        lead[self.config.fields.lead_es_socio] = "2617"
        lead[self.config.fields.lead_vimarx_nro_socio] = "OLD"
        lead[self.config.fields.lead_vimarx_creditos_activos_count] = 3
        lead[self.config.fields.lead_vimarx_creditos_activos_raw] = json.dumps({
            "ok": True, "es_socio": True, "creditos": [{"id": "old"}],
            "queried_at": self.now.isoformat(),
        })
        with patch(PROVIDER, return_value=self.snapshot()) as provider:
            result = self.qualify()
        provider.assert_called_once()
        self.assertEqual(result["commercial_action"], "approved")
        self.assertEqual(lead[self.config.fields.lead_vimarx_nro_socio], "")
        self.assertEqual(lead[self.config.fields.lead_vimarx_creditos_activos_count], 0)
        self.assertEqual(self.client.deals[930][DEAL_SOCIO_NUEVO_FIELD], "2599")
        self.assertEqual(json.loads(self.client.deals[930][RAW_DEAL_FIELD])["creditos"], [])

    def test_provider_failure_neither_rejects_nor_distributes_and_invalidates_stale_data(self):
        lead = self.client.leads[920]
        lead[self.config.fields.lead_vimarx_creditos_activos_count] = 2
        lead[self.config.fields.lead_vimarx_nro_socio] = "OLD"
        self.client.deals[930][DEAL_SOCIO_NUEVO_FIELD] = "2599"
        with patch(PROVIDER, side_effect=TimeoutError("secret provider URL")):
            result = self.qualify()
        self.assertEqual(result["action"], "vimarx_pending")
        self.assertEqual(result["business_decision"], "Pendiente de información Vimarx")
        self.assertEqual(self.client.deals[930]["stageId"], "C1:KESTRA_PENDING")
        self.assertEqual(lead[self.config.fields.lead_es_socio], "4053")
        self.assertEqual(lead[self.config.fields.lead_vimarx_creditos_activos_count], "")
        self.assertEqual(self.client.deals[930][DEAL_ENUM_FIELD_MAPPINGS["es_socio"]], "4059")
        self.assertEqual(self.client.deals[930][DEAL_SOCIO_NUEVO_FIELD], "")
        self.assertNotIn("secret provider URL", self.client.deals[930][RAW_DEAL_FIELD])
        self.assertFalse(self.client.notifications)
        self.assertFalse(self.client.chat_transfers)
        self.assertFalse(any(m == "user.get" for m, _ in self.client.calls))

    def test_third_failure_goes_to_manual_review_with_explicit_reason(self):
        with patch(PROVIDER, side_effect=TimeoutError()) as provider:
            first = self.qualify()
            second = self.qualify(self.now + timedelta(minutes=5))
            third = self.qualify(self.now + timedelta(minutes=20))
        self.assertEqual(provider.call_count, 3)
        self.assertEqual(first["vimarx_retry_attempts"], 1)
        self.assertEqual(second["vimarx_retry_attempts"], 2)
        self.assertEqual(third["vimarx_retry_attempts"], 3)
        self.assertEqual(third["commercial_action"], "manual_review")
        self.assertEqual(third["reason"], "vimarx_retry_exhausted")
        self.assertEqual(third["vimarx_next_retry_at"], "")
        self.assertEqual(self.client.deals[930]["stageId"], "C1:KESTRA_REVIEW")

    def test_direct_retry_before_due_does_not_call_provider_or_distribute(self):
        with patch(PROVIDER, side_effect=TimeoutError()) as provider:
            self.qualify()
            self.client.calls.clear()
            result = self.qualify(self.now + timedelta(minutes=1))
        self.assertEqual(provider.call_count, 1)
        self.assertEqual(result["action"], "vimarx_pending")
        self.assertFalse(any(m.endswith(".update") for m, _ in self.client.calls))

    def test_queue_skips_waiting_deal_and_resumes_when_due_even_if_lead_raw_changed(self):
        with patch(PROVIDER, side_effect=TimeoutError()):
            self.qualify()
        self.client.leads[920][self.config.fields.lead_vimarx_creditos_activos_raw] = "{}"
        self.client.leads[921] = dict(self.client.leads[920], ID="921")
        self.client.deals[931] = fixtures.BusinessLogicTests._pending_deal(self, 931, 921)
        selected = select_next_pending_catamarca_deal(
            env=self.env, bitrix_client=self.client, logger=self.logger,
            now=self.now + timedelta(minutes=1),
        )
        self.assertEqual(selected["deal_id"], 931)
        selected = select_next_pending_catamarca_deal(
            env=self.env, bitrix_client=self.client, logger=self.logger,
            now=self.now + timedelta(minutes=5),
        )
        self.assertEqual(selected["deal_id"], 930)

    def test_success_after_failure_resumes_commercial_decision(self):
        with patch(PROVIDER, side_effect=TimeoutError()):
            self.qualify()
        with patch(PROVIDER, return_value=self.snapshot()):
            result = self.qualify(self.now + timedelta(minutes=5))
        self.assertEqual(result["commercial_action"], "approved")
        self.assertEqual(result["vimarx_retry_attempts"], 2)
        self.assertEqual(result["vimarx_next_retry_at"], "")

    def test_changed_cuil_cancels_previous_wait_and_uses_current_identity(self):
        with patch(PROVIDER, side_effect=TimeoutError()):
            self.qualify()
        self.client.leads[920][self.config.fields.lead_cuil] = "20-22222222-3"
        with patch(PROVIDER, return_value=self.snapshot()) as provider:
            result = self.qualify(self.now + timedelta(minutes=1))
        self.assertEqual(provider.call_args.args[0], "20222222223")
        self.assertEqual(result["vimarx_retry_attempts"], 1)
        self.assertEqual(self.client.deals[930][DEAL_DIRECT_FIELD_MAPPINGS["cuil"]], "20222222223")

    def test_missing_cuil_goes_to_manual_without_querying_or_using_old_membership(self):
        self.client.leads[920][self.config.fields.lead_cuil] = ""
        with patch(PROVIDER) as provider:
            result = self.qualify()
        provider.assert_not_called()
        self.assertEqual(result["reason"], "vimarx_missing_cuil")
        self.assertEqual(result["commercial_action"], "manual_review")
        self.assertEqual(self.client.leads[920][self.config.fields.lead_es_socio], "4053")

    def test_missing_provider_configuration_cannot_silently_reuse_old_data(self):
        env = {k: v for k, v in self.env.items() if k != "VIMARX_EVAL_BASE_URL"}
        with patch(PROVIDER) as provider:
            result = self.qualify(env=env)
        provider.assert_not_called()
        self.assertEqual(result["commercial_action"], "manual_review")
        self.assertEqual(result["reason"], "vimarx_configuration_error")

    def test_existing_closed_deal_is_not_refreshed(self):
        self.client.deals[930]["stageId"] = "C1:WON"
        with patch(PROVIDER) as provider:
            result = self.qualify()
        provider.assert_not_called()
        self.assertEqual(result["action"], "skipped")
        self.assertFalse(any(m.endswith(".update") for m, _ in self.client.calls))

    def test_identity_change_during_provider_call_aborts_before_writes(self):
        def change_identity(*args):
            self.client.leads[920][self.config.fields.lead_cuil] = "20222222223"
            return self.snapshot()
        with patch(PROVIDER, side_effect=change_identity):
            with self.assertRaisesRegex(RuntimeError, "identidad o etapa"):
                self.qualify()
        self.assertFalse(any(m.endswith(".update") for m, _ in self.client.calls))

    def test_stage_change_during_provider_call_aborts_before_writes(self):
        def close_deal(*args):
            self.client.deals[930]["stageId"] = "C1:WON"
            return self.snapshot()
        with patch(PROVIDER, side_effect=close_deal):
            with self.assertRaisesRegex(RuntimeError, "identidad o etapa"):
                self.qualify()
        self.assertFalse(any(m.endswith(".update") for m, _ in self.client.calls))

    def test_failed_deal_write_aborts_classification(self):
        original_call = self.client.call
        def fail_snapshot(method, payload):
            if method == "crm.item.update" and RAW_DEAL_FIELD in payload["fields"]:
                raise RuntimeError("Bitrix unavailable")
            return original_call(method, payload)
        with patch(PROVIDER, return_value=self.snapshot()), patch.object(
            self.client, "call", side_effect=fail_snapshot,
        ):
            with self.assertRaisesRegex(RuntimeError, "Bitrix unavailable"):
                self.qualify()
        self.assertEqual(self.client.deals[930]["stageId"], "C1:KESTRA_PENDING")
        self.assertFalse(self.client.chat_transfers)

    def test_provider_error_payload_is_never_not_found(self):
        with patch(PROVIDER, return_value=build_error_enrichment("27555555556", "error")):
            result = self.qualify()
        self.assertEqual(result["action"], "vimarx_pending")

    def test_credit_snapshot_is_mirrored_with_current_balances(self):
        credit = {"prestamo_id": 11, "saldo": 123.45, "cuotas_pagadas": 4}
        with patch(PROVIDER, return_value=self.snapshot(True, [credit])):
            result = self.refresh()
        self.assertEqual(result.outcome, "member")
        self.assertEqual(json.loads(self.client.deals[930][RAW_DEAL_FIELD])["creditos"], [credit])
        self.assertEqual(self.client.deals[930][DEAL_DIRECT_FIELD_MAPPINGS["vimarx_creditos_activos_count"]], 1)

    def test_new_deal_does_not_inherit_copied_retry_state(self):
        with patch(PROVIDER, side_effect=TimeoutError()):
            self.refresh()
        self.client.deals[930][RAW_DEAL_FIELD] = self.client.deals[930][RAW_DEAL_FIELD].replace(
            '"deal_id": 930', '"deal_id": 999',
        )
        with patch(PROVIDER, return_value=self.snapshot()) as provider:
            result = self.refresh(self.now + timedelta(minutes=1))
        provider.assert_called_once()
        self.assertEqual(result.attempts, 1)

    def test_explicit_environment_supplies_provider_token_and_timeout(self):
        with patch.dict(os.environ, {"VIMARX_BEARER_TOKEN": "wrong-global-token"}):
            config = load_vimarx_config_from_env({**self.env, "VIMARX_TIMEOUT_SECONDS": "21"})
            with patch("bitrix24_form_flow.form_processor.vimarx_service.requests.Session") as session:
                session.return_value.post.return_value.json.return_value = []
                rows = evaluate_list(config=config, tipo="test", campos=["ID"], criterio="ID=1", max_filas=1)
        self.assertEqual(rows, [])
        args = session.return_value.post.call_args.kwargs
        self.assertEqual(args["headers"]["Authorization"], "Bearer test-token")
        self.assertEqual(args["timeout"], 21)


if __name__ == "__main__":
    unittest.main()
