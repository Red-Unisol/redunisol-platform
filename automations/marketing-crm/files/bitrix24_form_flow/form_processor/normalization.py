from __future__ import annotations

import re


def normalize_cuil(raw_value: object) -> tuple[str, str]:
    digits = re.sub(r"\D", "", str(raw_value or ""))
    if len(digits) != 11:
        raise ValueError("El CUIL debe contener 11 digitos.")
    formatted = f"{digits[:2]}-{digits[2:10]}-{digits[10:]}"
    return digits, formatted


def normalize_whatsapp(raw_value: object) -> str:
    digits = re.sub(r"\D", "", str(raw_value or ""))

    if len(digits) == 10:
        return f"+549{digits}"
    if len(digits) == 12 and digits.startswith("54"):
        return f"+{digits}"
    if len(digits) == 13 and digits.startswith("549"):
        return f"+{digits}"

    raise ValueError(
        'El campo "whatsapp" debe venir con 10 digitos locales o en formato internacional argentino.'
    )


def normalize_email(raw_value: object) -> str:
    value = str(raw_value or "").strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
        raise ValueError("El email informado no tiene un formato valido.")
    return value


def normalize_full_name(raw_value: object) -> str:
    value = " ".join(str(raw_value or "").strip().split())
    if not value:
        raise ValueError("El nombre completo es obligatorio.")
    return value
