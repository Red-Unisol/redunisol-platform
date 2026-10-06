from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any, Iterable

import requests
import urllib3

from .contact_data import ContactObservation, observations

CORE_LOAN_TYPE = "F.Module.Cuentas.Prestamos.Prestamo"
CORE_CAJA_CORDOBA_PARENT_ID = 2756
CORE_FIELDS = (
    "ID",
    "LineaPrestamo.ID",
    "LineaPrestamo.Descripcion",
    "SocioTitular.Socio.CUIT",
    "SocioTitular.Socio.Email",
    "SocioTitular.Socio.Celular",
)

BITRIX_ENUMS = {
    "province_cordoba": "209",
    "employment_jubilado_provincial": "2565",
    "employment_pensionado": "2569",
    "bank_bancor": "437",
}
BITRIX_ENUM_LABELS = {
    "province_cordoba": "cordoba",
    "employment_jubilado_provincial": "jubilado provincial",
    "employment_pensionado": "pensionado",
    "bank_bancor": "banco de la provincia de cordoba s.a.",
}


@dataclass
class Candidate:
    cuil: str
    from_core: bool = False
    from_bitrix_jubilado: bool = False
    from_bitrix_pensionado_bancor: bool = False
    cuil_from_lead: bool = False
    cuil_from_contact: bool = False
    core_loan_ids: set[str] = field(default_factory=set)
    core_line_ids: set[str] = field(default_factory=set)
    core_line_names: set[str] = field(default_factory=set)
    bitrix_lead_ids: set[str] = field(default_factory=set)
    core_emails: set[ContactObservation] = field(default_factory=set)
    core_phones: set[ContactObservation] = field(default_factory=set)
    bitrix_lead_emails: set[ContactObservation] = field(default_factory=set)
    bitrix_lead_phones: set[ContactObservation] = field(default_factory=set)
    bitrix_contact_emails: set[ContactObservation] = field(default_factory=set)
    bitrix_contact_phones: set[ContactObservation] = field(default_factory=set)

    def merge(self, other: "Candidate") -> None:
        self.from_core = self.from_core or other.from_core
        self.from_bitrix_jubilado = (
            self.from_bitrix_jubilado or other.from_bitrix_jubilado
        )
        self.from_bitrix_pensionado_bancor = (
            self.from_bitrix_pensionado_bancor
            or other.from_bitrix_pensionado_bancor
        )
        self.cuil_from_lead = self.cuil_from_lead or other.cuil_from_lead
        self.cuil_from_contact = self.cuil_from_contact or other.cuil_from_contact
        self.core_loan_ids.update(other.core_loan_ids)
        self.core_line_ids.update(other.core_line_ids)
        self.core_line_names.update(other.core_line_names)
        self.bitrix_lead_ids.update(other.bitrix_lead_ids)
        self.core_emails.update(other.core_emails)
        self.core_phones.update(other.core_phones)
        self.bitrix_lead_emails.update(other.bitrix_lead_emails)
        self.bitrix_lead_phones.update(other.bitrix_lead_phones)
        self.bitrix_contact_emails.update(other.bitrix_contact_emails)
        self.bitrix_contact_phones.update(other.bitrix_contact_phones)


@dataclass(frozen=True)
class SourceStats:
    core_rows: int = 0
    core_without_cuil: int = 0
    bitrix_jubilado_rows: int = 0
    bitrix_pensionado_rows: int = 0
    bitrix_without_direct_cuil: int = 0
    bitrix_contact_ids_checked: int = 0
    bitrix_contacts_recovered: int = 0


def normalize_cuil(value: Any) -> str:
    values = value if isinstance(value, (list, tuple)) else [value]
    for item in values:
        digits = re.sub(r"\D+", "", str(item or ""))
        if len(digits) == 11:
            return digits
    return ""


def is_valid_cuil(cuil: str) -> bool:
    if not re.fullmatch(r"\d{11}", cuil):
        return False
    weights = (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)
    check_digit = 11 - sum(
        int(digit) * weight for digit, weight in zip(cuil[:10], weights)
    ) % 11
    if check_digit == 11:
        check_digit = 0
    elif check_digit == 10:
        check_digit = 9
    return check_digit == int(cuil[-1])


def merge_candidates(*groups: Iterable[Candidate]) -> list[Candidate]:
    merged: dict[str, Candidate] = {}
    for group in groups:
        for candidate in group:
            current = merged.setdefault(candidate.cuil, Candidate(cuil=candidate.cuil))
            current.merge(candidate)
    return sorted(merged.values(), key=lambda item: item.cuil)


class VimarxClient:
    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = 90,
        verify_tls: bool = False,
        bearer_token: str = "",
        session: requests.Session | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.verify_tls = verify_tls
        self.bearer_token = bearer_token
        self.session = session or requests.Session()
        self.session.trust_env = False
        if not verify_tls:
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    def caja_candidates(self) -> tuple[list[Candidate], int, int]:
        rows = self.evaluate_list(
            tipo=CORE_LOAN_TYPE,
            fields=CORE_FIELDS,
            criterion=f"[LineaPrestamo.Superior.ID] = {CORE_CAJA_CORDOBA_PARENT_ID}",
            max_rows=50000,
        )
        candidates: list[Candidate] = []
        missing = 0
        for row in rows:
            cuil = normalize_cuil(row.get("SocioTitular.Socio.CUIT"))
            if not cuil:
                missing += 1
                continue
            loan_id = _text(row.get("ID"))
            candidates.append(
                Candidate(
                    cuil=cuil,
                    from_core=True,
                    core_loan_ids={loan_id} - {""},
                    core_line_ids={_text(row.get("LineaPrestamo.ID"))} - {""},
                    core_line_names={_text(row.get("LineaPrestamo.Descripcion"))} - {""},
                    core_emails=observations(
                        row.get("SocioTitular.Socio.Email"),
                        "email",
                        record_id=loan_id,
                    ),
                    core_phones=observations(
                        row.get("SocioTitular.Socio.Celular"),
                        "phone",
                        record_id=loan_id,
                    ),
                )
            )
        return merge_candidates(candidates), len(rows), missing

    def evaluate_list(
        self,
        *,
        tipo: str,
        fields: tuple[str, ...],
        criterion: str,
        max_rows: int,
    ) -> list[dict[str, Any]]:
        headers = {"Content-Type": "application/json"}
        if self.bearer_token:
            headers["Authorization"] = f"Bearer {self.bearer_token}"
        response = self.session.post(
            f"{self.base_url}/api/Empresa/EvaluateList",
            json={
                "cmd": criterion,
                "tipo": tipo,
                "campos": ";".join(fields),
                "max": max_rows,
            },
            headers=headers,
            timeout=self.timeout,
            verify=self.verify_tls,
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, list):
            raise RuntimeError("Vimarx devolvio una respuesta que no es una lista.")
        return [_coerce_row(fields, row) for row in payload]


class BitrixClient:
    def __init__(
        self,
        base_url: str,
        webhook_path: str,
        *,
        lead_cuil_field: str,
        contact_cuil_field: str,
        province_field: str,
        employment_field: str,
        payment_bank_field: str,
        timeout: float = 60,
        session: requests.Session | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.webhook_path = webhook_path.strip("/")
        self.lead_cuil_field = lead_cuil_field
        self.contact_cuil_field = contact_cuil_field
        self.province_field = province_field
        self.employment_field = employment_field
        self.payment_bank_field = payment_bank_field
        self.timeout = timeout
        self.session = session or requests.Session()

    def candidates(self) -> tuple[list[Candidate], dict[str, int]]:
        self.validate_live_enums()
        jubilados = self._lead_candidates(
            {
                f"={self.province_field}": BITRIX_ENUMS["province_cordoba"],
                f"={self.employment_field}": BITRIX_ENUMS[
                    "employment_jubilado_provincial"
                ],
            },
            source="jubilado",
        )
        pensionados = self._lead_candidates(
            {
                f"={self.province_field}": BITRIX_ENUMS["province_cordoba"],
                f"={self.employment_field}": BITRIX_ENUMS["employment_pensionado"],
                f"={self.payment_bank_field}": BITRIX_ENUMS["bank_bancor"],
            },
            source="pensionado",
        )
        all_rows = jubilados + pensionados
        missing = [row for row in all_rows if not row["candidate"].cuil]
        requested_contact_count = len(
            {row["contact_id"] for row in all_rows if row["contact_id"]}
        )
        contacts = self._load_contacts(all_rows)
        recovered_cuils: set[str] = set()
        candidates: list[Candidate] = []
        for row in all_rows:
            candidate = row["candidate"]
            contact = contacts.get(row["contact_id"], {})
            if not candidate.cuil:
                candidate.cuil = normalize_cuil(contact.get(self.contact_cuil_field))
                candidate.cuil_from_contact = bool(candidate.cuil)
                if candidate.cuil:
                    recovered_cuils.add(candidate.cuil)
            if not candidate.cuil:
                continue
            contact_id = row["contact_id"]
            observed_at = _text(contact.get("DATE_MODIFY") or contact.get("DATE_CREATE"))
            candidate.bitrix_contact_emails.update(
                observations(
                    contact.get("EMAIL"),
                    "email",
                    observed_at=observed_at,
                    record_id=contact_id,
                )
            )
            candidate.bitrix_contact_phones.update(
                observations(
                    contact.get("PHONE"),
                    "phone",
                    observed_at=observed_at,
                    record_id=contact_id,
                )
            )
            candidates.append(candidate)
        stats = {
            "jubilado_rows": len(jubilados),
            "pensionado_rows": len(pensionados),
            "without_direct_cuil": len(missing),
            "contact_ids_checked": requested_contact_count,
            "contacts_recovered": len(recovered_cuils),
        }
        return merge_candidates(candidates), stats

    def validate_live_enums(self) -> None:
        fields = self.call("crm.lead.fields", {})
        checks = (
            ("province_cordoba", self.province_field),
            ("employment_jubilado_provincial", self.employment_field),
            ("employment_pensionado", self.employment_field),
            ("bank_bancor", self.payment_bank_field),
        )
        for key, field_name in checks:
            metadata = fields.get(field_name) if isinstance(fields, dict) else None
            items = metadata.get("items") if isinstance(metadata, dict) else None
            match = next(
                (
                    item
                    for item in items or []
                    if str(item.get("ID") or "") == BITRIX_ENUMS[key]
                ),
                None,
            )
            label = _normalized_label(match.get("VALUE") if match else "")
            if label != BITRIX_ENUM_LABELS[key]:
                raise RuntimeError(
                    f"El enum Bitrix {key}={BITRIX_ENUMS[key]} no coincide con su etiqueta esperada."
                )

    def _lead_candidates(
        self, filter_values: dict[str, Any], *, source: str
    ) -> list[dict[str, Any]]:
        rows = self.list_all(
            "crm.lead.list",
            {
                "order": {"ID": "ASC"},
                "filter": filter_values,
                "select": [
                    "ID",
                    "CONTACT_ID",
                    self.lead_cuil_field,
                    "EMAIL",
                    "PHONE",
                    "DATE_CREATE",
                    "DATE_MODIFY",
                ],
            },
        )
        output = []
        for row in rows:
            cuil = normalize_cuil(row.get(self.lead_cuil_field))
            lead_id = _text(row.get("ID"))
            observed_at = _text(row.get("DATE_MODIFY") or row.get("DATE_CREATE"))
            candidate = Candidate(
                cuil=cuil,
                from_bitrix_jubilado=source == "jubilado",
                from_bitrix_pensionado_bancor=source == "pensionado",
                cuil_from_lead=bool(cuil),
                bitrix_lead_ids={lead_id} - {""},
                bitrix_lead_emails=observations(
                    row.get("EMAIL"),
                    "email",
                    observed_at=observed_at,
                    record_id=lead_id,
                ),
                bitrix_lead_phones=observations(
                    row.get("PHONE"),
                    "phone",
                    observed_at=observed_at,
                    record_id=lead_id,
                ),
            )
            output.append(
                {
                    "candidate": candidate,
                    "contact_id": _text(row.get("CONTACT_ID")),
                }
            )
        return output

    def _load_contacts(
        self, lead_rows: list[dict[str, Any]]
    ) -> dict[str, dict[str, Any]]:
        contacts: dict[str, dict[str, Any]] = {}
        ids = sorted(
            {row["contact_id"] for row in lead_rows if row["contact_id"]},
            key=lambda value: (0, f"{int(value):020d}")
            if value.isdigit()
            else (1, value),
        )
        for offset in range(0, len(ids), 50):
            chunk = ids[offset : offset + 50]
            result = self.call(
                "crm.contact.list",
                {
                    "filter": {"@ID": chunk},
                    "select": [
                        "ID",
                        self.contact_cuil_field,
                        "EMAIL",
                        "PHONE",
                        "DATE_CREATE",
                        "DATE_MODIFY",
                    ],
                    "start": -1,
                },
            )
            for contact in result or []:
                contact_id = _text(contact.get("ID"))
                if contact_id:
                    contacts[contact_id] = contact
        return contacts

    def list_all(self, method: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        start = 0
        while True:
            page = dict(payload)
            page["start"] = start
            response = self.call_full(method, page)
            result = response.get("result") or []
            if not isinstance(result, list):
                raise RuntimeError(f"Bitrix devolvio una lista invalida para {method}.")
            rows.extend(item for item in result if isinstance(item, dict))
            next_start = response.get("next")
            if next_start is None:
                return rows
            start = int(next_start)

    def call(self, method: str, payload: dict[str, Any]) -> Any:
        return self.call_full(method, payload).get("result")

    def call_full(self, method: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.session.post(
            f"{self.base_url}/{self.webhook_path}/{method}.json",
            json=payload,
            timeout=self.timeout,
        )
        response.raise_for_status()
        body = response.json()
        if not isinstance(body, dict):
            raise RuntimeError(f"Bitrix devolvio una respuesta invalida para {method}.")
        if body.get("error"):
            raise RuntimeError(str(body.get("error_description") or body["error"]))
        return body


def clients_from_env() -> tuple[VimarxClient, BitrixClient]:
    vimarx = VimarxClient(
        _required_env("VIMARX_EVAL_BASE_URL"),
        timeout=float(os.getenv("VIMARX_TIMEOUT_SECONDS", "90")),
        verify_tls=_bool_env("VIMARX_VERIFY_TLS", False),
        bearer_token=os.getenv("VIMARX_BEARER_TOKEN", "").strip(),
    )
    bitrix = BitrixClient(
        _required_env("BITRIX24_BASE_URL"),
        _required_env("BITRIX24_WEBHOOK_PATH"),
        lead_cuil_field=_required_env("BITRIX24_LEAD_CUIL_FIELD"),
        contact_cuil_field=_required_env("BITRIX24_CONTACT_CUIL_FIELD"),
        province_field=_required_env("BITRIX24_LEAD_PROVINCE_FIELD"),
        employment_field=_required_env("BITRIX24_LEAD_EMPLOYMENT_STATUS_FIELD"),
        payment_bank_field=_required_env("BITRIX24_LEAD_PAYMENT_BANK_FIELD"),
        timeout=float(os.getenv("BITRIX24_TIMEOUT_SECONDS", "60")),
    )
    return vimarx, bitrix


def collect_candidates() -> tuple[list[Candidate], SourceStats]:
    vimarx, bitrix = clients_from_env()
    core, core_rows, core_missing = vimarx.caja_candidates()
    bitrix_candidates, bitrix_stats = bitrix.candidates()
    stats = SourceStats(
        core_rows=core_rows,
        core_without_cuil=core_missing,
        bitrix_jubilado_rows=bitrix_stats["jubilado_rows"],
        bitrix_pensionado_rows=bitrix_stats["pensionado_rows"],
        bitrix_without_direct_cuil=bitrix_stats["without_direct_cuil"],
        bitrix_contact_ids_checked=bitrix_stats["contact_ids_checked"],
        bitrix_contacts_recovered=bitrix_stats["contacts_recovered"],
    )
    return merge_candidates(core, bitrix_candidates), stats


def _coerce_row(fields: tuple[str, ...], row: Any) -> dict[str, Any]:
    if isinstance(row, dict):
        return row
    if isinstance(row, list):
        return dict(zip(fields, row))
    return {}


def _normalized_label(value: Any) -> str:
    text = str(value or "").strip().lower()
    return (
        text.replace("á", "a")
        .replace("é", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ú", "u")
    )


def _text(value: Any) -> str:
    return str(value or "").strip()


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(f"Falta la variable {name}.")
    return value


def _bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name, "").strip().lower()
    if not value:
        return default
    return value in {"1", "true", "yes", "si", "on"}
