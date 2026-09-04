from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Any, Iterable, Literal

ContactKind = Literal["email", "phone"]


@dataclass(frozen=True)
class ContactObservation:
    value: str
    normalized: str
    observed_at: str = ""
    record_id: str = ""


@dataclass(frozen=True)
class PreferredContact:
    value: str = ""
    criterion: str = "sin_dato"


def observations(
    raw: Any,
    kind: ContactKind,
    *,
    observed_at: str = "",
    record_id: str = "",
) -> set[ContactObservation]:
    values = raw if isinstance(raw, (list, tuple)) else [raw]
    output: set[ContactObservation] = set()
    for item in values:
        value = item.get("VALUE") if isinstance(item, dict) else item
        text = str(value or "").strip()
        normalized = normalize_contact(text, kind)
        if text and normalized:
            output.add(
                ContactObservation(
                    value=text,
                    normalized=normalized,
                    observed_at=str(observed_at or ""),
                    record_id=str(record_id or ""),
                )
            )
    return output


def normalize_contact(value: str, kind: ContactKind) -> str:
    if kind == "email":
        return value.strip().lower()
    digits = "".join(character for character in value if character.isdigit())
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("54"):
        digits = digits[2:]
        if digits.startswith("9"):
            digits = digits[1:]
    digits = digits.lstrip("0")
    return digits[-10:] if len(digits) > 10 else digits


def display_values(items: Iterable[ContactObservation]) -> str:
    values = sorted({item.value.strip() for item in items if item.value.strip()})
    return "; ".join(values)


def choose_preferred(
    *,
    cuil: str,
    kind: ContactKind,
    core: set[ContactObservation],
    leads: set[ContactObservation],
    contacts: set[ContactObservation],
) -> PreferredContact:
    valid_core = _valid_groups(cuil, kind, core)
    valid_leads = _valid_groups(cuil, kind, leads)
    valid_contacts = _valid_groups(cuil, kind, contacts)

    shared = set(valid_core) & set(valid_leads)
    if shared:
        normalized = _best_lead_value(shared, valid_leads)
        return PreferredContact(
            _presentation(normalized, valid_leads), "coincide_core_lead"
        )

    if valid_leads:
        record_counts = {
            normalized: len({item.record_id or item.value for item in items})
            for normalized, items in valid_leads.items()
        }
        most_repeated = max(record_counts.values())
        if most_repeated > 1:
            repeated = {
                normalized
                for normalized, count in record_counts.items()
                if count == most_repeated
            }
            normalized = _best_lead_value(repeated, valid_leads)
            return PreferredContact(
                _presentation(normalized, valid_leads), "repetido_en_leads"
            )
        normalized = _best_lead_value(set(valid_leads), valid_leads)
        return PreferredContact(
            _presentation(normalized, valid_leads), "lead_mas_reciente"
        )

    if valid_core:
        normalized = sorted(valid_core)[0]
        return PreferredContact(_presentation(normalized, valid_core), "core")

    if valid_contacts:
        normalized = max(
            valid_contacts,
            key=lambda value: (_latest(valid_contacts[value]), value),
        )
        return PreferredContact(
            _presentation(normalized, valid_contacts), "contacto_bitrix"
        )
    return PreferredContact()


def _valid_groups(
    cuil: str,
    kind: ContactKind,
    items: Iterable[ContactObservation],
) -> dict[str, list[ContactObservation]]:
    grouped: dict[str, list[ContactObservation]] = {}
    for item in items:
        if not _is_usable(cuil, kind, item):
            continue
        grouped.setdefault(item.normalized, []).append(item)
    return grouped


def _is_usable(cuil: str, kind: ContactKind, item: ContactObservation) -> bool:
    if kind == "email":
        return bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", item.normalized))
    digits = "".join(character for character in item.value if character.isdigit())
    if len(digits) < 8 or len(digits) > 15:
        return False
    if digits == cuil:
        return False
    return not (
        len(digits) == 11
        and digits[:2] in {"20", "23", "24", "27", "30", "33", "34"}
        and _valid_tax_id(digits)
    )


def _best_lead_value(
    candidates: set[str], groups: dict[str, list[ContactObservation]]
) -> str:
    counts = Counter(
        {
            normalized: len({item.record_id or item.value for item in groups[normalized]})
            for normalized in candidates
        }
    )
    return max(
        candidates,
        key=lambda value: (counts[value], _latest(groups[value]), value),
    )


def _latest(items: Iterable[ContactObservation]) -> str:
    return max((item.observed_at for item in items), default="")


def _presentation(
    normalized: str, groups: dict[str, list[ContactObservation]]
) -> str:
    return max(
        groups[normalized],
        key=lambda item: (item.observed_at, len(item.value), item.value),
    ).value


def _valid_tax_id(value: str) -> bool:
    weights = (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)
    check_digit = 11 - sum(
        int(digit) * weight for digit, weight in zip(value[:10], weights)
    ) % 11
    if check_digit == 11:
        check_digit = 0
    elif check_digit == 10:
        check_digit = 9
    return check_digit == int(value[-1])
