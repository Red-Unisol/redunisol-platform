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
            "select": ["ID", "NAME", "LAST_NAME", "BIRTHDATE"],
        },
    )

    if not isinstance(contacts, list):
        raise RuntimeError("Bitrix24 devolvio una respuesta invalida al buscar contactos.")

    if len(contacts) > 1:
        raise RuntimeError("Se encontro mas de un contacto con el mismo CUIL.")

    common_fields = {
        "EMAIL": [{"VALUE": submission.email, "VALUE_TYPE": "WORK"}],
        "PHONE": [{"VALUE": submission.whatsapp, "VALUE_TYPE": "WORK"}],
        config.fields.contact_cuil: submission.cuil_digits,
    }

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
