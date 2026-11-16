import copy
from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import Mock, patch

from bitrix24_form_flow.form_processor import organic_profile_reuse as reuse
from bitrix24_form_flow.form_processor.whatsapp_intake import process
from bitrix24_form_flow.form_processor.lead_service import build_prequalification_input_from_lead
from bitrix24_form_flow.form_processor.qualification import evaluate_prequalification
from test_whatsapp_intake import CASE, CONFIG, CUIL, PHONE, IntakeCrm

NOW = datetime(2026, 11, 11, 15, tzinfo=timezone.utc)
ENV = {**CONFIG, "EDNA_INCOMING_SUBJECT_ID": "2423", "EDNA_ORGANIC_PROFILE_MAX_AGE_MONTHS": "6"}


def payload():
    return {"contract": reuse.CONTRACT, "case_id": CASE, "phone": PHONE, "dry_run": False,
            "received_at": NOW.isoformat(),
            "answer": {"provincia": "catamarca", "situacion_catamarca": "policia", "banco_catamarca": "nacion", "cuil": CUIL},
            "provenance": {"source_kind": "edna_intake_request", "source_id": "123", "confirmed_at": "2026-10-01T12:00:00Z",
                           "schema": reuse.SCHEMA, "v3_equivalent": True},
            "attribution": {"version": 1, "status": "unknown", "journey_id": None, "first": {}, "last": {},
                            "wa_assisted": True, "wa": {"WA_ENTRY": "whatsapp_directo"}},
            "entry_context": {"version": 1, "source": "edna_authenticated", "event_id": 20, "message_id": "101",
                              "subject_id": "2423", "received_at": NOW.isoformat(), "origin": "whatsapp_directo"},
            "crm_binding": {"version": 1, "source": "bitrix_openline_session", "verified": True,
                            "native_lead_id": "10", "contact_id": "1", "chat_id": "200", "session_id": "300", "message_id": "400",
                            "activity_id": "500", "entry_event_id": 20, "entry_message_id": "101", "evidence": "external_message_id"}}


class OrganicCrm(IntakeCrm):
    def __init__(self, *, native=True, **kwargs):
        contact = {"ID": "1", "PHONE": [{"VALUE": PHONE}], "UF_CONTACT_CUIL": CUIL,
                   "ASSIGNED_BY_ID": "88", "NAME": "Synthetic", "LAST_NAME": "Person"}
        lead = {"ID": "10", "STATUS_ID": "UC_PWTVG6", "STATUS_SEMANTIC_ID": "P", "CONTACT_ID": "1",
                "ASSIGNED_BY_ID": "999", "NAME": "Guest", "PHONE": [{"VALUE": PHONE}]} if native else None
        super().__init__(contact=contact, lead=lead, **kwargs)
        self.calls = []
        code = "whatsappbyedna|1|" + PHONE.lstrip("+") + "@2423|901"
        self.dialog = {"id": 200, "entity_type": "LINES", "entity_id": code,
                       "entity_data_1": "Y|LEAD|10|N|N|300|0", "text_field_enabled": True,
                       "entity_data_2": "LEAD|" + ("10" if native else "0") + "|CONTACT|1|COMPANY|0|DEAL|0"}
        self.activity = {"ID": "500", "OWNER_ID": "10" if native else "1", "OWNER_TYPE_ID": "1" if native else "3",
                         "PROVIDER_ID": "IMOPENLINES_SESSION", "ASSOCIATED_ENTITY_ID": "300", "PROVIDER_PARAMS": {"USER_CODE": code}}
        self.history = {"sessionId": 300, "chatId": 200, "hasNextPage": False, "users": {"901": {"id": "901", "connector": True}},
                        "message": {"400": {"id": "400", "chatid": "200", "senderid": "901", "params": {"connectorMid": ["101"]}}}}
        self.seller = [{"ID": "44", "ACTIVE": True, "USER_TYPE": "employee"}]

    def get_lead_field(self, name):
        result = super().get_lead_field(name)
        if name == self.config.fields.lead_commercial_owner:
            result = {**result, "items": [*result["items"], {"ID": "7", "VALUE": "Bitrix"}]}
        return result

    def call(self, method, body):
        self.calls.append((method, copy.deepcopy(body)))
        if method == "imopenlines.dialog.get":
            return copy.deepcopy(self.dialog)
        if method == "crm.activity.get":
            return copy.deepcopy(self.activity)
        if method == "imopenlines.session.history.get":
            return copy.deepcopy(self.history)
        if method == "user.get":
            return copy.deepcopy(self.seller)
        if method == "crm.lead.list" and "@ID" in body.get("filter", {}):
            rows = [row for key, row in self.leads.items() if key in body["filter"]["@ID"]]
            return copy.deepcopy(rows[body.get("start", 0):body.get("start", 0) + 50])
        return super().call(method, body)


class OrganicProfileReuseTests(unittest.TestCase):
    def setUp(self):
        clock = patch.object(reuse, "now_utc", return_value=NOW)
        clock.start()
        self.addCleanup(clock.stop)

    def test_contact_proven_native_guest_enters_the_same_current_qualification_without_faking_a_flow(self):
        api = OrganicCrm()
        original_contact = copy.deepcopy(api.contacts)
        result = process(payload(), env={**ENV, "EDNA_INTAKE_FLOW_ID": ""}, client=api)
        self.assertEqual((result["action"], result["lead_id"], result["contact_id"], result["write_attempted"]), ("queued", "10", "1", True))
        self.assertEqual(api.contacts, original_contact)
        self.assertEqual(len(api.leads), 1)
        lead = api.leads["10"]
        self.assertEqual(lead["ASSIGNED_BY_ID"], "999")
        self.assertEqual(lead["UF_CRM_WA_FLOW"], reuse.SUBFLOW)
        self.assertEqual(lead["UF_CRM_WA_SUBFLOW"], reuse.SUBFLOW)
        self.assertEqual(lead["UF_CRM_WA_FLOW_ID"], "")
        self.assertEqual(lead["UF_CRM_WA_SUBFLOW_ID"], "")
        self.assertEqual(lead["UF_CRM_WA_TIMESTAMP"], payload()["provenance"]["confirmed_at"])
        self.assertTrue(evaluate_prequalification(build_prequalification_input_from_lead(lead, api.config)).qualified)
        self.assertEqual([method for method, _ in api.writes], ["crm.lead.update"])
        writes = copy.deepcopy(api.writes)
        self.assertEqual(process(payload(), env=ENV, client=api)["action"], "already_processed")
        self.assertEqual(api.writes, writes)

    def test_contact_only_native_identity_creates_one_idempotent_new_inquiry_without_touching_contact_owner(self):
        api = OrganicCrm(native=False)
        request = payload()
        request["crm_binding"]["native_lead_id"] = None
        before = copy.deepcopy(api.contacts)
        result = process(request, env=ENV, client=api)
        self.assertEqual(result["action"], "queued")
        self.assertEqual(len(api.leads), 1)
        self.assertEqual(api.contacts, before)
        self.assertEqual([method for method, _ in api.writes], ["crm.lead.add"])
        self.assertEqual(process(request, env=ENV, client=api)["action"], "already_processed")
        self.assertEqual(len(api.writes), 1)

    def test_terminal_native_lead_is_preserved_and_a_new_current_inquiry_runs_normal_processing(self):
        api = OrganicCrm()
        api.leads["10"].update(STATUS_ID="CONVERTED", STATUS_SEMANTIC_ID="S", UF_CRM_WA_ASSISTANCE_ID="old-case",
                               UF_CRM_1693840106704=CUIL, UF_CRM_REJECTION_REASON="old-rejection", UF_CRM_WA_ASSISTANCE_STATE="old-rejection")
        before = copy.deepcopy(api.leads["10"])
        result = process(payload(), env=ENV, client=api)
        self.assertEqual(result["action"], "queued")
        self.assertNotEqual(result["lead_id"], "10")
        self.assertEqual(api.leads["10"], before)
        self.assertNotIn("UF_CRM_REJECTION_REASON", api.leads[result["lead_id"]])

    def test_six_calendar_months_is_strict_and_does_not_depend_on_crm_modified_date(self):
        for confirmed, expected in [("2026-05-11T15:00:00Z", False), ("2026-05-11T15:00:01Z", True),
                                    ("2026-11-11T15:05:00Z", True), ("2026-11-11T15:05:01Z", False)]:
            with self.subTest(confirmed=confirmed):
                request = payload(); request["provenance"]["confirmed_at"] = confirmed
                api = OrganicCrm(); api.leads["10"]["DATE_MODIFY"] = NOW.isoformat()
                result = process(request, env=ENV, client=api)
                self.assertEqual(result["action"], "queued" if expected else "reused_not_valid")
                if not expected:
                    self.assertFalse(api.calls)
                    self.assertFalse(result["write_attempted"])
        self.assertEqual(reuse._cutoff(datetime(2026, 8, 31, tzinfo=timezone.utc), 6).isoformat(), "2026-02-28T00:00:00+00:00")

    def test_configurable_age_uses_source_confirmation_without_refreshing_it_on_reuse(self):
        request = payload(); request["provenance"]["confirmed_at"] = "2026-08-01T12:00:00Z"
        for months, expected in [("6", "queued"), ("3", "reused_not_valid"), ("0", "reused_not_valid"), ("invalid", "reused_not_valid")]:
            result = process(request, env={**ENV, "EDNA_ORGANIC_PROFILE_MAX_AGE_MONTHS": months}, client=OrganicCrm())
            self.assertEqual(result["action"], expected)

    def test_invalid_provenance_or_incomplete_v3_data_never_accesses_crm_or_claims_a_write(self):
        changes = [lambda p: p.update(flow_id="950118281197789"),
                   lambda p: p["provenance"].update(source_kind="phone_guess"),
                   lambda p: p["provenance"].update(v3_equivalent=False),
                   lambda p: p["provenance"].update(schema="legacy-v2"),
                   lambda p: p["provenance"].update(confirmed_at="2026-11-11 12:00:00"),
                   lambda p: p["crm_binding"].update(verified=False),
                   lambda p: p["crm_binding"].update(activity_id=None),
                   lambda p: p["crm_binding"].update(native_lead_id=None, contact_id=None),
                   lambda p: p["answer"].update(cuil="123"),
                   lambda p: p["answer"].update(email="bad"),
                   lambda p: p["answer"].update(banco_catamarca="ayuda"),
                   lambda p: p["answer"].update(situacion_catamarca="jubilado_pensionado", organismo_catamarca="anses")]
        for change in changes:
            with self.subTest(change=changes.index(change)):
                request = payload(); change(request); api = Mock()
                result = process(request, env=ENV, client=api)
                self.assertEqual(result["action"], "reused_not_valid")
                self.assertFalse(result["write_attempted"])
                api.call.assert_not_called()

    def test_every_supported_source_has_the_same_contract_and_no_archived_financial_decision_is_used(self):
        for source in sorted(reuse.SOURCE_KINDS):
            request = payload(); request["provenance"]["source_kind"] = source
            request.update(previous_approved=True, previous_bcra_result="good")
            api = OrganicCrm()
            if source == "crm_verified_profile":
                request["provenance"]["source_id"] = "21"
                api.leads["21"] = {"ID": "21", "STATUS_SEMANTIC_ID": "S", "CONTACT_ID": "1",
                                   api.config.fields.lead_cuil: CUIL, "UF_CRM_WA_FLOW": "whatsapp_intake",
                                   "UF_CRM_WA_TIMESTAMP": request["provenance"]["confirmed_at"]}
            self.assertEqual(process(request, env=ENV, client=api)["action"], "queued")
            self.assertNotIn("previous_bcra_result", api.leads["10"])

    def test_false_native_messages_session_activity_and_connector_proofs_stop_before_writes(self):
        changes = [lambda a: a.history.update(hasNextPage=True),
                   lambda a: a.history["message"]["400"]["params"].update(connectorMid=["999"]),
                   lambda a: a.history["users"]["901"].update(connector=False),
                   lambda a: a.activity.update(OWNER_ID="999"),
                   lambda a: a.activity.update(ASSOCIATED_ENTITY_ID="999"),
                   lambda a: a.dialog.update(entity_data_1="Y|LEAD|10|N|N|999|0"),
                   lambda a: a.dialog.update(entity_data_2="LEAD|999|CONTACT|1"),
                   lambda a: a.dialog.update(entity_id="whatsappbyedna|2|" + PHONE.lstrip("+") + "@2423|901")]
        for change in changes:
            with self.subTest(change=changes.index(change)):
                api = OrganicCrm(); change(api)
                result = process(payload(), env=ENV, client=api)
                self.assertEqual(result["action"], "manual_review")
                self.assertFalse(result["write_attempted"])
                self.assertFalse(api.writes)

    def test_shared_phone_and_multiple_cuil_contacts_cannot_select_a_person(self):
        for change in [lambda a: a.contacts["1"].update(UF_CONTACT_CUIL="20999999999"),
                       lambda a: a.contacts.update({"2": {"ID": "2", "UF_CONTACT_CUIL": CUIL, "PHONE": [{"VALUE": PHONE}]}})]:
            api = OrganicCrm(); change(api)
            self.assertEqual(process(payload(), env=ENV, client=api)["action"], "manual_review")
            self.assertFalse(api.writes)

    def test_a_recent_profile_with_one_current_phone_contact_recognizes_the_unlinked_guest(self):
        api = OrganicCrm()
        api.leads["10"].pop("CONTACT_ID")
        api.dialog["entity_data_2"] = "LEAD|10|CONTACT|0|COMPANY|0|DEAL|0"
        request = payload(); request["crm_binding"]["contact_id"] = None
        result = process(request, env=ENV, client=api)
        self.assertEqual((result["action"], result["contact_id"], result["write_attempted"]), ("queued", "1", True))
        self.assertEqual(len(api.leads), 1)
        self.assertEqual(api.leads["10"]["CONTACT_ID"], "1")
        self.assertEqual(api.contacts["1"]["ASSIGNED_BY_ID"], "88")

    def test_an_unlinked_guest_with_two_people_or_a_changed_source_identity_is_not_merged(self):
        for condition in ("contacts", "leads", "source"):
            api = OrganicCrm()
            api.leads["10"].pop("CONTACT_ID")
            api.dialog["entity_data_2"] = "LEAD|10|CONTACT|0|COMPANY|0|DEAL|0"
            request = payload(); request["crm_binding"]["contact_id"] = None
            if condition == "contacts":
                api.contacts["2"] = {"ID": "2", "PHONE": [{"VALUE": PHONE}], "UF_CONTACT_CUIL": "20999999999"}
            elif condition == "leads":
                api.leads["21"] = {"ID": "21", "PHONE": [{"VALUE": PHONE}], api.config.fields.lead_cuil: "20999999999"}
            else:
                request["provenance"].update(source_kind="crm_verified_profile", source_id="21")
                api.leads["21"] = {"ID": "21", "PHONE": [], api.config.fields.lead_cuil: "20999999999",
                                   "UF_CRM_WA_TIMESTAMP": request["provenance"]["confirmed_at"]}
            with self.subTest(condition=condition):
                result = process(request, env=ENV, client=api)
                self.assertEqual(result["action"], "manual_review")
                self.assertFalse(result["write_attempted"])
                self.assertFalse(api.writes)

    def test_a_source_lead_without_a_current_cuil_contact_cannot_create_a_contact_by_reuse(self):
        api = OrganicCrm()
        api.contacts = {}
        api.leads["10"].pop("CONTACT_ID")
        api.leads["10"][api.config.fields.lead_cuil] = CUIL
        api.dialog["entity_data_2"] = "LEAD|10|CONTACT|0|COMPANY|0|DEAL|0"
        request = payload(); request["crm_binding"]["contact_id"] = None
        result = process(request, env=ENV, client=api)
        self.assertEqual((result["action"], result["reason"], result["write_attempted"]),
                         ("reused_not_valid", "current_person_unproven", False))
        self.assertFalse(api.writes)

    def test_one_existing_commercial_case_returns_its_current_seller_without_any_writes(self):
        api = OrganicCrm()
        api.leads["11"] = {"ID": "11", "STATUS_SEMANTIC_ID": "S", "ASSIGNED_BY_ID": "44", "CONTACT_ID": "1",
                           api.config.fields.lead_cuil: CUIL}
        api.deals = [{"ID": "900", "LEAD_ID": "11", "CONTACT_ID": "1", "CATEGORY_ID": "1", "STAGE_ID": "C1:NEW",
                      "STAGE_SEMANTIC_ID": "P", "ASSIGNED_BY_ID": "44"}]
        before = copy.deepcopy((api.leads, api.contacts, api.deals))
        result = process(payload(), env=ENV, client=api)
        self.assertEqual((result["action"], result["deal_id"], result["seller_id"], result["lead_id"]), ("assigned_case", "900", "44", "11"))
        self.assertFalse(result["write_attempted"])
        self.assertEqual((api.leads, api.contacts, api.deals), before)
        self.assertFalse(api.writes)

    def test_ambiguous_closed_other_category_or_provisional_management_is_never_duplicated(self):
        for condition in ["multiple", "category", "queue", "inactive", "identity", "provisional"]:
            api = OrganicCrm()
            api.deals = [{"ID": "900", "CONTACT_ID": "1", "CATEGORY_ID": "1", "STAGE_ID": "C1:NEW",
                          "STAGE_SEMANTIC_ID": "P", "ASSIGNED_BY_ID": "44"}]
            if condition == "multiple":
                api.deals.append({**api.deals[0], "ID": "901"})
            elif condition == "category": api.deals[0]["CATEGORY_ID"] = "5"
            elif condition == "queue": api.deals[0]["STAGE_ID"] = "C1:KESTRA_QUEUE"
            elif condition == "inactive": api.seller[0]["ACTIVE"] = False
            elif condition == "identity": api.deals[0]["LEAD_ID"] = "999"
            elif condition == "provisional": api.deals[0]["ASSIGNED_BY_ID"] = "57"
            with self.subTest(condition=condition):
                self.assertEqual(process(payload(), env=ENV, client=api)["action"], "manual_review")
                self.assertFalse(api.writes)

    def test_manual_native_owners_explicit_policies_and_other_pending_inquiries_are_preserved(self):
        for condition in ["manual-engine", "explicit-policy", "unknown-engine", "zero-policy", "existing-inquiry", "profile-conflict"]:
            api = OrganicCrm()
            if condition == "manual-engine": api.leads["10"]["UF_CRM_COMM_OWNER"] = "3"
            elif condition == "explicit-policy": api.leads["10"]["UF_CRM_PROCESSING_POLICY"] = "4"
            elif condition == "unknown-engine": api.leads["10"]["UF_CRM_COMM_OWNER"] = 0
            elif condition == "zero-policy": api.leads["10"]["UF_CRM_PROCESSING_POLICY"] = 0
            elif condition == "profile-conflict": api.leads["10"][api.config.fields.lead_province] = "209"
            else: api.leads["11"] = {"ID": "11", "STATUS_SEMANTIC_ID": "P", api.config.fields.lead_cuil: CUIL}
            with self.subTest(condition=condition):
                self.assertEqual(process(payload(), env=ENV, client=api)["action"], "manual_review")
                self.assertFalse(api.writes)

    def test_lost_write_acknowledgement_is_never_retried_and_never_becomes_a_valid_flow_fallback(self):
        api = OrganicCrm(native=False); request = payload(); request["crm_binding"]["native_lead_id"] = None
        original = api.call
        def lost(method, body):
            value = original(method, body)
            if method == "crm.lead.add":
                raise TimeoutError("private-credential-must-not-escape")
            return value
        api.call = lost
        with self.assertRaises(TimeoutError) as caught:
            process(request, env=ENV, client=api)
        self.assertTrue(caught.exception.intake_crm_write_attempted)
        self.assertEqual(caught.exception.intake_crm_method, "crm.lead.add")
        self.assertEqual(len(api.writes), 1)
        self.assertEqual(len(api.leads), 1)

    def test_native_bitrix_handoff_preserves_human_owner_and_raw_acquisition(self):
        api = OrganicCrm()
        api.leads["10"].update(UF_CRM_COMM_OWNER="7", UF_CRM_PROCESSING_POLICY=False,
                               UTM_CAMPAIGN="native_campaign", UTM_SOURCE="facebook")
        result = process(payload(), env=ENV, client=api)
        self.assertEqual(result["action"], "queued")
        self.assertEqual(api.leads["10"]["ASSIGNED_BY_ID"], "999")
        self.assertEqual(api.leads["10"]["UTM_CAMPAIGN"], "native_campaign")
        self.assertEqual(api.leads["10"]["UTM_SOURCE"], "facebook")
        self.assertEqual(api.contacts["1"]["ASSIGNED_BY_ID"], "88")

    def test_current_v3_rejection_is_recomputed_without_inheriting_an_old_approval(self):
        api = OrganicCrm()
        request = payload(); request["answer"]["situacion_catamarca"] = "otra"
        request.update(previous_approved=True)
        result = process(request, env=ENV, client=api)
        self.assertEqual((result["action"], result["reason"]), ("rejected", "employment_status_not_eligible"))
        self.assertEqual(api.leads["10"]["STATUS_ID"], "JUNK")
        self.assertTrue(result["write_attempted"])

    def test_disabled_gate_and_dry_run_never_access_any_provider(self):
        for changes in [{"EDNA_INTAKE_CRM_ENABLED": "false"}, {"EDNA_INTAKE_RECIPIENTS": "5493519999999"}]:
            api = Mock()
            result = process(payload(), env={**ENV, **changes}, client=api)
            self.assertEqual(result["action"], "disabled")
            self.assertFalse(result["write_attempted"])
            api.call.assert_not_called()
        request = payload(); request["dry_run"] = True; api = Mock()
        self.assertEqual(process(request, env=ENV, client=api)["action"], "dry_run")
        api.call.assert_not_called()

    def test_malformed_case_identity_does_not_echo_private_values_and_never_writes(self):
        request = payload(); request["case_id"] = "https://private.example.test/secret"
        api = Mock()
        result = process(request, env=ENV, client=api)
        self.assertEqual((result["action"], result["case_id"], result["write_attempted"]), ("reused_not_valid", "", False))
        api.call.assert_not_called()

    def test_a_human_owner_change_during_preflight_stops_before_the_first_write(self):
        api = OrganicCrm()
        original = api.call
        reads = 0
        def changed(method, body):
            nonlocal reads
            if method == "crm.lead.get" and str(body["id"]) == "10":
                reads += 1
                if reads == 2:
                    api.leads["10"]["ASSIGNED_BY_ID"] = "777"
            return original(method, body)
        api.call = changed
        result = process(payload(), env=ENV, client=api)
        self.assertEqual((result["action"], result["reason"], result["write_attempted"]),
                         ("manual_review", "native_inquiry_changed", False))
        self.assertEqual(api.leads["10"]["ASSIGNED_BY_ID"], "777")
        self.assertFalse(api.writes)


if __name__ == "__main__":
    unittest.main()
