"""Expanded WhatsApp payloads must reach the website's canonical CRM rules."""
import json
from pathlib import Path
import unittest

from edna_incoming.intake import INTAKE_SEGMENTS, normalize_answer
from edna_incoming.receiver import SEGMENTS
from bitrix24_form_flow.form_processor.catalogs import BANCOS, PROVINCIAS, SITUACIONES_LABORALES
from bitrix24_form_flow.form_processor.input_parser import normalize_prequalification_input
from bitrix24_form_flow.form_processor.lead_service import build_prequalification_input_from_lead
from bitrix24_form_flow.form_processor.qualification import evaluate_prequalification
from bitrix24_form_flow.form_processor.whatsapp_intake import process
from test_whatsapp_intake import CONFIG, CUIL, IntakeCrm, payload


def answer(province, situation, bank='nacion', organism='anses'):
    return {'provincia': province, 'situacion_' + province: situation, 'cuil': CUIL,
            'organismo' if province == 'cordoba' else 'organismo_' + province: organism,
            'banco_jubilado' if province == 'cordoba' and situation in {
                'jubilado', 'pensionado', 'jubilado_pensionado'} else 'banco_' + province: bank}


class IntakeV3Tests(unittest.TestCase):
    def test_expanded_provinces_persist_the_same_categories_and_decisions_as_the_web(self):
        profiles = {
            'buenos_aires': ['empleado_publico', 'policia', 'docente'],
            'santa_fe': ['empleado_publico', 'policia', 'docente', 'salud'],
            'neuquen': ['empleado_publico', 'empleado_publico_municipal', 'policia', 'docente', 'salud'],
        }
        banks = {'buenos_aires': ('provincia_bsas', '461'), 'santa_fe': ('santa_fe', '535'),
                 'neuquen': ('bpn', '443')}
        for province, situations in profiles.items():
            for situation in situations:
                bank, bank_id = banks[province]
                with self.subTest(province=province, situation=situation):
                    data = answer(province, situation, bank)
                    # Stale hidden retirement data must not change the profile.
                    data.update(organismo='caja_cordoba', banco_jubilado='bancor')
                    normalized = normalize_answer(data)
                    api = IntakeCrm()
                    request = payload(**data)
                    result = process(request, env=CONFIG, client=api)
                    lead = api.leads[result['lead_id']]
                    self.assertEqual(result['action'], 'queued')
                    self.assertEqual(lead[api.config.fields.lead_province], PROVINCIAS.resolve(normalized['province'], 'province').bitrix_id)
                    self.assertEqual(lead[api.config.fields.lead_payment_bank], [bank_id])
                    self.assertEqual(lead['UF_CRM_WA_ORGANISMO'], '')
                    actual = build_prequalification_input_from_lead(lead, api.config)
                    web = normalize_prequalification_input({'provincia': normalized['province'],
                        'situacion_laboral': normalized['employment_status'], 'payment_bank': normalized['payment_bank']})
                    self.assertEqual(actual, web)
                    self.assertEqual(evaluate_prequalification(actual), evaluate_prequalification(web))
                    self.assertTrue(evaluate_prequalification(actual).qualified)
                    writes = len(api.writes)
                    self.assertEqual(process(request, env=CONFIG, client=api)['lead_id'], result['lead_id'])
                    self.assertEqual(len(api.writes), writes)

    def test_explicit_anses_retirement_works_in_every_province_and_with_every_new_bank(self):
        for province in [*INTAKE_SEGMENTS, 'otra']:
            for bank in ['nacion', 'otro', 'provincia_bsas', 'santa_fe', 'bpn']:
                with self.subTest(province=province, bank=bank):
                    api = IntakeCrm()
                    result = process(payload(**answer(province, 'jubilado', bank)), env=CONFIG, client=api)
                    self.assertEqual(result['action'], 'queued')
                    lead = api.leads[result['lead_id']]
                    self.assertEqual(lead[api.config.fields.lead_employment_status], '2567')
                    if province == 'otra':
                        self.assertEqual(lead['UF_CRM_WA_SEGMENT'], 'otra_jubilado')
                    self.assertTrue(evaluate_prequalification(build_prequalification_input_from_lead(lead, api.config)).qualified)

    def test_provincial_retirements_use_the_declared_organism_not_hidden_cordoba_data(self):
        for province in ['buenos_aires', 'santa_fe', 'neuquen', 'catamarca', 'caba', 'otra']:
            data = answer(province, 'jubilado', organism='caja_provincial')
            data.update(organismo='anses', banco_jubilado='bancor')
            value = normalize_answer(data)
            self.assertEqual(value['employment_status'], 'Jubilado Provincial')
            self.assertEqual(value['organism'], 'caja_provincial')
            self.assertEqual(value['bank'], 'nacion')
            api = IntakeCrm()
            result = process(payload(**data), env=CONFIG, client=api)
            self.assertEqual(result['action'], 'rejected' if province == 'otra' else 'queued')
            lead = api.leads[result['lead_id']]
            if province != 'otra':
                decision = evaluate_prequalification(build_prequalification_input_from_lead(lead, api.config))
                self.assertEqual(decision.qualified, province in {'buenos_aires', 'santa_fe', 'neuquen'})

    def test_pensioners_are_never_mapped_to_jubilado_nacional(self):
        for province in [*INTAKE_SEGMENTS, 'otra']:
            value = normalize_answer(answer(province, 'pensionado'))
            self.assertEqual(value['employment_status'], 'Pensionado')
            self.assertNotEqual(SITUACIONES_LABORALES.resolve(value['employment_status'], 'employment').bitrix_id, '2567')

    def test_new_ambiguous_or_unknown_benefits_remain_visible_for_review(self):
        for province in ['buenos_aires', 'santa_fe', 'neuquen', 'catamarca', 'caba', 'otra']:
            for situation, organism in [('jubilado_pensionado', 'anses'), ('jubilado', 'ayuda')]:
                api = IntakeCrm()
                result = process(payload(**answer(province, situation, organism=organism)), env=CONFIG, client=api)
                self.assertEqual((result['action'], result['reason']), ('manual_review', 'pending_data'))
                lead = api.leads[result['lead_id']]
                self.assertEqual(lead['UF_CRM_WA_ORGANISMO'], organism)
                self.assertNotIn(api.config.fields.lead_employment_status, lead)

    def test_legacy_published_cordoba_callbacks_keep_their_retirement_mapping(self):
        for organism, employment in [('anses', 'Jubilado Nacional'), ('caja_cordoba', 'Jubilado Provincial')]:
            value = normalize_answer(answer('cordoba', 'jubilado_pensionado', organism=organism))
            self.assertEqual((value['action'], value['employment_status']), ('intake', employment))
        self.assertEqual(set(SEGMENTS), {'cordoba', 'catamarca', 'caba'})
        self.assertNotIn('jubilado_pensionado', SEGMENTS['catamarca'])

    def test_new_flow_cannot_use_the_legacy_grouped_cordoba_category_to_classify_a_pensioner(self):
        data = answer('cordoba', 'jubilado_pensionado')
        config = {**CONFIG, 'EDNA_INTAKE_FLOW_ID': '950118281197789'}
        api = IntakeCrm()
        result = process({**payload(**data), 'flow_id': config['EDNA_INTAKE_FLOW_ID']}, env=config, client=api)
        self.assertEqual((result['action'], result['reason']), ('manual_review', 'pending_data'))
        self.assertNotIn(api.config.fields.lead_employment_status, api.leads[result['lead_id']])

    def test_v3_source_has_two_screens_and_only_canonical_province_and_bank_mappings(self):
        root = next(p for p in Path(__file__).resolve().parents if (p / 'docs/whatsapp-website-intake-v3.flow.json').exists())
        flow = json.loads((root / 'docs/whatsapp-website-intake-v3.flow.json').read_text(encoding='utf-8'))
        first, second = flow['screens']
        self.assertEqual([first['id'], second['id']], ['DATOS', 'IDENTIDAD'])
        self.assertFalse(first.get('terminal', False))
        self.assertTrue(second['terminal'])
        fields = first['layout']['children'][0]['children']
        provinces = next(f['data-source'] for f in fields if f.get('name') == 'provincia')
        self.assertEqual({p['id'] for p in provinces}, {*INTAKE_SEGMENTS, 'otra'})
        for province in provinces:
            self.assertTrue(PROVINCIAS.resolve(normalize_answer(answer(province['id'], 'jubilado'))['province'], 'province'))
        def visit(items):
            for field in items:
                if field.get('name', '').startswith('banco_'):
                    for bank in field['data-source']:
                        if bank['id'] != 'ayuda':
                            # No provider enum is fabricated for the new banks.
                            value = normalize_answer(answer('neuquen', 'docente', bank['id']))
                            self.assertTrue(BANCOS.resolve(value['payment_bank'], 'bank'))
                visit(field.get('then', []))
                visit(field.get('else', []))
        visit(fields)
        identity = second['layout']['children'][0]['children']
        self.assertTrue(next(f for f in identity if f.get('name') == 'cuil')['required'])
        self.assertFalse(next(f for f in identity if f.get('name') == 'email')['required'])
        self.assertEqual(next(f for f in identity if f['type'] == 'Footer')['on-click-action']['name'], 'complete')


if __name__ == '__main__':
    unittest.main()
