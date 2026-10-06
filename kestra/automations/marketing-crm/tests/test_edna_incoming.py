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

    def test_flow_preserves_reply_references_without_claiming_verified_identity(self):
        incoming = event(data={'provincia': 'cordoba', 'situacion_cordoba': 'jubilado_pensionado'})
        incoming.update(replyOutMessageId=98765, replyOutMessageExternalRequestId='flow-test-request')
        receipt, parsed = receiver.classify(incoming, '2423')
        self.assertEqual(receipt['kind'], 'flow_response')
        self.assertEqual(parsed['reply_out_message_id'], '98765')
        self.assertEqual(parsed['reply_out_message_external_request_id'], 'flow-test-request')
        self.assertFalse(parsed['flow_id_verified'])
        self.assertNotIn('reply_out_message_id', receipt)

    def test_malformed_reply_references_are_invalid_but_null_remains_optional(self):
        for field, value in [('replyOutMessageId', True), ('replyOutMessageId', {}),
                             ('replyOutMessageExternalRequestId', []),
                             ('replyOutMessageExternalRequestId', 'x' * 257)]:
            incoming = event(data={'provincia': 'otra'})
            incoming[field] = value
            receipt, parsed = receiver.classify(incoming, '2423')
            self.assertEqual(receipt['reason'], 'invalid_reply_reference')
            self.assertIsNone(parsed)
        incoming = event(data={'provincia': 'otra'})
        incoming.update(replyOutMessageId=None, replyOutMessageExternalRequestId=None)
        self.assertEqual(receiver.classify(incoming, '2423')[0]['kind'], 'flow_response')


class EdnaCorrelationTest(unittest.TestCase):
    def correlated(self):
        incoming = event(data={'provincia': 'catamarca', 'situacion_catamarca': 'policia'})
        incoming.update(replyOutMessageId='9001', replyOutMessageExternalRequestId='request-uuid')
        incoming['routerContext'] = {'verified': True, 'flow_id': '1850162769693486', 'send_id': 42,
                                     'request_id': 'request-uuid', 'outgoing_message_id': '9001'}
        return incoming

    def test_trusted_ledger_context_marks_flow_identity_in_receipt_and_artifact(self):
        receipt, parsed = receiver.classify(self.correlated(), '2423')
        self.assertTrue(receipt['flow_id_verified'])
        self.assertEqual(receipt['reason'], 'verified_router_response')
        self.assertTrue(parsed['flow_id_verified'])
        self.assertEqual(parsed['flow_send_id'], 42)
        self.assertEqual(parsed['flow_id'], '1850162769693486')
        self.assertEqual(parsed['flow_request_id'], 'request-uuid')

    def test_mismatched_or_malformed_context_never_becomes_verified(self):
        for context in [False, [], {}, {'verified': 'true'},
                        {**self.correlated()['routerContext'], 'send_id': True},
                        {**self.correlated()['routerContext'], 'send_id': 0},
                        {**self.correlated()['routerContext'], 'request_id': 'another'},
                        {**self.correlated()['routerContext'], 'outgoing_message_id': '9002'},
                        {**self.correlated()['routerContext'], 'flow_id': 'other-flow'}]:
            incoming = self.correlated()
            incoming['routerContext'] = context
            receipt, parsed = receiver.classify(incoming, '2423')
            self.assertFalse(receipt['flow_id_verified'])
            self.assertEqual(receipt['kind'], 'invalid')
            self.assertIsNone(parsed)

    def test_context_requires_reply_references_and_valid_answers(self):
        for field in ['replyOutMessageId', 'replyOutMessageExternalRequestId']:
            incoming = self.correlated()
            del incoming[field]
            self.assertFalse(receiver.classify(incoming, '2423')[0]['flow_id_verified'])
        incoming = self.correlated()
        incoming['messageContent']['text'] = '{}'
        self.assertFalse(receiver.classify(incoming, '2423')[0]['flow_id_verified'])


if __name__ == '__main__':
    unittest.main()
