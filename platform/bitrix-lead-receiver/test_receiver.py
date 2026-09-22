import concurrent.futures
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from receiver import Client, Engine, Store, make_handler, normalize_payload


class FakeClient:
    actionable = {'NEW', 'WON'}
    current = 'NEW'

    def status(self, lead):
        return self.current


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.now = 1000.
        self.path = Path(self.tmp.name)/'db.sqlite'
        self.store = Store(self.path, lambda: self.now)
        self.store.mode('active')
        self.client = FakeClient()
        self.engine = Engine(self.store, self.client)

    def tearDown(self):
        self.tmp.cleanup()

    def receipt(self):
        with self.store.db() as db:
            return dict(db.execute('SELECT * FROM receipts ORDER BY created DESC LIMIT 1').fetchone())

    def test_concurrent_ingress_coalesces_without_losing_versions(self):
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            list(pool.map(lambda _: self.store.enqueue('12'), range(80)))
        self.assertEqual(self.store.stats()['jobs'], {'pending': 1})
        job = self.store.take()
        self.assertEqual(job['version'], 80)
        self.assertEqual(self.store.stats()['counters']['events_coalesced'], 79)

    def test_event_during_read_is_rechecked(self):
        self.store.enqueue('12')
        job = self.store.take()
        self.store.enqueue('12')
        self.store.finish_check(job, 'INTAKE')
        self.assertEqual(self.store.take()['version'], 2)

    def test_event_during_processing_survives_completion_and_state_transition(self):
        self.store.enqueue('12')
        self.engine.step()
        r = self.receipt()
        self.assertTrue(self.store.claim(r['id'], '12', 'executionA'))
        self.store.enqueue('12')
        self.store.complete(r['id'], 'executionA', True)
        self.client.current = 'WON'
        self.engine.step()
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM receipts').fetchone()[0], 2)

    def test_success_same_status_is_filtered_but_failed_business_retries(self):
        self.store.enqueue('12')
        self.engine.step()
        r = self.receipt()
        self.store.claim(r['id'], '12', 'executionA')
        self.store.complete(r['id'], 'executionA', False)
        self.now += 61
        self.engine.step()
        r = self.receipt()
        self.store.claim(r['id'], '12', 'executionB')
        self.store.complete(r['id'], 'executionB', True)
        self.store.enqueue('12')
        self.engine.step()
        self.assertEqual(self.store.stats()['jobs'], {'done': 1})
        self.assertEqual(self.store.stats()['counters']['business_requested'], 2)

    def test_ambiguous_submit_cannot_grant_two_executions(self):
        self.store.enqueue('12')
        self.engine.step()
        first = self.store.submissions()[0]
        self.now += 61
        second = self.store.submissions()[0]
        self.assertEqual(first['id'], second['id'])
        self.assertTrue(self.store.claim(first['id'], '12', 'executionA'))
        self.assertFalse(self.store.claim(first['id'], '12', 'executionB'))
        self.assertFalse(self.store.claim(first['id'], '99', 'executionA'))
        self.assertFalse(self.store.complete(first['id'], 'executionB', True))

    def test_restart_preserves_pending_and_claimed_work(self):
        self.store.enqueue('12')
        self.engine.step()
        r = self.receipt()
        self.store.claim(r['id'], '12', 'executionA')
        self.store.enqueue('13')
        self.store.take()  # Simulate death while reading Bitrix.
        restarted = Store(self.path, lambda: self.now)
        self.now += 121
        self.assertEqual(restarted.take()['lead'], '13')
        self.assertFalse(restarted.claim(r['id'], '12', 'executionB'))
        self.assertTrue(restarted.complete(r['id'], 'executionA', True))

    def test_reconciliation_recovers_callback_but_never_guesses_ambiguous_result(self):
        self.store.enqueue('12')
        self.engine.step()
        r = self.receipt()
        self.store.claim(r['id'], '12', 'executionA')
        self.now += 61
        self.client.result = lambda _: None
        self.engine.reconcile()
        self.assertEqual(self.store.stats()['jobs'], {'waiting': 1})
        self.client.result = lambda _: True
        self.engine.reconcile()
        self.assertEqual(self.store.stats()['jobs'], {'done': 1})

    def test_pause_and_shadow_never_dispatch_and_activation_replays_shadow(self):
        self.store.mode('paused')
        self.store.enqueue('12')
        self.assertFalse(self.engine.step())
        self.store.mode('shadow')
        self.engine.step()
        self.assertEqual(self.store.stats()['jobs'], {'shadow': 1})
        self.assertNotIn('business_requested', self.store.stats()['counters'])
        self.store.mode('active')
        self.engine.step()
        self.assertEqual(self.store.stats()['jobs'], {'waiting': 1})

    def test_capacity_does_not_block_irrelevant_leads(self):
        for lead in ('1','2','3'):
            self.store.enqueue(lead)
            self.engine.step()
        self.client.current = 'INTAKE'
        self.store.enqueue('4')
        self.engine.step()
        self.assertEqual(self.store.stats()['jobs'], {'waiting': 2, 'pending': 1, 'done': 1})

    def test_bitrix_read_failure_is_not_acknowledged_as_processed(self):
        self.store.enqueue('12')
        self.client.status = lambda _: (_ for _ in ()).throw(TimeoutError())
        self.engine.step()
        self.assertEqual(self.store.stats()['jobs'], {'pending': 1})

    def test_authenticated_ingress_and_callbacks(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(self.store, 'app-secret', 'admin-secret', 'hook-secret'))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = 'http://127.0.0.1:'+str(server.server_port)
        path = '/api/v1/main/executions/webhook/redunisol.prod.marketing-crm/bitrix24_lead_won_deal_webhook/hook-secret'
        def post(body, token=None, target=path):
            headers = {'Content-Type': 'application/json'}
            if token:
                headers['Authorization'] = 'Bearer '+token
            with urlopen(Request(base+target, data=json.dumps(body).encode(), headers=headers), timeout=2) as response:
                return json.load(response)
        try:
            body = {'event': 'ONCRMLEADUPDATE', 'data': {'FIELDS': {'ID': '12'}}, 'auth': {'application_token': 'wrong'}}
            with self.assertRaises(HTTPError) as caught:
                post(body)
            self.assertEqual(caught.exception.code, 403)
            self.assertEqual(self.store.stats()['jobs'], {})
            body['auth']['application_token'] = 'app-secret'
            self.assertTrue(post(body)['queued'])
            self.engine.step()
            r = self.receipt()
            claimed = post({'receipt':r['id'], 'lead_id':'12', 'execution_id':'executionA'}, 'app-secret', '/internal/claim')
            self.assertTrue(claimed['granted'])
            post({'receipt':r['id'], 'execution_id':'executionA', 'ok':True}, 'app-secret', '/internal/complete')
            self.assertEqual(self.store.stats()['jobs'], {'done':1})
            self.assertTrue(post(body, target=path.replace('/api/v1/main/', '/api/v1/'))['queued'])
            self.assertEqual(self.store.stats()['jobs'], {'pending':1})
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_urlencoded_bitrix_contract(self):
        self.assertEqual(normalize_payload('event=ONCRMLEADUPDATE&data%5BFIELDS%5D%5BID%5D=12&auth%5Bapplication_token%5D=secret'), ('12','secret'))


if __name__ == '__main__':
    unittest.main()
