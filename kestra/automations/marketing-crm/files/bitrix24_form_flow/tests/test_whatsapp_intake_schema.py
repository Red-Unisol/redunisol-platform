import copy
import unittest

from bitrix24_form_flow.form_processor.whatsapp_intake_schema import provision, FIELDS, CUIL_REVIEW_STATUS


class SchemaCrm:
    def __init__(self):
        self.fields = []
        self.stages = [{'ID': '1', 'STATUS_ID': 'CONVERTED', 'SORT': '100', 'SEMANTICS': 'S'}]
        self.writes = []

    def call(self, method, body):
        if method == 'crm.status.list':
            return copy.deepcopy(self.stages)
        if method == 'crm.lead.userfield.list':
            return [copy.deepcopy(f) for f in self.fields if f['FIELD_NAME'] == body['filter']['FIELD_NAME']]
        self.writes.append((method, body))
        if method == 'crm.lead.userfield.add':
            self.fields.append({**body['fields'], 'ID': str(len(self.fields) + 1),
                                'FIELD_NAME': 'UF_CRM_' + body['fields']['FIELD_NAME']})
            return len(self.fields)
        if method == 'crm.status.add':
            self.stages.append({**body['fields'], 'ID': '2'})
            return 2
        raise AssertionError(method)


class SchemaTests(unittest.TestCase):
    def test_preview_does_not_write_and_apply_is_verified_and_idempotent(self):
        api = SchemaCrm()
        self.assertEqual(provision(api)['missing_fields'], list(FIELDS))
        self.assertEqual(api.writes, [])
        self.assertTrue(provision(api, apply=True)['verified'])
        self.assertEqual([m for m, _ in api.writes], ['crm.lead.userfield.add', 'crm.lead.userfield.add', 'crm.status.add'])
        self.assertEqual(api.stages[-1]['STATUS_ID'], CUIL_REVIEW_STATUS)
        self.assertLess(api.stages[-1]['SORT'], 100)
        self.assertEqual(provision(api)['missing_fields'], [])
        provision(api, apply=True)
        self.assertEqual(len(api.writes), 3)
        self.assertTrue(all(f['MANDATORY'] == 'N' and f['IS_SEARCHABLE'] == 'N' for f in api.fields))

    def test_incompatible_existing_schema_stops_before_any_mutation(self):
        for condition in ['type', 'multiple', 'required', 'stage']:
            api = SchemaCrm()
            field = {'ID': '1', 'FIELD_NAME': next(iter(FIELDS)), 'USER_TYPE_ID': 'string', 'MULTIPLE': 'N', 'MANDATORY': 'N'}
            if condition == 'type':
                field['USER_TYPE_ID'] = 'integer'
            elif condition == 'multiple':
                field['MULTIPLE'] = 'Y'
            elif condition == 'required':
                field['MANDATORY'] = 'Y'
            else:
                api.stages.append({'STATUS_ID': CUIL_REVIEW_STATUS, 'SEMANTICS': 'F'})
            api.fields.append(field)
            with self.subTest(condition=condition), self.assertRaises(ValueError):
                provision(api, apply=True)
            self.assertEqual(api.writes, [])
