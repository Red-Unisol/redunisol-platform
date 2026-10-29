import copy
import json
import unittest
from unittest.mock import Mock

from edna_incoming.receiver import classify
from edna_incoming.test_reference import TEST_CONTRACT, TEST_MARKER, TEST_REFERENCE, TEST_TITLE, is_test_entry
from bitrix24_form_flow.form_processor.attribution import ASSISTANCE_FIELDS, CRM_FIELDS, WA_FIELDS, copy_to_deal
from bitrix24_form_flow.form_processor.business_logic import classify_lead
from bitrix24_form_flow.form_processor.lead_prefill_service import _apply_arca_output, select_new_leads_for_prefill
from bitrix24_form_flow.form_processor.whatsapp_intake import process
from test_whatsapp_intake import CASE, CONFIG, CUIL, PHONE, IntakeCrm, payload


def test_payload(**answer):
    value = payload(**answer)
    value['contract'] = TEST_CONTRACT
    value['test_reference'] = TEST_REFERENCE
    value['attribution']['test_reference'] = TEST_REFERENCE
    value['attribution']['first'] = value['attribution']['last'] = {
        'utm_source': 'test', 'utm_medium': 'whatsapp', 'utm_campaign': 'whatsapp_intake_e2e'}
    return value


class TestReferenceTests(unittest.TestCase):
    def test_reference_alone_is_a_router_entry_but_not_an_out_of_hours_candidate(self):
        event = {'id': '100', 'subjectId': '2423', 'subscriber': {'identifier': PHONE[1:]},
                 'receivedAt': '2026-10-29T14:00:00Z',
                 'messageContent': {'type': 'TEXT', 'text': '(ref: PRUEBAFORM)'}}
        receipt, artifact = classify(event, '2423')
        self.assertEqual((receipt['kind'], receipt['reason']), ('router_entry', 'test_reference'))
        self.assertFalse(receipt['out_of_hours_candidate'])
        self.assertEqual(artifact['kind'], 'router_entry')
        event['subjectId'] = '999'
        self.assertEqual(classify(event, '2423')[0]['reason'], 'other_channel')
        for text in ['PRUEBAFORM', '(ref: PRUEBAFORMx)', '(ref: PRUEBAFORM) (ref: other)']:
            self.assertFalse(is_test_entry(text))
        self.assertTrue(is_test_entry('Hola (REF: pruebaform)'))

    def test_valid_test_enters_real_ingreso_and_can_be_repeated_with_one_contact(self):
        api = IntakeCrm()
        first = process(test_payload(), env=CONFIG, client=api)
        before = copy.deepcopy(api.leads[first['lead_id']])
        second = process(dict(test_payload(), case_id=CASE[:-1] + '2'), env=CONFIG, client=api)
        self.assertEqual((first['action'], second['action']), ('queued', 'queued'))
        self.assertEqual(len(api.contacts), 1)
        self.assertNotEqual(first['lead_id'], second['lead_id'])
        self.assertEqual(api.leads[first['lead_id']], before)
        lead = api.leads[second['lead_id']]
        self.assertTrue(second['is_test'])
        self.assertEqual(lead['UF_CRM_WA_TEST'], TEST_MARKER)
        self.assertEqual(lead['STATUS_ID'], api.config.lead_statuses.new)
        self.assertTrue(lead['TITLE'].startswith(TEST_TITLE))
        self.assertIn(TEST_REFERENCE, lead['COMMENTS'])
        self.assertEqual(json.loads(lead['UF_CRM_ATTR_JSON'])['test_reference'], TEST_REFERENCE)
        writes = len(api.writes)
        self.assertEqual(process(test_payload(), env=CONFIG, client=api)['action'], 'already_processed')
        self.assertEqual(len(api.writes), writes)

    def test_same_reference_works_for_any_phone_even_outside_the_ordinary_allowlist(self):
        for phone in [PHONE, '+5493519999999']:
            api = IntakeCrm()
            config = {**CONFIG, 'EDNA_INTAKE_RECIPIENTS': '5493518888888'}
            self.assertEqual(process(dict(test_payload(), phone=phone), env=config, client=api)['action'], 'queued')
            untouched = Mock()
            self.assertEqual(process(dict(payload(), phone=phone), env=config, client=untouched)['action'], 'disabled')
            untouched.call.assert_not_called()

    def test_test_reference_requires_matching_saved_attribution_before_any_crm_call(self):
        for mode in ['payload_only', 'journey_only', 'unknown', 'boolean', 'old_test_mode', 'normal_contract']:
            value = test_payload()
            if mode == 'payload_only':
                value['attribution'].pop('test_reference')
            elif mode == 'journey_only':
                value.pop('test_reference')
            elif mode == 'unknown':
                value['test_reference'] = value['attribution']['test_reference'] = 'OTHER'
            elif mode == 'boolean':
                value['test_reference'] = True
            elif mode == 'normal_contract':
                value['contract'] = payload()['contract']
            else:
                value['test_mode'] = True
            api = Mock()
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                process(value, env=CONFIG, client=api)
            api.call.assert_not_called()

    def test_test_reference_keeps_the_global_crm_gate_and_dry_run(self):
        api = Mock()
        self.assertEqual(process(dict(test_payload(), dry_run=True), env=CONFIG, client=api)['action'], 'dry_run')
        self.assertEqual(process(test_payload(), env={**CONFIG, 'EDNA_INTAKE_CRM_ENABLED': 'false'}, client=api)['action'], 'disabled')
        api.call.assert_not_called()

    def test_new_test_never_consumes_an_ordinary_empty_guest(self):
        guest = {'ID': '10', 'STATUS_ID': 'UC_PWTVG6', 'STATUS_SEMANTIC_ID': 'P',
                 'NAME': 'Guest', 'PHONE': [{'VALUE': PHONE}]}
        api = IntakeCrm(lead=guest)
        result = process(test_payload(), env=CONFIG, client=api)
        self.assertNotEqual(result['lead_id'], '10')
        self.assertEqual(api.leads['10'], guest)

    def test_invalid_identity_and_rejections_still_obey_the_real_rules_and_keep_the_marker(self):
        for answer, action in [({'cuil': '123'}, 'manual_review'), ({'provincia': 'otra', 'banco_otra': 'nacion'}, 'rejected')]:
            api = IntakeCrm()
            result = process(test_payload(**answer), env=CONFIG, client=api)
            self.assertEqual(result['action'], action)
            self.assertEqual(api.leads[result['lead_id']]['UF_CRM_WA_TEST'], TEST_MARKER)
            self.assertEqual(len(api.contacts), 0)

    def test_existing_real_inquiry_and_management_are_never_overwritten_or_bypassed(self):
        contact = {'ID': '1', 'UF_CONTACT_CUIL': CUIL, 'PHONE': [{'VALUE': PHONE}]}
        lead = {'ID': '10', 'STATUS_SEMANTIC_ID': 'P', 'STATUS_ID': 'NEW', 'CONTACT_ID': '1',
                'UF_CRM_1693840106704': CUIL, 'NAME': 'Real inquiry'}
        api = IntakeCrm(contact=contact, lead=lead)
        self.assertEqual(process(test_payload(), env=CONFIG, client=api)['reason'], 'existing_form_requires_review')
        self.assertEqual(api.leads['10'], lead)
        api = IntakeCrm(contact=contact, deals=[{'ID': '90', 'CONTACT_ID': '1', 'CATEGORY_ID': '1', 'STAGE_SEMANTIC_ID': 'P'}])
        self.assertEqual(process(test_payload(), env=CONFIG, client=api)['reason'], 'existing_management')

    def test_test_leads_and_their_deals_do_not_block_a_repeat_or_a_real_inquiry(self):
        for test in [True, False]:
            api = IntakeCrm()
            first = process(test_payload(), env=CONFIG, client=api)
            api.deals = [{'ID': '90', 'CONTACT_ID': first['contact_id'], 'CATEGORY_ID': '1',
                          'STAGE_SEMANTIC_ID': 'P', 'UF_CRM_WA_TEST': TEST_MARKER,
                          'UF_CRM_ATTR_JSON': api.leads[first['lead_id']]['UF_CRM_ATTR_JSON']}]
            result = process(dict(test_payload() if test else payload(), case_id=CASE[:-1] + '2'), env=CONFIG, client=api)
            self.assertEqual(result['action'], 'queued')
            self.assertEqual(result['is_test'], test)

    def test_case_replay_cannot_switch_between_real_and_test_or_lose_its_marker(self):
        for first, replay in [(test_payload(), payload()), (payload(), test_payload())]:
            api = IntakeCrm()
            process(first, env=CONFIG, client=api)
            count = len(api.writes)
            with self.assertRaises(ValueError):
                process(replay, env=CONFIG, client=api)
            self.assertEqual(len(api.writes), count)

    def test_marker_schema_is_checked_before_any_write(self):
        api = IntakeCrm()
        original = api.call
        api.call = lambda m, b: {k: v for k, v in original(m, b).items() if k != 'UF_CRM_WA_TEST'} if m == 'crm.lead.fields' else original(m, b)
        with self.assertRaises(ValueError):
            process(test_payload(), env=CONFIG, client=api)
        self.assertEqual(api.writes, [])

    def test_e2e_marker_survives_prefill_and_real_classification_and_is_copied_to_deal(self):
        api = IntakeCrm()
        result = process(test_payload(), env=CONFIG, client=api)
        lead = api.leads[result['lead_id']]
        _apply_arca_output(api, api.config, lead, {'ok': True, 'nombre': 'Persona', 'apellido': 'Prueba'}, Mock())
        self.assertEqual(lead['TITLE'], TEST_TITLE + 'Persona Prueba')
        classification = classify_lead(result['lead_id'], env=CONFIG, bitrix_client=api, logger=Mock())
        self.assertTrue(classification['ok'], classification)
        self.assertEqual(classification['action'], 'qualified')
        self.assertEqual(lead['TITLE'], TEST_TITLE + 'Persona Prueba - Catamarca')
        selector = Mock()
        selector.call_full.return_value = {'result': [lead]}
        self.assertEqual(select_new_leads_for_prefill(env=CONFIG, bitrix_client=selector)[0]['lead_id'], result['lead_id'])
        metadata = {n: {'upperName': n} for n in (*CRM_FIELDS, *WA_FIELDS, *ASSISTANCE_FIELDS)}
        deal_api = Mock()
        deal_api.call.return_value = {'fields': metadata}
        fields = {}
        copy_to_deal(deal_api, lead, fields)
        self.assertEqual(fields['UF_CRM_WA_TEST'], TEST_MARKER)
        self.assertEqual(json.loads(fields['UF_CRM_ATTR_JSON'])['test_reference'], TEST_REFERENCE)
