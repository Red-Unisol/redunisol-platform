"""Streaming parsers for the monthly normal-since and 24-month publications."""
from __future__ import annotations

from datetime import datetime
import struct
import zlib

from .formats import FormatError, integer, money, split_record

HISTORY_WIDTHS = [5, 2, 11] + [2, 12, 1] * 24
CELL = struct.Struct('>BQB')
EMPTY = (255, 0, 255)
PADRON_WIDTHS = [11, 160, 6, 1, 11, 10, 1, 10, 2, 8]


def valid_month(value: str) -> str:
    if len(value) != 6 or not value.isascii() or not value.isdigit():
        raise FormatError('Invalid publication month')
    try:
        datetime.strptime(value, '%Y%m')
    except ValueError:
        raise FormatError('Invalid publication month') from None
    return value


def months_ending(period: str) -> list[str]:
    valid_month(period)
    year, month = int(period[:4]), int(period[4:])
    result = []
    for _ in range(24):
        result.append(f'{year:04d}{month:02d}')
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    return result


def fiscal_identity(kind: str, identification: str) -> str | None:
    if integer(kind) != 11:
        return None
    if len(identification) != 11 or integer(identification) is None:
        raise FormatError('Invalid fiscal identification')
    return identification


def normal_since_record(line: str, publication: str) -> tuple[str, str] | None:
    fields, _ = split_record(line, [2, 11, 6])
    identification = fiscal_identity(fields[0], fields[1])
    if identification is None:
        return None
    since = valid_month(fields[2])
    if since > publication:
        raise FormatError('Normal-since date exceeds publication')
    return identification, since


def name_record(line: str) -> tuple[str, str] | None:
    fields, _ = split_record(line, PADRON_WIDTHS)
    identification, name = fields[:2]
    if len(identification) != 11 or integer(identification) is None:
        raise FormatError('Invalid name identification')
    if fields[3] not in ('', '*'):
        raise FormatError('Unknown name deactivation marker')
    # A replaced identity must not silently acquire its replacement's name.
    # Keep the original identification and denomination exactly as published.
    if not name:
        return None
    return identification, name


def history_record(line: str) -> tuple[str, str, bytes] | None:
    fields, implicit = split_record(line, HISTORY_WIDTHS)
    identification = fiscal_identity(fields[1], fields[2])
    if identification is None:
        return None
    code = fields[0]
    if not code or len(code) > 5 or integer(code) is None:
        raise FormatError('Invalid history entity')
    packed = bytearray(CELL.size * 24)
    for index in range(24):
        position = 3 + index * 3
        situation = integer(fields[position], blank=0)
        observation = integer(fields[position + 2], blank=0)
        raw_amount = fields[position + 1]
        amount = (int(raw_amount) if implicit and raw_amount.isascii() and raw_amount.isdigit()
                  else money(raw_amount, implicit))
        if not 0 <= situation <= 99 or not 0 <= observation <= 9:
            raise FormatError('Invalid history situation or observation')
        cell = EMPTY if situation == 0 and amount == 0 and observation == 0 else (situation, amount, observation)
        CELL.pack_into(packed, index * CELL.size, *cell)
    return identification, code.zfill(5), zlib.compress(packed, level=1)


def decode_history(value: bytes) -> list[tuple[int, int, int] | None]:
    try:
        decoder = zlib.decompressobj()
        packed = decoder.decompress(value, CELL.size * 24 + 1)
        if len(packed) != CELL.size * 24 or not decoder.eof or decoder.unused_data:
            raise ValueError
        return [None if cell == EMPTY else cell for cell in CELL.iter_unpack(packed)]
    except (zlib.error, ValueError, struct.error):
        raise FormatError('Invalid stored history record') from None


def encode_history(cells: list[tuple[int, int, int] | None]) -> bytes:
    if len(cells) != 24:
        raise FormatError('Expected 24 historical months')
    return zlib.compress(b''.join(CELL.pack(*(cell if cell is not None else EMPTY)) for cell in cells), level=1)
