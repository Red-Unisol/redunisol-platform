from __future__ import annotations

import datetime as dt
import re


def normalize_cuil(raw_value: object) -> tuple[str, str]:
    digits = re.sub(r"\D", "", str(raw_value or ""))
    if len(digits) != 11:
        raise ValueError("El CUIL debe contener 11 digitos.")
    formatted = f"{digits[:2]}-{digits[2:10]}-{digits[10:]}"
    return digits, formatted


def normalize_whatsapp(raw_value: object) -> str:
    digits = re.sub(r"\D", "", str(raw_value or ""))

    if digits.startswith("00"):
        digits = digits[2:]

    if len(digits) == 13 and digits.startswith("549"):
        local_digits = digits[3:]
    elif len(digits) == 12 and digits.startswith("54"):
        local_digits = digits[2:]
    elif len(digits) == 10:
        local_digits = digits
    else:
        local_digits = ""

    if (
        len(local_digits) == 10
        and local_digits[0] != "0"
        and len(set(local_digits)) > 1
    ):
        return f"+549{local_digits}"

    raise ValueError(
        'El campo "whatsapp" debe contener un celular argentino valido de 10 digitos, con o sin +54 9.'
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


def normalize_birthdate(raw_value: object) -> str:
    text = str(raw_value or "").strip()
    if not text:
        return ""
    for candidate in (text, text[:10]):
        try:
            return dt.datetime.fromisoformat(candidate).date().isoformat()
        except ValueError:
            pass
    return ""
