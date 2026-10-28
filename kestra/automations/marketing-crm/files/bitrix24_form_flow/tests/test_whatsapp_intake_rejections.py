import copy
import unittest

from bitrix24_form_flow.form_processor.lead_service import build_prequalification_input_from_lead
from bitrix24_form_flow.form_processor.qualification import evaluate_prequalification
from bitrix24_form_flow.form_processor.whatsapp_intake import process
from bitrix24_form_flow.form_processor.whatsapp_intake_crm import CUIL_REVIEW_STATUS, INVALID_CUIL_FIELD, REVIEW_REASON_FIELD
from test_whatsapp_intake import CONFIG, CUIL, IntakeCrm, payload
from test_whatsapp_intake_identity import guest, person


def others():
    return [
        (payload(provincia='otra', banco_otra='nacion'), 'province_not_eligible', '3933'),
        *[(payload(provincia=p, **{'situacion_' + p: 'otra', 'banco_' + p: 'nacion'}),
           'employment_status_not_eligible', '3965') for p in ['cordoba', 'catamarca', 'caba']],
    ]


class RejectionTests(unittest.TestCase):
    def test_other_province_and_other_employment_create_one_rejected_lead_with_reason(self):
        for request, reason, enum in others():
            with self.subTest(reason=reason, province=request['answer']['provincia']):
                api = IntakeCrm()
                result = process(request, env=CONFIG, client=api)
                lead = api.leads[result['lead_id']]
                self.assertEqual((result['action'], result['reason']), ('rejected', reason))
                self.assertEqual(lead['STATUS_ID'], 'JUNK')
                self.assertEqual(lead[api.config.fields.lead_rejection_reason], enum)
                self.assertEqual(lead['UF_CRM_WA_ASSISTANCE_STATE'], reason)
                self.assertEqual(lead[REVIEW_REASON_FIELD], '')
                self.assertEqual(lead[api.config.fields.lead_cuil], CUIL)
                self.assertNotIn('CONTACT_ID', lead)
                self.assertEqual(api.contacts, {})
                self.assertEqual([m for m, _ in api.writes], ['crm.lead.add'])
                self.assertIn('Solicitud rechazada', lead['COMMENTS'])
                count = len(api.writes)
                again = process(request, env=CONFIG, client=api)
                self.assertEqual((again['action'], again['lead_id']), ('rejected', result['lead_id']))
                self.assertEqual(len(api.writes), count)

    def test_explicit_out_of_scope_selection_has_priority_over_invalid_cuil_email_or_help(self):
        for request, reason, _ in others():
            request['answer'].update(cuil='123', email='bad-email', organismo='ayuda')
            for field in ['banco_otra', 'banco_cordoba', 'banco_catamarca', 'banco_caba']:
                request['answer'][field] = 'ayuda'
            api = IntakeCrm(contact=person())
            before = copy.deepcopy(api.contacts)
            result = process(request, env=CONFIG, client=api)
            lead = api.leads[result['lead_id']]
            self.assertEqual((result['action'], result['reason']), ('rejected', reason))
            self.assertEqual(lead['STATUS_ID'], 'JUNK')
            self.assertEqual(lead[INVALID_CUIL_FIELD], '123')
            self.assertNotIn(api.config.fields.lead_cuil, lead)
            self.assertNotIn('CONTACT_ID', lead)
            self.assertNotIn('EMAIL', lead)
            self.assertIn('bad-email', lead['COMMENTS'])
            self.assertEqual(api.contacts, before)

    def test_rejected_inquiry_does_not_modify_existing_management_or_contact(self):
        api = IntakeCrm(contact=person(), deals=[{'ID': '99', 'CONTACT_ID': '1', 'CATEGORY_ID': '1', 'STAGE_SEMANTIC_ID': 'P'}])
        before = copy.deepcopy(api.contacts)
        result = process(others()[0][0], env=CONFIG, client=api)
        lead = api.leads[result['lead_id']]
        self.assertEqual(result['action'], 'rejected')
        self.assertEqual(lead['CONTACT_ID'], '1')
        self.assertIn('99', lead['COMMENTS'])
        self.assertEqual(api.contacts, before)
        self.assertEqual([m for m, _ in api.writes], ['crm.lead.add'])

    def test_ambiguous_cuil_does_not_create_another_contact_when_rejecting(self):
        api = IntakeCrm(contact=person())
        api.contacts['2'] = person('2')
        before = copy.deepcopy(api.contacts)
        result = process(others()[0][0], env=CONFIG, client=api)
        self.assertEqual(result['action'], 'rejected')
        self.assertEqual(result['contact_id'], '')
        self.assertEqual(api.contacts, before)
        self.assertNotIn('CONTACT_ID', api.leads[result['lead_id']])

    def test_rejection_completes_empty_guest_without_creating_another_lead(self):
        api = IntakeCrm(lead=guest())
        result = process(others()[0][0], env=CONFIG, client=api)
        self.assertEqual((result['action'], result['lead_id']), ('rejected', '10'))
        self.assertEqual(api.leads['10']['STATUS_ID'], 'JUNK')
        self.assertEqual([m for m, _ in api.writes], ['crm.lead.update'])

    def test_other_bank_retains_existing_rules_and_is_not_a_global_rejection(self):
        for province, expected in [('catamarca', True), ('cordoba', False)]:
            api = IntakeCrm()
            request = payload(provincia=province, **{'situacion_' + province: 'empleado_publico', 'banco_' + province: 'otro'})
            result = process(request, env=CONFIG, client=api)
            self.assertEqual(result['action'], 'queued')
            decision = evaluate_prequalification(build_prequalification_input_from_lead(api.leads[result['lead_id']], api.config))
            self.assertEqual(decision.qualified, expected)
            if not expected:
                self.assertEqual(decision.rejection_label, 'OTRO BANCO')

    def test_internal_missing_data_and_invalid_identity_keep_correction_paths(self):
        for request, reason, stage in [
            (payload(banco_catamarca='ayuda'), 'pending_data', 'ASSISTANCE_REVIEW'),
            (payload(cuil='123'), 'pending_cuil', CUIL_REVIEW_STATUS),
            (payload(email='bad-email'), 'invalid_email', 'ASSISTANCE_REVIEW'),
        ]:
            api = IntakeCrm()
            result = process(request, env=CONFIG, client=api)
            self.assertEqual((result['action'], result['reason']), ('manual_review', reason))
            self.assertEqual(api.leads[result['lead_id']]['STATUS_ID'], stage)

    def test_rejection_destination_and_enum_are_validated_before_writing(self):
        for condition in ['stage', 'reason']:
            api = IntakeCrm()
            original = api.call
            if condition == 'stage':
                api.call = lambda method, body: [s for s in original(method, body) if s['STATUS_ID'] != 'JUNK'] if method == 'crm.status.list' else original(method, body)
            else:
                api.get_lead_field = lambda name: {'items': []}
            with self.subTest(condition=condition), self.assertRaises((ValueError, RuntimeError)):
                process(others()[0][0], env=CONFIG, client=api)
            self.assertEqual(api.writes, [])

    def test_partial_rejection_readback_is_uncertain_instead_of_acknowledged(self):
        for field, wrong in [('STATUS_ID', 'ASSISTANCE_REVIEW'), ('UF_CRM_REJECTION_REASON', '3939'),
                             ('UF_CRM_WA_ASSISTANCE_STATE', 'pending_data')]:
            api = IntakeCrm()
            original = api.call

            def call(method, body):
                result = original(method, body)
                if method == 'crm.lead.get':
                    result[field] = wrong
                return result

            api.call = call
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                process(others()[0][0], env=CONFIG, client=api)
            self.assertEqual([m for m, _ in api.writes], ['crm.lead.add'])
