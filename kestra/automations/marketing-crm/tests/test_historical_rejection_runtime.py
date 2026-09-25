import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from contextlib import nullcontext

FILES = Path(__file__).parents[1] / 'files'
sys.path.insert(0, str(FILES))
from bitrix24_rejection_history import run, core


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.row = {'ID': '10', 'STATUS_ID': '3', 'DATE_CREATE': '2024-01-01',
                    'DATE_MODIFY': '2024-01-02', core.REASON: '', core.NOTICE: '',
                    'proposed': {'STATUS_ID': core.TARGET, core.REASON: '3943', core.NOTICE: 'HISTORICAL'}}

    def test_ambiguous_attempt_never_resends_even_if_original_values_remain(self):
        current = {**self.row, 'STATUS_SEMANTIC_ID': 'F'}
        with self.assertRaises(core.ApiFailure):
            core.disposition(self.row, current, self.row['proposed'], attempted=True)

    def test_import_refuses_to_replace_any_existing_progress(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'execution').mkdir()
            (root / 'execution/journal.jsonl').write_text('preserve')
            with self.assertRaises(ValueError):
                run.bootstrap(root, root / 'missing.zip')
            self.assertEqual((root / 'execution/journal.jsonl').read_text(), 'preserve')

    def test_import_rejects_traversal_before_extracting(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = root / 'seed.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('../escaped.json', '{}')
            with self.assertRaises(ValueError):
                run.bootstrap(root, archive)
            self.assertEqual(list((root / 'importing').iterdir()), [])

    def test_modified_inventory_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'candidates.json').write_text('[]')
            with self.assertRaisesRegex(ValueError, 'Approved seed differs'):
                run.validate_seed(root)

    def test_pause_and_daytime_make_no_api_calls(self):
        for paused in (False, True):
            with self.subTest(paused=paused), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                journal = core.Journal(root / 'execution')
                if paused:
                    (root / 'execution/paused.json').write_text('{}')
                with patch.object(core, 'in_night_window', return_value=False), patch.object(run, 'receiver_stats') as stats:
                    result = run.process(root, object(), [self.row], journal)
                stats.assert_not_called()
                self.assertEqual(result['handled'], 0)
                self.assertIn(result['status'], ('paused_requires_review', 'outside_night_window'))

    def test_unconfirmed_receiver_waits_without_writing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            journal = core.Journal(root / 'execution')
            stats = {'mode':'active', 'jobs':{'pending':0}, 'unconfirmed_submissions':1, 'stale_business_receipts':0}
            with patch.object(core, 'in_night_window', return_value=True), \
                 patch.object(run, 'receiver_stats', return_value=stats), \
                 patch.object(core, 'apply_chunk') as apply, \
                 patch.object(run.time, 'monotonic', side_effect=[0, 0, 0, 10]), \
                 patch.object(run.time, 'sleep'):
                result = run.process(root, object(), [self.row], journal, seconds=1)
            apply.assert_not_called()
            self.assertEqual(result['remaining'], 1)

    def test_completed_journal_never_rewrites_or_queries_receiver(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            journal = core.Journal(root / 'execution')
            journal.append({'type':'outcomes', 'states':{'10':'verified'}})
            with patch.object(core, 'in_night_window', return_value=True), patch.object(run, 'receiver_stats') as stats:
                result = run.process(root, object(), [self.row], journal)
            stats.assert_not_called()
            self.assertEqual(result['status'], 'complete')
            self.assertEqual(result['remaining'], 0)

    def test_journal_with_foreign_id_stops_before_processing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            journal = core.Journal(root / 'execution')
            journal.append({'type':'outcomes', 'states':{'999':'verified'}})
            with self.assertRaises(ValueError):
                run.progress(root, [self.row], journal, 'checking')

    def test_runtime_error_persists_pause_for_following_ticks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'approved').mkdir()
            with patch.object(run, 'ROOT', root), \
                 patch.object(run, 'exclusive', return_value=nullcontext()), \
                 patch.dict(run.os.environ, {'FLOW_NAMESPACE':run.PROD, 'MIGRATION_MODE':'run',
                                            'BITRIX24_BASE_URL':'https://redunisol.bitrix24.es',
                                            'BITRIX24_WEBHOOK_PATH':'rest/1/test'}), \
                 patch.object(run, 'validate_seed', return_value=[self.row]), \
                 patch.object(run, 'validate_live', side_effect=core.ApiFailure('Read unavailable')):
                with self.assertRaises(core.ApiFailure):
                    run.main()
            self.assertEqual(json.loads((root / 'execution/paused.json').read_text())['error_type'], 'ApiFailure')

    @unittest.skipUnless(sys.platform == 'linux', 'Production uses Linux kernel locks')
    def test_kernel_lock_excludes_second_process_and_releases_after_exit(self):
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            command = [sys.executable, '-c',
                       'import fcntl,sys; f=open(sys.argv[1],"a"); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)',
                       str(root / 'migration.lock')]
            with run.exclusive(root):
                self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)

    def test_approval_uses_canonical_manifest(self):
        manifest = Path(__file__).parents[1] / 'bitrix/rejection-notifications/manifest.json'
        self.assertEqual(hashlib.sha256(manifest.read_text(encoding="utf-8").encode()).hexdigest(), run.APPROVAL['sha256']['manifest.json'])

    def test_flow_runs_only_at_night_and_dev_drops_schedule(self):
        import importlib.util
        import yaml
        spec = importlib.util.spec_from_file_location('deployment', Path(__file__).parents[3] / 'tools/deploy_kestra.py')
        deploy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(deploy)
        path = Path(__file__).parents[1] / 'flows/bitrix24_historical_rejection_migration.yaml'
        source = yaml.safe_load(path.read_text())
        self.assertEqual(source['inputs'][0]['defaults'], 'inspect')
        self.assertEqual(source['triggers'][0]['cron'], '*/10 0-5,22-23 * * *')
        self.assertEqual(source['triggers'][0]['inputs'], {'mode':'run'})
        self.assertEqual(source['concurrency']['limit'], 1)
        self.assertNotIn('retry', source['tasks'][0])
        self.assertNotIn('triggers', yaml.safe_load(deploy.normalize_flow_source(path, 'redunisol.dev.marketing-crm', 'dev')))


if __name__ == '__main__':
    unittest.main()
