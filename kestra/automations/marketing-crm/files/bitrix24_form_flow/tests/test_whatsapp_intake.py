import copy
import json
import re
from pathlib import Path
import unittest
from unittest.mock import Mock

from edna_incoming.intake import BANKS, PROVINCES, VERSION, normalize_answer
from edna_incoming.receiver import SEGMENTS
from bitrix24_form_flow.form_processor.whatsapp_intake import process
from bitrix24_form_flow.form_processor.whatsapp_intake_crm import CUIL_REVIEW_STATUS, INVALID_CUIL_FIELD, REVIEW_REASON_FIELD
from bitrix24_form_flow.form_processor.lead_service import build_prequalification_input_from_lead
from bitrix24_form_flow.form_processor.qualification import evaluate_prequalification
from test_whatsapp_assistance import CASE, CUIL, ENV, PHONE, Crm

FLOW = '999000111222333'
CONFIG = {**ENV, 'EDNA_INTAKE_CRM_ENABLED': 'true', 'EDNA_INTAKE_FLOW_ID': FLOW}


def payload(**answer):
    return {'contract': VERSION, 'case_id': CASE, 'flow_id': FLOW, 'phone': PHONE, 'dry_run': False,
            'received_at': '2026-10-27T11:00:00-03:00',
            'answer': {'provincia': 'catamarca', 'situacion_catamarca': 'policia',
                       'banco_catamarca': 'nacion', 'cuil': CUIL, **answer},
            'attribution': {'version': 1, 'status': 'resolved', 'journey_id': 'AbCdEf1234',
                            'first': {}, 'last': {'utm_source': 'ig', 'utm_campaign': 'original'},
                            'wa_assisted': True, 'wa': {'WA_ENTRY': 'website'}}}


class IntakeCrm(Crm):
    def __init__(self, *, deals=None, **kwargs):
        super().__init__(**kwargs)
        self.deals = deals or []

    def get_lead_field(self, name):
        if name == self.config.fields.lead_rejection_reason:
            return {'items': [{'ID': '3933', 'VALUE': 'OTRA PROVINCIA'}, {'ID': '3965', 'VALUE': 'NO CUMPLE REQUISITOS PARA CONVENIO'},
                              {'ID': '3939', 'VALUE': 'OTRO BANCO'}]}
        return super().get_lead_field(name)

    def call(self, method, body):
        if method == 'crm.duplicate.findbycomm':
            store = self.contacts if body['entity_type'] == 'CONTACT' else self.leads
            digits = re.sub(r'\D', '', body['values'][0])
            ids = [i for i, r in store.items() if any(re.sub(r'\D', '', p['VALUE']) == digits for p in r.get('PHONE', []))]
            return {body['entity_type']: ids} if ids else []
        if method == 'crm.status.list':
            return super().call(method, body) + [{'STATUS_ID': CUIL_REVIEW_STATUS, 'SEMANTICS': ''}, {'STATUS_ID': 'JUNK', 'SEMANTICS': 'F'}]
        if method == 'crm.lead.fields':
            return {**super().call(method, body), **{n: {'type': 'string', 'isMultiple': False}
                    for n in [INVALID_CUIL_FIELD, REVIEW_REASON_FIELD]}}
        if method == 'crm.deal.list':
            rows = self.deals
            for key, value in body['filter'].items():
                rows = [r for r in rows if str(r.get(key.lstrip('=@'))) in {str(v) for v in (value if isinstance(value, list) else [value])}]
            return copy.deepcopy(rows[body.get('start', 0):body.get('start', 0) + 50])
        if method.endswith('.list'):
            rows = super().call(method, body)
            return rows[body.get('start', 0):body.get('start', 0) + 50]
        return super().call(method, body)


class IntakeTests(unittest.TestCase):
    def test_published_json_source_covers_every_route_and_only_its_active_fields(self):
        root = next(p for p in Path(__file__).resolve().parents if (p / 'docs/whatsapp-website-intake.flow.json').exists())
        flow = json.loads((root / 'docs/whatsapp-website-intake.flow.json').read_text(encoding='utf8'))
        fields = flow['screens'][0]['layout']['children'][0]['children']

        def visible(items, answer):
            result = []
            for field in items:
                if field['type'] == 'If':
                    key, value = re.fullmatch(r"\$\{form\.([a-z_]+)\} == '([a-z_]+)'", field['condition']).groups()
                    result.extend(visible(field.get('then' if answer.get(key) == value else 'else', []), answer))
                else:
                    result.append(field)
            return result

        for province, situations in {**SEGMENTS, 'otra': {'otra'}}.items():
            for situation in situations:
                for organism in ('caja_cordoba', 'anses', 'ayuda'):
                    data = {'provincia': province, 'situacion_' + province: situation, 'organismo': organism}
                    current = {f['name']: f for f in visible(fields, data) if 'name' in f}
                    self.assertTrue(current['cuil']['required'])
                    self.assertFalse(current['email']['required'])
                    banks = [k for k in current if k.startswith('banco_')]
                    caja = province == 'cordoba' and situation == 'jubilado_pensionado' and organism == 'caja_cordoba'
                    self.assertEqual(len(banks), 0 if caja else 1)
                    self.assertTrue(flow['screens'][0]['terminal'])
                    self.assertEqual(current.get('provincia', {})['type'], 'Dropdown')
        footer = next(f for f in fields if f['type'] == 'Footer')
        self.assertEqual(footer['on-click-action']['name'], 'complete')
        self.assertNotIn('continuidad', json.dumps(flow))

    def test_all_existing_router_segments_have_a_single_intake_route(self):
        for province, situations in {**SEGMENTS, 'otra': {'otra'}}.items():
            for situation in situations:
                for bank in BANKS:
                    with self.subTest(province=province, situation=situation, bank=bank):
                        answer = {'provincia': province, 'situacion_' + province: situation,
                                  'organismo': 'anses', 'banco_jubilado': bank,
                                  'banco_' + province: bank, 'cuil': CUIL}
                        value = normalize_answer(answer)
                        self.assertEqual(value['cuil'], CUIL)
                        self.assertNotEqual(value['action'], 'landing')
                        self.assertEqual(value['province'], PROVINCES[province])
                        self.assertEqual(value['action'], 'rejected' if situation == 'otra' else 'intake')

    def test_invalid_or_missing_cuil_is_a_visible_unbound_lead_in_a_correction_stage(self):
        for cuil in [None, '', '123', CUIL[:-1] + '0', 20301234563, True]:
            api = IntakeCrm(contact={'ID': '1', 'PHONE': [{'VALUE': PHONE}], 'UF_CONTACT_CUIL': CUIL})
            before = copy.deepcopy(api.contacts)
            with self.subTest(value=cuil):
                result = process(payload(cuil=cuil), env=CONFIG, client=api)
                lead = api.leads[result['lead_id']]
                self.assertEqual((result['action'], result['reason']), ('manual_review', 'pending_cuil'))
                self.assertEqual(lead['STATUS_ID'], CUIL_REVIEW_STATUS)
                self.assertNotIn(api.config.fields.lead_cuil, lead)
                self.assertNotIn('CONTACT_ID', lead)
                self.assertEqual(lead[INVALID_CUIL_FIELD], normalize_answer(payload(cuil=cuil)['answer'], retain_invalid_identity=True)['reported_cuil'])
                self.assertEqual(api.contacts, before)
                count = len(api.writes)
                self.assertEqual(process(payload(cuil=cuil), env=CONFIG, client=api)['lead_id'], result['lead_id'])
                self.assertEqual(len(api.writes), count)

    def test_email_optional_but_invalid_values_are_not_silently_accepted(self):
        self.assertIsNone(normalize_answer(payload()['answer'])['email'])
        for email in ['bad', 123, 'x' * 255 + '@example.test']:
            with self.assertRaises(ValueError):
                normalize_answer(payload(email=email)['answer'])

    def test_hidden_branch_values_cannot_change_identity_bank_or_job(self):
        value = normalize_answer(payload(organismo='caja_cordoba', banco_jubilado='otro',
                                         situacion_cordoba='jubilado_pensionado')['answer'])
        self.assertEqual((value['organism'], value['bank'], value['employment_status']), ('', 'nacion', 'Policia'))
        value = normalize_answer(payload(provincia='cordoba', situacion_cordoba='jubilado_pensionado',
                                         organismo='caja_cordoba', banco_jubilado='otro')['answer'])
        self.assertEqual((value['bank'], value['payment_bank']), ('', ''))

    def test_unresolved_bank_or_organism_stays_manual(self):
        for changes in [dict(banco_catamarca='ayuda'),
                        dict(provincia='cordoba', situacion_cordoba='jubilado_pensionado',
                             organismo='ayuda', banco_jubilado='ayuda')]:
            api = IntakeCrm()
            result = process(payload(**changes), env=CONFIG, client=api)
            self.assertEqual(result['action'], 'manual_review')
            self.assertEqual(api.leads[result['lead_id']]['STATUS_ID'], 'ASSISTANCE_REVIEW')

    def test_valid_response_upgrades_guest_without_web_form_and_preserves_email(self):
        api = IntakeCrm(lead={'ID': '10', 'STATUS_SEMANTIC_ID': 'P', 'STATUS_ID': 'UC_PWTVG6', 'PHONE': [{'VALUE': PHONE}],
                             'EMAIL': [{'VALUE': 'known@example.test'}]})
        result = process(payload(), env=CONFIG, client=api)
        self.assertEqual((result['action'], result['lead_id']), ('queued', '10'))
        lead = api.leads['10']
        self.assertEqual(lead['EMAIL'], [{'VALUE': 'known@example.test'}])
        self.assertEqual(lead['UF_CRM_WA_SUBFLOW'], 'website_single_intake')
        self.assertEqual(lead['UF_CRM_WA_FLOW_ID'], FLOW)
        self.assertEqual(lead['UF_CRM_WA_ENTRY'], 'website')
        self.assertEqual(lead['UTM_CAMPAIGN'], 'original')
        self.assertEqual(lead[api.config.fields.lead_source], '2427')
        self.assertEqual(lead[api.config.fields.lead_payment_bank], ['439'])
        self.assertTrue(evaluate_prequalification(build_prequalification_input_from_lead(lead, api.config)).qualified)
        writes = len(api.writes)
        self.assertEqual(process(payload(), env=CONFIG, client=api)['action'], 'already_processed')
        self.assertEqual(len(api.writes), writes)

    def test_empty_contact_and_lead_searches_create_one_identity_and_case(self):
        api = IntakeCrm()
        first = process(payload(), env=CONFIG, client=api)
        self.assertEqual(first['action'], 'queued')
        self.assertEqual((len(api.contacts), len(api.leads)), (1, 1))
        writes = len(api.writes)
        again = process(payload(), env=CONFIG, client=api)
        self.assertEqual((again['action'], again['lead_id'], again['contact_id']),
                         ('already_processed', first['lead_id'], first['contact_id']))
        self.assertEqual(len(api.writes), writes)

    def test_invalid_duplicate_search_shape_stops_before_any_identity_write(self):
        for bad in [[1], None, {'LEAD': None}, {'LEAD': '12'}, {'LEAD': [True]}, {'LEAD': ['bad']}]:
            for entity in ['LEAD']:
                api = IntakeCrm()
                original = api.call

                def call(method, body):
                    if method == 'crm.duplicate.findbycomm' and body['entity_type'] == entity:
                        return bad
                    return original(method, body)

                api.call = call
                with self.subTest(shape=bad, entity=entity), self.assertRaises(ValueError):
                    process(payload(), env=CONFIG, client=api)
                self.assertEqual(api.writes, [])

    def test_caja_without_bank_reuses_existing_qualification_exception(self):
        api = IntakeCrm()
        result = process(payload(provincia='cordoba', situacion_cordoba='jubilado_pensionado', organismo='caja_cordoba'), env=CONFIG, client=api)
        self.assertEqual(result['action'], 'queued')
        submission = build_prequalification_input_from_lead(api.leads[result['lead_id']], api.config)
        self.assertIsNone(submission.payment_bank)
        self.assertTrue(evaluate_prequalification(submission).qualified)

    def test_open_management_is_preserved_and_new_inquiry_is_visible_for_review(self):
        api = IntakeCrm(contact={'ID': '1', 'UF_CONTACT_CUIL': CUIL, 'PHONE': [{'VALUE': PHONE}]},
                        deals=[{'ID': '99', 'CONTACT_ID': '1', 'CATEGORY_ID': '1', 'STAGE_SEMANTIC_ID': 'P'}])
        before = copy.deepcopy(api.contacts)
        result = process(payload(), env=CONFIG, client=api)
        self.assertEqual(result['reason'], 'existing_management')
        self.assertEqual(api.leads[result['lead_id']]['CONTACT_ID'], '1')
        self.assertIn('99', api.leads[result['lead_id']]['COMMENTS'])
        self.assertEqual(api.contacts, before)
        self.assertEqual([m for m, _ in api.writes], ['crm.lead.add'])

    def test_provenance_gates_and_dry_run_do_not_touch_crm(self):
        for changes in [{'attribution': None}, {'flow_id': '1850162769693486'}, {'contract': 'other'},
                        {'test_mode': True}, {'received_at': '2026-10-27T12:00:00'}]:
            api = Mock()
            with self.assertRaises(ValueError):
                process({**payload(), **changes}, env=CONFIG, client=api)
            api.call.assert_not_called()
        api = Mock()
        self.assertEqual(process({**payload(), 'dry_run': True}, env=CONFIG, client=api)['action'], 'dry_run')
        self.assertEqual(process(payload(), env={**CONFIG, 'EDNA_INTAKE_CRM_ENABLED': 'false'}, client=api)['action'], 'disabled')
        self.assertEqual(process(payload(), env={**CONFIG, 'EDNA_INTAKE_RECIPIENTS': '5493519999999'}, client=api)['action'], 'disabled')
        api.call.assert_not_called()


if __name__ == '__main__':
    unittest.main()
