"""Public dissemination layouts: t-ceninf, sections 4.1.1.1 and 4.1.1.2.

Amounts are stored as integer tenths of thousands of pesos. Explicit decimal
comma/dot and the layout's implicit final decimal are accepted for fixed width.
Semicolon-delimited records use explicit amounts (no implicit decimal).
"""
from __future__ import annotations

import csv
from decimal import Decimal, InvalidOperation


class FormatError(ValueError):
    pass


BASE_WIDTHS = [5, 6, 2, 11, 3, 2] + [12] * 11 + [1] * 6 + [4]
RECT_WIDTHS = [5, 6, 2, 11, 55, 2, 12]


def split_record(line: str, widths: list[int]) -> tuple[list[str], bool]:
    line = line.rstrip("\r\n")
    if ";" in line:
        fields = next(csv.reader([line], delimiter=";"))
        if len(fields) != len(widths):
            raise FormatError("Unexpected field count")
        return [part.strip() for part in fields], False
    if len(line) != sum(widths):
        raise FormatError("Unexpected fixed record length")
    fields = []
    offset = 0
    for width in widths:
        fields.append(line[offset:offset + width].strip())
        offset += width
    return fields, True


def integer(value: str, *, blank: int | None = None) -> int | None:
    if not value:
        return blank
    if not value.isascii() or not value.isdigit():
        raise FormatError("Invalid numeric field")
    return int(value)


def money(value: str, implicit: bool) -> int:
    if not value:
        return 0
    try:
        amount = Decimal(value.replace(",", "."))
    except InvalidOperation:
        raise FormatError("Invalid amount") from None
    if not amount.is_finite() or amount < 0:
        raise FormatError("Invalid amount")
    if implicit and "." not in value and "," not in value:
        tenths = amount
    else:
        tenths = amount * 10
    if tenths != tenths.to_integral_value():
        raise FormatError("Amount has more than one decimal")
    return int(tenths)


def identity(fields: list[str]) -> tuple[str, str, str] | None:
    entity, period, kind, identification = fields[:4]
    if integer(entity) is None or len(entity) > 5:
        raise FormatError("Invalid entity")
    if len(period) != 6 or integer(period) is None or not 1 <= int(period[4:]) <= 12:
        raise FormatError("Invalid period")
    if integer(kind) != 11:
        return None
    if len(identification) != 11 or integer(identification) is None:
        raise FormatError("Invalid fiscal identification")
    return identification, entity.zfill(5), period


def base_record(line: str) -> tuple | None:
    fields, implicit = split_record(line, BASE_WIDTHS)
    key = identity(fields)
    if key is None:
        return None
    situation = integer(fields[5])
    if situation is None or situation > 99:
        raise FormatError("Invalid situation")
    flags = [integer(fields[index]) for index in range(18, 23)]
    if (flags[0] not in (None, 0, 1, 2)
            or any(value not in (None, 0, 1) for value in flags[1:])):
        raise FormatError("Invalid observation")
    # Financiaciones y Otros conceptos: loans + guarantees + other concepts.
    amount = sum(money(fields[index], implicit) for index in (6, 8, 9))
    days = integer(fields[23])
    return (*key, situation, amount, days, *flags, "DEUDORES")


def rect_record(line: str) -> tuple | None:
    fields, implicit = split_record(line, RECT_WIDTHS)
    key = identity(fields)
    if key is None:
        return None
    situation = integer(fields[5])
    if situation is None or situation > 99:
        raise FormatError("Invalid rectification situation")
    return (*key, situation, money(fields[6], implicit), fields[4])
