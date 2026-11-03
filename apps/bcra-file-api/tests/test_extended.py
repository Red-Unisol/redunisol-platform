from __future__ import annotations

from contextlib import closing, contextmanager
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import os
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from bcra_file_api.app import compatibility_response, create_app
from bcra_file_api.archive import Archive
from bcra_file_api.bundle import BuildBudget, active_bundle, active_current, clean_staging, inside
from bcra_file_api.component_store import build_component
from bcra_file_api.config import Config
from bcra_file_api.extended_formats import (decode_history, history_record, months_ending,
                                          name_record, normal_since_record)
from bcra_file_api.formats import FormatError
from bcra_file_api.refresh import RefreshManager
from bcra_file_api.source import Asset, SourceError, parse_catalog
from bcra_file_api.source import content_version
from bcra_file_api.store import import_snapshot
from test_bcra import CUIL, OTHER, PERIOD, FakeArchive, archives, base, catalog_html, manifest, rect

SEVEN_ZIP = shutil.which(os.environ.get('BCRA_FILE_7Z', '7z')) or shutil.which('7zz')


def history(identification=CUIL, entity='00007', cells=None):
    values = cells if cells is not None else {0: (1, '123,5', 0), 1: (2, '60,0', 1), 23: (3, '90,0', 2)}
    fields = [entity, '11', identification]
    widths = [5, 2, 11]
    for index in range(24):
        situation, amount, observation = values.get(index, (0, '0,0', 0))
        fields.extend([str(situation), amount, str(observation)])
        widths.extend([2, 12, 1])
    return ''.join(value.rjust(width) for value, width in zip(fields, widths)) + '\r\n'


def name(identification=CUIL, value='NOMBRE COMPLETO DEL PADRON'):
    return (identification + value.ljust(160) + '000000' + ' ' + ' ' * 11
            + '1901-01-01' + ' ' + ' ' * 10 + '00' + ' ' * 8 + '\r\n')


def extended_archives(current=None, historical=None, full='', partial='', names=None, normal=None):
    result = archives(rows=current if current is not None else base(situation=1), full=full, partial=partial)
    result['24DSF'] = FakeArchive({'24dsf.txt': historical if historical is not None else history()})
    result['PADRON'] = FakeArchive({'padron_arca.txt': names if names is not None else name()})
    result['1DSF'] = FakeArchive({'1dsf.txt': normal if normal is not None else '11' + CUIL + '202505\r\n'})
    return result


class ExtendedFormatTests(unittest.TestCase):
    def test_history_preserves_amounts_zero_situation_and_unknown_observations(self):
        value = history_record(history(cells={0: (0, '123,5', 9), 23: (6, '99,9', 2)}))
        cells = decode_history(value[2])
        self.assertEqual(cells[0], (0, 1235, 9))
        self.assertIsNone(cells[1])
        self.assertEqual(cells[23], (6, 999, 2))
        self.assertEqual(months_ending(PERIOD)[-1], '202409')
        with self.assertRaises(FormatError):
            history_record(history(cells={0: (1, '-1,0', 0)}))
        with self.assertRaises(FormatError):
            decode_history(value[2] + b'extra')

    def test_name_layout_and_month_validation_do_not_invent_other_identity_data(self):
        self.assertEqual(name_record(name(value='NOMBRE; CON SIGNOS')),
                         (CUIL, 'NOMBRE; CON SIGNOS'))
        self.assertEqual(normal_since_record('11' + CUIL + '202402', PERIOD), (CUIL, '202402'))
        self.assertIsNone(normal_since_record('96' + CUIL + '202402', PERIOD))
        for month in ['202613', '202609', '000000']:
            with self.subTest(month=month), self.assertRaises(FormatError):
                normal_since_record('11' + CUIL + month, PERIOD)

    def test_catalog_requires_complete_same_month_extended_files(self):
        html = catalog_html()
        for filename in ['24DSF202608.7Z', '1DSF202608.7Z', '20260930PADRON.7Z']:
            html += f"<a onclick=\"Confirmacion('https://mft.bcra.gob.ar/apilink.aspx?file={filename}','{filename}')\">file</a>"
        self.assertEqual([asset.kind for asset in parse_catalog(html, extended=True)],
                         ['DEUDORES', 'INFRET', 'INFRETPA', '24DSF', '1DSF', 'PADRON'])
        with self.assertRaises(SourceError):
            parse_catalog(html.replace('24DSF202608', '24DSF202607'), extended=True)


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.config = Config(self.root, 'x' * 32, terms_accepted=True, min_rows=1,
                             min_extended_rows=1, min_free_bytes=0,
                             max_build_bytes=10 * 1024**2, extended_enabled=True)
        self.manager = RefreshManager(self.config)
        self.fixtures = extended_archives()
        self.revisions = {}
        self.assets = [Asset(PERIOD + kind + '.7Z', kind, PERIOD, 'unused')
                       for kind in ('DEUDORES', 'INFRET', 'INFRETPA')]
        self.assets.extend([Asset(kind + PERIOD + '.7Z', kind, PERIOD, 'unused') for kind in ('24DSF', '1DSF')])
        self.assets.append(Asset('20260930PADRON.7Z', 'PADRON', '20260930', 'unused'))

    def tearDown(self):
        self.temporary.cleanup()

    def download(self, asset, target):
        value = (asset.kind + self.revisions.get(asset.kind, '')).encode()
        target.write_bytes(value)
        return {'name': asset.name, 'kind': asset.kind, 'sha256': hashlib.sha256(value).hexdigest(), 'bytes': len(value)}

    @contextmanager
    def sources(self):
        def archive(path, *_args, **_kwargs):
            return self.fixtures[next(asset.kind for asset in self.assets if asset.name == path.name)]
        with patch('bcra_file_api.bundle.SourceClient') as source, patch('bcra_file_api.bundle.Archive', side_effect=archive):
            source.return_value.catalog.return_value = self.assets
            source.return_value.download.side_effect = self.download
            yield source

    def refresh(self):
        with self.sources():
            return self.manager._refresh()

    def request(self, client, path, token=True):
        return client.get(path, headers={'Authorization': 'Bearer ' + self.config.token} if token else {})

    def test_compatible_current_selects_latest_entity_and_complete_names(self):
        self.fixtures = extended_archives(current=base(situation=1) + base(period='202607', situation=5))
        self.refresh()
        with TestClient(create_app(self.config)) as client:
            result = self.request(client, '/centraldedeudores/v1.0/Deudas/' + CUIL)
            self.assertEqual(result.status_code, 200)
            body = result.json()
            self.assertEqual(set(body), {'status', 'results'})
            self.assertIsInstance(body['results']['identificacion'], int)
            self.assertEqual(body['results']['denominacion'], 'NOMBRE COMPLETO DEL PADRON')
            self.assertEqual(len(body['results']['periodos']), 1)
            entity = body['results']['periodos'][0]['entidades'][0]
            self.assertEqual(entity['situacion'], 1)
            self.assertEqual(entity['fechaSit1'], '2025-05-30')
            self.assertNotIn('codigoEntidad', entity)
            self.assertNotIn('meta', body)
            self.assertEqual(result.headers['x-bcra-period'], PERIOD)

    def test_history_has_24_month_coverage_without_fabricating_empty_debts(self):
        self.refresh()
        with TestClient(create_app(self.config)) as client:
            result = self.request(client, '/CentralDeDeudores/v1.0/Deudas/Historicas/' + CUIL)
            self.assertEqual(result.status_code, 200)
            periods = result.json()['results']['periodos']
            self.assertEqual([period['periodo'] for period in periods], ['202608', '202607', '202409'])
            self.assertEqual(periods[1]['entidades'][0], {'entidad': 'BANCO SINTETICO', 'situacion': 2,
                            'monto': 60.0, 'enRevision': False, 'procesoJud': True})
            self.assertEqual(set(periods[-1]['entidades'][0]), {'entidad', 'situacion', 'monto', 'enRevision', 'procesoJud'})
            absent = self.request(client, '/centraldedeudores/v1.0/Deudas/Historicas/' + OTHER)
            self.assertEqual(absent.status_code, 404)
            self.assertEqual(set(absent.json()), {'status', 'errorMessages'})

    def test_historical_rectifications_apply_to_old_months_in_order_and_preserve_unknown_flags(self):
        self.fixtures = extended_archives(full=rect(period='202607', situation=3),
            partial=rect(period='202607', situation=4, amount='88,8')
                    + rect(period='202409', situation=0, amount='0,0'))
        self.refresh()
        with TestClient(create_app(self.config)) as client:
            body = self.request(client, '/centraldedeudores/v1.0/Deudas/Historicas/' + CUIL).json()
            self.assertEqual([period['periodo'] for period in body['results']['periodos']], ['202608', '202607'])
            corrected = body['results']['periodos'][1]['entidades'][0]
            self.assertEqual((corrected['situacion'], corrected['monto']), (4, 88.8))
            self.assertIsNone(corrected['enRevision'])
            current = self.request(client, '/centraldedeudores/v1.0/Deudas/' + CUIL).json()
            self.assertEqual(current['results']['periodos'][0]['entidades'][0]['situacion'], 1)

    def test_missing_initial_history_is_unavailable_and_invalid_ids_keep_official_error_shape(self):
        import_snapshot(self.manager.database, archives(), manifest(), 1)
        with TestClient(create_app(self.config)) as client:
            path = '/centraldedeudores/v1.0/Deudas/'
            self.assertEqual(self.request(client, path + CUIL).status_code, 200)
            self.assertEqual(self.request(client, path + 'Historicas/' + CUIL).status_code, 503)
            self.assertEqual(self.request(client, path + CUIL, token=False).status_code, 401)
            invalid = self.request(client, path + '20-12345678-6')
            self.assertEqual(invalid.status_code, 400)
            self.assertEqual(set(invalid.json()), {'status', 'errorMessages'})

    def test_february_date_and_mixed_risk_do_not_acquire_a_false_normal_since_date(self):
        self.fixtures = extended_archives(normal='11' + CUIL + '202402\r\n')
        self.refresh()
        with TestClient(create_app(self.config)) as client:
            body = self.request(client, '/centraldedeudores/v1.0/Deudas/' + CUIL).json()
            self.assertEqual(body['results']['periodos'][0]['entidades'][0]['fechaSit1'], '2024-02-29')
        self.revisions['DEUDORES'] = 'new'
        self.fixtures = extended_archives(current=base(situation=3), normal='11' + CUIL + '202402\r\n')
        self.refresh()
        with TestClient(create_app(self.config)) as client:
            body = self.request(client, '/centraldedeudores/v1.0/Deudas/' + CUIL).json()
            self.assertIsNone(body['results']['periodos'][0]['entidades'][0]['fechaSit1'])

    def test_unchanged_and_name_only_updates_do_not_rebuild_history(self):
        self.refresh()
        before = active_bundle(self.root)
        history_path = inside(self.root, before['components']['history']['path'])
        original = history_path.read_bytes()
        with patch('bcra_file_api.bundle.build_component', side_effect=AssertionError('must reuse')):
            self.assertEqual(self.refresh()['action'], 'unchanged')
        self.revisions['PADRON'] = 'new'
        self.fixtures['PADRON'] = FakeArchive({'padron_arca.txt': name(value='NOMBRE ACTUALIZADO')})
        with patch('bcra_file_api.bundle.build_component', wraps=build_component) as builder:
            self.refresh()
        self.assertEqual([call.args[1] for call in builder.call_args_list], ['padron'])
        self.assertEqual(history_path.read_bytes(), original)

    def test_initial_extension_reuses_the_legacy_snapshot_without_copying(self):
        files = [self.download(asset, self.root / asset.name) for asset in self.assets[:3]]
        legacy = {**manifest(), 'files': files, 'version': content_version(files)}
        import_snapshot(self.manager.database, archives(), legacy, 1)
        inode = self.manager.database.stat().st_ino
        with patch('bcra_file_api.bundle.import_snapshot', side_effect=AssertionError('must reuse')):
            self.refresh()
        current = inside(self.root, active_bundle(self.root)['components']['current']['path'])
        self.assertEqual(current.stat().st_ino, inode)

    def test_rectification_only_update_reuses_history_and_applies_new_overlay(self):
        self.refresh()
        previous = active_bundle(self.root)
        self.revisions['INFRETPA'] = 'new'
        self.fixtures = extended_archives(partial=rect(period='202607', situation=5))
        with patch('bcra_file_api.bundle.build_component', wraps=build_component) as builder:
            self.refresh()
        self.assertEqual([call.args[1] for call in builder.call_args_list], ['corrections'])
        self.assertEqual(active_bundle(self.root)['components']['history'], previous['components']['history'])
        body = json.loads(compatibility_response(self.manager, CUIL, historical=True).body)
        self.assertEqual(body['results']['periodos'][1]['entidades'][0]['situacion'], 5)

    def test_reads_keep_the_old_complete_bundle_during_import_then_switch_together(self):
        self.refresh()
        self.revisions['PADRON'] = 'new'
        self.fixtures['PADRON'] = FakeArchive({'padron_arca.txt': name(value='NOMBRE NUEVO')})
        started, proceed = threading.Event(), threading.Event()
        failures = []
        def build(*args, **kwargs):
            if args[1] == 'padron':
                started.set()
                if not proceed.wait(5):
                    raise AssertionError('query did not complete during import')
            return build_component(*args, **kwargs)
        def refresh():
            try:
                self.manager._refresh()
            except Exception as error:
                failures.append(error)
        with self.sources(), patch('bcra_file_api.bundle.build_component', side_effect=build):
            worker = threading.Thread(target=refresh)
            worker.start()
            try:
                self.assertTrue(started.wait(5))
                for historical in (False, True):
                    body = json.loads(compatibility_response(self.manager, CUIL, historical).body)
                    self.assertEqual(body['results']['denominacion'], 'NOMBRE COMPLETO DEL PADRON')
            finally:
                proceed.set()
                worker.join(5)
            self.assertFalse(worker.is_alive())
            self.assertEqual(failures, [])
        for historical in (False, True):
            body = json.loads(compatibility_response(self.manager, CUIL, historical).body)
            self.assertEqual(body['results']['denominacion'], 'NOMBRE NUEVO')

    def test_failed_publication_keeps_every_active_component(self):
        self.refresh()
        original = (self.root / 'active.json').read_bytes()
        self.revisions['PADRON'] = 'new'
        with self.sources(), patch('bcra_file_api.bundle._atomic_manifest', side_effect=SourceError('stopped')):
            with self.assertRaises(SourceError):
                self.manager._refresh()
        self.assertEqual((self.root / 'active.json').read_bytes(), original)
        with TestClient(create_app(self.config)) as client:
            self.assertEqual(self.request(client, '/centraldedeudores/v1.0/Deudas/Historicas/' + CUIL).status_code, 200)
        with patch('bcra_file_api.bundle.build_component', side_effect=AssertionError('reuse completed build')):
            self.assertEqual(self.refresh()['action'], 'updated')

    def test_bad_import_never_publishes_partial_coverage(self):
        import_snapshot(self.manager.database, archives(), manifest(), 1)
        original = self.manager.database.read_bytes()
        self.fixtures['PADRON'] = FakeArchive({'padron_arca.txt': 'bad'})
        with self.assertRaises(SourceError):
            self.refresh()
        self.assertFalse((self.root / 'active.json').exists())
        self.assertEqual(self.manager.database.read_bytes(), original)
        self.assertEqual(list(self.root.glob('refresh-*')), [])

    def test_disk_and_time_budgets_abort_before_more_writes(self):
        budget = BuildBudget(replace(self.config, min_free_bytes=100), self.root, time.monotonic() + 60)
        with patch('bcra_file_api.bundle.shutil.disk_usage', return_value=shutil._ntuple_diskusage(100, 99, 1)):
            with self.assertRaisesRegex(SourceError, 'disk reserve'):
                budget()
        budget = BuildBudget(self.config, self.root, 0)
        with self.assertRaisesRegex(SourceError, 'time budget'):
            budget()
        abandoned = self.root / 'refresh-abandoned';abandoned.mkdir();(abandoned / 'partial').write_text('x')
        untouched = self.root / 'unrelated';untouched.mkdir()
        clean_staging(self.root)
        self.assertFalse(abandoned.exists())
        self.assertTrue(untouched.exists())
        with self.assertRaises(SourceError):
            inside(self.root, '../outside')

    def test_storage_limit_or_expired_check_does_not_return_partial_data(self):
        self.refresh()
        original = (self.root / 'active.json').read_bytes()
        self.revisions['PADRON'] = 'new'
        self.manager.config = replace(self.config, max_build_bytes=1)
        with self.assertRaisesRegex(SourceError, 'storage budget'):
            self.refresh()
        self.assertEqual((self.root / 'active.json').read_bytes(), original)
        self.assertEqual(list(self.root.glob('refresh-*')), [])
        self.manager.config = replace(self.config, max_check_age_hours=-1)
        self.assertEqual(compatibility_response(self.manager, CUIL).status_code, 503)
        self.assertEqual(compatibility_response(self.manager, CUIL, historical=True).status_code, 503)

    def test_next_night_resumes_blocks_after_restart_and_a_name_source_change(self):
        from test_resume import InterruptedArchive
        import_snapshot(self.manager.database, archives(rows=base(situation=1)), manifest(), 1)
        original = self.manager.database.read_bytes()
        text = history() + history(OTHER) + ''.join(history(str(20999999990 + i)) for i in range(5))
        self.fixtures['24DSF'] = InterruptedArchive({'24dsf.txt': text}, after=3)
        def build(*args, **kwargs):
            return build_component(*args, **kwargs, block_rows=2)
        with self.sources(), patch('bcra_file_api.bundle.build_component', side_effect=build):
            self.manager._run()
        self.assertEqual(self.manager.state['status'], 'failed')
        self.assertFalse((self.root / 'active.json').exists())
        self.assertEqual(self.manager.database.read_bytes(), original)
        checkpoint = next((self.root / 'pending').glob('history-*.sqlite'))
        with closing(sqlite3.connect(checkpoint)) as connection:
            self.assertEqual(connection.execute('SELECT count(*) FROM history').fetchone()[0], 2)
        self.manager = RefreshManager(self.config)
        self.fixtures['24DSF'] = FakeArchive({'24dsf.txt': text})
        self.revisions['PADRON'] = 'new-day'
        from bcra_file_api.component_store import history_record
        with self.sources(), patch('bcra_file_api.bundle.build_component', side_effect=build), \
                patch('bcra_file_api.bundle.import_snapshot', side_effect=AssertionError('reuse completed monthly base')), \
                patch('bcra_file_api.component_store.history_record', wraps=history_record) as parse:
            result = self.manager._refresh()
        self.assertEqual(parse.call_count, 5)
        self.assertEqual(result['component_rows']['history'], 7)
        self.assertEqual(list((self.root / 'pending').glob('*.sqlite')), [])
        self.assertEqual(compatibility_response(self.manager, CUIL, historical=True).status_code, 200)

    def test_changed_history_source_discards_only_its_obsolete_checkpoint(self):
        from test_resume import InterruptedArchive
        text = history() + history(OTHER) + history('20999999999')
        self.fixtures['24DSF'] = InterruptedArchive({'24dsf.txt': text}, after=2)
        def build(*args, **kwargs):
            return build_component(*args, **kwargs, block_rows=2)
        with self.sources(), patch('bcra_file_api.bundle.build_component', side_effect=build):
            with self.assertRaises(SourceError):
                self.manager._refresh()
        old = next((self.root / 'pending').glob('history-*.sqlite'))
        self.revisions['24DSF'] = 'rectified-file'
        self.fixtures['24DSF'] = FakeArchive({'24dsf.txt': text})
        from bcra_file_api.component_store import history_record
        with self.sources(), patch('bcra_file_api.component_store.history_record', wraps=history_record) as parse:
            self.manager._refresh()
        self.assertEqual(parse.call_count, 3)
        self.assertFalse(old.exists())

    def test_completed_pending_component_cannot_bypass_row_drop_validation(self):
        self.fixtures['24DSF'] = FakeArchive({'24dsf.txt': history() + history(OTHER)})
        self.refresh()
        original = (self.root / 'active.json').read_bytes()
        self.revisions['24DSF'] = 'suspicious-shrink'
        self.fixtures['24DSF'] = FakeArchive({'24dsf.txt': history()})
        with self.assertRaisesRegex(SourceError, 'row count dropped'):
            self.refresh()
        with patch('bcra_file_api.bundle.build_component', side_effect=AssertionError('reuse completed pending')):
            with self.assertRaisesRegex(SourceError, 'row count dropped'):
                self.refresh()
        self.assertEqual((self.root / 'active.json').read_bytes(), original)

    def test_storage_budget_includes_blocks_retained_from_previous_nights(self):
        pending = self.root / 'pending'; pending.mkdir()
        (pending / 'history.sqlite').write_bytes(b'x' * 101)
        work = self.root / 'refresh-current'; work.mkdir()
        budget = BuildBudget(replace(self.config, max_build_bytes=100), work,
                             time.monotonic() + 60, pending)
        with self.assertRaisesRegex(SourceError, 'storage budget'):
            budget()
        (pending / 'history.sqlite').unlink()
        completed = self.root / 'completed.sqlite'; completed.write_bytes(b'x' * 101)
        budget.completed.append(completed)
        with self.assertRaisesRegex(SourceError, 'storage budget'):
            budget(force=True)
        (pending / 'history.sqlite').write_bytes(b'x')
        clean_staging(self.root)
        self.assertTrue((pending / 'history.sqlite').exists())

    def fail_during_history(self):
        from test_resume import InterruptedArchive
        text = history() + history(OTHER) + history('20999999999')
        self.fixtures['24DSF'] = InterruptedArchive({'24dsf.txt': text}, after=2)
        self.revisions['24DSF'] = 'incomplete-history'
        def build(*args, **kwargs):
            return build_component(*args, **kwargs, block_rows=2)
        with self.sources(), patch('bcra_file_api.bundle.build_component', side_effect=build):
            self.manager._run()
        self.assertEqual(self.manager.state['status'], 'failed')

    def test_current_queries_work_after_restart_while_committed_history_is_incomplete(self):
        self.fail_during_history()
        self.assertIsNone(active_bundle(self.root))
        monthly = active_current(self.root)
        checkpoint = next((self.root / 'pending').glob('history-*.sqlite'))
        with closing(sqlite3.connect(checkpoint)) as connection:
            self.assertEqual(connection.execute('SELECT count(*) FROM history').fetchone()[0], 2)
        with TestClient(create_app(self.config)) as client:
            status = self.request(client, '/status').json()
            self.assertTrue(status['ready'])
            self.assertFalse(status['history_ready'])
            self.assertFalse(status['capabilities']['history'])
            current = self.request(client, '/centraldedeudores/v1.0/Deudas/' + CUIL)
            self.assertEqual(current.status_code, 200)
            self.assertEqual(current.headers['x-bcra-version'], monthly['version'])
            self.assertEqual(current.headers['x-bcra-checked-at'], monthly['checked_at'])
            self.assertIsNone(current.json()['results']['periodos'][0]['entidades'][0]['fechaSit1'])
            self.assertEqual(self.request(client, '/centraldedeudores/v1.0/Deudas/20999999998').status_code, 404)
            # Even an identification already present in a committed block must
            # remain unavailable through the historical contract until complete.
            for identification in (CUIL, '20999999998'):
                self.assertEqual(self.request(client,
                    '/centraldedeudores/v1.0/Deudas/Historicas/' + identification).status_code, 503)
            lookup = client.post('/lookup', json={'cuil': CUIL},
                                 headers={'Authorization': 'Bearer ' + self.config.token})
            self.assertEqual(lookup.status_code, 200)

    def test_daily_monthly_verification_renews_only_current_freshness(self):
        self.fail_during_history()
        path = self.root / 'current.json'
        monthly = json.loads(path.read_text())
        monthly['checked_at'] = (datetime.now(timezone.utc) - timedelta(hours=73)).isoformat()
        path.write_text(json.dumps(monthly))
        self.assertEqual(compatibility_response(self.manager, CUIL).status_code, 503)
        with patch('bcra_file_api.bundle.import_snapshot', side_effect=AssertionError('reuse monthly data')):
            self.fail_during_history()
        self.assertEqual(compatibility_response(self.manager, CUIL).status_code, 200)
        self.assertEqual(compatibility_response(self.manager, CUIL, historical=True).status_code, 503)
        self.assertNotEqual(active_current(self.root)['checked_at'], monthly['checked_at'])
        self.assertIsNone(self.manager.state.get('last_successful_check_at'))

    def test_current_queries_are_available_while_first_history_import_is_running(self):
        entered, release = threading.Event(), threading.Event()
        failures = []
        def build(*args, **kwargs):
            if args[1] == 'history':
                entered.set()
                if not release.wait(5):
                    raise AssertionError('current query blocked behind history import')
            return build_component(*args, **kwargs)
        def refresh():
            try:
                self.manager._refresh()
            except Exception as exc:
                failures.append(exc)
        with self.sources(), patch('bcra_file_api.bundle.build_component', side_effect=build):
            worker = threading.Thread(target=refresh)
            worker.start()
            try:
                self.assertTrue(entered.wait(5))
                self.assertIsNone(active_bundle(self.root))
                with TestClient(create_app(self.config)) as client:
                    self.assertEqual(self.request(client, '/centraldedeudores/v1.0/Deudas/' + CUIL).status_code, 200)
                    self.assertEqual(self.request(client, '/centraldedeudores/v1.0/Deudas/Historicas/' + CUIL).status_code, 503)
            finally:
                release.set()
                worker.join(5)
        self.assertFalse(worker.is_alive())
        self.assertEqual(failures, [])
        self.assertEqual(compatibility_response(self.manager, CUIL, historical=True).status_code, 200)

    def test_historical_download_failure_does_not_block_monthly_publication(self):
        def download(asset, target):
            if asset.kind == '24DSF':
                raise SourceError('Historical archive unavailable')
            return self.download(asset, target)
        with self.sources() as source:
            source.return_value.download.side_effect = download
            self.manager._run()
        self.assertEqual(self.manager.state['status'], 'failed')
        self.assertTrue(self.manager.status()['ready'])
        self.assertFalse(self.manager.status()['history_ready'])
        self.assertEqual(compatibility_response(self.manager, CUIL).status_code, 200)

    def test_invalid_monthly_input_cannot_enable_either_endpoint(self):
        self.fixtures = extended_archives(current=base() + base())
        with self.assertRaises(SourceError):
            self.refresh()
        self.assertIsNone(active_current(self.root))
        self.assertFalse(self.manager.status()['ready'])
        for historical in (False, True):
            self.assertEqual(compatibility_response(self.manager, CUIL, historical).status_code, 503)

    def test_new_current_publication_keeps_history_bound_to_its_original_entity_master(self):
        self.refresh()
        historical = active_bundle(self.root)
        old_database = inside(self.root, historical['components']['current']['path'])
        self.revisions['DEUDORES'] = 'new-entity-master'
        self.fixtures['DEUDORES'] = FakeArchive({'deudores.txt': base(entity='00008', situation=5),
            'maeent.txt': '00008' + 'OTRO BANCO'.ljust(70) + '\r\n'})
        with self.assertRaisesRegex(SourceError, 'entity absent'):
            self.refresh()
        self.assertTrue(old_database.is_file())
        current_response = compatibility_response(self.manager, CUIL)
        history_response = compatibility_response(self.manager, CUIL, historical=True)
        self.assertEqual((current_response.status_code, history_response.status_code), (200, 200))
        self.assertEqual(json.loads(current_response.body)['results']['periodos'][0]['entidades'][0]['entidad'], 'OTRO BANCO')
        self.assertEqual(json.loads(history_response.body)['results']['periodos'][0]['entidades'][0]['entidad'], 'BANCO SINTETICO')
        self.assertEqual(history_response.headers['x-bcra-version'], historical['version'])
        self.assertNotEqual(current_response.headers['x-bcra-version'], historical['version'])

    def test_monthly_check_does_not_renew_an_expired_complete_history(self):
        self.refresh()
        path = self.root / 'active.json'
        historical = json.loads(path.read_text())
        historical['checked_at'] = (datetime.now(timezone.utc) - timedelta(hours=73)).isoformat()
        path.write_text(json.dumps(historical))
        self.fail_during_history()
        self.assertEqual(compatibility_response(self.manager, CUIL).status_code, 200)
        self.assertEqual(compatibility_response(self.manager, CUIL, historical=True).status_code, 503)
        self.assertTrue(self.manager.status()['ready'])
        self.assertFalse(self.manager.status()['history_ready'])
        self.assertEqual(self.manager.status()['last_successful_history_check_at'], historical['checked_at'])

    def test_failed_monthly_revalidation_cannot_renew_a_stale_current_publication(self):
        self.fail_during_history()
        path = self.root / 'current.json'
        monthly = json.loads(path.read_text())
        monthly['checked_at'] = (datetime.now(timezone.utc) - timedelta(hours=73)).isoformat()
        path.write_text(json.dumps(monthly))
        original = path.read_bytes()
        self.revisions['DEUDORES'] = 'invalid-new-monthly'
        self.fixtures['DEUDORES'] = archives(rows=base() + base())['DEUDORES']
        with self.assertRaises(SourceError):
            self.refresh()
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(compatibility_response(self.manager, CUIL).status_code, 503)

    def test_historical_disk_headroom_does_not_prevent_valid_monthly_queries(self):
        free = 5 * 1024**2
        with self.sources(), patch('bcra_file_api.bundle.shutil.disk_usage',
                                  return_value=shutil._ntuple_diskusage(free, 0, free)):
            with self.assertRaisesRegex(SourceError, 'Insufficient free space'):
                self.manager._refresh()
        self.assertIsNotNone(active_current(self.root))
        self.assertIsNone(active_bundle(self.root))
        self.assertEqual(compatibility_response(self.manager, CUIL).status_code, 200)

    def test_monthly_pointer_changes_only_after_a_successful_atomic_publication(self):
        self.fail_during_history()
        path = self.root / 'current.json'
        original = path.read_bytes()
        self.revisions['DEUDORES'] = 'new-current'
        self.fixtures['DEUDORES'] = archives(rows=base(situation=5))['DEUDORES']
        from bcra_file_api.bundle import _atomic_json
        def publish(root, manifest, name):
            if name == 'current.json':
                raise SourceError('Monthly pointer publication interrupted')
            return _atomic_json(root, manifest, name)
        with self.sources(), patch('bcra_file_api.bundle._atomic_json', side_effect=publish):
            with self.assertRaisesRegex(SourceError, 'pointer publication interrupted'):
                self.manager._refresh()
        self.assertEqual(path.read_bytes(), original)
        response = compatibility_response(self.manager, CUIL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.body)['results']['periodos'][0]['entidades'][0]['situacion'], 1)

    @unittest.skipUnless(SEVEN_ZIP, '7z/7zz required')
    def test_real_archives_build_and_serve_the_complete_bundle(self):
        originals = {}
        self.manager = RefreshManager(replace(self.config, seven_zip=SEVEN_ZIP))
        for asset in self.assets:
            inputs = self.root / ('input-' + asset.kind);inputs.mkdir()
            for filename, value in self.fixtures[asset.kind].members.items():
                (inputs / filename).write_bytes(value.encode('cp1252'))
            target = self.root / asset.name
            subprocess.run([SEVEN_ZIP, 'a', '-t7z', '-bd', '-y', str(target), '.'], cwd=inputs,
                           capture_output=True, check=True)
            originals[asset.kind] = target
        def download(asset, target):
            shutil.copyfile(originals[asset.kind], target)
            raw = target.read_bytes()
            return {'name': asset.name, 'kind': asset.kind, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
        with patch('bcra_file_api.bundle.SourceClient') as source:
            source.return_value.catalog.return_value = self.assets
            source.return_value.download.side_effect = download
            self.manager._refresh()
        with TestClient(create_app(self.config)) as client:
            self.assertEqual(self.request(client, '/centraldedeudores/v1.0/Deudas/Historicas/' + CUIL).status_code, 200)


if __name__ == '__main__':
    unittest.main()
