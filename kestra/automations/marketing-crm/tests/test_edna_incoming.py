import importlib.util
import json
from pathlib import Path
import unittest

MODULE = Path(__file__).parents[1] / 'files' / 'edna_incoming' / 'receiver.py'
SPEC = importlib.util.spec_from_file_location('edna_receiver', MODULE)
receiver = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(receiver)


def event(kind='FLOW', data=None):
    return {
        'id': '101', 'subjectId': '2423', 'subscriber': {'identifier': '5493510000000'},
        'receivedAt': '2026-09-17T12:00:00Z',
        'messageContent': {'type': kind, 'text': json.dumps(data) if kind == 'FLOW' else data},
    }


class EdnaReceiverTest(unittest.TestCase):
    def test_required_routes_and_all_allowed_segments(self):
        # Contract of the published router, independent of the parser's enums.
        expected = {
            'cordoba': ['jubilado_pensionado', 'empleado_publico', 'policia_cordoba', 'docente', 'salud', 'unc', 'otra'],
            'catamarca': ['empleado_publico', 'policia', 'docente', 'salud', 'otra'],
            'caba': ['pfa', 'otra'], 'otra': ['otra'],
        }
        for province, segments in expected.items():
            for segment in segments:
                with self.subTest(province=province, segment=segment):
                    data = {'provincia': province, f'situacion_{province}': segment}
                    receipt, parsed = receiver.classify(event(data=data), '2423')
                    self.assertEqual(receipt['kind'], 'flow_response')
                    self.assertEqual(parsed['province'], province)
                    self.assertEqual(parsed['segment'], segment)
                    self.assertFalse(parsed['flow_id_verified'])
                    self.assertNotIn('subscriber_identifier', receipt)

    def test_entry_is_contains_case_insensitive_with_extra_information(self):
        receipt, parsed = receiver.classify(event('TEXT', 'Hola VENGO del sitio web de Red Unisol. ref=abc'), '2423')
        self.assertEqual(receipt['kind'], 'router_entry')
        self.assertEqual(parsed['wa_entry'], 'website')
        self.assertNotIn('text', parsed)

    def test_other_channel_and_unrelated_message_are_ignored(self):
        incoming = event('TEXT', receiver.ENTRY_PHRASE)
        incoming['subjectId'] = 2580
        self.assertEqual(receiver.classify(incoming, '2423')[0]['reason'], 'other_channel')
        self.assertEqual(receiver.classify(event('TEXT', 'hola'), '2423')[0]['kind'], 'ignored')

    def test_inactive_fields_are_ignored_and_token_preserved(self):
        data = {'provincia': 'caba', 'situacion_caba': 'pfa', 'situacion_cordoba': 'docente', 'flow_token': 'test-ref'}
        _, parsed = receiver.classify(event(data=data), '2423')
        self.assertEqual(parsed['segment'], 'pfa')
        self.assertEqual(parsed['flow_token'], 'test-ref')

    def test_malformed_flow_data_does_not_crash_or_claim_successful_classification(self):
        for data in [None, [], {}, {'provincia': []}, {'provincia': 'unknown'},
                     {'provincia': 'caba', 'situacion_caba': 'docente'},
                     {'provincia': 'cordoba'}, {'provincia': 'otra', 'flow_token': 1}]:
            with self.subTest(data=data):
                receipt, parsed = receiver.classify(event(data=data), '2423')
                self.assertTrue(receipt['ok'])  # Acknowledges receipt, not commercial acceptance.
                self.assertEqual(receipt['kind'], 'invalid')
                self.assertIsNone(parsed)
        incoming = event(data={})
        incoming['messageContent']['text'] = '{broken'
        self.assertEqual(receiver.classify(incoming, '2423')[0]['reason'], 'invalid_flow_json')

    def test_invalid_envelopes_and_missing_configuration(self):
        for incoming in [None, [], {}, {'id': True, 'subjectId': '2423'},
                         {**event(data={}), 'receivedAt': 'not-a-date'},
                         {**event(data={}), 'receivedAt': '2026-09-17T12:00:00'}]:
            self.assertEqual(receiver.classify(incoming, '2423')[0]['kind'], 'invalid')
        with self.assertRaises(ValueError):
            receiver.classify(event(data={}), '')


if __name__ == '__main__':
    unittest.main()
