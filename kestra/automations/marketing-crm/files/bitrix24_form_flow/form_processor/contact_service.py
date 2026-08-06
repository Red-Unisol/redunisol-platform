from __future__ import annotations

from dataclasses import dataclass

from .bitrix_client import BitrixClient
from .config import AppConfig
from .input_parser import NormalizedInput
from .logger import Logger
from .normalization import normalize_birthdate


@dataclass(frozen=True)
class ContactUpsertResult:
    contact_id: int
    effective_full_name: str
    effective_birthdate: str
    birthdate_updated: bool


def upsert_contact(
    client: BitrixClient,
    config: AppConfig,
    submission: NormalizedInput,
    logger: Logger,
    *,
    birthdate: str | None = None,
) -> ContactUpsertResult:
    logger.info(f"Buscando contacto por CUIL {submission.cuil_formatted}.")
    contacts = client.call(
        "crm.contact.list",
        {
            "filter": {config.fields.contact_cuil: submission.cuil_digits},
            "select": [
                "ID",
                "NAME",
                "LAST_NAME",
                "BIRTHDATE",
                "EMAIL",
                "PHONE",
                "COMMENTS",
                config.fields.contact_cuil,
            ],
        },
    )

    if not isinstance(contacts, list):
        raise RuntimeError(
            "Bitrix24 devolvio una respuesta invalida al buscar contactos."
        )

    common_fields = {
        "EMAIL": [{"VALUE": submission.email, "VALUE_TYPE": "WORK"}],
        "PHONE": [{"VALUE": submission.whatsapp, "VALUE_TYPE": "WORK"}],
        config.fields.contact_cuil: submission.cuil_digits,
    }

    if len(contacts) > 1:
        master_contact = _select_master_contact(contacts)
        contact_id = int(master_contact["ID"])
        existing_birthdate = normalize_birthdate(master_contact.get("BIRTHDATE"))
        effective_birthdate = existing_birthdate or (birthdate or "")
        birthdate_updated = bool(birthdate and not existing_birthdate)

        effective_full_name, alternative_names = _choose_canonical_full_name(
            contacts,
            master_contact,
            submission.full_name,
            submission.full_name_inferred,
        )

        fields = dict(common_fields)
        fields["EMAIL"] = _merge_multifields(contacts, common_fields["EMAIL"], "EMAIL")
        fields["PHONE"] = _merge_multifields(contacts, common_fields["PHONE"], "PHONE")

        if effective_full_name:
            fields["NAME"] = effective_full_name
            fields["LAST_NAME"] = ""

        if birthdate_updated:
            fields["BIRTHDATE"] = birthdate

        merged_comments = _merge_comments(
            master_contact.get("COMMENTS"), alternative_names
        )
        if merged_comments:
            fields["COMMENTS"] = merged_comments

        logger.info(
            f"Se encontraron {len(contacts)} contactos con el mismo CUIL. "
            f"Se usara el maestro {contact_id}."
        )
        client.call("crm.contact.update", {"id": contact_id, "fields": fields})
        return ContactUpsertResult(
            contact_id=contact_id,
            effective_full_name=effective_full_name or submission.full_name,
            effective_birthdate=effective_birthdate,
            birthdate_updated=birthdate_updated,
        )

    if len(contacts) == 1:
        existing_contact = contacts[0]
        contact_id = int(contacts[0]["ID"])
        existing_full_name = _contact_full_name(existing_contact)
        existing_birthdate = normalize_birthdate(existing_contact.get("BIRTHDATE"))
        effective_full_name = (
            existing_full_name
            if submission.full_name_inferred and existing_full_name
            else submission.full_name
        )
        effective_birthdate = existing_birthdate or (birthdate or "")
        birthdate_updated = bool(birthdate and not existing_birthdate)
        fields = dict(common_fields)
        if effective_full_name == submission.full_name:
            fields["NAME"] = submission.full_name
            fields["LAST_NAME"] = ""
        if birthdate_updated:
            fields["BIRTHDATE"] = birthdate

        logger.info(f"Contacto encontrado ({contact_id}). Actualizando datos.")
        client.call("crm.contact.update", {"id": contact_id, "fields": fields})
        return ContactUpsertResult(
            contact_id=contact_id,
            effective_full_name=effective_full_name,
            effective_birthdate=effective_birthdate,
            birthdate_updated=birthdate_updated,
        )

    logger.info("No se encontro contacto. Creando contacto nuevo.")
    fields = {"NAME": submission.full_name, **common_fields}
    if birthdate:
        fields["BIRTHDATE"] = birthdate
    contact_id = client.call("crm.contact.add", {"fields": fields})
    return ContactUpsertResult(
        contact_id=int(contact_id),
        effective_full_name=submission.full_name,
        effective_birthdate=birthdate or "",
        birthdate_updated=bool(birthdate),
    )


def _contact_full_name(contact: dict[str, object]) -> str:
    parts = [
        str(contact.get("NAME") or "").strip(),
        str(contact.get("LAST_NAME") or "").strip(),
    ]
    return " ".join(part for part in parts if part)


def _select_master_contact(contacts: list[dict[str, object]]) -> dict[str, object]:
    return min(contacts, key=lambda contact: int(contact["ID"]))


def _choose_canonical_full_name(
    contacts: list[dict[str, object]],
    master_contact: dict[str, object],
    submitted_full_name: str,
    submitted_full_name_inferred: bool,
) -> tuple[str, list[str]]:
    names: list[str] = []

    master_full_name = _contact_full_name(master_contact)
    if master_full_name:
        names.append(master_full_name)

    for contact in contacts:
        full_name = _contact_full_name(contact)
        if full_name and full_name not in names:
            names.append(full_name)

    submitted = submitted_full_name.strip()
    if submitted and submitted not in names:
        names.append(submitted)

    if submitted_full_name_inferred and master_full_name:
        canonical = master_full_name
    else:
        canonical = _best_full_name(names) or submitted

    alternatives = [name for name in names if name and name != canonical]
    return canonical, alternatives


def _best_full_name(names: list[str]) -> str:
    if not names:
        return ""
    return max(names, key=lambda name: (len(name.split()), len(name)))


def _merge_multifields(
    contacts: list[dict[str, object]],
    incoming: list[dict[str, str]],
    field_name: str,
) -> list[dict[str, str]]:
    merged: list[dict[str, str]] = []
    seen: set[str] = set()

    for contact in sorted(contacts, key=lambda item: int(item["ID"])):
        values = contact.get(field_name)
        if not isinstance(values, list):
            continue
        for item in values:
            if isinstance(item, dict):
                _append_multifield_value(merged, seen, item, field_name)

    for item in incoming:
        _append_multifield_value(merged, seen, item, field_name)

    return merged


def _append_multifield_value(
    merged: list[dict[str, str]],
    seen: set[str],
    item: dict[str, object],
    field_name: str,
) -> None:
    raw_value = str(item.get("VALUE") or "").strip()
    if not raw_value:
        return

    key = _normalize_multifield_key(raw_value, field_name)
    if not key or key in seen:
        return

    seen.add(key)
    merged.append(
        {
            "VALUE": raw_value.lower() if field_name == "EMAIL" else raw_value,
            "VALUE_TYPE": str(item.get("VALUE_TYPE") or "WORK"),
        }
    )


def _normalize_multifield_key(value: str, field_name: str) -> str:
    if field_name == "EMAIL":
        return value.strip().lower()
    if field_name == "PHONE":
        return "".join(ch for ch in value if ch.isdigit())
    return value.strip()


def _merge_comments(existing_comments: object, alternative_names: list[str]) -> str:
    existing = str(existing_comments or "").strip()
    if not alternative_names:
        return existing

    note = "Nombres alternativos detectados por CUIL duplicado: " + " | ".join(
        alternative_names
    )
    if not existing:
        return note
    if note in existing:
        return existing
    return f"{existing}\n{note}"
