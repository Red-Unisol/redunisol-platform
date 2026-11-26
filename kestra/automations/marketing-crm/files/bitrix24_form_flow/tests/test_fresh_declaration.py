import copy
from datetime import datetime, timedelta, timezone
import unittest

from bitrix24_form_flow.form_processor import fresh_declaration as fresh
from bitrix24_form_flow.form_processor.whatsapp_intake import process
from test_organic_profile_reuse import ENV, OrganicCrm, payload


FLOW = "950118281197789"
CONFIG = {**ENV, "EDNA_INTAKE_FLOW_ID": FLOW}


def declaration():
    data = payload()
    data.pop("provenance")
    received = datetime.now(timezone.utc) - timedelta(minutes=3)
    data.update(contract=fresh.CONTRACT, received_at=received.isoformat(), flow_id=FLOW,
                response={"request_id": "875", "case_id": data["case_id"], "transport_id": data["case_id"],
                          "message_id": "102", "event_id": 21, "outgoing_message_id": "220"})
    data["entry_context"]["received_at"] = (received - timedelta(minutes=2)).isoformat()
    data["attribution"]["wa"].update(WA_FLOW_ID=FLOW, WA_FLOW="whatsapp_intake")
    return data


class FreshCrm(OrganicCrm):
    def __init__(self):
        super().__init__()
        self.epoch = int((datetime.now(timezone.utc) - timedelta(minutes=8)).timestamp())
        self.dialog.update(entity_data_1=f"Y|LEAD|10|N|N|300|{self.epoch}", owner="74827")
        self.taken = False

    def call(self, method, body):
        if method == "imopenlines.v2.Session.list":
            return {"hasNextPage": False, "sessions": [{"id": 300, "chatId": 200, "configId": 1,
                    "dateCreate": datetime.fromtimestamp(self.epoch, timezone.utc).isoformat(),
                    "status": "new", "operatorId": "74827", "dateClose": None, "dateFirstAnswer": None,
                    "dateOperatorAnswer": "2026-11-01" if self.taken else None}]}
        if method == "imopenlines.v2.Session.Stat.get":
            return {"sessions": [{"sessionId": "300", "messagesOperatorCount": 0, "transfersCount": 0}]}
        if method == "imopenlines.v2.Session.Transfer.list":
            return {"hasNextPage": False, "transfers": []}
        return super().call(method, body)


class FreshDeclarationTests(unittest.TestCase):
    def test_131043_stores_the_new_application_once_without_using_the_other_person(self):
        api = FreshCrm()
        api.leads["10"][api.config.fields.lead_cuil] = "20999999999"
        api.contacts["1"][api.config.fields.contact_cuil] = "20999999999"
        api.deals = [{"ID": "33", "LEAD_ID": "10", "ASSIGNED_BY_ID": "99"}]
        old = copy.deepcopy((api.leads["10"], api.contacts, api.deals))
        data = declaration()
        first = process(data, env=CONFIG, client=api)
        self.assertEqual((first["action"], first["contact_id"]), ("queued", ""))
        lead = api.leads[first["lead_id"]]
        self.assertEqual((lead["ORIGIN_ID"], lead["UF_CRM_WA_FLOW_ID"], lead["UF_CRM_WA_SUBFLOW_ID"]),
                         (data["case_id"], FLOW, FLOW))
        self.assertNotIn("CONTACT_ID", lead)
        self.assertEqual((api.leads["10"], api.contacts, api.deals), old)
        self.assertFalse(any(m in {"crm.contact.list", "crm.duplicate.findbycomm", "crm.deal.list"} for m, _ in api.calls))
        replay = process(data, env=CONFIG, client=api)
        self.assertEqual((replay["action"], replay["lead_id"], replay["write_attempted"]),
                         ("already_processed", first["lead_id"], False))
        data["answer"]["banco_catamarca"] = "otro"
        self.assertEqual(process(data, env=CONFIG, client=api)["reason"], "fresh_case_id_conflict")
        self.assertEqual(len(api.writes), 1)

    def test_mismatched_source_actual_take_or_uncertain_session_cannot_write(self):
        for condition in ("flow", "case", "historic", "history", "manual"):
            with self.subTest(condition=condition):
                api, data = FreshCrm(), declaration()
                if condition == "flow":
                    data["attribution"]["wa"]["WA_FLOW_ID"] = "123"
                elif condition == "case":
                    data["response"]["case_id"] = data["response"]["case_id"][::-1]
                elif condition == "historic":
                    data["provenance"] = {"source_kind": "web_form"}
                elif condition == "history":
                    api.history["message"]["400"]["params"] = {"connectorMid": ["999"]}
                else:
                    api.taken = True
                self.assertEqual(process(data, env=CONFIG, client=api)["action"], "manual_review")
                self.assertFalse(api.writes)

    def test_explicit_rejection_needs_no_identity_or_historical_records(self):
        api, data = FreshCrm(), declaration()
        data["answer"].update(cuil="123", situacion_catamarca="otra")
        first = process(data, env=CONFIG, client=api)
        replay = process(data, env=CONFIG, client=api)
        self.assertEqual((first["action"], first["reason"]), ("rejected", "employment_status_not_eligible"))
        self.assertEqual((replay["action"], replay["lead_id"]), ("rejected", first["lead_id"]))
        self.assertNotIn(api.config.fields.lead_cuil, api.leads[first["lead_id"]])
        self.assertEqual(len(api.writes), 1)

    def test_invalid_cuil_survives_as_one_visible_correction_lead_without_any_identity_inheritance(self):
        api, data = FreshCrm(), declaration()
        data["answer"]["cuil"] = "123"
        first = process(data, env=CONFIG, client=api)
        replay = process(data, env=CONFIG, client=api)
        self.assertEqual((first["action"], first["reason"]), ("manual_review", "pending_cuil"))
        self.assertEqual((replay["lead_id"], replay["reason"]), (first["lead_id"], "pending_cuil"))
        lead = api.leads[first["lead_id"]]
        self.assertEqual((lead["STATUS_ID"], lead["UF_CRM_WA_CUIL_INVALID"]), ("UC_WA_CUIL_REVIEW", "123"))
        self.assertNotIn(api.config.fields.lead_cuil, lead)
        self.assertNotIn("CONTACT_ID", lead)
        self.assertEqual(len(api.writes), 1)
