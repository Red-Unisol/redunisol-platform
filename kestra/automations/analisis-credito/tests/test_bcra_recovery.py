from contextlib import closing
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

import yaml

DOMAIN = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(DOMAIN / 'files'))
from consulta_quiebra_credix import bcra, bcra_recovery as recovery
from consulta_quiebra_credix.bcra_recovery_entrypoint import KestraKV
from consulta_quiebra_credix.cache_response_entrypoint import _mirror_cache_hit
from consulta_quiebra_credix.service import SearchRequest, cache_key_for_cuil, cache_key_for_name, find_cached_result_in_payloads
from consulta_quiebra_credix.sqlite_cache import read_cache_payload, write_cache_entries

CUIT = '20123456786'
NOW = datetime.now(timezone.utc).replace(microsecond=0)


def report(cuit=CUIT, name='TEST PERSON', cached_at=None):
    cached = cached_at or NOW - timedelta(minutes=3)
    return {'version': 4, 'cached_at': cached.isoformat(),
            'expires_at': (cached + timedelta(days=7)).isoformat(),
            'result': {'cuit': cuit, 'nombre': name, 'ok': True, 'status': 'single',
                       'data': [{'title': 'CredixSA original', 'rows': [['untouched']]}],
                       'rows': [], 'alertas': [{'detalle': 'unchanged'}], 'error': '',
                       'normalized': {'persona': {'cuit': cuit}, 'empleador': {'nombre': 'unchanged'},
                                      'bcra': {'fuente': 'CredixSA', 'consulta_directa_estado': 'unavailable',
                                               'deuda_vigente_total': '$ 999',
                                               'consulta_directa_intentos': [{'endpoint': 'current', 'result': 'transport_error'}]}}}}


def direct():
    value = bcra._normalize({}, {})
    value['consultado_en'] = NOW.isoformat()
    return value


class FakeKV:
    def __init__(self):
        self.values = {}
        self.writes = []
        self.error = False

    def get(self, key):
        if self.error:
            raise OSError('private-url-and-secret-must-not-be-logged')
        return deepcopy(self.values.get(key))

    def put(self, key, payload, ttl):
        self.values[key] = deepcopy(payload)
        self.writes.append((key, deepcopy(payload), ttl))


class BcraRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = str(Path(self.temp.name) / 'cache.sqlite')
        self.kv = FakeKV()
        self.clock = NOW
        self.original = report()
        self.save(self.original)

    def save(self, payload):
        result = payload['result']
        entries = [{'key': key, 'value': json.dumps(payload)} for key in
                   [cache_key_for_cuil(result['cuit']), cache_key_for_name(result['nombre'])]]
        write_cache_entries(self.db, entries)

    def read(self, key=None):
        return read_cache_payload(self.db, key or cache_key_for_cuil(CUIT))

    def state(self, cuit=CUIT):
        with closing(sqlite3.connect(self.db)) as connection:
            connection.row_factory = sqlite3.Row
            row = connection.execute('SELECT * FROM bcra_recovery WHERE cuit = ?', (cuit,)).fetchone()
            return dict(row) if row else None

    def run_worker(self, consult=None, **kwargs):
        return recovery.run_recovery(self.db, self.kv, now=lambda: self.clock,
                                     jitter=lambda *_: 0, consult=consult or (lambda *a, **k: direct()), **kwargs)

    def test_recovers_once_per_cuil_preserves_original_report_and_updates_both_aliases_and_kv(self):
        calls = []

        def consult(cuit, **kwargs):
            calls.append((cuit, kwargs['max_attempts']))
            return direct()

        output = self.run_worker(consult)
        self.assertEqual(calls, [(CUIT, 1)])
        self.assertEqual(output['recovered'], 1)
        self.assertEqual(output['kv_synced'], 2)
        updated = self.read()
        expected = deepcopy(self.original)
        expected['result']['normalized']['bcra'] = updated['result']['normalized']['bcra']
        self.assertEqual(updated, expected)
        self.assertEqual(updated['result']['normalized']['bcra']['fuente'], 'BCRA')
        self.assertEqual(self.read(cache_key_for_name('TEST PERSON')), updated)
        for key, value, ttl in self.kv.writes:
            self.assertEqual(value, updated)
            self.assertEqual(ttl, int((datetime.fromisoformat(self.original['expires_at']) - NOW).total_seconds()))
        self.assertEqual(self.run_worker(consult)['processed'], 0)
        self.assertEqual(len(calls), 1)

    def test_real_recovery_has_one_parallel_round_and_no_sleep_or_partial_publication(self):
        good = {'status': 200, 'results': {'identificacion': CUIT, 'periodos': []}}
        with (patch.object(bcra, '_fetch', side_effect=lambda path: (200, good) if path == CUIT else (503, {})) as fetch,
              patch.object(bcra.time, 'sleep') as sleep):
            output = self.run_worker(bcra.consult_bcra)
        self.assertEqual(fetch.call_count, 2)
        sleep.assert_not_called()
        self.assertEqual(output['retry_scheduled'], 1)
        self.assertEqual(self.read(), self.original)
        self.assertEqual(self.kv.writes, [])

    def test_four_failures_use_persisted_backoff_and_stop_until_new_snapshot(self):
        calls = []

        def fail(*args, **kwargs):
            calls.append(True)
            return None

        for index in range(4):
            output = self.run_worker(fail)
            state = self.state()
            self.assertEqual(state['attempt_count'], index + 1)
            if index < 3:
                due = self.clock + timedelta(minutes=recovery.RETRY_MINUTES[index + 1])
                self.assertEqual(datetime.fromisoformat(state['next_attempt_at']), due)
                self.assertEqual(self.run_worker(fail)['processed'], 0)
                self.clock = due
            else:
                self.assertEqual(output['exhausted'], 1)
                self.assertEqual(state['state'], 'exhausted')
        self.clock += timedelta(hours=2)
        self.assertEqual(self.run_worker(fail)['processed'], 0)
        self.assertEqual(len(calls), 4)
        self.save(report(cached_at=self.clock - timedelta(minutes=3)))
        self.assertEqual(self.run_worker()['recovered'], 1)
        self.assertEqual(self.state()['attempt_count'], 1)

    def test_first_attempt_is_not_due_before_two_minutes_and_jitter_is_bounded(self):
        self.save(report(cached_at=NOW))
        self.assertEqual(self.run_worker()['processed'], 0)
        self.clock += timedelta(minutes=2)
        self.assertEqual(self.run_worker()['recovered'], 1)
        self.assertEqual(recovery.retry_at(NOW, 0, lambda low, high: high), NOW + timedelta(seconds=144))
        self.assertEqual(recovery.retry_at(NOW, 3, lambda low, high: high), NOW + timedelta(minutes=72))

    def test_ineligible_reports_are_not_sent_to_bcra(self):
        variants = []
        for field, value in [('version', 3), ('cached_at', (NOW - timedelta(days=8)).isoformat()),
                             ('expires_at', (NOW - timedelta(seconds=1)).isoformat())]:
            payload = report()
            payload[field] = value
            variants.append(payload)
        for state in ['invalid_identity', 'ok', None]:
            payload = report()
            payload['result']['normalized']['bcra']['consulta_directa_estado'] = state
            variants.append(payload)
        payload = report()
        payload['result']['normalized']['persona']['cuit'] = '27999999999'
        variants.append(payload)
        payload = report()
        payload['result']['status'] = 'multiple'
        variants.append(payload)
        payload = report()
        payload['result']['normalized']['bcra']['fuente'] = 'BCRA'
        variants.append(payload)
        payload = report()
        payload['result']['ok'] = False
        variants.append(payload)
        for payload in variants:
            with self.subTest(payload=payload):
                with closing(sqlite3.connect(self.db)) as connection, connection:
                    connection.execute('UPDATE credixsa_cache SET payload_json = ?, cached_at = ?, expires_at = ?',
                                       (json.dumps(payload), payload['cached_at'], payload['expires_at']))
                with patch.object(recovery, 'claim_next', wraps=recovery.claim_next):
                    output = self.run_worker(lambda *a, **k: self.fail('Unexpected BCRA query'))
                self.assertEqual(output['processed'], 0)

    def test_newer_or_changed_snapshot_during_request_is_not_overwritten(self):
        for newer_timestamp in [True, False]:
            with self.subTest(newer_timestamp=newer_timestamp):
                payload = report(cached_at=NOW if newer_timestamp else datetime.fromisoformat(self.original['cached_at']))
                payload['result']['normalized']['empleador']['nombre'] = f'new report {newer_timestamp}'

                def consult(*args, **kwargs):
                    self.save(payload)
                    return direct()

                output = self.run_worker(consult)
                self.assertEqual(output['superseded'], 1)
                self.assertEqual(self.read(), payload)
                self.assertEqual(self.kv.writes, [])
                self.original = payload
                self.clock += timedelta(minutes=3)

    def test_expiry_during_request_does_not_extend_or_publish_report(self):
        self.original['expires_at'] = (NOW + timedelta(seconds=1)).isoformat()
        self.save(self.original)

        def consult(*args, **kwargs):
            self.clock += timedelta(seconds=2)
            return direct()

        self.assertEqual(self.run_worker(consult)['superseded'], 1)
        self.assertEqual(self.read(), self.original)
        self.assertEqual(self.kv.writes, [])

    def test_claim_prevents_overlapping_workers_and_expired_owner_cannot_publish(self):
        recovery.enqueue_fallbacks(self.db, NOW, lambda *_: 0)
        first = recovery.claim_next(self.db, NOW)
        self.assertIsNone(recovery.claim_next(self.db, NOW))
        later = NOW + timedelta(seconds=recovery.LEASE_SECONDS + 1)
        second = recovery.claim_next(self.db, later)
        self.assertEqual(second['attempt_count'], 2)
        self.assertEqual(recovery.finish_claim(self.db, first, direct(), [], later), 'superseded')
        self.assertEqual(self.read(), self.original)
        self.assertEqual(recovery.finish_claim(self.db, second, direct(), [], later), 'recovered')

    def test_crash_on_last_claim_cannot_make_attempts_unbounded(self):
        recovery.enqueue_fallbacks(self.db, NOW, lambda *_: 0)
        for index in range(4):
            claim = recovery.claim_next(self.db, self.clock)
            self.assertEqual(claim['attempt_count'], index + 1)
            self.clock += timedelta(seconds=recovery.LEASE_SECONDS + 1)
        self.assertIsNone(recovery.claim_next(self.db, self.clock))
        self.assertEqual(self.state()['state'], 'exhausted')

    def test_batch_limit_and_time_budget_leave_remaining_cases_for_next_run(self):
        for i in range(6):
            self.save(report(cuit=f'201234567{i:02}', name=f'TEST {i}'))
        self.assertEqual(self.run_worker(max_per_run=5)['processed'], 5)
        self.assertEqual(self.run_worker(max_per_run=5)['processed'], 2)
        self.save(report(cuit='27123456780', name='BUDGET'))
        self.assertEqual(self.run_worker(monotonic=iter([0, 81, 81, 81]).__next__)['processed'], 0)

    def test_recovered_sqlite_is_not_replaced_by_kv_replay_or_fallback_in_same_batch(self):
        self.run_worker()
        recovered = self.read()
        result = {**self.original['result'], 'cache_hit': True, 'cache_source': 'cuil'}
        with patch.dict(os.environ, {'CREDIX_CACHE_SQLITE_PATH': self.db}):
            _mirror_cache_hit(result, self.original, None)
            selected = find_cached_result_in_payloads(SearchRequest(CUIT, ''), self.original, None)
        self.assertEqual(self.read(), recovered)
        self.assertEqual(selected['normalized']['bcra']['fuente'], 'BCRA')
        newer = report(cached_at=datetime.fromisoformat(self.original['cached_at']) + timedelta(microseconds=1))
        self.save(newer)
        self.assertEqual(self.read(), newer)
        write_cache_entries(self.db, [
            {'key': 'duplicate', 'value': json.dumps(recovered)},
            {'key': 'duplicate', 'value': json.dumps(self.original)}])
        self.assertEqual(self.read('duplicate'), recovered)

    def test_sqlite_only_hit_and_name_hit_use_recovered_payload(self):
        self.run_worker()
        with patch.dict(os.environ, {'CREDIX_CACHE_SQLITE_PATH': self.db}):
            for request, cuil, name in [(SearchRequest(CUIT, ''), None, None),
                                        (SearchRequest('', 'TEST PERSON'), None, self.original)]:
                cached = find_cached_result_in_payloads(request, cuil, name)
                self.assertEqual(cached['normalized']['bcra']['fuente'], 'BCRA')
                self.assertEqual(cached['cached_at'], self.original['cached_at'])

    def test_kv_failure_keeps_outbox_and_sqlite_readable_until_retry_without_reconsulting_bcra(self):
        self.kv.error = True
        output = self.run_worker()
        self.assertEqual(output['recovered'], 1)
        self.assertEqual(output['kv_errors'], 2)
        self.assertEqual(output['kv_pending'], 2)
        self.assertEqual(self.read()['result']['normalized']['bcra']['fuente'], 'BCRA')
        self.kv.error = False
        self.assertEqual(self.run_worker()['kv_synced'], 0)
        self.clock += timedelta(minutes=2)
        output = self.run_worker(lambda *a, **k: self.fail('BCRA must not be queried again'))
        self.assertEqual(output['kv_synced'], 2)
        self.assertEqual(output['kv_pending'], 0)

    def test_newer_kv_generation_is_not_overwritten(self):
        newer = report(cached_at=NOW)
        for key in [cache_key_for_cuil(CUIT), cache_key_for_name('TEST PERSON')]:
            self.kv.values[key] = newer
        self.run_worker()
        self.assertEqual(self.kv.writes, [])
        self.assertEqual(self.kv.values[cache_key_for_cuil(CUIT)], newer)

    def test_kv_read_write_race_cannot_make_consumers_return_an_older_generation(self):
        newer = report(cached_at=NOW)
        original_put = self.kv.put

        def racing_put(key, payload, ttl):
            self.save(newer)
            original_put(key, payload, ttl)

        self.kv.put = racing_put
        self.run_worker()
        with patch.dict(os.environ, {'CREDIX_CACHE_SQLITE_PATH': self.db}):
            cached = find_cached_result_in_payloads(SearchRequest(CUIT, ''), self.kv.values[cache_key_for_cuil(CUIT)], None)
        self.assertEqual(cached['cached_at'], newer['cached_at'])
        self.assertEqual(self.read(), newer)

    def test_missing_database_is_not_created(self):
        path = str(Path(self.temp.name) / 'missing.sqlite')
        with self.assertRaisesRegex(RuntimeError, 'shared volume'):
            recovery.run_recovery(path, self.kv)
        self.assertFalse(Path(path).exists())

    def test_schedule_is_bounded_nonoverlapping_and_does_not_require_credix_credentials(self):
        flow = yaml.safe_load((DOMAIN / 'flows/recuperar_bcra_cache.yaml').read_text())
        self.assertEqual(flow['concurrency']['limit'], 1)
        self.assertEqual(flow['triggers'][0]['cron'], '*/2 * * * *')
        self.assertFalse(flow['triggers'][0]['allowConcurrent'])
        self.assertEqual(flow['tasks'][0]['timeout'], 'PT3M')
        env = flow['tasks'][0]['env']
        self.assertNotIn('CREDIX_USER', env)
        self.assertNotIn('CREDIX_PASS', env)


class KestraKVContractTests(unittest.TestCase):
    def test_api_uses_value_wrapper_text_plain_and_remaining_ttl_header(self):
        kv = KestraKV('https://kestra.example', 'main', 'redunisol.prod.analisis-credito', 'test', 'test-password')

        class Response:
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return None
            def read(self):
                return json.dumps({'value': report(), 'type': 'JSON'}).encode()

        with patch('consulta_quiebra_credix.bcra_recovery_entrypoint.urlopen', return_value=Response()) as request:
            self.assertEqual(kv.get('credixsa.test'), report())
            kv.put('credixsa.test', report(), 123)
        put = request.call_args.args[0]
        self.assertEqual(put.method, 'PUT')
        self.assertEqual(put.get_header('Content-type'), 'text/plain')
        self.assertEqual(put.get_header('Ttl'), 'PT123S')
        self.assertEqual(json.loads(put.data), report())
        self.assertEqual(request.call_args.kwargs['timeout'], 5)


if __name__ == '__main__':
    unittest.main()
