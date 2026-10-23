from __future__ import annotations

from contextlib import contextmanager
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from bcra_file_api.app import compatibility_response, create_app
from bcra_file_api.archive import Archive
from bcra_file_api.bundle import BuildBudget, active_bundle, clean_staging, inside
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
