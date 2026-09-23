from contextlib import redirect_stdout
import copy
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

FILES = Path(__file__).resolve().parents[1] / 'files'
sys.path.insert(0, str(FILES))
from capturar_revision_riesgo.archive import Archive, CaptureError, CoreClient, atomic_json, main, poll, read_json


class FakeCore:
    def __init__(self):
        self.row = {'Oid': 17, 'Estado.ID': 114, 'Estado.Descripcion': 'RevisionRiesgo', 'Adjuntos.Count()': 1, 'Novedades.Count()': 1, 'NombreCompleto': 'Persona de prueba'}
        self.listed = True
        self.data = b'abc'
        self.metadata = [{'Oid': 91, 'Archivo.FileName': '../../external.xlsx', 'Archivo.Size': 3, 'Descripcion': 'Original'}]
        self.fail_content = False
        self.fail_index = False
        self.change_during_capture = False

    def active(self):
        return [copy.deepcopy(self.row)] if self.listed else []

    def application(self, oid):
        row = copy.deepcopy(self.row)
        if self.change_during_capture:
            row['Estado.ID'] = 123
        return row

    def events(self, oid):
        return [{'ID': 8, 'Fecha': '2026-09-17', 'Texto': '[RevisionRiesgo]'}]

    def attachments(self, oid):
        if self.fail_index:
            raise CaptureError('network_error')
        return copy.deepcopy(self.metadata)

    def content(self, oid):
        if self.fail_content:
            raise CaptureError('network_error')
        return self.data


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.archive = Archive(Path(self.temp.name) / 'archive', reserve_bytes=0)
        self.client = FakeCore()

    def tearDown(self):
        self.temp.cleanup()

    def poll(self):
        return poll(self.client, self.archive, workers=2, min_free_bytes=0)

    def poll_at(self, timestamp):
        with patch('capturar_revision_riesgo.archive.time.time', return_value=timestamp):
            return self.poll()

    def pending(self):
        return read_json(self.archive.root / 'pending.json', {})

    def observations(self):
        return sorted((self.archive.root / 'applications/17/observations').iterdir())

    def manifest(self, folder):
        return read_json(folder / 'manifest.json', {})

    def test_originals_deduplicated_without_overwriting_first_observation(self):
        first = self.poll()
        self.assertTrue(first['ok'])
        pointer = (self.archive.root / 'applications/17/first.json').read_bytes()
        initial = (self.observations()[0] / 'initial.json').read_bytes()
        old = self.manifest(self.observations()[0])
        second = self.poll()
        new = self.manifest(self.observations()[1])
        self.assertEqual(second['changed'], 0)
        self.assertEqual(old['payload'], new['payload'])
        self.assertEqual(len(list((self.archive.root / 'objects').glob('*/*'))), 2)
        self.assertEqual(pointer, (self.archive.root / 'applications/17/first.json').read_bytes())
        self.assertEqual(initial, (self.observations()[0] / 'initial.json').read_bytes())
        self.assertEqual((self.archive.root / old['downloads'][0]['object']['path']).read_bytes(), b'abc')
        self.assertFalse((Path(self.temp.name) / 'external.xlsx').exists())

    def test_same_attachment_id_name_and_size_with_new_content_is_versioned(self):
        self.poll()
        self.client.data = b'xyz'
        result = self.poll()
        old, new = [self.manifest(p) for p in self.observations()]
        self.assertEqual(result['changed'], 1)
        self.assertNotEqual(old['downloads'][0]['object']['sha256'], new['downloads'][0]['object']['sha256'])
        self.assertEqual((self.archive.root / old['downloads'][0]['object']['path']).read_bytes(), b'abc')

    def test_failed_download_is_partial_and_late_retry_does_not_backdate_bytes(self):
        self.client.fail_content = True
        failed = self.poll()
        self.assertFalse(failed['ok'])
        self.assertEqual((failed['partial_error'], failed['partial_changed']), (1, 0))
        self.assertEqual(self.manifest(self.observations()[0])['partial_reason'], 'fetch_or_storage_error')
        first = self.observations()[0]
        first_bytes = (first / 'manifest.json').read_bytes()
        pending_path = self.archive.root / 'pending.json'
        pending = read_json(pending_path, {})
        pending['17']['next_retry'] = 0
        atomic_json(pending_path, pending)
        self.client.fail_content = False
        self.client.listed = False
        self.client.row['Estado.ID'] = 5
        result = self.poll()
        self.assertTrue(result['ok'])
        self.assertEqual(result['late_retries'], 1)
        self.assertEqual(result['pending'], 0)
        latest = self.manifest(self.observations()[1])
        self.assertEqual(latest['origin'], 'late_retry_after_absence_from_risk')
        self.assertEqual(latest['state_before'], 5)
        self.assertEqual(first_bytes, (first / 'manifest.json').read_bytes())
        self.assertEqual(read_json(first / 'initial.json', {})['application']['Estado.ID'], 114)

    def test_state_change_during_capture_is_explicit_and_never_complete(self):
        self.client.change_during_capture = True
        result = self.poll()
        # La edicion concurrente no es una falla: se reintenta en el sondeo
        # siguiente y la observacion queda marcada como parcial igual.
        self.assertTrue(result['ok'])
        self.assertEqual((result['partial'], result['partial_changed'], result['partial_error']), (1, 1, 0))
        record = self.manifest(self.observations()[0])
        self.assertFalse(record['complete'])
        self.assertEqual(record['partial_reason'], 'changed_during_capture')
        self.assertEqual(record['state_before'], 114)
        self.assertEqual(record['state_after'], 123)
        self.assertFalse(record['metadata_stable'])
        self.assertTrue(record['downloads'][0]['object'])
        self.assertIn('17', read_json(self.archive.root / 'pending.json', {}))

    def test_concurrent_edits_become_stuck_after_one_hour_not_five_polls(self):
        self.client.change_during_capture = True
        for elapsed in (0, 60, 120, 180, 240, 3599):
            result = self.poll_at(10000 + elapsed)
            self.assertTrue(result['ok'])
            self.assertEqual(result['captured'], 1)
            self.assertEqual(result['stuck'], 0)
            self.assertEqual(self.pending()['17']['first_pending_at'], 10000)
        # Recargar el archivo como lo hace una nueva ejecucion de Kestra.
        self.archive = Archive(self.archive.root, reserve_bytes=0)
        result = self.poll_at(13600)
        self.assertFalse(result['ok'])
        self.assertEqual(result['stuck'], 1)
        self.assertEqual(result['partial_error'], 0)

    def test_complete_capture_clears_pending_and_a_new_partial_starts_its_own_clock(self):
        self.client.change_during_capture = True
        self.poll_at(10000)
        self.assertFalse(self.poll_at(13600)['ok'])
        self.client.change_during_capture = False
        complete = self.poll_at(13601)
        self.assertTrue(complete['ok'])
        self.assertEqual((complete['pending'], complete['stuck']), (0, 0))
        self.assertEqual(self.pending(), {})
        self.client.change_during_capture = True
        self.assertTrue(self.poll_at(13602)['ok'])
        self.assertEqual(self.pending()['17']['first_pending_at'], 13602)

    def test_absent_pending_becomes_stuck_even_when_retry_is_not_due(self):
        self.client.change_during_capture = True
        self.poll_at(10000)
        self.client.listed = False
        state = self.pending()
        state['17']['next_retry'] = 20000
        atomic_json(self.archive.root / 'pending.json', state)
        self.assertTrue(self.poll_at(13599)['ok'])
        result = self.poll_at(13600)
        self.assertFalse(result['ok'])
        self.assertEqual((result['stuck'], result['captured'], result['late_retries']), (1, 0, 0))
        self.assertEqual(self.pending()['17']['first_pending_at'], 10000)

    def test_legacy_pending_gets_one_persisted_clock_without_guessing_from_attempts(self):
        self.client.listed = False
        atomic_json(self.archive.root / 'pending.json', {'17': {'attempts': 99, 'next_retry': 20000}})
        self.assertTrue(self.poll_at(10000)['ok'])
        self.assertEqual(self.pending()['17']['first_pending_at'], 10000)
        self.assertTrue(self.poll_at(13599)['ok'])
        self.assertEqual(self.poll_at(13600)['stuck'], 1)
        self.assertEqual(self.pending()['17']['first_pending_at'], 10000)

    def test_retry_fetch_error_keeps_original_pending_age_and_fails_immediately(self):
        self.client.change_during_capture = True
        self.poll_at(10000)
        self.client.listed = False
        with patch.object(self.client, 'application', side_effect=CaptureError('network_error')):
            result = self.poll_at(10120)
        self.assertFalse(result['ok'])
        self.assertEqual((result['retry_fetch_failures'], result['stuck']), (1, 0))
        self.assertEqual(self.pending()['17']['first_pending_at'], 10000)

    def test_deleted_attachment_remains_in_archive(self):
        self.poll()
        first = self.manifest(self.observations()[0])
        self.client.metadata = []
        self.client.row['Adjuntos.Count()'] = 0
        self.assertTrue(self.poll()['ok'])
        latest = self.manifest(self.observations()[1])
        self.assertEqual(latest['attachment_ids_absent_since_last_capture'], [91])
        self.assertTrue((self.archive.root / first['downloads'][0]['object']['path']).exists())

    def test_failed_index_does_not_claim_attachments_were_deleted(self):
        self.poll()
        self.client.fail_index = True
        self.assertFalse(self.poll()['ok'])
        self.assertIsNone(self.manifest(self.observations()[1])['attachment_ids_absent_since_last_capture'])
        self.assertEqual(read_json(self.archive.root / 'applications/17/latest.json', {})['attachment_ids'], [91])

    def test_size_mismatch_preserves_returned_bytes_but_marks_partial(self):
        self.client.data = b'changed size'
        result = self.poll()
        self.assertFalse(result['ok'])
        self.assertEqual((result['partial'], result['partial_error']), (1, 1))
        manifest = self.manifest(self.observations()[0])
        self.assertTrue(manifest['metadata_stable'])
        self.assertFalse(manifest['complete'])
        self.assertEqual(manifest['partial_reason'], 'fetch_or_storage_error')
        self.assertEqual(manifest['downloads'][0]['error'], 'attachment_size_changed')
        self.assertEqual((self.archive.root / manifest['downloads'][0]['object']['path']).read_bytes(), b'changed size')

    def test_size_change_is_tolerated_only_when_new_metadata_explains_downloaded_bytes(self):
        self.client.data = b'abcd'
        for final_size, expected_ok in [(4, True), (5, False)]:
            with self.subTest(final_size=final_size):
                after = copy.deepcopy(self.client.metadata)
                after[0]['Archivo.Size'] = final_size
                with patch.object(self.client, 'attachments', side_effect=[self.client.metadata, after]):
                    result = self.poll()
                self.assertEqual(result['ok'], expected_ok)
                manifest = self.manifest(self.observations()[-1])
                self.assertFalse(manifest['complete'])
                self.assertEqual(manifest['partial_reason'], 'changed_during_capture' if expected_ok else 'fetch_or_storage_error')

    def test_stable_count_mismatches_fail_even_with_unrelated_concurrent_edit(self):
        for field in ('Adjuntos.Count()', 'Novedades.Count()'):
            for unrelated_edit in (False, True):
                with self.subTest(field=field, unrelated_edit=unrelated_edit):
                    self.client = FakeCore()
                    self.client.row[field] = 2
                    self.client.change_during_capture = unrelated_edit
                    result = self.poll()
                    self.assertFalse(result['ok'])
                    self.assertEqual((result['partial_error'], result['partial_changed']), (1, 0))

    def test_unrelated_state_change_does_not_hide_truncated_attachment(self):
        self.client.data = b'ab'
        self.client.change_during_capture = True
        result = self.poll()
        self.assertFalse(result['ok'])
        self.assertEqual((result['partial_error'], result['partial_changed']), (1, 0))

    def test_changed_application_count_explains_initial_count_mismatch(self):
        for field in ('Adjuntos.Count()', 'Novedades.Count()'):
            with self.subTest(field=field):
                self.client = FakeCore()
                self.client.row[field] = 2
                after = copy.deepcopy(self.client.row)
                after[field] = 1
                with patch.object(self.client, 'application', return_value=after):
                    result = self.poll()
                self.assertTrue(result['ok'])
                self.assertEqual((result['partial_changed'], result['partial_error']), (1, 0))
                self.assertFalse(self.manifest(self.observations()[-1])['complete'])

    def test_changed_index_count_can_explain_a_mismatch_but_second_read_must_agree(self):
        for kind, field in [('attachments', 'Adjuntos.Count()'), ('events', 'Novedades.Count()')]:
            for final_consistent in (True, False):
                with self.subTest(kind=kind, final_consistent=final_consistent):
                    self.client = FakeCore()
                    items = getattr(self.client, kind)(17)
                    after_items = [copy.deepcopy(items[0]), copy.deepcopy(items[0])]
                    after_items[-1]['Oid' if kind == 'attachments' else 'ID'] += 1
                    self.client.row[field] = 2 if final_consistent else 3
                    with patch.object(self.client, kind, side_effect=[items, after_items]):
                        result = self.poll()
                    self.assertEqual(result['ok'], final_consistent)
                    self.assertFalse(self.manifest(self.observations()[-1])['complete'])

    def test_download_error_dominates_concurrent_edit(self):
        self.client.change_during_capture = True
        self.client.fail_content = True
        result = self.poll_at(10000)
        self.assertFalse(result['ok'])
        self.assertEqual((result['partial_error'], result['partial_changed'], result['stuck']), (1, 0, 0))

    def test_failed_second_read_cannot_be_classified_as_edit(self):
        with patch.object(self.client, 'application', side_effect=CaptureError('network_error')):
            result = self.poll()
        self.assertFalse(result['ok'])
        self.assertEqual(result['partial_error'], 1)

    def test_storage_error_dominates_concurrent_edit(self):
        self.client.change_during_capture = True
        with patch.object(self.archive, 'blob', side_effect=CaptureError('insufficient_disk_space')):
            result = self.poll_at(10000)
        self.assertFalse(result['ok'])
        self.assertEqual((result['partial_error'], result['stuck']), (1, 0))
        self.assertEqual(self.pending()['17']['first_pending_at'], 10000)

    def test_interruption_preserves_first_metadata_and_pending_for_retry(self):
        with patch.object(self.client, 'events', side_effect=RuntimeError('unexpected')):
            self.assertFalse(self.poll()['ok'])
        folder = self.observations()[0]
        self.assertTrue((folder / 'initial.json').exists())
        self.assertTrue((folder / 'failure.json').exists())
        self.assertIn('17', read_json(self.archive.root / 'pending.json', {}))

    def test_failed_scan_does_not_rewrite_archive_as_empty(self):
        self.poll()
        first = (self.archive.root / 'applications/17/first.json').read_bytes()
        with patch.object(self.client, 'active', side_effect=CaptureError('invalid_or_truncated_projection')):
            with self.assertRaises(CaptureError):
                self.poll()
        self.assertEqual(first, (self.archive.root / 'applications/17/first.json').read_bytes())

    def test_logs_never_include_exception_values(self):
        output = io.StringIO()
        with patch.dict('os.environ', {'VIMARX_EVAL_BASE_URL': 'https://core.test', 'RISK_SNAPSHOT_ROOT': str(self.archive.root)}), patch('capturar_revision_riesgo.archive.poll', side_effect=RuntimeError('secret applicant data')), redirect_stdout(output):
            self.assertEqual(main(), 1)
        self.assertNotIn('secret applicant', output.getvalue())

    def test_live_query_contract_is_read_only_and_truncation_fails(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, count): return b'[[1],[2]]'
        client = CoreClient('https://core.test')
        with patch('capturar_revision_riesgo.archive.urlopen', return_value=Response()) as call:
            with self.assertRaisesRegex(CaptureError, 'truncated'):
                client.query('PreSolicitud.Module.Solicitud', '[Estado.ID] = 114', ['Oid'], 1)
            request = call.call_args.args[0]
            self.assertTrue(request.full_url.endswith('/api/Empresa/EvaluateList'))
            self.assertEqual(request.get_method(), 'POST')
            self.assertEqual(json.loads(request.data)['max'], 2)

    def test_flow_runs_every_minute_prod_only_with_persistent_volume(self):
        import yaml
        flow = yaml.safe_load((FILES.parent / 'flows/capturar_revision_riesgo.yaml').read_text(encoding='utf-8'))
        self.assertEqual(flow['triggers'][0]['cron'], '* * * * *')
        self.assertEqual(flow['labels']['schedule_scope'], 'prod_only')
        self.assertEqual(flow['concurrency'], {'limit': 1, 'behavior': 'CANCEL'})
        self.assertIn('/opt/kestra/data/', flow['tasks'][0]['taskRunner']['volumes'][0])
        self.assertNotIn('outputFiles', flow['tasks'][0])
