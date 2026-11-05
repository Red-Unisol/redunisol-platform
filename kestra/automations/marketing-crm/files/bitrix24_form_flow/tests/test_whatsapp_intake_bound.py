import copy
import json
import unittest
from unittest.mock import Mock, patch

from bitrix24_form_flow.form_processor.intake_context import CHANNEL_CONTRACT, CHANNEL_SUBFLOW
from bitrix24_form_flow.form_processor.intake_crm_client import IntakeCrmClient
from bitrix24_form_flow.form_processor.lead_service import build_prequalification_input_from_lead
from bitrix24_form_flow.form_processor.qualification import evaluate_prequalification
from bitrix24_form_flow.form_processor.whatsapp_intake import InvalidIntake, process
from bitrix24_form_flow.form_processor.whatsapp_intake_crm import CUIL_REVIEW_STATUS
from test_whatsapp_intake import CASE, CONFIG, CUIL, FLOW, PHONE, IntakeCrm, payload
from test_whatsapp_intake_identity import person

CHANNEL_ENV = {**CONFIG, "EDNA_INCOMING_SUBJECT_ID": "2423"}


def channel_payload(origin="whatsapp_directo", **answer):
    result = payload(**answer)
    result.update(contract=CHANNEL_CONTRACT, test_reference=None,
                  entry_context={"version": 1, "source": "edna_authenticated", "event_id": 20,
                                 "message_id": "101", "subject_id": "2423", "received_at": "2026-10-27T10:58:00-03:00",
                                 "origin": origin},
                  crm_binding={"version": 1, "source": "bitrix_openline_session", "verified": True,
                               "lead_id": "10", "chat_id": "200", "session_id": "300", "message_id": "400",
                               "entry_event_id": 20, "entry_message_id": "101", "evidence": "external_message_id"})
    if origin != "website":
        result["attribution"] = {"version": 1, "status": "unknown", "journey_id": None, "first": {}, "last": {},
                                 "wa_assisted": True, "wa": {"WA_ENTRY": "whatsapp_directo", "WA_FLOW_ID": FLOW}}
    return result


class BoundCrm(IntakeCrm):
    def __init__(self, *, lead=None, **kwargs):
        lead = lead if lead is not None else {"ID": "10", "STATUS_ID": "UC_5N2OEO", "STATUS_SEMANTIC_ID": "P",
                                              "ASSIGNED_BY_ID": "999", "NAME": "Channel profile", "TITLE": "Channel inquiry",
                                              "PHONE": [{"VALUE": PHONE}]}
        super().__init__(lead=lead, **kwargs)
        self.dialog = {"id": 200, "entity_type": "LINES", "entity_id": "whatsappbyedna|1|synthetic|synthetic",
                       "entity_data_2": "LEAD|10|COMPANY|0|CONTACT|0|DEAL|0", "entity_data_1": "0|0|0|0|0|0"}
        self.calls = []

    def call(self, method, body):
        self.calls.append((method, copy.deepcopy(body)))
        if method == "imopenlines.dialog.get":
            assert body == {"CHAT_ID": 200}
            return copy.deepcopy(self.dialog)
        if method == "crm.lead.add":
            raise AssertionError("The bound contract must never create a second lead")
        return super().call(method, body)


class BoundIntakeTests(unittest.TestCase):
    def test_empty_bitrix_catalog_sentinels_enrich_the_original_and_replay_without_duplicates(self):
        sample = BoundCrm()
        fields = (sample.config.fields.lead_province, sample.config.fields.lead_employment_status,
                  sample.config.fields.lead_payment_bank)
        for field in fields:
            for empty in (None, False, "", []):
                with self.subTest(field=field, empty=empty):
                    api = BoundCrm()
                    api.leads["10"].update(STATUS_ID="NEW", **{field: copy.deepcopy(empty)})
                    result = process(channel_payload(), env=CHANNEL_ENV, client=api)
                    self.assertEqual((result["action"], result["lead_id"]), ("queued", "10"))
                    self.assertEqual((len(api.leads), len(api.contacts)), (1, 1))
                    self.assertEqual(api.leads["10"]["STATUS_ID"], "NEW")
                    writes = len(api.writes)
                    replay = process(channel_payload(), env=CHANNEL_ENV, client=api)
                    self.assertEqual((replay["action"], replay["lead_id"]), ("already_processed", "10"))
                    self.assertEqual((len(api.leads), len(api.contacts), len(api.writes)), (1, 1, writes))

    def test_real_catalog_conflicts_still_stop_before_any_contact_or_lead_write(self):
        sample = BoundCrm()
        fields = (sample.config.fields.lead_province, sample.config.fields.lead_employment_status,
                  sample.config.fields.lead_payment_bank)
        for field in fields:
            for value in (0, True, "false", "999999", ["999999"]):
                with self.subTest(field=field, value=value):
                    api = BoundCrm()
                    api.leads["10"][field] = copy.deepcopy(value)
                    before = copy.deepcopy((api.leads, api.contacts))
                    result = process(channel_payload(), env=CHANNEL_ENV, client=api)
                    self.assertEqual((result["action"], result["reason"], result["lead_id"]),
                                     ("manual_review", "bound_profile_conflict", "10"))
                    self.assertEqual((api.leads, api.contacts), before)
                    self.assertEqual(api.writes, [])

    def test_matching_scalar_or_list_catalog_ids_remain_compatible(self):
        populated = BoundCrm()
        process(channel_payload(), env=CHANNEL_ENV, client=populated)
        fields = (populated.config.fields.lead_province, populated.config.fields.lead_employment_status,
                  populated.config.fields.lead_payment_bank)
        for use_lists in (False, True):
            with self.subTest(use_lists=use_lists):
                api = BoundCrm(contact=person())
                for field in fields:
                    value = populated.leads["10"][field]
                    scalar = value[0] if isinstance(value, list) else value
                    api.leads["10"][field] = [str(scalar)] if use_lists else str(scalar)
                result = process(channel_payload(), env=CHANNEL_ENV, client=api)
                self.assertEqual((result["action"], result["lead_id"], result["contact_id"]), ("queued", "10", "1"))
                self.assertEqual((len(api.leads), len(api.contacts)), (1, 1))

    def test_direct_entry_enriches_exact_named_ingreso_without_second_lead_or_fake_web_origin(self):
        api = BoundCrm()
        before = copy.deepcopy(api.leads["10"])
        result = process(channel_payload(), env=CHANNEL_ENV, client=api)
        self.assertEqual((result["action"], result["lead_id"]), ("queued", "10"))
        self.assertEqual((len(api.leads), len(api.contacts)), (1, 1))
        self.assertEqual([method for method, _ in api.writes], ["crm.contact.add", "crm.lead.update"])
        lead = api.leads["10"]
        for key in ("STATUS_ID", "ASSIGNED_BY_ID", "NAME", "TITLE"):
            self.assertEqual(lead[key], before[key])
        self.assertEqual(lead["UF_CRM_WA_SUBFLOW"], CHANNEL_SUBFLOW)
        self.assertEqual(lead["UF_CRM_WA_ENTRY"], "whatsapp_directo")
        self.assertEqual(lead["UF_CRM_JOURNEY_ID"], "")
        self.assertEqual(lead["UTM_CAMPAIGN"], "")
        snapshot = json.loads(lead["UF_CRM_ATTR_JSON"])
        self.assertEqual((snapshot["status"], snapshot["journey_id"], snapshot["first"], snapshot["last"]),
                         ("unknown", None, {}, {}))
        self.assertFalse(any(method == "crm.duplicate.findbycomm" for method, _ in api.calls))

    def test_preclassification_is_not_reset_and_known_identity_reuses_the_same_contact(self):
        api = BoundCrm(contact=person())
        api.leads["10"].update(STATUS_ID="NEW", CONTACT_ID="1", **{api.config.fields.lead_cuil: CUIL})
        result = process(channel_payload("website"), env=CHANNEL_ENV, client=api)
        self.assertEqual((result["action"], result["lead_id"], result["contact_id"]), ("queued", "10", "1"))
        self.assertEqual(api.leads["10"]["STATUS_ID"], "NEW")
        self.assertEqual(api.leads["10"]["ASSIGNED_BY_ID"], "999")
        self.assertEqual((len(api.leads), len(api.contacts)), (1, 1))
        self.assertEqual(api.leads["10"]["UF_CRM_WA_ENTRY"], "website")
        self.assertEqual(api.leads["10"]["UF_CRM_JOURNEY_ID"], "AbCdEf1234")

    def test_empty_guest_advances_to_ingreso_without_changing_its_responsible(self):
        api = BoundCrm()
        api.leads["10"]["STATUS_ID"] = "UC_PWTVG6"
        self.assertEqual(process(channel_payload(), env=CHANNEL_ENV, client=api)["lead_id"], "10")
        self.assertEqual(api.leads["10"]["STATUS_ID"], "UC_5N2OEO")
        self.assertEqual(api.leads["10"]["ASSIGNED_BY_ID"], "999")

    def test_malformed_or_forged_binding_fails_before_any_provider_call(self):
        changes = [lambda p: p.pop("crm_binding"), lambda p: p["crm_binding"].update(verified=False),
                   lambda p: p["crm_binding"].update(entry_event_id=21), lambda p: p["crm_binding"].update(entry_message_id="102"),
                   lambda p: p["crm_binding"].update(lead_id=True), lambda p: p["crm_binding"].update(session_id=""),
                   lambda p: p["crm_binding"].update(evidence="phone_latest"),
                   lambda p: p["crm_binding"].update(evidence="entry_reference"),
                   lambda p: p["crm_binding"].update(evidence="connector_message"),
                   lambda p: p["entry_context"].update(subject_id="2580"),
                   lambda p: p["entry_context"].update(event_id=True), lambda p: p["entry_context"].update(received_at="2026-10-27"),
                   lambda p: p["entry_context"].update(source="public_answer")]
        for change in changes:
            p = channel_payload(); change(p)
            api = Mock()
            with self.subTest(change=change), self.assertRaises(InvalidIntake):
                process(p, env=CHANNEL_ENV, client=api)
            api.call.assert_not_called()

    def test_direct_entry_cannot_claim_a_website_journey_or_campaign(self):
        for attr in (payload()["attribution"], {**channel_payload()["attribution"], "last": {"utm_source": "meta"}},
                     {**channel_payload()["attribution"], "journey_id": "AbCdEf1234"}):
            api = Mock()
            with self.subTest(attr=attr), self.assertRaises(InvalidIntake):
                process({**channel_payload(), "attribution": attr}, env=CHANNEL_ENV, client=api)
            api.call.assert_not_called()

    def test_direct_entry_preserves_native_acquisition_but_its_current_case_stays_unknown(self):
        api = BoundCrm()
        original = {"UTM_SOURCE": "meta", "UTM_CAMPAIGN": "native-campaign", "UF_CRM_FBCLID": "synthetic-click",
                    "UF_CRM_LANDING_ORIGEN": "https://example.test/native", api.config.fields.lead_source: "2427"}
        api.leads["10"].update(original)
        self.assertEqual(process(channel_payload(), env=CHANNEL_ENV, client=api)["lead_id"], "10")
        for field, value in original.items():
            self.assertEqual(api.leads["10"][field], value)
        snapshot = json.loads(api.leads["10"]["UF_CRM_ATTR_JSON"])
        self.assertEqual((snapshot["status"], snapshot["journey_id"], snapshot["last"]), ("unknown", None, {}))
        self.assertEqual(api.leads["10"]["UF_CRM_WA_ENTRY"], "whatsapp_directo")

    def test_website_acquisition_conflict_preserves_native_fields_and_never_writes(self):
        for fields in ({"UTM_CAMPAIGN": "another-campaign"},
                       {"UF_CRM_ATTR_JSON": json.dumps({"first": {}, "last": {"utm_campaign": "another-campaign"}})},
                       {"UF_CRM_JOURNEY_ID": "otherRef12"}):
            api = BoundCrm(); api.leads["10"].update(fields)
            before = copy.deepcopy(api.leads)
            result = process(channel_payload("website"), env=CHANNEL_ENV, client=api)
            self.assertEqual((result["action"], result["reason"], result["lead_id"]),
                             ("manual_review", "bound_attribution_conflict", "10"))
            self.assertEqual(api.leads, before)
            self.assertEqual(api.writes, [])

    def test_cobranzas_other_lead_or_phone_binding_never_mutates_any_record(self):
        for change in (lambda a: a.dialog.update(entity_id="whatsappbyedna|3|synthetic"),
                       lambda a: a.dialog.update(entity_data_2="LEAD|11|CONTACT|0|DEAL|0"),
                       lambda a: a.leads["10"].update(PHONE=[{"VALUE": "+5493519999999"}])):
            api = BoundCrm(); change(api)
            before = copy.deepcopy(api.leads)
            result = process(channel_payload(), env=CHANNEL_ENV, client=api)
            self.assertEqual((result["action"], result["reason"], result["lead_id"]),
                             ("manual_review", "bound_channel_conflict", "10"))
            self.assertEqual(api.leads, before)
            self.assertEqual(api.writes, [])

    def test_shared_phone_never_overwrites_another_cuil_or_contact(self):
        for changes in ({"UF_CRM_1693840106704": "20123456786"}, {"CONTACT_ID": "1"}):
            api = BoundCrm(contact=person(cuil="20123456786"))
            api.leads["10"].update(changes)
            before = copy.deepcopy((api.leads, api.contacts))
            result = process(channel_payload(), env=CHANNEL_ENV, client=api)
            self.assertEqual((result["action"], result["lead_id"]), ("manual_review", "10"))
            self.assertEqual((api.leads, api.contacts), before)
            self.assertEqual(api.writes, [])

    def test_shared_phone_alone_never_borrows_an_unlinked_persons_identity(self):
        api = BoundCrm(contact=person(cuil="20123456786"))
        before = copy.deepcopy(api.contacts["1"])
        result = process(channel_payload(), env=CHANNEL_ENV, client=api)
        self.assertEqual(result["lead_id"], "10")
        self.assertNotEqual(result["contact_id"], "1")
        self.assertEqual(api.contacts["1"], before)
        self.assertEqual((len(api.leads), len(api.contacts)), (1, 2))

    def test_the_uuid_cannot_be_rebound_to_a_second_original_lead(self):
        api = BoundCrm()
        api.leads["11"] = {**copy.deepcopy(api.leads["10"]), "ID": "11", "UF_CRM_WA_ASSISTANCE_ID": CASE}
        before = copy.deepcopy(api.leads)
        result = process(channel_payload(), env=CHANNEL_ENV, client=api)
        self.assertEqual((result["action"], result["reason"], result["lead_id"]),
                         ("manual_review", "bound_case_conflict", "10"))
        self.assertEqual(api.leads, before)
        self.assertEqual(api.writes, [])

    def test_a_case_link_created_elsewhere_during_identity_work_prevents_the_lead_write(self):
        api = BoundCrm(); original = api.call

        def linked_elsewhere(method, body):
            value = original(method, body)
            if method == "crm.contact.add":
                api.leads["11"] = {"ID": "11", "UF_CRM_WA_ASSISTANCE_ID": CASE}
            return value

        with patch.object(api, "call", side_effect=linked_elsewhere):
            result = process(channel_payload(), env=CHANNEL_ENV, client=api)
        self.assertEqual((result["action"], result["reason"], result["lead_id"]),
                         ("manual_review", "bound_case_conflict", "10"))
        self.assertEqual([method for method, _ in api.writes], ["crm.contact.add"])
        self.assertNotIn("UF_CRM_WA_ASSISTANCE_ID", api.leads["10"])

    def test_unknown_entry_origin_remains_unattributed_without_a_synthetic_journey(self):
        api = BoundCrm()
        p = channel_payload("unknown")
        p["attribution"]["referral"] = {"source_type": "ad", "source_id": "123456789", "ctwa_clid": "synthetic-click"}
        self.assertEqual(process(p, env=CHANNEL_ENV, client=api)["lead_id"], "10")
        snapshot = json.loads(api.leads["10"]["UF_CRM_ATTR_JSON"])
        self.assertEqual(snapshot["status"], "unknown")
        self.assertIsNone(snapshot["journey_id"])
        self.assertEqual(snapshot["referral"], p["attribution"]["referral"])
        self.assertEqual(api.leads["10"]["UTM_SOURCE"], "")
        self.assertEqual(api.leads["10"]["UF_CRM_WA_ENTRY"], "whatsapp_directo")

    def test_previous_case_final_management_or_conflicting_commercial_data_is_preserved(self):
        for changes in ({"UF_CRM_WA_ASSISTANCE_ID": CASE[:-1] + "2"}, {"STATUS_ID": "CONVERTED", "STATUS_SEMANTIC_ID": "S"},
                        {"UF_CRM_64E65D2B2136C": "209"}, {"UF_CRM_COMM_OWNER": "3"}):
            api = BoundCrm(); api.leads["10"].update(changes)
            before = copy.deepcopy(api.leads)
            result = process(channel_payload(), env=CHANNEL_ENV, client=api)
            self.assertEqual((result["action"], result["lead_id"]), ("manual_review", "10"))
            self.assertEqual(api.leads, before)
            self.assertEqual(api.writes, [])

    def test_rejection_or_invalid_cuil_uses_the_original_record_and_terminal_stage(self):
        for changes, expected in (({"situacion_catamarca": "otra"}, "JUNK"), ({"cuil": "123"}, CUIL_REVIEW_STATUS)):
            api = BoundCrm()
            result = process(channel_payload(**changes), env=CHANNEL_ENV, client=api)
            self.assertEqual(result["lead_id"], "10")
            self.assertEqual(api.leads["10"]["STATUS_ID"], expected)
            self.assertEqual(api.leads["10"]["ASSIGNED_BY_ID"], "999")
            self.assertEqual([method for method, _ in api.writes], ["crm.lead.update"])
            count = len(api.writes)
            self.assertEqual(process(channel_payload(**changes), env=CHANNEL_ENV, client=api)["lead_id"], "10")
            self.assertEqual(len(api.writes), count)

    def test_human_change_detected_before_any_mutation_is_not_overwritten(self):
        api = BoundCrm()
        original = api.call
        reads = []

        def changed(method, body):
            if method == "crm.lead.get":
                reads.append(method)
                if len(reads) == 2:
                    api.leads["10"].update(STATUS_ID="CONVERTED", STATUS_SEMANTIC_ID="S", ASSIGNED_BY_ID="7")
            return original(method, body)

        with patch.object(api, "call", side_effect=changed):
            result = process(channel_payload(), env=CHANNEL_ENV, client=api)
        self.assertEqual((result["action"], result["reason"]), ("manual_review", "bound_lead_changed"))
        self.assertEqual(api.leads["10"]["ASSIGNED_BY_ID"], "7")
        self.assertEqual(api.writes, [])

    def test_prefill_can_advance_the_original_without_a_reset_or_false_conflict(self):
        for initial, advanced, at_read in (("UC_PWTVG6", "UC_5N2OEO", 2), ("UC_5N2OEO", "NEW", 3)):
            api = BoundCrm(); api.leads["10"]["STATUS_ID"] = initial
            original = api.call
            reads = []

            def advancing(method, body):
                if method == "crm.lead.get":
                    reads.append(method)
                    if len(reads) == at_read:
                        api.leads["10"].update(STATUS_ID=advanced, DATE_MODIFY="2026-10-27T11:00:01-03:00")
                return original(method, body)

            with patch.object(api, "call", side_effect=advancing):
                result = process(channel_payload(), env=CHANNEL_ENV, client=api)
            self.assertEqual((result["action"], result["lead_id"]), ("queued", "10"))
            self.assertEqual(api.leads["10"]["STATUS_ID"], advanced)
            self.assertEqual(api.leads["10"]["ASSIGNED_BY_ID"], "999")
            writes = [body for method, body in api.writes if method == "crm.lead.update"]
            self.assertEqual(len(writes), 1)
            self.assertNotIn("STATUS_ID", writes[0]["fields"])

    def test_forward_stage_with_a_human_edit_still_requires_review(self):
        api = BoundCrm(); original = api.call; reads = []

        def changing(method, body):
            if method == "crm.lead.get":
                reads.append(method)
                if len(reads) == 2:
                    api.leads["10"].update(STATUS_ID="NEW", ASSIGNED_BY_ID="7")
            return original(method, body)

        with patch.object(api, "call", side_effect=changing):
            result = process(channel_payload(), env=CHANNEL_ENV, client=api)
        self.assertEqual((result["action"], result["reason"]), ("manual_review", "bound_lead_changed"))
        self.assertEqual(api.writes, [])

    def test_replay_after_conversion_and_closed_chat_keeps_original_ids_without_writes(self):
        api = BoundCrm()
        first = process(channel_payload(), env=CHANNEL_ENV, client=api)
        api.leads["10"].update(STATUS_ID="CONVERTED", STATUS_SEMANTIC_ID="S")
        api.dialog.update(entity_data_2="LEAD|0|CONTACT|100|DEAL|500")
        writes = copy.deepcopy(api.writes)
        second = process(channel_payload(), env=CHANNEL_ENV, client=api)
        self.assertEqual((second["action"], second["lead_id"], second["contact_id"]),
                         ("already_processed", first["lead_id"], first["contact_id"]))
        self.assertEqual(api.writes, writes)

    def test_read_retry_does_not_replay_lead_write_and_uncertain_write_is_dispatched_once(self):
        for fail_method in ("imopenlines.dialog.get", "crm.lead.update"):
            api = BoundCrm(); original = api.call; failures = []

            def flaky(method, body):
                if method == fail_method and not failures:
                    failures.append(method)
                    if method == "crm.lead.update":
                        original(method, body)  # Provider committed, acknowledgement was lost.
                    raise TimeoutError("synthetic timeout")
                return original(method, body)

            sleep = Mock()
            with patch.object(api, "call", side_effect=flaky), patch(
                    "bitrix24_form_flow.form_processor.whatsapp_intake_crm.IntakeCrmClient",
                    side_effect=lambda inner: IntakeCrmClient(inner, sleep=sleep, clock=lambda: 0)):
                if fail_method == "crm.lead.update":
                    with self.assertRaises(TimeoutError):
                        process(channel_payload(), env=CHANNEL_ENV, client=api)
                else:
                    self.assertEqual(process(channel_payload(), env=CHANNEL_ENV, client=api)["lead_id"], "10")
            self.assertEqual(sum(method == "crm.lead.update" for method, _ in api.writes), 1)
            self.assertEqual(len(api.leads), 1)
            self.assertEqual(sleep.call_count, int(fail_method == "imopenlines.dialog.get"))

    def test_caja_cordoba_keeps_its_bank_exception_with_the_neutral_subflow(self):
        api = BoundCrm()
        result = process(channel_payload(provincia="cordoba", situacion_cordoba="jubilado", organismo="caja_cordoba"),
                         env=CHANNEL_ENV, client=api)
        self.assertEqual(result["action"], "queued")
        lead = api.leads["10"]
        self.assertEqual(lead["UF_CRM_WA_SUBFLOW"], CHANNEL_SUBFLOW)
        self.assertTrue(evaluate_prequalification(build_prequalification_input_from_lead(lead, api.config)).qualified)


if __name__ == "__main__":
    unittest.main()
