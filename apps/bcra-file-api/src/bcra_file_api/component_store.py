"""Bounded, immutable SQLite components for the public BCRA file layouts."""
from __future__ import annotations

from collections.abc import Callable
import json
from pathlib import Path
import sqlite3

from .extended_formats import history_record, months_ending, name_record, normal_since_record
from .formats import FormatError, rect_record
from .source import SourceError
from .store import timestamp


SCHEMAS = {
    'history': ('CREATE TABLE history(identification TEXT NOT NULL,entity TEXT NOT NULL,'
                'data BLOB NOT NULL,PRIMARY KEY(identification,entity)) WITHOUT ROWID;',
                'INSERT INTO history VALUES (?,?,?)'),
    'padron': ('CREATE TABLE names(identification TEXT PRIMARY KEY,name TEXT NOT NULL) WITHOUT ROWID;',
               'INSERT INTO names VALUES (?,?)'),
    'normal': ('CREATE TABLE normal_since(identification TEXT PRIMARY KEY,since TEXT NOT NULL) WITHOUT ROWID;',
               'INSERT INTO normal_since VALUES (?,?)'),
    'corrections': ('CREATE TABLE corrections(identification TEXT NOT NULL,entity TEXT NOT NULL,'
                    'period TEXT NOT NULL,situation INTEGER NOT NULL,amount_tenths INTEGER NOT NULL,'
                    'PRIMARY KEY(identification,entity,period)) WITHOUT ROWID;',
                    'INSERT INTO corrections VALUES (?,?,?,?,?) ON CONFLICT(identification,entity,period) '
                    'DO UPDATE SET situation=excluded.situation,amount_tenths=excluded.amount_tenths'),
}


def build_component(path: Path, kind: str, archives: dict, period: str, version: str,
                    min_rows: int, guard: Callable[[], None],
                    progress: Callable[[str, int], None], *, block_rows: int = 100_000) -> dict:
    """Commit each block and its source cursor in the same durable transaction.

    7z streams are sequential: resume drains the confirmed prefix without parsing
    or inserting it again. Only the uncommitted block may be replayed after a
    crash. Member completion is recorded only after 7z verifies its integrity.
    """
    guard()
    if block_rows < 1:
        raise ValueError('block_rows must be positive')
    schema, insert = SCHEMAS[kind]
    connection = sqlite3.connect(path)
    interrupted = []

    def sql_guard():
        try:
            guard()
            return 0
        except SourceError as exc:
            # sqlite converts callback exceptions to OperationalError. Preserve
            # the actual pause/resource error rather than reporting bad input.
            interrupted.append(exc)
            return 1

    connection.set_progress_handler(sql_guard, 10_000)
    try:
        connection.executescript(
            'PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA cache_size=-65536;')
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not tables:
            connection.executescript('BEGIN;' + schema + 'CREATE TABLE metadata(value TEXT NOT NULL);'
                'CREATE TABLE import_checkpoint(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);')
            state = {'schema_version': 1, 'kind': kind, 'period': '' if kind == 'padron' else period, 'version': version,
                     'member_index': 0, 'line': 0, 'source_rows': 0, 'rows': 0,
                     'name_encoding_replacements': 0, 'entity_codes': []}
            connection.execute('INSERT INTO import_checkpoint VALUES (1,?)', (json.dumps(state),))
            connection.commit()
        else:
            row = connection.execute('SELECT value FROM import_checkpoint WHERE id=1').fetchone()
            if row is None:
                raise SourceError(f'Missing {kind} import checkpoint')
            state = json.loads(row[0])
            if any(state.get(key) != value for key, value in {
                'schema_version': 1, 'kind': kind, 'period': '' if kind == 'padron' else period, 'version': version,
            }.items()):
                raise SourceError(f'{kind} import checkpoint does not match its source')
            complete = connection.execute('SELECT value FROM metadata').fetchone()
            if complete:
                return json.loads(complete[0])

        source_rows, rows = state['source_rows'], state['rows']
        replacements = state['name_encoding_replacements']
        entities = set(state['entity_codes'])
        progress(('resume_' if source_rows else '') + kind, rows)
        if kind == 'corrections':
            members = [('INFRET', 'inf_ret.txt'), ('INFRETPA', 'inf_retparc.txt')]
        else:
            members = {'history': [('24DSF', '24dsf.txt')],
                       'padron': [('PADRON', 'padron_arca.txt')],
                       'normal': [('1DSF', '1dsf.txt')]}[kind]
        covered_months = set(months_ending(period))

        def commit_block(member_index, line):
            guard()
            state.update(member_index=member_index, line=line, source_rows=source_rows,
                         rows=rows, name_encoding_replacements=replacements,
                         entity_codes=sorted(entities))
            connection.execute('UPDATE import_checkpoint SET value=? WHERE id=1', (json.dumps(state),))
            connection.commit()
            progress(kind, rows)

        for member_index, (archive_kind, member) in enumerate(members):
            if member_index < state['member_index']:
                continue
            confirmed_line = state['line'] if member_index == state['member_index'] else 0
            batch = []
            block_start = source_rows
            last_line = 0
            with archives[archive_kind].lines(member) as lines:
                for number, line in lines:
                    last_line = number
                    if number <= confirmed_line:
                        if number % 10_000 == 0:
                            guard()
                        continue
                    source_rows += 1
                    try:
                        if kind == 'history':
                            record = history_record(line)
                            if record is not None:
                                entities.add(record[1])
                        elif kind == 'normal':
                            record = normal_since_record(line, period)
                        elif kind == 'padron':
                            record = name_record(line)
                            if record is not None:
                                replacements += record[1].count('\ufffd')
                        else:
                            source = rect_record(line)
                            record = source[:5] if source is not None and source[2] in covered_months else None
                            if record is not None:
                                entities.add(record[1])
                        if record is not None:
                            batch.append(record)
                            rows += 1
                        if len(batch) >= 10_000:
                            guard()
                            connection.executemany(insert, batch)
                            batch.clear()
                        if source_rows - block_start >= block_rows:
                            connection.executemany(insert, batch)
                            batch.clear()
                            commit_block(member_index, number)
                            block_start = source_rows
                    except (FormatError, sqlite3.Error):
                        if interrupted:
                            raise interrupted[-1]
                        guard()
                        raise SourceError(f'Invalid {archive_kind} record at line {number}') from None
            if last_line < confirmed_line:
                raise SourceError(f'{kind} source ended before its confirmed checkpoint')
            guard()
            connection.executemany(insert, batch)
            commit_block(member_index + 1, 0)
        if kind != 'corrections' and rows < min_rows:
            raise SourceError(f'{kind} import is below the minimum row count')
        manifest = {'kind': kind, 'version': version, 'period': period, 'rows': rows,
                    'source_rows': source_rows, 'imported_at': timestamp(),
                    'entity_codes': sorted(entities), 'name_encoding_replacements': replacements}
        guard()
        if connection.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise SourceError(f'{kind} integrity check failed')
        guard()
        connection.execute('INSERT INTO metadata VALUES (?)', (json.dumps(manifest),))
        connection.commit()
        progress(kind, rows)
        return manifest
    except sqlite3.Error:
        if interrupted:
            raise interrupted[-1]
        guard()
        raise SourceError(f'Unable to construct {kind} component') from None
    finally:
        connection.set_progress_handler(None, 0)
        connection.rollback()
        connection.close()
