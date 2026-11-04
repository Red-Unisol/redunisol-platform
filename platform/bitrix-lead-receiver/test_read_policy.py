import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

from receiver import Client, Engine, ReadFailure, Store


class ReadPolicyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name)/'receiver.sqlite'
        self.now = 1000.
        self.store = Store(self.path, lambda: self.now)
        self.store.mode('active')
        self.client = Mock(actionable={'NEW'})
        self.client.status.side_effect = ReadFailure('not_found',400)
        self.engine = Engine(self.store,self.client)

    def tearDown(self):
        self.tmp.cleanup()

    def row(self,lead='12'):
        with self.store.db() as db:
            return dict(db.execute('select * from jobs where lead=?',(lead,)).fetchone())

    def test_two_not_found_reads_a_minute_apart_park_durably_and_reactivation_resets(self):
        self.store.enqueue('12')
        self.assertTrue(self.engine.step())
        self.assertEqual(self.row()['available'],1060)
        self.now = 1059
        self.assertFalse(self.engine.step())
        self.now = 1060
        with self.assertLogs('receiver',level='ERROR') as logs:
            self.assertTrue(self.engine.step())
        self.assertIn('reason=not_found',logs.output[0])
        self.assertEqual(self.row()['state'],'review_required')
        self.assertEqual(self.row()['finished'],0)
        self.now += 86400
        restarted = Store(self.path,lambda:self.now)
        self.assertFalse(Engine(restarted,self.client).step())
        self.assertEqual(self.client.status.call_count,2)
        self.assertEqual(restarted.stats()['review_by_reason'],{'not_found':1})
        self.assertEqual(restarted.stats()['oldest_pending_seconds'],0)
        restarted.enqueue('12')  # Both webhook and authenticated manual retry use this path.
        self.assertEqual(self.row()['read_attempts'],0)
        self.client.status.side_effect = None
        self.client.status.return_value = 'INTAKE'
        self.assertTrue(Engine(restarted,self.client).step())
        self.assertEqual(self.row()['state'],'done')

    def test_new_event_during_second_failed_read_is_not_parked(self):
        self.store.enqueue('12')
        self.engine.step()
        self.now += 60
        old = self.store.take()
        self.store.enqueue('12')
        self.store.fail_read(old,ReadFailure('not_found',400))
        self.assertEqual(self.row()['state'],'pending')
        self.assertEqual(self.row()['read_attempts'],0)
        self.engine.step()
        self.assertEqual(self.row()['not_found_attempts'],1)

    def test_transient_errors_back_off_and_stop_after_six_without_acknowledging(self):
        self.store.enqueue('12')
        self.client.status.side_effect = ReadFailure('transport_error',shared=True)
        for delay in [30,60,120,240,480,960]:
            self.engine.step()
            row=self.row()
            self.assertEqual(row['available'],self.now+delay)
            self.now += max(delay,60)
        self.assertEqual(self.row()['state'],'review_required')
        self.assertEqual(self.row()['finished'],0)
        self.assertFalse(self.engine.step())

    def test_circuit_blocks_both_consumers_survives_restart_and_auth_does_not_park_leads(self):
        self.store.enqueue_many(['12','13'])
        self.client.status.side_effect = ReadFailure('authentication',401,shared=True)
        self.engine.step()
        self.assertTrue(self.store.stats()['read_circuit']['active'])
        restarted=Store(self.path,lambda:self.now)
        self.assertFalse(Engine(restarted,self.client).step())
        self.assertEqual(self.client.status.call_count,1)
        self.now += 300
        self.assertTrue(Engine(restarted,self.client).step())
        self.assertEqual(restarted.stats()['jobs'],{'pending':2})
        self.assertTrue(restarted.stats()['read_circuit']['active'])

    def test_migration_preserves_existing_jobs_and_receipts(self):
        old_path=Path(self.tmp.name)/'old.sqlite'
        with sqlite3.connect(old_path) as db:
            db.executescript('''CREATE TABLE jobs(lead TEXT PRIMARY KEY,version INTEGER NOT NULL,
                finished INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'pending',
                available REAL NOT NULL,lease REAL,receipt TEXT,last_status TEXT,
                events INTEGER NOT NULL DEFAULT 1,created REAL NOT NULL,updated REAL NOT NULL,error TEXT);
                INSERT INTO jobs(lead,version,available,created,updated) VALUES ('99',7,0,0,0);
                INSERT INTO jobs(lead,version,state,receipt,available,created,updated) VALUES ('98',2,'waiting','legacy',0,0,0);
                CREATE TABLE receipts(id TEXT PRIMARY KEY,lead TEXT NOT NULL,version INTEGER NOT NULL,
                    status TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'created',execution TEXT,
                    attempts INTEGER NOT NULL DEFAULT 0,last_submit REAL NOT NULL DEFAULT 0,
                    created REAL NOT NULL,updated REAL NOT NULL);
                INSERT INTO receipts(id,lead,version,status,state,execution,created,updated)
                    VALUES ('legacy','98',2,'NEW','running','original',0,0);''')
        db.close()
        migrated=Store(old_path,lambda:self.now)
        job=migrated.take()
        self.assertEqual((job['lead'],job['version'],job['read_attempts']),('99',7,0))
        Store(old_path,lambda:self.now)  # Migration is idempotent.
        self.assertFalse(migrated.claim('legacy','98','other'))
        self.assertTrue(migrated.complete('legacy','original',True))


class ResponseClassificationTests(unittest.TestCase):
    def read_error(self,http,body):
        client=Client('https://example.test/rest/private-token','unused','token',[])
        error=HTTPError('https://example.test/rest/private-token',http,'private response',{},io.BytesIO(json.dumps(body).encode()))
        with patch('receiver.urlopen',side_effect=error),self.assertRaises(ReadFailure) as caught:
            client.status('12')
        self.assertNotIn('private',str(caught.exception))
        return caught.exception

    def test_only_explicit_not_found_is_classified_as_missing(self):
        self.assertEqual(self.read_error(400,{'error':'','error_description':'Not found.'}).reason,'not_found')
        self.assertEqual(self.read_error(400,{'error':'bad_id','error_description':'Invalid parameters'}).reason,'invalid_request')
        self.assertEqual(self.read_error(404,{}).reason,'service_unavailable')

    def test_rate_auth_and_service_errors_open_shared_circuits(self):
        for http,body,reason in [(503,{'error':'QUERY_LIMIT_EXCEEDED'},'rate_limited'),
                (429,{},'rate_limited'),(401,{},'authentication'),(403,{},'authentication'),
                (503,{},'service_unavailable')]:
            error=self.read_error(http,body)
            self.assertEqual(error.reason,reason)
            self.assertTrue(error.shared)

    def test_success_error_envelopes_and_transport_errors_are_sanitized(self):
        client=Client('https://example.test/private-token','unused','token',[])
        for response in [io.BytesIO(b'{"error":"","error_description":"Not found."}'),
                         URLError('https://example.test/private-token')]:
            with patch('receiver.urlopen',**({'side_effect':response} if isinstance(response,Exception) else {'return_value':response})),self.assertRaises(ReadFailure) as caught:
                client.status('12')
            self.assertNotIn('private',str(caught.exception))


if __name__=='__main__':
    unittest.main()
