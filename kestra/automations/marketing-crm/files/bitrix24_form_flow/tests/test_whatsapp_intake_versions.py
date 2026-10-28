import unittest
from unittest.mock import Mock

from bitrix24_form_flow.form_processor.whatsapp_intake import process
from test_whatsapp_intake import CONFIG, FLOW, IntakeCrm, payload

NEXT_FLOW = '888000111222333'


class VersionTests(unittest.TestCase):
    def test_new_primary_and_explicit_previous_flow_both_keep_their_original_identity(self):
        config = {**CONFIG, 'EDNA_INTAKE_FLOW_ID': NEXT_FLOW, 'EDNA_INTAKE_ACCEPTED_FLOW_IDS': FLOW}
        for flow in [NEXT_FLOW, FLOW]:
            api = IntakeCrm()
            request = {**payload(), 'flow_id': flow}
            request['attribution']['wa']['WA_FLOW_ID'] = flow
            result = process(request, env=config, client=api)
            self.assertEqual(result['action'], 'queued')
            lead = api.leads[result['lead_id']]
            self.assertEqual(lead['UF_CRM_WA_FLOW_ID'], flow)
            self.assertEqual(lead['UF_CRM_WA_SUBFLOW_ID'], flow)
            count = len(api.writes)
            self.assertEqual(process(request, env=config, client=api)['lead_id'], result['lead_id'])
            self.assertEqual(len(api.writes), count)

    def test_unknown_previous_or_legacy_router_flows_never_reach_crm(self):
        for flow in [FLOW, '1850162769693486', '1993586314642842', '111']:
            api = Mock()
            with self.subTest(flow=flow), self.assertRaises(ValueError):
                process({**payload(), 'flow_id': flow}, env={**CONFIG, 'EDNA_INTAKE_FLOW_ID': NEXT_FLOW}, client=api)
            api.call.assert_not_called()

    def test_invalid_acceptance_configuration_fails_closed_without_writes(self):
        for invalid in ['1850162769693486', '1993586314642842', 'bad', 'https://example.test', '1234567890123456789']:
            api = Mock()
            with self.subTest(value=invalid), self.assertRaises(ValueError):
                process(payload(), env={**CONFIG, 'EDNA_INTAKE_ACCEPTED_FLOW_IDS': invalid}, client=api)
            api.call.assert_not_called()

    def test_attribution_cannot_be_swapped_between_accepted_versions(self):
        api = Mock()
        request = payload()
        request['attribution']['wa']['WA_FLOW_ID'] = NEXT_FLOW
        with self.assertRaises(ValueError):
            process(request, env={**CONFIG, 'EDNA_INTAKE_ACCEPTED_FLOW_IDS': NEXT_FLOW}, client=api)
        api.call.assert_not_called()

    def test_rejection_acknowledgement_is_compatible_with_an_old_bridge_during_deployment(self):
        request = payload(provincia='otra', banco_otra='nacion')
        request.pop('acknowledgement_version')
        api = IntakeCrm()
        result = process(request, env=CONFIG, client=api)
        self.assertEqual((result['action'], result['commercial_outcome']), ('already_processed', 'rejected'))
        self.assertEqual(api.leads[result['lead_id']]['STATUS_ID'], 'JUNK')
        self.assertEqual(result['reason'], 'province_not_eligible')
        count = len(api.writes)
        again = process({**request, 'acknowledgement_version': 2}, env=CONFIG, client=api)
        self.assertEqual((again['action'], again['lead_id']), ('rejected', result['lead_id']))
        self.assertEqual(len(api.writes), count)
