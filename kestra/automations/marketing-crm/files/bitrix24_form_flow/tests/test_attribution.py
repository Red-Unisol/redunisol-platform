from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from bitrix24_form_flow.form_processor.attribution import CRM_FIELDS, WA_FIELDS, copy_to_deal, source_from_lead
from bitrix24_form_flow.form_processor.business_logic import submission_payload_with_original_tracking
from bitrix24_form_flow.form_processor.config import load_config
from bitrix24_form_flow.form_processor.input_parser import normalize_business_input
from bitrix24_form_flow.form_processor.lead_service import create_lead, build_submission_from_lead


class AttributionTests(unittest.TestCase):
    def setUp(self):
        self.config = load_config({"BITRIX24_BASE_URL": "https://example.test/rest", "BITRIX24_WEBHOOK_PATH": "1/test", "BITRIX24_CONTACT_CUIL_FIELD": "UF_CONTACT_CUIL", "BITRIX24_LEAD_STATUS_QUALIFIED": "QUALIFIED", "BITRIX24_LEAD_STATUS_REJECTED": "REJECTED"})
        self.payload = {
            "full_name": "Juan Perez", "email": "juan@example.test", "whatsapp": "3511234567",
            "cuil": "20-12345678-3", "province": "209", "employment_status": "1269",
            "payment_bank": "439", "lead_source": "Facebook", "utm_source": "meta",
            "utm_campaign": "cordoba",
            "attribution": {
                "version": 1, "journey_id": "a" * 24, "status": "resolved",
                "ga_client_id": "123456789.1791469720", "ga_session_id": "1791469719",
                "first": {"utm_source": "meta", "utm_campaign": "primera", "fbclid": "click"},
                "last": {"utm_source": "meta", "utm_campaign": "cordoba"},
                "wa_assisted": True, "wa": {"WA_SEGMENT": "cordoba_jubilado"},
            },
        }
        self.client = MagicMock()
        self.client.get_lead_field.return_value = {"items": [
            {"ID": "11", "VALUE": "No procesar"}, {"ID": "12", "VALUE": "Kestra"},
            {"ID": "9991", "VALUE": "Sin origen"},
        ]}
        self.schema = {name: {"type": "datetime" if name in {"UF_CRM_WA_TIMESTAMP", "UF_CRM_FECHA_ORIGEN"} else "string", "isMultiple": False}
                       for name in (*CRM_FIELDS, *WA_FIELDS)}
        self.client.call.side_effect = lambda method, payload: self.schema if method == "crm.lead.fields" else 123

    def test_snapshot_survives_normalization_and_new_lead_and_deal(self):
        submission = normalize_business_input(self.payload)
        forwarded = submission_payload_with_original_tracking(self.payload, submission)
        self.assertEqual(forwarded["attribution"], self.payload["attribution"])
        self.assertEqual(create_lead(self.client, self.config, submission, 42, MagicMock()), 123)
        added = next(c.args[1]["fields"] for c in self.client.call.call_args_list if c.args[0] == "crm.lead.add")
        self.assertEqual(added["CONTACT_ID"], 42)
        self.assertEqual(added["UTM_SOURCE"], "meta")
        self.assertEqual(added["UF_CRM_JOURNEY_ID"], "a" * 24)
        self.assertEqual(added["UF_CRM_WA_SEGMENT"], "cordoba_jubilado")
        snapshot = json.loads(added["UF_CRM_ATTR_JSON"])
        self.assertEqual(snapshot["first"]["utm_campaign"], "primera")
        self.assertEqual(snapshot["last"]["utm_campaign"], "cordoba")
        self.assertEqual(snapshot["ga_client_id"], "123456789.1791469720")
        self.assertEqual(snapshot["ga_session_id"], "1791469719")
        # Item API field aliases come from metadata, never a guessed casing transform.
        self.client.call.side_effect = None
        self.client.call.return_value = {"fields": {
            "actualAlias" + str(i): {"upperName": name}
            for i, name in enumerate((*CRM_FIELDS, *WA_FIELDS))
        }}
        fields = {}
        copy_to_deal(self.client, added, fields)
        self.assertEqual(fields["actualAlias0"], "a" * 24)
        self.assertEqual(fields["actualAlias1"], added["UF_CRM_ATTR_JSON"])
        self.assertFalse(any(c.args[0] == "crm.lead.update" for c in self.client.call.call_args_list))

    def test_short_reference_survives_lead_and_deal_without_case_conversion(self):
        self.payload["attribution"]["journey_id"] = "a7Kp3mR9xB"
        submission = normalize_business_input(self.payload)
        self.assertEqual(submission_payload_with_original_tracking(self.payload, submission)["attribution"]["journey_id"], "a7Kp3mR9xB")
        create_lead(self.client, self.config, submission, 42, MagicMock())
        added = next(c.args[1]["fields"] for c in self.client.call.call_args_list if c.args[0] == "crm.lead.add")
        self.assertEqual(added["UF_CRM_JOURNEY_ID"], "a7Kp3mR9xB")
        self.client.call.side_effect = None
        self.client.call.return_value = {"fields": {name: {"upperName": name} for name in (*CRM_FIELDS, *WA_FIELDS)}}
        fields = {}
        copy_to_deal(self.client, added, fields)
        self.assertEqual(fields["UF_CRM_JOURNEY_ID"], "a7Kp3mR9xB")

    def test_invalid_reference_lengths_and_characters_are_rejected(self):
        for reference in ["a" * 9, "a" * 11, "a" * 23, "a" * 25, "a7Kp3mR9x_", "a7Kp3mR9xB\n", 123]:
            with self.subTest(reference=reference), self.assertRaises(ValueError):
                payload = dict(self.payload, attribution=dict(self.payload["attribution"], journey_id=reference))
                normalize_business_input(payload)

    def test_unknown_source_uses_provisioned_enum_and_can_be_read_by_prefill(self):
        self.payload.update(lead_source="Sin origen", utm_source=None)
        self.payload["attribution"].update(status="unresolved_ref", first={}, last={}, wa_assisted=False, wa={})
        submission = normalize_business_input(self.payload)
        create_lead(self.client, self.config, submission, 42, MagicMock())
        lead = next(c.args[1]["fields"] for c in self.client.call.call_args_list if c.args[0] == "crm.lead.add")
        self.assertEqual(lead[self.config.fields.lead_source], "9991")
        self.assertNotIn("UF_CRM_WA_ASSISTED", lead)
        self.assertEqual(build_submission_from_lead(lead, self.config).lead_source.key, "sin_origen")
        lead[self.config.fields.lead_source] = "2423"
        self.assertEqual(source_from_lead(lead, self.config.fields.lead_source), "2423")

    def test_missing_schema_stops_before_silently_losing_attribution(self):
        self.schema.pop("UF_CRM_ATTR_JSON")
        with self.assertRaisesRegex(RuntimeError, "provisioning"):
            create_lead(self.client, self.config, normalize_business_input(self.payload), 42, MagicMock())
        self.assertFalse(any(c.args[0] == "crm.lead.add" for c in self.client.call.call_args_list))

    def test_old_leads_require_no_new_schema_and_do_not_change(self):
        fields = {"title": "historic"}
        copy_to_deal(self.client, {"ID": 4, "UTM_SOURCE": "google"}, fields)
        self.assertEqual(fields, {"title": "historic"})
        self.client.call.assert_not_called()

    def test_unknown_snapshot_accepts_php_empty_arrays_without_inventing_a_source(self):
        self.payload["lead_source"] = "Sin origen"
        self.payload["attribution"] = json.loads(
            '{"version":1,"first":[],"last":[],"wa":[],"journey_id":null,"status":"unresolved_ref","wa_assisted":false}'
        )
        submission = normalize_business_input(self.payload)
        self.assertEqual(submission.attribution["last"], {})
        create_lead(self.client, self.config, submission, 42, MagicMock())
        added = next(c.args[1]["fields"] for c in self.client.call.call_args_list if c.args[0] == "crm.lead.add")
        self.assertEqual(added[self.config.fields.lead_source], "9991")

    def test_invalid_attribution_contract_is_rejected(self):
        for value in [{"version": 2}, "forged", {"version": 1, "status": "resolved", "first": ["bad"], "last": {}}]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_business_input(dict(self.payload, attribution=value))


if __name__ == "__main__":
    unittest.main()
