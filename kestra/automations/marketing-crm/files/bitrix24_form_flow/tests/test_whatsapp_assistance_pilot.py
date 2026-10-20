import copy
import json
import os
import runpy
import sys
import types
import unittest
from unittest.mock import Mock, patch

from test_whatsapp_assistance import CASE, CUIL, ENV, PHONE, Crm, payload
from bitrix24_form_flow.form_processor.business_logic import classify_lead
from bitrix24_form_flow.form_processor.lead_prefill_service import prefill_lead, select_new_leads_for_prefill
from bitrix24_form_flow.form_processor.lead_won_deal_service import process_lead_update_event
from bitrix24_form_flow.form_processor.whatsapp_assistance import process
from bitrix24_form_flow.form_processor import whatsapp_assistance

PILOT = {**ENV, "EDNA_ASSISTANCE_TEST_MODE": "true",
         "BITRIX24_LEAD_STATUS_ASSISTANCE_TEST": "ASSISTANCE_TEST",
         "BITRIX24_ASSISTANCE_TEST_USER_ID": "71283"}


def test_payload(**answer):
    return {**payload(cuil_caja=CUIL, **answer), "test_mode": True}


class TestLeadPilot(unittest.TestCase):
    def test_dedicated_endpoint_refuses_old_code_or_non_test_requests(self):
        for version, body, enabled, accepted in [
                ("isolated-test-v1", test_payload(), "true", True),
                ("legacy", test_payload(), "true", False),
                ("isolated-test-v1", payload(), "true", False),
                ("isolated-test-v1", test_payload(), "false", False)]:
            with self.subTest(version=version, enabled=enabled, accepted=accepted):
                output = Mock()
                process_mock = Mock(return_value={"ok": True, "action": "test_created"})
                with patch.dict(os.environ, {"TRIGGER_BODY_JSON": json.dumps(body),
                                             "EDNA_ASSISTANCE_TEST_MODE": enabled}, clear=True), \
                     patch.dict(sys.modules, {"kestra": types.SimpleNamespace(Kestra=types.SimpleNamespace(outputs=output))}), \
                     patch.object(whatsapp_assistance, "TEST_CONTRACT_VERSION", version), \
                     patch.object(whatsapp_assistance, "process", process_mock):
                    runpy.run_module("bitrix24_form_flow.kestra_whatsapp_assistance_pilot_entrypoint", run_name="__main__")
                self.assertEqual(process_mock.call_count, int(accepted))
                self.assertEqual(output.call_args.args[0]["ok"], accepted)

    def test_existing_real_entities_are_unchanged_and_not_linked(self):
        contact = {"ID": "1", "PHONE": [{"VALUE": PHONE}], "UF_CONTACT_CUIL": CUIL}
        lead = {"ID": "2", "PHONE": [{"VALUE": PHONE}], "STATUS_ID": "NEW", "CONTACT_ID": "1"}
        api = Crm(contact=contact, lead=lead)
        before = copy.deepcopy((api.contacts, api.leads))
        result = process(test_payload(email_caja="TEST@example.com"), env=PILOT, client=api)
        self.assertEqual((result["action"], result["contact_id"]), ("test_created", ""))
        self.assertEqual(api.contacts, before[0])
        self.assertEqual(api.leads["2"], before[1]["2"])
        self.assertEqual([m for m, _ in api.writes], ["crm.lead.add"])
        created = api.leads[result["lead_id"]]
        self.assertEqual((created["STATUS_ID"], created["ASSIGNED_BY_ID"]), ("ASSISTANCE_TEST", 71283))
        self.assertEqual(created["UF_CRM_WA_TEST"], "SI")
        self.assertEqual(created["UF_CRM_WA_ASSISTANCE_ID"], CASE)
        self.assertTrue(created["TITLE"].startswith("[PRUEBA WHATSAPP]"))
        self.assertNotIn("CONTACT_ID", created)
        self.assertEqual(created["EMAIL"][0]["VALUE"], "test@example.com")
        self.assertEqual(created[api.config.fields.lead_cuil], CUIL)

    def test_all_branches_stay_in_test_stage_without_contact_or_deal(self):
        for answer in [payload(cuil_caja=CUIL)["answer"],
                       {"organismo": "anses", "banco_anses": "bancor", "continuidad_anses": "ayuda", "cuil_anses": CUIL},
                       {"organismo": "anses", "banco_anses": "otro"},
                       {"organismo": "ayuda", "cuil_ayuda": CUIL}]:
            with self.subTest(answer=answer):
                api = Crm()
                result = process({**test_payload(), "answer": answer}, env=PILOT, client=api)
                self.assertEqual(result["action"], "test_created")
                self.assertEqual(api.leads[result["lead_id"]]["STATUS_ID"], "ASSISTANCE_TEST")
                self.assertNotIn("EMAIL", api.leads[result["lead_id"]])
                self.assertEqual([m for m, _ in api.writes], ["crm.lead.add"])

    def test_mode_mismatch_or_invalid_boolean_never_contacts_crm(self):
        for body, env in [(payload(), PILOT), (test_payload(), ENV),
                          ({**test_payload(), "test_mode": "true"}, PILOT)]:
            api = Mock()
            result = process(body, env=env, client=api)
            self.assertEqual(result["reason"], "pilot_mode_mismatch")
            api.call.assert_not_called()

    def test_flags_and_allowlist_still_gate_test_writes(self):
        for changes in [{"EDNA_ASSISTANCE_CRM_ENABLED": "false"}, {"EDNA_ASSISTANCE_RECIPIENTS": ""},
                        {"EDNA_ASSISTANCE_RECIPIENTS": "5493519999999"}]:
            api = Mock()
            self.assertEqual(process(test_payload(), env={**PILOT, **changes}, client=api)["action"], "disabled")
            api.call.assert_not_called()

    def test_missing_test_stage_owner_or_marker_prevents_any_write(self):
        for changes in [{"BITRIX24_LEAD_STATUS_ASSISTANCE_TEST": ""},
                        {"BITRIX24_LEAD_STATUS_ASSISTANCE_TEST": "NEW"},
                        {"BITRIX24_ASSISTANCE_TEST_USER_ID": ""}]:
            api = Crm()
            with self.assertRaises(ValueError):
                process(test_payload(), env={**PILOT, **changes}, client=api)
            self.assertEqual(api.writes, [])
        api = Crm()
        original = api.call
        api.call = lambda method, body: ({k: v for k, v in original(method, body).items() if k != "UF_CRM_WA_TEST"}
                                        if method == "crm.lead.fields" else original(method, body))
        with self.assertRaises(ValueError):
            process(test_payload(), env=PILOT, client=api)
        self.assertEqual(api.writes, [])

    def test_replay_does_not_create_twice_and_never_claims_a_real_case(self):
        api = Crm()
        first = process(test_payload(), env=PILOT, client=api)
        second = process(test_payload(), env=PILOT, client=api)
        self.assertEqual(second["action"], "already_processed")
        self.assertEqual(second["lead_id"], first["lead_id"])
        self.assertEqual(len(api.writes), 1)
        api.leads[first["lead_id"]].pop("UF_CRM_WA_TEST")
        self.assertEqual(process(test_payload(), env=PILOT, client=api)["reason"], "case_mode_mismatch")
        self.assertEqual(len(api.writes), 1)

    def test_completing_form_branch_never_creates_test_lead(self):
        api = Mock()
        result = process(test_payload(continuidad_caja="formulario"), env=PILOT, client=api)
        self.assertEqual(result["action"], "not_applicable")
        api.call.assert_not_called()

    def test_test_marker_excludes_lead_from_scheduled_prefill(self):
        api = Mock()
        api.call_full.return_value = {"result": [{"ID": "1", "UF_CRM_WA_TEST": "SI"}, {"ID": "2"}]}
        selected = select_new_leads_for_prefill(env=ENV, bitrix_client=api)
        self.assertEqual([row["lead_id"] for row in selected], ["2"])
        self.assertIn("UF_CRM_WA_TEST", api.call_full.call_args.args[1]["select"])

    def test_marked_lead_cannot_be_enriched_classified_or_converted_even_if_moved(self):
        for status in ("NEW", "PRECLASSIFICATION", "WON"):
            with self.subTest(status=status):
                api = Mock()
                api.call.return_value = {"ID": "10", "STATUS_ID": status, "UF_CRM_WA_TEST": "SI"}
                with patch("bitrix24_form_flow.form_processor.lead_prefill_service.sync_lead_bcra") as provider:
                    result = prefill_lead(10, arca_output={}, credixsa_output={}, env=ENV, bitrix_client=api)
                    self.assertEqual(result["action"], "skipped")
                    provider.assert_not_called()
                result = classify_lead(10, env=ENV, bitrix_client=api, force_processing=True, take_commercial_ownership=True)
                self.assertEqual(result["reason"], "test_lead")
                result = process_lead_update_event({"event": "ONCRMLEADUPDATE", "data": {"FIELDS": {"ID": "10"}},
                                                   "auth": {"application_token": "test"}}, env=ENV,
                                                  bitrix_client=api, expected_application_token="test")
                self.assertEqual(result["reason"], "test_lead")
                self.assertEqual([c.args[0] for c in api.call.call_args_list], ["crm.lead.get"] * 3)
