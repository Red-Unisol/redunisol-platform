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
        self.assertFalse(self.poll()['ok'])
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
        self.assertFalse(self.poll()['ok'])
        record = self.manifest(self.observations()[0])
        self.assertEqual(record['state_before'], 114)
        self.assertEqual(record['state_after'], 123)
        self.assertFalse(record['metadata_stable'])
        self.assertTrue(record['downloads'][0]['object'])

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
        self.assertFalse(self.poll()['ok'])
        manifest = self.manifest(self.observations()[0])
        self.assertEqual(manifest['downloads'][0]['error'], 'attachment_size_changed')
        self.assertEqual((self.archive.root / manifest['downloads'][0]['object']['path']).read_bytes(), b'changed size')

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
