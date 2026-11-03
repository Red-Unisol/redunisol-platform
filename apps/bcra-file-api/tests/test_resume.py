from contextlib import closing, contextmanager
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from bcra_file_api.component_store import build_component
from bcra_file_api.source import SourceError
from test_bcra import CUIL, OTHER, PERIOD, FakeArchive, rect
from test_extended import SEVEN_ZIP, history, name


class InterruptedArchive(FakeArchive):
    def __init__(self, members, after):
        super().__init__(members)
        self.after = after

    @contextmanager
    def lines(self, basename):
        def records():
            for number, line in enumerate(self.members[basename].splitlines(keepends=True), 1):
                if number > self.after:
                    raise SourceError('Nightly window ended')
                yield number, line
        yield records()


class ResumableComponentTests(unittest.TestCase):
    def build(self, path, kind, archives, **kwargs):
        return build_component(path, kind, archives, PERIOD, 'source-version', 1,
                               lambda: None, lambda *_: None, block_rows=2, **kwargs)

    def checkpoint(self, path):
        with closing(sqlite3.connect(path)) as connection:
            return json.loads(connection.execute('SELECT value FROM import_checkpoint').fetchone()[0])

    def test_large_tables_resume_without_reparsing_confirmed_records(self):
        for kind, source, member, parser, records in [
            ('history', '24DSF', '24dsf.txt', 'history_record',
             [history(identification=str(20000000000 + i)) for i in range(5)]),
            ('padron', 'PADRON', 'padron_arca.txt', 'name_record',
             [name(identification=str(20000000000 + i), value='NOMBRE\ufffd') for i in range(5)]),
            ('normal', '1DSF', '1dsf.txt', 'normal_since_record',
             ['11' + str(20000000000 + i) + '202505\n' for i in range(5)]),
        ]:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary) / 'pending.sqlite'
                content = {member: ''.join(records)}
                with self.assertRaisesRegex(SourceError, 'window'):
                    self.build(path, kind, {source: InterruptedArchive(content, after=3)})
                state = self.checkpoint(path)
                self.assertEqual((state['source_rows'], state['rows'], state['line']), (2, 2, 2))
                with closing(sqlite3.connect(path)) as connection:
                    self.assertIsNone(connection.execute('SELECT value FROM metadata').fetchone())
                import bcra_file_api.component_store as module
                with patch('bcra_file_api.component_store.' + parser, wraps=getattr(module, parser)) as parse:
                    result = self.build(path, kind, {source: FakeArchive(content)})
                self.assertEqual(parse.call_count, 3)
                self.assertEqual((result['rows'], result['source_rows']), (5, 5))
                if kind == 'padron':
                    self.assertEqual(result['name_encoding_replacements'], 5)
                if kind == 'history':
                    self.assertEqual(result['entity_codes'], ['00007'])

    def test_source_cursor_counts_ignored_rows_and_preserves_rectification_order(self):
        full = FakeArchive({'inf_ret.txt': rect(situation=2)})
        partial_text = (rect(situation=3) + rect(OTHER, situation=4)
                        + rect(period='202001') + rect(situation=5))
        partial = {'inf_retparc.txt': partial_text}
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'corrections.sqlite'
            with self.assertRaises(SourceError):
                self.build(path, 'corrections', {'INFRET': full, 'INFRETPA': InterruptedArchive(partial, 3)})
            state = self.checkpoint(path)
            self.assertEqual((state['member_index'], state['line'], state['source_rows']), (1, 2, 3))
            # Completed full corrections must not be replayed over partial ones.
            result = self.build(path, 'corrections', {'INFRET': FakeArchive({}), 'INFRETPA': FakeArchive(partial)})
            self.assertEqual((result['source_rows'], result['rows']), (5, 4))
            with closing(sqlite3.connect(path)) as connection:
                self.assertEqual(connection.execute('SELECT situation FROM corrections WHERE identification=?',
                                                    (CUIL,)).fetchone()[0], 5)
                self.assertEqual(connection.execute('SELECT count(*) FROM corrections').fetchone()[0], 2)

    def test_changed_source_cannot_resume_a_checkpoint_from_another_version(self):
        content = {'24dsf.txt': history() + history(OTHER) + history('20999999999')}
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'history.sqlite'
            with self.assertRaises(SourceError):
                self.build(path, 'history', {'24DSF': InterruptedArchive(content, 2)})
            with self.assertRaisesRegex(SourceError, 'does not match'):
                build_component(path, 'history', {'24DSF': FakeArchive(content)}, PERIOD, 'new-version',
                                1, lambda: None, lambda *_: None, block_rows=2)
            self.assertEqual(self.checkpoint(path)['rows'], 2)

    def test_archive_integrity_failure_never_marks_the_component_complete(self):
        class BadCRC(FakeArchive):
            @contextmanager
            def lines(self, member):
                with super().lines(member) as rows:
                    yield rows
                raise SourceError('Archive failed integrity validation')
        content = {'24dsf.txt': history() + history(OTHER)}
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'history.sqlite'
            with self.assertRaisesRegex(SourceError, 'integrity'):
                self.build(path, 'history', {'24DSF': BadCRC(content)})
            state = self.checkpoint(path)
            self.assertEqual((state['member_index'], state['line']), (0, 2))
            with closing(sqlite3.connect(path)) as connection:
                self.assertIsNone(connection.execute('SELECT value FROM metadata').fetchone())
            self.assertEqual(self.build(path, 'history', {'24DSF': FakeArchive(content)})['rows'], 2)

    def test_duplicate_across_blocks_remains_an_error(self):
        content = {'24dsf.txt': history() + history(OTHER) + history()}
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'history.sqlite'
            with self.assertRaisesRegex(SourceError, 'history component'):
                self.build(path, 'history', {'24DSF': FakeArchive(content)})
            self.assertEqual(self.checkpoint(path)['rows'], 2)

    @unittest.skipUnless(SEVEN_ZIP, '7z/7zz required')
    def test_real_7z_stream_resumes_after_committing_a_block(self):
        from bcra_file_api.archive import Archive
        from bcra_file_api.component_store import history_record
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            content = history() + history(OTHER) + history('20999999999')
            (root / '24dsf.txt').write_bytes(content.encode('cp1252'))
            compressed = root / 'history.7z'
            subprocess.run([SEVEN_ZIP, 'a', '-t7z', '-bd', '-y', str(compressed), '24dsf.txt'],
                           cwd=root, check=True, capture_output=True)
            version = hashlib.sha256(compressed.read_bytes()).hexdigest()
            path = root / 'pending.sqlite'
            def stop(_phase, rows):
                if rows == 2:
                    raise SourceError('Nightly window ended')
            with self.assertRaises(SourceError):
                build_component(path, 'history', {'24DSF': Archive(compressed, SEVEN_ZIP)},
                    PERIOD, version, 1, lambda: None, stop, block_rows=2)
            with patch('bcra_file_api.component_store.history_record', wraps=history_record) as parse:
                result = build_component(path, 'history', {'24DSF': Archive(compressed, SEVEN_ZIP)},
                    PERIOD, version, 1, lambda: None, lambda *_: None, block_rows=2)
            self.assertEqual((parse.call_count, result['rows']), (1, 3))

    def test_abrupt_process_exit_recovers_only_committed_blocks(self):
        # Exit after an additional 10k rows have been flushed inside an open
        # transaction. This exercises a real hot journal, not a caught exception.
        script = '''
from contextlib import contextmanager
import os, sys
from pathlib import Path
from bcra_file_api.component_store import build_component
class Input:
    @contextmanager
    def lines(self, member):
        def rows():
            for i in range(30005):
                if i == 30001:
                    os._exit(19)
                yield i + 1, '11' + str(20000000000 + i) + '202505\\n'
        yield rows()
build_component(Path(sys.argv[1]), 'normal', {'1DSF': Input()}, '202608',
                'source-version', 1, lambda: None, lambda *_: None, block_rows=20000)
'''
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'normal.sqlite'
            result = subprocess.run([sys.executable, '-c', script, str(path)],
                                    capture_output=True, timeout=30)
            self.assertEqual(result.returncode, 19, result.stderr.decode())
            content = {'1dsf.txt': ''.join('11' + str(20000000000 + i) + '202505\n' for i in range(30005))}
            from bcra_file_api.component_store import normal_since_record
            parsed = [0]
            def parse(*args):
                parsed[0] += 1
                return normal_since_record(*args)
            with patch('bcra_file_api.component_store.normal_since_record', side_effect=parse):
                metadata = build_component(path, 'normal', {'1DSF': FakeArchive(content)}, PERIOD,
                    'source-version', 1, lambda: None, lambda *_: None, block_rows=20000)
            self.assertEqual(parsed[0], 10005)
            self.assertEqual((metadata['rows'], metadata['source_rows']), (30005, 30005))
            with closing(sqlite3.connect(path)) as connection:
                self.assertEqual(connection.execute('SELECT count(*) FROM normal_since').fetchone()[0], 30005)
                self.assertEqual(connection.execute('PRAGMA quick_check').fetchone()[0], 'ok')


if __name__ == '__main__':
    unittest.main()
