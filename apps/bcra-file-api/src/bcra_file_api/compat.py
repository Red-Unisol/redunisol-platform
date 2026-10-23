"""BCRA-compatible bodies; file provenance remains in HTTP headers and /status."""
from __future__ import annotations

import calendar
from contextlib import closing
from pathlib import Path
import sqlite3

from .bundle import inside
from .extended_formats import decode_history, months_ending
from .formats import FormatError
from .source import SourceError
from .store import connect_readonly, lookup

CURRENT_FIELDS = ('entidad', 'situacion', 'fechaSit1', 'monto', 'diasAtrasoPago',
                  'refinanciaciones', 'recategorizacionOblig', 'situacionJuridica',
                  'irrecDisposicionTecnica', 'enRevision', 'procesoJud')
NOT_FOUND = {'status': 404, 'errorMessages': ['No se encontró datos para la identificación ingresada.']}
INVALID_ID = {'status': 400, 'errorMessages': ['Parámetro erróneo: Ingresar 11 dígitos para realizar la consulta.']}


def _component(root: Path, bundle: dict, kind: str) -> Path:
    return inside(root, bundle['components'][kind]['path'])


def _name(root: Path, bundle: dict | None, identification: str, fallback):
    if bundle:
        with closing(connect_readonly(_component(root, bundle, 'padron'))) as connection:
            row = connection.execute('SELECT name FROM names WHERE identification=?', (identification,)).fetchone()
        if row:
            return row[0]
    return fallback


def _normal_date(root: Path, bundle: dict | None, identification: str):
    if not bundle:
        return None
    with closing(connect_readonly(_component(root, bundle, 'normal'))) as connection:
        row = connection.execute('SELECT since FROM normal_since WHERE identification=?', (identification,)).fetchone()
    if row is None:
        return None
    year, month = int(row[0][:4]), int(row[0][4:])
    # The source has month precision. The official API was compared for multiple
    # months including February: day 30, capped by the month's last calendar day.
    return f'{year:04d}-{month:02d}-{min(30, calendar.monthrange(year, month)[1]):02d}'


def current_response(root: Path, current: Path, bundle: dict | None, identification: str) -> dict:
    raw = lookup(current, identification)
    if raw['status'] == 404:
        return dict(NOT_FOUND)
    periods = {}
    seen = set()
    chosen = []
    # The current contract is the latest information per entity. A previous
    # month for that same entity must not count as another current debt.
    for period in raw['results']['periodos']:
        for entity in period['entidades']:
            code = entity['codigoEntidad']
            if code in seen:
                continue
            seen.add(code)
            chosen.append(entity)
            periods.setdefault(period['periodo'], []).append(entity)
    normal = _normal_date(root, bundle, identification) if all(entity['situacion'] == 1 for entity in chosen) else None
    formatted = []
    for period, entities in periods.items():
        rows = []
        for entity in entities:
            value = {key: entity[key] for key in CURRENT_FIELDS}
            value['fechaSit1'] = normal
            rows.append(value)
        formatted.append({'periodo': period, 'entidades': rows})
    return {'status': 200, 'results': {'identificacion': int(identification),
            'denominacion': _name(root, bundle, identification, raw['results']['denominacion']),
            'periodos': formatted}}


def historical_response(root: Path, current: Path, bundle: dict, identification: str) -> dict:
    with closing(connect_readonly(_component(root, bundle, 'history'))) as connection:
        rows = connection.execute('SELECT entity,data FROM history WHERE identification=? ORDER BY entity',
                                  (identification,)).fetchall()
    values = {code: decode_history(data) for code, data in rows}
    periods = months_ending(bundle['period'])
    positions = {period: index for index, period in enumerate(periods)}
    with closing(connect_readonly(_component(root, bundle, 'corrections'))) as connection:
        changes = connection.execute(
            'SELECT entity,period,situation,amount_tenths FROM corrections WHERE identification=?',
            (identification,)).fetchall()
    for code, period, situation, amount in changes:
        if period not in positions:
            continue
        values.setdefault(code, [None] * 24)[positions[period]] = (
            None if situation == 0 and amount == 0 else (situation, amount, 255))
    with closing(connect_readonly(current)) as connection:
        names = dict(connection.execute('SELECT code,name FROM entities'))
        fallback = connection.execute('SELECT name FROM names WHERE identification=?', (identification,)).fetchone()
    result = []
    for index, period in enumerate(periods):
        entities = []
        for code, cells in sorted(values.items()):
            cell = cells[index]
            if cell is None:
                continue
            if code not in names:
                raise SourceError('Historical entity master is incomplete')
            situation, amount, observation = cell
            entities.append({'entidad': names[code], 'situacion': situation, 'monto': amount / 10,
                             'enRevision': None if observation not in (0, 1, 2) else observation == 2,
                             'procesoJud': None if observation not in (0, 1, 2) else observation == 1})
        if entities:
            result.append({'periodo': period, 'entidades': entities})
    if not result:
        return dict(NOT_FOUND)
    return {'status': 200, 'results': {'identificacion': int(identification),
            'denominacion': _name(root, bundle, identification, fallback[0] if fallback else None),
            'periodos': result}}


def compatible_response(root: Path, current: Path, bundle: dict | None,
                        identification: str, historical: bool = False) -> dict:
    try:
        if historical:
            if bundle is None:
                return {'status': 503, 'errorMessages': ['El histórico completo todavía no está disponible.']}
            return historical_response(root, current, bundle, identification)
        return current_response(root, current, bundle, identification)
    except (sqlite3.Error, FormatError, OSError):
        raise SourceError('Unable to read a validated BCRA publication') from None
