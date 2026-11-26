from hashlib import sha256
import json
import unittest

from bitrix24_form_flow.form_processor.fresh_prequalification import CONTRACT
from bitrix24_form_flow.form_processor.whatsapp_intake import process


FLOW = "950118281197789"
CASE = "5320b977-9095-4eaf-8c91-9b4ee1671b50"
SUBMISSION = "4dfbc372-a680-4062-9f33-d22784e145ef"


def receipt(fields):
    return {"contract": CONTRACT, "case_id": CASE, "web_submission_id": SUBMISSION, "flow_id": FLOW,
            "fields": fields, "input_digest": sha256(json.dumps(fields, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
            "received_at": "2026-11-26T12:00:00-03:00"}


class FreshPrequalificationTests(unittest.TestCase):
    def evaluate(self, fields):
        # No Bitrix URL, registry, token, existing lead or personal data required.
        return process(receipt(fields), env={"EDNA_INTAKE_FLOW_ID": FLOW}, client=object())

    def test_revised_declared_fields_change_the_decision_without_writing_crm(self):
        fields = {"provincia": "cordoba", "situacion_cordoba": "docente", "banco_cordoba": "otro"}
        before = self.evaluate(fields)
        self.assertEqual((before["action"], before["reason"]), ("rejected", "payment_bank_not_eligible"))
        after = self.evaluate(dict(fields, banco_cordoba="bancor"))
        self.assertEqual(after["action"], "qualified")
        self.assertNotEqual(before["input_digest"], after["input_digest"])
        self.assertEqual(after, self.evaluate(dict(fields, banco_cordoba="bancor")))
        self.assertEqual((after["case_id"], after["web_submission_id"], after["write_attempted"]), (CASE, SUBMISSION, False))
        self.assertTrue(after["rule_version"])
        self.assertEqual(self.evaluate({"provincia": "cordoba", "situacion_cordoba": "pensionado",
                                       "organismo": "caja_cordoba"})["action"], "qualified")

    def test_unusable_input_yields_an_explicit_pending_result(self):
        for fields in [{}, {"provincia": "cordoba", "situacion_cordoba": "docente", "banco_cordoba": "ayuda"}]:
            with self.subTest(fields=fields):
                result = self.evaluate(fields)
                self.assertEqual((result["ok"], result["action"], result["reason"]), (True, "pending", "missing_policy_input"))

    def test_rejects_mismatched_digest_and_identifying_fields(self):
        request = receipt({"provincia": "cordoba"})
        request["input_digest"] = "0" * 64
        self.assertFalse(process(request, env={"EDNA_INTAKE_FLOW_ID": FLOW})["ok"])
        self.assertFalse(self.evaluate({"provincia": "cordoba", "cuil": "12345678900"})["ok"])
