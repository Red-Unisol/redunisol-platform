from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Any, Iterable

import requests


DEFAULT_MUDON_LINES = (
    "MUDON HABERES",
    "MUDON HABERES SOCIOS NUEVOS",
)


@dataclass
class CoreMember:
    member_key: str
    cuit: str
    dni: str
    full_name: str
    member_number: str
    loan_accounts: set[str] = field(default_factory=set)
    loan_lines: set[str] = field(default_factory=set)


def normalize_digits(value: Any) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def build_member_key(cuit: str, dni: str, member_number: str) -> str:
    if len(cuit) == 11:
        return cuit
    if dni:
        return f"dni:{dni}"
    if member_number:
        return f"socio:{member_number}"
    raise ValueError("El registro del Core no contiene CUIL, DNI ni numero de socio.")


def build_active_loan_filter(lines: Iterable[str]) -> str:
    terms = [
        f"[LineaPrestamo.Descripcion] = '{line.replace(chr(39), chr(39) * 2)}'"
        for line in lines
        if line.strip()
    ]
    if not terms:
        raise ValueError("Debe configurarse al menos una linea MUDON.")
    return f"[SaldoPrestamo] > 0.0m AND ({' OR '.join(terms)})"


def fetch_active_mudon_members(
    *,
    base_url: str,
    bearer_token: str = "",
    timeout_seconds: int = 60,
    verify_tls: bool = False,
    max_rows: int = 5000,
    lines: Iterable[str] = DEFAULT_MUDON_LINES,
) -> list[CoreMember]:
    url = f"{base_url.rstrip('/')}/api/Empresa/EvaluateList"
    headers = {"Content-Type": "application/json"}
    if bearer_token.strip():
        headers["Authorization"] = f"Bearer {bearer_token.strip()}"
    payload = {
        "cmd": build_active_loan_filter(lines),
        "tipo": "F.Module.Cuentas.Prestamos.Prestamo",
        "campos": (
            "SocioTitular.Socio.CUIT;"
            "SocioTitular.Socio.NroDoc;"
            "SocioTitular.Socio.NombreCompleto;"
            "SocioTitular.Socio.NroSocio;"
            "NroCuenta;SaldoPrestamo;LineaPrestamo.Descripcion"
        ),
        "max": max_rows,
    }
    session = requests.Session()
    session.trust_env = False
    response = session.post(
        url,
        json=payload,
        headers=headers,
        timeout=timeout_seconds,
        verify=verify_tls,
    )
    response.raise_for_status()
    rows = response.json()
    if not isinstance(rows, list):
        raise RuntimeError("EvaluateList devolvio una respuesta que no es una lista.")
    if len(rows) >= max_rows:
        raise RuntimeError(
            f"La consulta MUDON alcanzo el limite de {max_rows} prestamos; "
            "no se puede garantizar un universo completo."
        )

    members: dict[str, CoreMember] = {}
    for row in rows:
        if not isinstance(row, list):
            continue
        values = ["" if value is None else str(value).strip() for value in row]
        values.extend([""] * max(0, 7 - len(values)))
        cuit = normalize_digits(values[0])
        dni = normalize_digits(values[1])
        full_name = values[2]
        member_number = values[3]
        try:
            member_key = build_member_key(cuit, dni, member_number)
        except ValueError:
            continue
        member = members.get(member_key)
        if member is None:
            member = CoreMember(
                member_key=member_key,
                cuit=cuit,
                dni=dni,
                full_name=full_name,
                member_number=member_number,
            )
            members[member_key] = member
        else:
            member.cuit = member.cuit or cuit
            member.dni = member.dni or dni
            member.full_name = member.full_name or full_name
            member.member_number = member.member_number or member_number
        if values[4]:
            member.loan_accounts.add(values[4])
        if values[6]:
            member.loan_lines.add(values[6])

    return sorted(
        members.values(),
        key=lambda item: (
            int(item.member_number) if item.member_number.isdigit() else 10**18,
            item.full_name,
        ),
    )
