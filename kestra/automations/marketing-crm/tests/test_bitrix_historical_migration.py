import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location('history_migration', Path(__file__).parents[3] / 'tools/migrate_bitrix_rejection_history.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class FakeClient:
    def __init__(self, before, fail_after=False, fail_update=False):
        self.before = copy.deepcopy(before)
        self.current = copy.deepcopy(before)
        self.calls = []
        self.fail_after = fail_after
        self.fail_update = fail_update

    def leads(self, ids):
        if self.calls and self.fail_after:
            raise m.ApiFailure('Read unavailable')
        return copy.deepcopy({key: self.current[key] for key in ids if key in self.current})

    def batch(self, calls):
        self.calls.append(calls)
        for _, payload in calls.values():
            if not self.fail_update:
                self.current[payload['id']].update(payload['fields'])
        return {'result': {key: True for key in calls}, 'result_error': {}}


class HistoricalMigrationTests(unittest.TestCase):
    def setUp(self):
        self.row = {'ID': '10', 'STATUS_ID': '3', 'DATE_CREATE': '2024-01-01', 'DATE_MODIFY': '2024-01-02', m.REASON: None, m.NOTICE: None,
                    'proposed': {'STATUS_ID': m.TARGET, m.REASON: '3943', m.NOTICE: 'HISTORICAL'}}
        self.current = {**self.row, 'STATUS_SEMANTIC_ID': 'F'}
        self.current.pop('proposed')

    def test_any_snapshot_change_excludes_the_record(self):
        for field in m.SNAPSHOT_FIELDS:
            with self.subTest(field=field):
                current = {**self.current, field: 'changed'}
                self.assertEqual(m.disposition(self.row, current, self.row['proposed']), 'skip_changed')

    def test_null_and_empty_are_equivalent(self):
        current = {**self.current, m.REASON: '', m.NOTICE: ''}
        self.assertEqual(m.disposition(self.row, current, self.row['proposed']), 'eligible')

    def test_active_or_unknown_semantic_is_excluded(self):
        for semantic in ('P', 'S', None):
            current = {**self.current, 'STATUS_SEMANTIC_ID': semantic}
            self.assertEqual(m.disposition(self.row, current, self.row['proposed']), 'skip_not_failed')

    def test_missing_record_excluded(self):
        self.assertEqual(m.disposition(self.row, None, self.row['proposed']), 'skip_missing')

    def test_atomic_fields_and_durable_intent(self):
        with tempfile.TemporaryDirectory() as tmp:
            journal = m.Journal(tmp)
            client = FakeClient({'10': self.current})
            result = m.apply_chunk(client, journal, [self.row])
            self.assertEqual(result, {'10': 'verified'})
            payload = client.calls[0]['u10'][1]
            self.assertEqual(payload['fields'], self.row['proposed'])
            self.assertEqual(journal.events[0]['type'], 'intent')
            self.assertEqual(journal.events[0]['rows'][0]['fresh_before'], self.current)

    def test_recover_ambiguous_write_without_resending(self):
        with tempfile.TemporaryDirectory() as tmp:
            journal = m.Journal(tmp)
            client = FakeClient({'10': self.current}, fail_after=True)
            with self.assertRaises(m.ApiFailure):
                m.apply_chunk(client, journal, [self.row])
            client.fail_after = False
            journal = m.Journal(tmp)
            result = m.apply_chunk(client, journal, [self.row])
            self.assertEqual(result['10'], 'recovered')
            self.assertEqual(len(client.calls), 1)

    def test_false_success_stops_without_retry(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeClient({'10': self.current}, fail_update=True)
            with self.assertRaises(m.ApiFailure):
                m.apply_chunk(client, m.Journal(tmp), [self.row])
            self.assertEqual(len(client.calls), 1)

    def test_changed_lead_is_never_written(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeClient({'10': {**self.current, 'DATE_MODIFY': 'later'}})
            result = m.apply_chunk(client, m.Journal(tmp), [self.row])
            self.assertEqual(result['10'], 'skip_changed')
            self.assertEqual(client.calls, [])

    def test_time_boundary_is_checked_after_read_before_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeClient({'10': self.current})
            with self.assertRaises(m.NightWindowClosed):
                m.apply_chunk(client, m.Journal(tmp), [self.row], allow_write=lambda:False)
            self.assertEqual(client.calls, [])

    def test_existing_migrated_lead_without_journal_not_claimed(self):
        current = {**self.current, **self.row['proposed']}
        self.assertEqual(m.disposition(self.row, current, self.row['proposed']), 'skip_already_target')

    def test_new_activity_or_chat_message_blocks_pilot(self):
        before = {'activities': {'10': []}, 'chats': {'10': ['2']}, 'last_message_ids': {'2': 100}}
        self.assertTrue(m.compare_communications(before, before)['clean'])
        after = copy.deepcopy(before)
        after['last_message_ids']['2'] = 101
        self.assertFalse(m.compare_communications(before, after)['clean'])
        after = copy.deepcopy(before)
        after['activities']['10'] = [{'ID': '9'}]
        self.assertFalse(m.compare_communications(before, after)['clean'])

    def test_night_window_uses_argentina_not_utc(self):
        for hour, allowed in [(0,False),(1,True),(8,True),(9,False),(23,False)]:
            self.assertEqual(m.in_night_window(datetime(2026,9,25,hour,tzinfo=timezone.utc)), allowed)

    def test_receiver_backpressure_and_unconfirmed_work(self):
        stats = {'mode':'active','jobs':{'pending':72,'checking':2,'waiting':2},'unconfirmed_submissions':0,'stale_business_receipts':0}
        self.assertEqual(m.queue_capacity(stats,125),49)
        self.assertEqual(m.queue_capacity({**stats,'mode':'paused'},125),0)
        self.assertEqual(m.queue_capacity({**stats,'unconfirmed_submissions':1},125),0)
        self.assertEqual(m.queue_capacity({**stats,'jobs':{'pending':200}},125),0)

    def test_php_empty_batch_maps_are_normalized(self):
        client = object.__new__(m.Client)
        with patch.object(client,'call',return_value={'result':{'result':{'x':True},'result_error':[]}}):
            result = client.batch({'x':('crm.lead.update',{'id':'10','fields':self.row['proposed']})})
        self.assertEqual(result['result_error'],{})

    def test_guard_rejects_or_or_nonempty_skip_branch(self):
        conditions = [{'object':'Document','field':field,'operator':op,'value':value,'joiner':'0'} for field,op,value in [('STATUS_ID','=',m.TARGET),('ID','>','396841'),(m.NOTICE,'=','')]]
        export = {'TEMPLATE':[{'Type':'SequentialWorkflowActivity','Children':[{'Type':'IfElseActivity','Children':[{'Properties':{'mixedcondition':conditions}},{'Properties':{'truecondition':'1'},'Children':[]}]}]}]}
        m.validate_guard(export,396841)
        conditions[0]['joiner'] = '1'
        with self.assertRaises(ValueError): m.validate_guard(export,396841)
        conditions[0]['joiner'] = '0'
        export['TEMPLATE'][0]['Children'][0]['Children'][1]['Children'] = [{'Type':'CrmSendEmailActivity'}]
        with self.assertRaises(ValueError): m.validate_guard(export,396841)

    def test_inventory_rejects_future_ids_and_reason_conflicts(self):
        manifest = {'sources':[{'source_stage':'3','reason_xml_id':'reason','reason_label':'AUTONOMO'}]}
        initial = {'reason_fields':[{'LIST':[{'ID':'3943','XML_ID':'reason','VALUE':'AUTONOMO'}]}], 'stages':[{'STATUS_ID':'3','SEMANTICS':'F','NAME':'AUTONOMO'}]}
        m.validate_inventory([self.row],'hash','hash',manifest,initial,396841)
        for change in [{'ID':'396842'},{m.REASON:'99'},{'STATUS_ID':'CONVERTED'},{m.NOTICE:'PROCESSED'}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                m.validate_inventory([{**self.row,**change}],'hash','hash',manifest,initial,396841)
        with self.assertRaises(ValueError):
            m.validate_inventory([self.row],'hash','modified',manifest,initial,396841)


if __name__ == '__main__':
    unittest.main()
