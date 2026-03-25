from __future__ import annotations

from .bitrix_client import BitrixClient
from .config import AppConfig
from .input_parser import NormalizedInput
from .logger import Logger


def upsert_contact(
    client: BitrixClient,
    config: AppConfig,
    submission: NormalizedInput,
    logger: Logger,
) -> int:
    logger.info(f"Buscando contacto por CUIL {submission.cuil_formatted}.")
    contacts = client.call(
        "crm.contact.list",
        {
            "filter": {config.fields.contact_cuil: submission.cuil_digits},
            "select": ["ID"],
        },
    )

    if not isinstance(contacts, list):
        raise RuntimeError("Bitrix24 devolvio una respuesta invalida al buscar contactos.")

    if len(contacts) > 1:
        raise RuntimeError("Se encontro mas de un contacto con el mismo CUIL.")

    fields = {
        "NAME": submission.full_name,
        "EMAIL": [{"VALUE": submission.email, "VALUE_TYPE": "WORK"}],
        "PHONE": [{"VALUE": submission.whatsapp, "VALUE_TYPE": "WORK"}],
        config.fields.contact_cuil: submission.cuil_digits,
    }

    if len(contacts) == 1:
        contact_id = int(contacts[0]["ID"])
        logger.info(f"Contacto encontrado ({contact_id}). Actualizando datos.")
        client.call("crm.contact.update", {"id": contact_id, "fields": fields})
        return contact_id

    logger.info("No se encontro contacto. Creando contacto nuevo.")
    contact_id = client.call("crm.contact.add", {"fields": fields})
    return int(contact_id)
