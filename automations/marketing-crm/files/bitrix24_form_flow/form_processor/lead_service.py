from __future__ import annotations

from .bitrix_client import BitrixClient
from .config import AppConfig
from .input_parser import NormalizedInput
from .logger import Logger


def create_lead(
    client: BitrixClient,
    config: AppConfig,
    submission: NormalizedInput,
    contact_id: int,
    logger: Logger,
) -> int:
    logger.info(f"Creando lead para el contacto {contact_id}.")
    lead_id = client.call(
        "crm.lead.add",
        {
            "fields": {
                "TITLE": submission.full_name,
                "NAME": submission.full_name,
                "EMAIL": [{"VALUE": submission.email, "VALUE_TYPE": "WORK"}],
                "PHONE": [{"VALUE": submission.whatsapp, "VALUE_TYPE": "WORK"}],
                "CONTACT_ID": contact_id,
                config.fields.lead_cuil: submission.cuil_digits,
                config.fields.lead_employment_status: submission.employment_status.bitrix_id,
                config.fields.lead_payment_bank: [submission.payment_bank.bitrix_id],
                config.fields.lead_province: submission.province.bitrix_id,
                config.fields.lead_source: submission.lead_source.bitrix_id,
            }
        },
    )
    return int(lead_id)


def update_lead_status(
    client: BitrixClient,
    config: AppConfig,
    lead_id: int,
    qualified: bool,
    rejection_reason: str | None,
    logger: Logger,
) -> str:
    status_id = config.lead_statuses.qualified if qualified else config.lead_statuses.rejected
    logger.info(f"Actualizando estado del lead {lead_id} a {status_id}.")
    fields = {"STATUS_ID": status_id}
    if not qualified and rejection_reason:
        fields[config.fields.lead_rejection_reason] = _resolve_rejection_reason_enum_id(
            client,
            config.fields.lead_rejection_reason,
            rejection_reason,
        )
    client.call("crm.lead.update", {"id": lead_id, "fields": fields})
    return status_id


def _resolve_rejection_reason_enum_id(
    client: BitrixClient,
    field_name: str,
    rejection_label: str,
) -> str:
    field = client.get_lead_field(field_name)
    items = field.get("items")
    if not isinstance(items, list):
        raise RuntimeError(f'El campo "{field_name}" no expone items de enumeracion.')

    for item in items:
        if str(item.get("VALUE", "")).strip().lower() == rejection_label.strip().lower():
            return str(item["ID"])

    raise RuntimeError(
        f'No se encontro el valor "{rejection_label}" en la enumeracion del campo "{field_name}".'
    )
