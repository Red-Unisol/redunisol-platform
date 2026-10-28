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
                    progress: Callable[[str, int], None]) -> dict:
    guard()
    schema, insert = SCHEMAS[kind]
    connection = sqlite3.connect(path)
    connection.set_progress_handler(lambda: (guard(), 0)[1], 10_000)
    source_rows = rows = replacements = 0
    entities = set()
    try:
        connection.executescript(
            'PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-65536;'
            + schema + 'CREATE TABLE metadata(value TEXT NOT NULL);')
        if kind == 'corrections':
            members = [('INFRET', 'inf_ret.txt'), ('INFRETPA', 'inf_retparc.txt')]
        else:
            members = {'history': [('24DSF', '24dsf.txt')],
                       'padron': [('PADRON', 'padron_arca.txt')],
                       'normal': [('1DSF', '1dsf.txt')]}[kind]
        covered_months = set(months_ending(period))
        for archive_kind, member in members:
            batch = []
            with archives[archive_kind].lines(member) as lines:
                for number, line in lines:
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
                            progress(kind, rows)
                    except (FormatError, sqlite3.Error):
                        guard()
                        raise SourceError(f'Invalid {archive_kind} record at line {number}') from None
            guard()
            connection.executemany(insert, batch)
        if kind != 'corrections' and rows < min_rows:
            raise SourceError(f'{kind} import is below the minimum row count')
        manifest = {'kind': kind, 'version': version, 'period': period, 'rows': rows,
                    'source_rows': source_rows, 'imported_at': timestamp(),
                    'entity_codes': sorted(entities), 'name_encoding_replacements': replacements}
        connection.execute('INSERT INTO metadata VALUES (?)', (json.dumps(manifest),))
        connection.commit()
        guard()
        if connection.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise SourceError(f'{kind} integrity check failed')
        progress(kind, rows)
        return manifest
    except sqlite3.Error:
        guard()
        raise SourceError(f'Unable to construct {kind} component') from None
    finally:
        connection.close()
