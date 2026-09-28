import copy
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError
from urllib.request import Request

sys.path.insert(0, str(Path(__file__).parents[1] / 'files'))
from bitrix24_rejection_history import core, run


class ReadFailureTests(unittest.TestCase):
    def request(self, read_only=True):
        return core.request_json(Request('https://example.invalid/secret'),
                                 service='bitrix', operation='crm.lead.list' if read_only else 'batch',
                                 read_only=read_only, timeout=1)

    def test_transient_read_recovers_with_bounded_backoff(self):
        with patch.object(core.urllib.request, 'urlopen', side_effect=[
                URLError('https://example.invalid/secret'),
                HTTPError('secret', 503, 'private response', {}, None),
                io.BytesIO(b'{"result": []}')]) as request, \
                patch.object(core.time, 'sleep') as sleep, patch('builtins.print') as log:
            self.assertEqual(self.request(), {'result': []})
        self.assertEqual(request.call_count, 3)
        self.assertEqual([x.args[0] for x in sleep.call_args_list], [2, 4])
        self.assertNotIn('secret', str(log.call_args_list))
        self.assertNotIn('private response', str(log.call_args_list))

    def test_mutation_is_never_retried_after_uncertain_transport_failure(self):
        with patch.object(core.urllib.request, 'urlopen', side_effect=TimeoutError('secret')) as request, \
                patch.object(core.time, 'sleep') as sleep, self.assertRaises(core.ApiFailure) as caught:
            self.request(read_only=False)
        self.assertEqual(request.call_count, 1)
        sleep.assert_not_called()
        self.assertEqual(caught.exception.details['operation'], 'batch')
        self.assertFalse(caught.exception.details['retryable_read'])

    def test_read_exhaustion_keeps_operation_status_and_attempts_without_secrets(self):
        with patch.object(core.urllib.request, 'urlopen', side_effect=HTTPError(
                'https://example.invalid/secret', 429, 'sensitive body', {}, None)) as request, \
                patch.object(core.time, 'sleep'), patch('builtins.print'), \
                self.assertRaises(core.ApiFailure) as caught:
            self.request()
        detail = core.error_details(caught.exception)
        self.assertEqual(request.call_count, 3)
        self.assertEqual(detail['http_status'], 429)
        self.assertEqual(detail['attempts'], 3)
        self.assertEqual(detail['operation'], 'crm.lead.list')
        self.assertNotIn('secret', json.dumps(detail))
        self.assertNotIn('sensitive', json.dumps(detail))

    def test_permission_failure_and_malformed_json_do_not_retry(self):
        for response in [HTTPError('secret', 403, 'secret', {}, None), io.BytesIO(b'not-json-secret')]:
            with self.subTest(response=type(response).__name__), \
                    patch.object(core.urllib.request, 'urlopen', side_effect=[response]) as request, \
                    patch.object(core.time, 'sleep') as sleep, self.assertRaises(core.ApiFailure):
                self.request()
            self.assertEqual(request.call_count, 1)
            sleep.assert_not_called()

    def test_bitrix_rate_limit_retries_but_unknown_error_does_not_leak(self):
        with patch.object(core.urllib.request, 'urlopen', side_effect=[
                io.BytesIO(b'{"error":"QUERY_LIMIT_EXCEEDED"}'),
                io.BytesIO(b'{"result":[]}')]), patch.object(core.time, 'sleep'), patch('builtins.print'):
            self.assertEqual(self.request(), {'result': []})
        with patch.object(core.urllib.request, 'urlopen', return_value=io.BytesIO(
                b'{"error":"https://secret","error_description":"password"}')), \
                self.assertRaises(core.ApiFailure) as caught:
            self.request()
        self.assertEqual(caught.exception.details['code'], 'unknown_api_error')
        self.assertNotIn('secret', json.dumps(core.error_details(caught.exception)))


class ResumeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.journal = core.Journal(self.root / 'execution')
        self.rows = [{'ID': str(i), 'STATUS_ID': '3', 'DATE_CREATE': 'old',
                      'DATE_MODIFY': 'old', core.REASON: '', core.NOTICE: '',
                      'proposed': {'STATUS_ID': core.TARGET, core.REASON: '3943',
                                   core.NOTICE: 'HISTORICAL'}} for i in range(1, 103)]
        self.journal.append({'type': 'intent', 'rows': self.rows[:101]})
        self.journal.append({'type': 'outcomes', 'states': {r['ID']: 'verified' for r in self.rows[:101]}})
        self.live = {r['ID']: {**r, 'STATUS_SEMANTIC_ID': 'F', **r['proposed']} for r in self.rows[:101]}
        self.live['102'] = {**self.rows[-1], 'STATUS_SEMANTIC_ID': 'F'}
        self.client = Mock()
        self.client.leads.side_effect = lambda ids: copy.deepcopy({i: self.live[i] for i in ids})
        self.pause = self.root / 'execution/paused.json'
        self.original = b'{"at":"2026-09-26T03:30:47Z","error_type":"ApiFailure"}'
        self.pause.write_bytes(self.original)
        self.digest = hashlib.sha256(self.original).hexdigest()
        self.stats = {'mode': 'active', 'jobs': {'pending': 0},
                      'unconfirmed_submissions': 0, 'stale_business_receipts': 0}

    def resume(self, **changes):
        return run.resume(self.root, self.client, self.rows, self.journal,
                          changes.get('digest', self.digest), changes.get('handled', 101))

    def test_resume_reads_all_migrated_preserves_journal_and_archives_pause(self):
        before = self.journal.path.read_bytes()
        with patch.object(run, 'receiver_stats', return_value=self.stats):
            result = self.resume()
        self.assertEqual(result['live_verified'], 101)
        self.assertEqual(result['handled'], 101)
        self.assertEqual(result['remaining'], 1)
        self.assertEqual(result['external_mutations'], 0)
        self.assertEqual(result['status'], 'resumed_waiting_for_schedule')
        self.assertFalse(result['paused'])
        self.assertEqual(self.journal.path.read_bytes(), before)
        self.assertEqual((self.root / ('execution/resumes/' + self.digest + '.paused.json')).read_bytes(), self.original)
        self.client.batch.assert_not_called()
        read_ids = [i for call in self.client.leads.call_args_list for i in call.args[0]]
        self.assertEqual(set(read_ids), set(self.live))

    def test_stale_acknowledgement_or_count_cannot_clear_pause(self):
        for changes in [{'digest': '0' * 64}, {'handled': 100}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.resume(**changes)
            self.assertEqual(self.pause.read_bytes(), self.original)
        self.client.leads.assert_not_called()

    def test_uncertain_write_blocks_resume_without_any_resend(self):
        self.journal.append({'type': 'intent', 'rows': self.rows[-1:]})
        with self.assertRaises(ValueError):
            self.resume()
        self.client.leads.assert_not_called()
        self.client.batch.assert_not_called()
        self.assertTrue(self.pause.exists())

    def test_even_first_migrated_record_is_reverified_before_resume(self):
        self.live['1'][core.NOTICE] = ''
        with self.assertRaises(ValueError):
            self.resume()
        self.assertTrue(self.pause.exists())
        self.client.batch.assert_not_called()

    def test_receiver_unsafe_state_keeps_pause(self):
        for change in [{'mode': 'paused'}, {'unconfirmed_submissions': 1},
                       {'stale_business_receipts': 1}, {'jobs': {'pending': 125}}]:
            with self.subTest(change=change), \
                    patch.object(run, 'receiver_stats', return_value={**self.stats, **change}), \
                    self.assertRaises(ValueError):
                self.resume()
            self.assertTrue(self.pause.exists())

    def test_failed_diagnostics_preserve_original_pause_and_record_safe_detail(self):
        exc = core.ApiFailure('https://secret/password', service='bitrix',
                              operation='crm.status.list', http_status=503, attempts=3)
        with patch('builtins.print'):
            run.record_failure(self.root, exc, 'validate_live_catalogs')
        self.assertEqual(self.pause.read_bytes(), self.original)
        detail = json.loads((self.root / 'execution/last-error.json').read_text())
        self.assertEqual(detail['operation'], 'crm.status.list')
        self.assertEqual(detail['phase'], 'validate_live_catalogs')
        self.assertNotIn('secret', json.dumps(detail))
        self.assertEqual(len((self.root / 'execution/errors.jsonl').read_text().splitlines()), 1)


if __name__ == '__main__':
    unittest.main()
