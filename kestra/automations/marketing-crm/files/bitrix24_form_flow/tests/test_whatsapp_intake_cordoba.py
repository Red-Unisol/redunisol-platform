import json
from pathlib import Path
import unittest
from unittest.mock import Mock

from edna_incoming.intake import CORDOBA_EXTRA_SITUATIONS, INTAKE_SEGMENTS, normalize_answer
from edna_incoming.receiver import SEGMENTS, classify
from bitrix24_form_flow.form_processor.input_parser import normalize_prequalification_input
from bitrix24_form_flow.form_processor.lead_service import build_prequalification_input_from_lead
from bitrix24_form_flow.form_processor.qualification import evaluate_prequalification
from bitrix24_form_flow.form_processor.routing_bucket import resolve_routing_bucket
from bitrix24_form_flow.form_processor.whatsapp_intake import process
from bitrix24_form_flow.form_processor.whatsapp_intake_crm import CUIL_REVIEW_STATUS, INVALID_CUIL_FIELD
from test_whatsapp_intake import CONFIG, IntakeCrm, payload

NEW_OPTIONS = {
    'daspu': ('DASPU', '4073'),
    'empleado_publico_municipal': ('Empleado Publico Municipal', '1273'),
    'jubilado_municipal': ('Jubilado Municipal', '3129'),
}


def cordoba_answer(situation, bank='bancor', **kwargs):
    # Stale hidden values from the pension branch must not change these cases.
    return payload(provincia='cordoba', situacion_cordoba=situation, banco_cordoba=bank,
                   organismo='caja_cordoba', banco_jubilado='otro', **kwargs)


class CordobaOptionsTests(unittest.TestCase):
    def test_next_flow_preserves_fields_adds_three_choices_and_clarifies_out_of_scope_message(self):
        root = next(p for p in Path(__file__).resolve().parents if (p / 'docs/whatsapp-website-intake.flow.json').exists())
        previous = json.loads((root / 'docs/whatsapp-website-intake.flow.json').read_text(encoding='utf8'))
        updated = json.loads((root / 'docs/whatsapp-website-intake-cordoba-v2.flow.json').read_text(encoding='utf8'))
        old_fields = previous['screens'][0]['layout']['children'][0]['children']
        new_fields = updated['screens'][0]['layout']['children'][0]['children']
        old_choices = next(f for f in old_fields if f.get('condition') == "${form.provincia} == 'cordoba'")['then'][0]['data-source']
        new_choices = next(f for f in new_fields if f.get('condition') == "${form.provincia} == 'cordoba'")['then'][0]['data-source']
        added = [c for c in new_choices if c['id'] not in {c['id'] for c in old_choices}]
        self.assertEqual(added, [
            {'id': 'daspu', 'title': 'DASPU'},
            {'id': 'empleado_publico_municipal', 'title': 'Empleado público municipal'},
            {'id': 'jubilado_municipal', 'title': 'Jubilado municipal'},
        ])
        self.assertEqual({c['id'] for c in new_choices}, INTAKE_SEGMENTS['cordoba'])
        self.assertEqual([c for c in new_choices if c not in added], old_choices)
        old_choices[-1:-1] = added
        next(f for f in old_fields if f.get('condition') == "${form.provincia} == 'otra'")['then'][1]['text'] = (
            'Registraremos tu consulta. Esta opción no ingresa al circuito interno.')
        self.assertEqual(updated, previous)  # Every other field, branch and payload is identical.

    def test_only_the_single_intake_accepts_new_cordoba_options(self):
        self.assertEqual(CORDOBA_EXTRA_SITUATIONS, set(NEW_OPTIONS))
        for province in SEGMENTS:
            self.assertEqual(INTAKE_SEGMENTS[province] - SEGMENTS[province],
                             set(NEW_OPTIONS) if province == 'cordoba' else set())
        for situation in NEW_OPTIONS:
            data = cordoba_answer(situation)['answer']
            event = {'id': '1', 'subjectId': '2423', 'subscriber': {'identifier': '5493510000000'},
                     'receivedAt': '2026-10-28T12:00:00Z',
                     'messageContent': {'type': 'FLOW', 'text': json.dumps(data)}}
            receipt, parsed = classify(event, '2423')
            self.assertEqual(receipt['reason'], 'invalid_segment')
            self.assertIsNone(parsed)
            self.assertEqual(normalize_answer(data)['action'], 'intake')

    def test_new_options_persist_correct_categories_and_use_the_same_web_rules(self):
        for situation, (label, id) in NEW_OPTIONS.items():
            for bank, bank_label in [('bancor', 'Banco de la Provincia de Cordoba S.A.'),
                                     ('nacion', 'Banco de la Nacion Argentina'), ('otro', 'Otros')]:
                with self.subTest(situation=situation, bank=bank):
                    api = IntakeCrm()
                    result = process(cordoba_answer(situation, bank), env=CONFIG, client=api)
                    self.assertEqual(result['action'], 'queued')
                    lead = api.leads[result['lead_id']]
                    self.assertEqual(lead[api.config.fields.lead_employment_status], id)
                    self.assertEqual(lead['UF_CRM_WA_SEGMENT'], 'cordoba_' + situation)
                    self.assertEqual(lead['UF_CRM_WA_ORGANISMO'], '')
                    actual = build_prequalification_input_from_lead(lead, api.config)
                    web = normalize_prequalification_input({'provincia': 'Córdoba',
                        'situacion_laboral': label, 'payment_bank': bank_label})
                    self.assertEqual(actual, web)
                    decision = evaluate_prequalification(actual)
                    self.assertEqual(decision, evaluate_prequalification(web))
                    self.assertEqual(decision.qualified, situation == 'daspu' or bank == 'bancor')
                    self.assertEqual(decision.reason, 'qualified' if decision.qualified else 'payment_bank_not_eligible')
                    if decision.qualified:
                        expected_bucket = {'daspu': 'cordoba_unc', 'empleado_publico_municipal': 'cordoba_general',
                                           'jubilado_municipal': 'cordoba_jubilados'}[situation]
                        self.assertEqual(resolve_routing_bucket(api.config, lead).bucket.key, expected_bucket)
                    count = len(api.writes)
                    self.assertEqual(process(cordoba_answer(situation, bank), env=CONFIG, client=api)['lead_id'], result['lead_id'])
                    self.assertEqual(len(api.writes), count)

    def test_new_categories_still_require_the_active_bank_and_ignore_hidden_pension_fields(self):
        for situation in NEW_OPTIONS:
            data = cordoba_answer(situation)['answer']
            data.pop('banco_cordoba')
            with self.assertRaises(ValueError):
                normalize_answer(data)
            value = normalize_answer(cordoba_answer(situation, 'ayuda')['answer'])
            self.assertEqual((value['action'], value['bank'], value['organism']), ('review', 'ayuda', ''))
            self.assertEqual(value['employment_status'], NEW_OPTIONS[situation][0])

    def test_invalid_cuil_in_new_categories_is_visible_without_contaminating_identity(self):
        for situation, (_, id) in NEW_OPTIONS.items():
            api = IntakeCrm()
            result = process(cordoba_answer(situation, cuil='123'), env=CONFIG, client=api)
            lead = api.leads[result['lead_id']]
            self.assertEqual((result['action'], result['reason']), ('manual_review', 'pending_cuil'))
            self.assertEqual(lead['STATUS_ID'], CUIL_REVIEW_STATUS)
            self.assertEqual(lead[api.config.fields.lead_employment_status], id)
            self.assertEqual(lead[INVALID_CUIL_FIELD], '123')
            self.assertNotIn(api.config.fields.lead_cuil, lead)
            self.assertEqual(api.contacts, {})

    def test_other_provinces_cannot_use_hidden_new_cordoba_options(self):
        for province, situation in [('catamarca', 'policia'), ('caba', 'pfa')]:
            for extra in NEW_OPTIONS:
                data = payload(provincia=province, situacion_cordoba=extra,
                               **{'situacion_' + province: situation, 'banco_' + province: 'nacion'})
                value = normalize_answer(data['answer'])
                self.assertEqual(value['employment_status'], 'Policia' if province == 'catamarca' else 'Policía Federal')
                data['answer']['situacion_' + province] = extra
                api = Mock()
                with self.assertRaises(ValueError):
                    process(data, env=CONFIG, client=api)
                api.call.assert_not_called()
