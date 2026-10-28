import copy
import json
import unittest
from unittest.mock import Mock

from edna_incoming.assistance import FLOW_ID, evaluate, normalize_answer, valid_cuil
from bitrix24_form_flow.form_processor.attribution import CRM_FIELDS, WA_FIELDS
from bitrix24_form_flow.form_processor.config import load_config
from bitrix24_form_flow.form_processor.lead_service import build_prequalification_input_from_lead
from bitrix24_form_flow.form_processor.qualification import evaluate_prequalification
from bitrix24_form_flow.form_processor.whatsapp_assistance import EXTRA_FIELDS, process

CASE = "00000000-0000-4000-8000-000000000001"
PHONE = "+5493511234567"
CUIL = "20301234563"  # Synthetic identity with a valid check digit.
ENV = {"BITRIX24_BASE_URL": "https://crm.example.test", "BITRIX24_WEBHOOK_PATH": "rest/1/test",
       "BITRIX24_CONTACT_CUIL_FIELD": "UF_CONTACT_CUIL", "BITRIX24_LEAD_STATUS_QUALIFIED": "WON",
       "BITRIX24_LEAD_STATUS_REJECTED": "JUNK", "EDNA_ASSISTANCE_CRM_ENABLED": "true",
       "EDNA_ASSISTANCE_RECIPIENTS": PHONE[1:], "BITRIX24_LEAD_STATUS_ASSISTANCE_REVIEW": "ASSISTANCE_REVIEW"}


def payload(**answer):
    return {"case_id": CASE, "phone": PHONE, "dry_run": False,
            "answer": {"organismo": "caja_cordoba", "continuidad_caja": "ayuda", **answer}}


class Crm:
    def __init__(self, *, contact=None, lead=None):
        self.contacts = {str(contact["ID"]): copy.deepcopy(contact)} if contact else {}
        self.leads = {str(lead["ID"]): copy.deepcopy(lead)} if lead else {}
        self.writes = []
        self.config = load_config(ENV)

    def get_lead_field(self, name):
        return {"items": [{"ID": str(i), "VALUE": label} for i, label in enumerate(
            ["Sin origen", "Kestra", "Manual", "No procesar", "Procesar", "OTRO BANCO"], 1)]}

    def call(self, method, body):
        if method == "crm.status.list":
            return [{"STATUS_ID": s, "SEMANTICS": "P"} for s in ("ASSISTANCE_REVIEW", "ASSISTANCE_TEST")]
        if method == "crm.lead.fields":
            names = (*CRM_FIELDS, *WA_FIELDS, "UF_CRM_WA_TEST", *("UF_CRM_" + n for n in EXTRA_FIELDS))
            return {n: {"type": "datetime" if n.endswith(("TIMESTAMP", "FECHA_ORIGEN")) else "string", "isMultiple": False} for n in names}
        if method == "crm.duplicate.findbycomm":
            store = self.contacts if body["entity_type"] == "CONTACT" else self.leads
            ids = [k for k, r in store.items() if r.get("PHONE")]
            return {body["entity_type"]: ids} if ids else []  # Actual Bitrix empty result shape.
        entity = method.split(".")[1]
        store = self.contacts if entity == "contact" else self.leads
        op = method.split(".")[2]
        if op == "get":
            return copy.deepcopy(store[str(body["id"])])
        if op == "list":
            rows = list(store.values())
            for key, value in body.get("filter", {}).items():
                rows = [r for r in rows if str(r.get(key.lstrip("="))) == str(value)]
            return copy.deepcopy(rows)
        if op in {"update", "add"}:
            self.writes.append((method, copy.deepcopy(body)))
            key = str(body["id"]) if op == "update" else str(100 + len(store))
            record = store.setdefault(key, {"ID": key, "STATUS_SEMANTIC_ID": "P"})
            record.update(copy.deepcopy(body["fields"]))
            return True if op == "update" else int(key)
        raise AssertionError(method)


class AssistanceTests(unittest.TestCase):
    def test_optional_identity_combinations(self):
        self.assertTrue(valid_cuil(CUIL))
        for cuil, email in [(None, None), (CUIL, None), (None, " TEST@example.com "), (CUIL, "TEST@example.com")]:
            with self.subTest(cuil=bool(cuil), email=bool(email)):
                answer = normalize_answer(payload(cuil_caja=cuil, email_caja=email)["answer"])
                self.assertEqual(answer["cuil"], cuil)
                self.assertEqual(answer["email"], "test@example.com" if email else None)

    def test_invalid_optional_values_are_not_used_or_a_rejection(self):
        answer = normalize_answer(payload(cuil_caja="123", email_caja="bad")["answer"])
        self.assertEqual((answer["cuil"], answer["email"]), (None, None))
        self.assertEqual((answer["cuil_status"], answer["email_status"]), ("invalid", "invalid"))
        self.assertEqual(answer["action"], "intake")

    def test_hidden_branch_and_form_values_are_ignored(self):
        answer = normalize_answer({"organismo": "anses", "banco_anses": "bancor", "continuidad_anses": "ayuda",
                                   "cuil_caja": CUIL, "email_caja": "old@example.com"})
        self.assertIsNone(answer["cuil"])
        self.assertIsNone(answer["email"])
        answer = normalize_answer(payload(continuidad_caja="formulario", cuil_caja=CUIL)["answer"])
        self.assertEqual(answer["action"], "landing")
        self.assertIsNone(answer["cuil"])

    def test_bank_rejection_needs_no_identity(self):
        answer = normalize_answer({"organismo": "anses", "banco_anses": "otro", "cuil_anses": CUIL})
        self.assertEqual(answer["action"], "bank_rejected")
        self.assertIsNone(answer["cuil"])

    def test_simulation_and_empty_allowlist_never_contact_crm(self):
        api = Mock()
        self.assertEqual(process(dict(payload(), dry_run=True), env={}, client=api)["action"], "dry_run")
        for changes in [{"EDNA_ASSISTANCE_CRM_ENABLED": "false"}, {"EDNA_ASSISTANCE_RECIPIENTS": ""}]:
            self.assertEqual(process(payload(), env={**ENV, **changes}, client=api)["action"], "disabled")
        api.call.assert_not_called()

    def test_empty_email_preserves_existing_email_and_upgrades_guest(self):
        lead = {"ID": "10", "STATUS_SEMANTIC_ID": "P", "PHONE": [{"VALUE": PHONE}],
                "EMAIL": [{"VALUE": "known@example.com"}]}
        api = Crm(lead=lead)
        result = process(payload(), env=ENV, client=api)
        self.assertEqual((result["action"], result["lead_id"]), ("manual_review", "10"))
        self.assertEqual(api.leads["10"]["EMAIL"], lead["EMAIL"])
        self.assertEqual(api.leads["10"]["STATUS_ID"], "ASSISTANCE_REVIEW")
        self.assertNotIn(api.config.fields.lead_cuil, api.leads["10"])
        self.assertFalse(any(m.endswith(".add") for m, _ in api.writes))

    def test_valid_cuil_without_email_enters_existing_prefill(self):
        api = Crm()
        result = process(payload(cuil_caja=CUIL), env=ENV, client=api)
        self.assertEqual(result["action"], "queued")
        lead = api.leads[result["lead_id"]]
        self.assertEqual(lead["STATUS_ID"], api.config.lead_statuses.new)
        self.assertNotIn("EMAIL", lead)
        self.assertEqual(lead[api.config.fields.lead_cuil], CUIL)
        self.assertTrue(lead["CONTACT_ID"])
        submission = build_prequalification_input_from_lead(lead, api.config)
        self.assertTrue(evaluate_prequalification(submission).qualified)

    def test_phone_bound_known_cuil_can_be_reused_without_requesting_it(self):
        contact = {"ID": "1", "PHONE": [{"VALUE": PHONE}], "UF_CONTACT_CUIL": CUIL,
                   "EMAIL": [{"VALUE": "old@example.com"}]}
        api = Crm(contact=contact)
        result = process(payload(), env=ENV, client=api)
        self.assertEqual(result["action"], "queued")
        self.assertEqual(api.contacts["1"]["EMAIL"], contact["EMAIL"])

    def test_case_replay_never_writes_twice(self):
        api = Crm()
        first = process(payload(), env=ENV, client=api)
        count = len(api.writes)
        second = process(payload(), env=ENV, client=api)
        self.assertEqual(second["action"], "already_processed")
        self.assertEqual(second["lead_id"], first["lead_id"])
        self.assertEqual(len(api.writes), count)

    def test_organism_unknown_with_cuil_is_manual_and_not_rejected(self):
        api = Crm()
        result = process({**payload(), "answer": {"organismo": "ayuda", "cuil_ayuda": CUIL}}, env=ENV, client=api)
        self.assertEqual(result["reason"], "pending_organism")
        self.assertEqual(api.leads[result["lead_id"]]["STATUS_ID"], "ASSISTANCE_REVIEW")

    def test_callback_requires_verified_second_flow_and_receipt_has_no_pii(self):
        event = {"subjectId": "2423", "id": "101", "receivedAt": "2026-10-19T12:00:00Z",
                 "replyOutMessageExternalRequestId": CASE, "replyOutMessageId": "900",
                 "messageContent": {"type": "FLOW", "text": json.dumps(payload(cuil_caja=CUIL, email_caja="x@example.com")["answer"])}}
        request = {"request_id": CASE, "event": event, "context": {"case_id": 1, "verified": True,
                   "flow_id": FLOW_ID, "request_id": CASE, "outgoing_message_id": "900"}}
        receipt, artifact = evaluate(request, "2423")
        self.assertTrue(receipt["ok"])
        self.assertEqual(artifact["cuil"], CUIL)
        self.assertNotIn(CUIL, json.dumps(receipt))
        self.assertNotIn("x@example.com", json.dumps(receipt))
        request["context"]["flow_id"] = "1850162769693486"
        self.assertFalse(evaluate(request, "2423")[0]["ok"])

    def test_all_identity_combinations_persist_without_requiring_email(self):
        for cuil, email in [(None, None), (CUIL, None), (None, "person@example.com"), (CUIL, "person@example.com")]:
            with self.subTest(cuil=bool(cuil), email=bool(email)):
                api = Crm()
                result = process(payload(cuil_caja=cuil, email_caja=email), env=ENV, client=api)
                self.assertEqual(result["action"], "queued" if cuil else "manual_review")
                lead = api.leads[result["lead_id"]]
                self.assertEqual(bool(lead.get("EMAIL")), bool(email))

    def test_conflicting_known_cuil_never_updates_another_identity(self):
        api = Crm(contact={"ID": "1", "PHONE": [{"VALUE": PHONE}], "UF_CONTACT_CUIL": "20123456786"})
        self.assertTrue(valid_cuil("20123456786"))
        self.assertEqual(process(payload(cuil_caja=CUIL), env=ENV, client=api)["action"], "review")
        self.assertEqual(api.writes, [])

    def test_missing_manual_destination_and_schema_fail_before_any_write(self):
        for changes in [{"BITRIX24_LEAD_STATUS_ASSISTANCE_REVIEW": ""}, {"BITRIX24_LEAD_STATUS_ASSISTANCE_REVIEW": "NEW"}]:
            api = Crm()
            with self.assertRaises(ValueError):
                process(payload(), env={**ENV, **changes}, client=api)
            self.assertEqual(api.writes, [])

    def test_no_journey_clears_stale_campaign_without_defaulting_to_google(self):
        api = Crm(lead={"ID": "10", "STATUS_SEMANTIC_ID": "P", "PHONE": [{"VALUE": PHONE}],
                        "UTM_SOURCE": "google", "UTM_CAMPAIGN": "old", "UF_CRM_GCLID": "old-click"})
        process(payload(), env=ENV, client=api)
        self.assertEqual(api.leads["10"]["UTM_SOURCE"], "")
        self.assertEqual(api.leads["10"]["UTM_CAMPAIGN"], "")
        self.assertEqual(api.leads["10"]["UF_CRM_GCLID"], "")
        self.assertEqual(json.loads(api.leads["10"]["UF_CRM_ATTR_JSON"])["source_label"], "Sin origen")

    def test_resolved_journey_preserves_campaign_and_assistance(self):
        api = Crm()
        snapshot = {"version": 1, "status": "resolved", "journey_id": "AbCdEf1234", "first": {},
                    "last": {"utm_source": "facebook", "utm_campaign": "retirees", "fbclid": "click"},
                    "wa_assisted": True, "wa": {"WA_FLOW": "web_whatsapp_router"}}
        result = process(dict(payload(), attribution=snapshot), env=ENV, client=api)
        lead = api.leads[result["lead_id"]]
        self.assertEqual(lead["UTM_SOURCE"], "facebook")
        self.assertEqual(lead["UTM_CAMPAIGN"], "retirees")
        self.assertEqual(lead["UF_CRM_JOURNEY_ID"], "AbCdEf1234")
        self.assertEqual(lead["UF_CRM_WA_SUBFLOW_ID"], FLOW_ID)


if __name__ == "__main__":
    unittest.main()
