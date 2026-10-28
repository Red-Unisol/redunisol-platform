import copy
import unittest

from bitrix24_form_flow.form_processor.whatsapp_intake import process
from bitrix24_form_flow.form_processor.whatsapp_intake_crm import CUIL_REVIEW_STATUS, INVALID_CUIL_FIELD, REVIEW_REASON_FIELD
from test_whatsapp_intake import CASE, CUIL, PHONE, FLOW, CONFIG, IntakeCrm, payload


def person(id='1', cuil=CUIL, phone=PHONE):
    return {'ID': id, 'UF_CONTACT_CUIL': cuil, 'NAME': 'Synthetic', 'LAST_NAME': id,
            'PHONE': [{'VALUE': phone}], 'EMAIL': [{'VALUE': 'previous@example.test'}]}


def guest(id='10', **fields):
    return {'ID': id, 'STATUS_ID': 'UC_PWTVG6', 'STATUS_SEMANTIC_ID': 'P',
            'NAME': 'Guest', 'PHONE': [{'VALUE': PHONE}], **fields}


class IdentityTests(unittest.TestCase):
    def test_cuil_is_searched_first_and_selects_one_of_four_shared_phone_contacts(self):
        api = IntakeCrm(contact=person('4'))
        for id in ['1', '2', '3']:
            api.contacts[id] = person(id, cuil='20123456786' if id == '1' else '')
        before = copy.deepcopy(api.contacts)
        calls = []
        original = api.call

        def call(method, body):
            calls.append((method, body))
            return original(method, body)

        api.call = call
        result = process(payload(), env=CONFIG, client=api)
        self.assertEqual((result['action'], result['contact_id']), ('queued', '4'))
        self.assertEqual([body for method, body in calls if method == 'crm.contact.list'][0]['filter'], {'=UF_CONTACT_CUIL': CUIL})
        self.assertFalse(any(m == 'crm.duplicate.findbycomm' and b['entity_type'] == 'CONTACT' for m, b in calls))
        for id in ['1', '2', '3']:
            self.assertEqual(api.contacts[id], before[id])
        self.assertEqual(len(api.contacts), 4)

    def test_existing_cuil_with_new_phone_keeps_all_previous_contact_channels(self):
        api = IntakeCrm(contact=person(phone='+5493519999999'))
        result = process(payload(email='new@example.test'), env=CONFIG, client=api)
        self.assertEqual(result['contact_id'], '1')
        self.assertEqual(len(api.contacts), 1)
        self.assertEqual({p['VALUE'] for p in api.contacts['1']['PHONE']}, {'+5493519999999', PHONE})
        self.assertEqual({p['VALUE'] for p in api.contacts['1']['EMAIL']}, {'previous@example.test', 'new@example.test'})

    def test_different_valid_cuil_on_shared_phone_creates_separate_person_and_inquiry(self):
        api = IntakeCrm(contact=person(cuil='20123456786'))
        before = copy.deepcopy(api.contacts['1'])
        result = process(payload(), env=CONFIG, client=api)
        self.assertNotEqual(result['contact_id'], '1')
        self.assertEqual(api.contacts['1'], before)
        self.assertEqual(len(api.contacts), 2)

    def test_two_people_complete_forms_from_same_phone_without_merging_their_cases(self):
        api = IntakeCrm()
        first = process(payload(), env=CONFIG, client=api)
        second = process({**payload(cuil='20123456786'), 'case_id': CASE[:-1] + '2'}, env=CONFIG, client=api)
        self.assertNotEqual(first['contact_id'], second['contact_id'])
        self.assertNotEqual(first['lead_id'], second['lead_id'])
        self.assertEqual((len(api.contacts), len(api.leads)), (2, 2))
        self.assertEqual(second['action'], 'queued')

    def test_ambiguous_cuil_is_visible_but_never_selects_or_merges_a_person(self):
        api = IntakeCrm(contact=person())
        api.contacts['2'] = person('2')
        before = copy.deepcopy(api.contacts)
        result = process(payload(), env=CONFIG, client=api)
        self.assertEqual(result['reason'], 'ambiguous_cuil_contact')
        self.assertEqual(result['contact_id'], '')
        self.assertNotIn('CONTACT_ID', api.leads[result['lead_id']])
        self.assertEqual(api.contacts, before)
        self.assertEqual([m for m, _ in api.writes], ['crm.lead.add'])
        count = len(api.writes)
        self.assertEqual(process(payload(), env=CONFIG, client=api)['action'], 'manual_review')
        self.assertEqual(len(api.writes), count)

    def test_existing_forms_and_deals_are_preserved_and_referenced(self):
        api = IntakeCrm(contact=person(), lead=guest(**{'STATUS_ID': 'NEW', 'CONTACT_ID': '1',
                        'UF_CRM_1693840106704': CUIL, 'COMMENTS': 'Original management'}))
        before = copy.deepcopy(api.leads['10'])
        result = process(payload(), env=CONFIG, client=api)
        self.assertEqual(result['reason'], 'existing_form_requires_review')
        self.assertNotEqual(result['lead_id'], '10')
        self.assertEqual(api.leads['10'], before)
        self.assertIn('10', api.leads[result['lead_id']]['COMMENTS'])

    def test_invalid_cuil_reuses_only_empty_guest_without_borrowing_identity(self):
        api = IntakeCrm(lead=guest(ASSIGNED_BY_ID='999'), contact=person())
        result = process(payload(cuil=' 20-30123456-0 '), env=CONFIG, client=api)
        lead = api.leads[result['lead_id']]
        self.assertEqual(result['lead_id'], '10')
        self.assertEqual(lead[INVALID_CUIL_FIELD], ' 20-30123456-0 ')
        self.assertEqual(lead['STATUS_ID'], CUIL_REVIEW_STATUS)
        self.assertEqual(lead[REVIEW_REASON_FIELD], 'pending_cuil')
        self.assertEqual(lead['ASSIGNED_BY_ID'], 57)
        self.assertNotIn(api.config.fields.lead_cuil, lead)
        self.assertEqual([m for m, _ in api.writes], ['crm.lead.update'])

    def test_invalid_cuil_does_not_overwrite_named_linked_or_historic_records(self):
        for changes in [{'NAME': 'Known person'}, {'CONTACT_ID': '1'}, {'STATUS_SEMANTIC_ID': 'F'},
                        {'UF_CRM_1693840106704': CUIL}, {'STATUS_ID': 'ASSISTANCE_REVIEW'}]:
            api = IntakeCrm(lead=guest(**changes), contact=person())
            before = copy.deepcopy(api.leads['10'])
            result = process(payload(cuil='123'), env=CONFIG, client=api)
            self.assertNotEqual(result['lead_id'], '10')
            self.assertEqual(api.leads['10'], before)

    def test_several_empty_guests_do_not_block_unique_cuil(self):
        api = IntakeCrm(lead=guest())
        api.leads['11'] = guest('11')
        before = copy.deepcopy(api.leads)
        result = process(payload(), env=CONFIG, client=api)
        self.assertEqual(result['action'], 'queued')
        self.assertNotIn(result['lead_id'], before)
        self.assertEqual(api.leads['10'], before['10'])
        self.assertEqual(api.leads['11'], before['11'])

    def test_invalid_optional_email_is_retained_for_review_without_contaminating_email(self):
        api = IntakeCrm()
        result = process(payload(email='bad-address'), env=CONFIG, client=api)
        self.assertEqual(result['reason'], 'invalid_email')
        lead = api.leads[result['lead_id']]
        self.assertNotIn('EMAIL', lead)
        self.assertNotIn('EMAIL', api.contacts[result['contact_id']])
        self.assertIn('bad-address', lead['COMMENTS'])

    def test_missing_stage_or_invalid_field_schema_fails_before_writes(self):
        for change in ['stage', 'field', 'multiple']:
            api = IntakeCrm()
            original = api.call

            def call(method, body):
                data = original(method, body)
                if change == 'stage' and method == 'crm.status.list':
                    return [s for s in data if s['STATUS_ID'] != CUIL_REVIEW_STATUS]
                if method == 'crm.lead.fields':
                    if change == 'field':
                        data.pop(INVALID_CUIL_FIELD)
                    if change == 'multiple':
                        data[INVALID_CUIL_FIELD]['isMultiple'] = True
                return data

            api.call = call
            with self.subTest(change=change), self.assertRaises(ValueError):
                process(payload(), env=CONFIG, client=api)
            self.assertEqual(api.writes, [])

    def test_malformed_identity_lists_never_mean_no_matches(self):
        for bad in [None, {}, [None], [{'NAME': 'no-id'}], [{'ID': True}], [{'ID': '0'}]]:
            api = IntakeCrm()
            original = api.call
            api.call = lambda m, b: bad if m == 'crm.contact.list' else original(m, b)
            with self.subTest(shape=bad), self.assertRaises(ValueError):
                process(payload(), env=CONFIG, client=api)
            self.assertEqual(api.writes, [])

    def test_identity_search_reads_second_page_and_leaves_duplicates_unbound(self):
        api = IntakeCrm()
        api.contacts = {str(i): person(str(i)) for i in range(1, 52)}
        result = process(payload(), env=CONFIG, client=api)
        self.assertEqual(result['reason'], 'ambiguous_cuil_contact')
        self.assertIn('51', api.leads[result['lead_id']]['COMMENTS'])
        self.assertEqual(len(api.contacts), 51)

    def test_replay_with_other_phone_flow_or_identity_never_writes(self):
        for change in ['phone', 'flow', 'cuil', 'raw']:
            api = IntakeCrm()
            result = process(payload(cuil='123') if change == 'raw' else payload(), env=CONFIG, client=api)
            lead = api.leads[result['lead_id']]
            if change == 'phone':
                lead['PHONE'] = [{'VALUE': '+5493519999999'}]
            if change == 'flow':
                lead['UF_CRM_WA_FLOW_ID'] = '999'
            if change == 'cuil':
                lead[api.config.fields.lead_cuil] = '20123456786'
            if change == 'raw':
                lead[INVALID_CUIL_FIELD] = '456'
            writes = len(api.writes)
            with self.subTest(change=change), self.assertRaises(ValueError):
                process(payload(cuil='123') if change == 'raw' else payload(), env=CONFIG, client=api)
            self.assertEqual(len(api.writes), writes)

    def test_provider_null_empty_fields_acknowledge_valid_and_missing_cuil_cases(self):
        for cuil in [CUIL, None]:
            api = IntakeCrm()
            original = api.call

            def call(method, body):
                data = original(method, body)
                if method == 'crm.lead.get':
                    for field in [INVALID_CUIL_FIELD, REVIEW_REASON_FIELD]:
                        if data.get(field) == '':
                            data[field] = None
                return data

            api.call = call
            result = process(payload(cuil=cuil), env=CONFIG, client=api)
            self.assertEqual(result['action'], 'queued' if cuil else 'manual_review')
            self.assertTrue(result['lead_id'])
