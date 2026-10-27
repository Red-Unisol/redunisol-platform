import copy
import json
import re
from pathlib import Path
import unittest
from unittest.mock import Mock

from edna_incoming.intake import BANKS, PROVINCES, VERSION, normalize_answer
from edna_incoming.receiver import SEGMENTS
from bitrix24_form_flow.form_processor.whatsapp_intake import process
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

    def call(self, method, body):
        if method == 'crm.deal.list':
            return copy.deepcopy(self.deals)
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
                        self.assertEqual(value['action'], 'review' if situation == 'otra' else 'intake')

    def test_cuil_is_required_and_checksum_validated_before_any_crm_access(self):
        for cuil in [None, '', '123', CUIL[:-1] + '0', 20301234563, True]:
            api = Mock()
            with self.subTest(value=cuil), self.assertRaises(ValueError):
                process(payload(cuil=cuil), env=CONFIG, client=api)
            api.call.assert_not_called()

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
        api = IntakeCrm(lead={'ID': '10', 'STATUS_SEMANTIC_ID': 'P', 'PHONE': [{'VALUE': PHONE}],
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

    def test_caja_without_bank_reuses_existing_qualification_exception(self):
        api = IntakeCrm()
        result = process(payload(provincia='cordoba', situacion_cordoba='jubilado_pensionado', organismo='caja_cordoba'), env=CONFIG, client=api)
        self.assertEqual(result['action'], 'queued')
        submission = build_prequalification_input_from_lead(api.leads[result['lead_id']], api.config)
        self.assertIsNone(submission.payment_bank)
        self.assertTrue(evaluate_prequalification(submission).qualified)

    def test_open_management_is_preserved_before_any_mutation(self):
        api = IntakeCrm(contact={'ID': '1', 'PHONE': [{'VALUE': PHONE}]},
                        deals=[{'ID': '99', 'CONTACT_ID': '1', 'CATEGORY_ID': '1', 'STAGE_SEMANTIC_ID': 'P'}])
        self.assertEqual(process(payload(), env=CONFIG, client=api)['reason'], 'existing_management')
        self.assertEqual(api.writes, [])

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
