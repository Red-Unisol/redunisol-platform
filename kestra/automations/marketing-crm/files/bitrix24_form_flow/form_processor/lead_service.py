from __future__ import annotations

from typing import Any

from .bitrix_client import BitrixClient
from .config import AppConfig
from .input_parser import NormalizedInput, normalize_business_input
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
                config.fields.lead_processing_policy: _resolve_enum_id(
                    client,
                    config.fields.lead_processing_policy,
                    config.processing_policy.skip,
                ),
                config.fields.lead_cuil: submission.cuil_digits,
                config.fields.lead_employment_status: submission.employment_status.bitrix_id,
                config.fields.lead_payment_bank: [submission.payment_bank.bitrix_id],
                config.fields.lead_province: submission.province.bitrix_id,
                config.fields.lead_source: submission.lead_source.bitrix_id,
            }
        },
    )
    return int(lead_id)


def get_lead(
    client: BitrixClient,
    lead_id: int,
    logger: Logger,
) -> dict[str, Any]:
    logger.info(f"Obteniendo lead {lead_id} para clasificacion.")
    lead = client.call("crm.lead.get", {"id": lead_id})
    if not isinstance(lead, dict):
        raise RuntimeError(f"Bitrix24 devolvio una respuesta invalida al obtener el lead {lead_id}.")
    return lead


def should_process_lead(
    client: BitrixClient,
    lead: dict[str, Any],
    config: AppConfig,
) -> bool:
    current_value = _optional_lead_value(lead, config.fields.lead_processing_policy)
    if current_value is None:
        return False

    expected_value = _resolve_enum_id(
        client,
        config.fields.lead_processing_policy,
        config.processing_policy.process,
    )
    return str(current_value) == expected_value


def build_submission_from_lead(
    lead: dict[str, Any],
    config: AppConfig,
) -> NormalizedInput:
    payload = {
        "full_name": _lead_full_name(lead),
        "email": _first_multifield_value(lead.get("EMAIL"), "EMAIL"),
        "whatsapp": _first_multifield_value(lead.get("PHONE"), "PHONE"),
        "cuil": _required_lead_value(lead, config.fields.lead_cuil),
        "province": _required_lead_value(lead, config.fields.lead_province),
        "employment_status": _required_lead_value(lead, config.fields.lead_employment_status),
        "payment_bank": _required_lead_value(lead, config.fields.lead_payment_bank),
        "lead_source": _required_lead_value(lead, config.fields.lead_source),
    }
    return normalize_business_input(payload)


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
    return _resolve_enum_id(client, field_name, rejection_label)


def _resolve_enum_id(
    client: BitrixClient,
    field_name: str,
    target_label: str,
) -> str:
    field = client.get_lead_field(field_name)
    items = field.get("items")
    if not isinstance(items, list):
        raise RuntimeError(f'El campo "{field_name}" no expone items de enumeracion.')

    for item in items:
        if str(item.get("VALUE", "")).strip().lower() == target_label.strip().lower():
            return str(item["ID"])

    raise RuntimeError(
        f'No se encontro el valor "{target_label}" en la enumeracion del campo "{field_name}".'
    )


def _lead_full_name(lead: dict[str, Any]) -> str:
    parts = [str(lead.get("NAME") or "").strip(), str(lead.get("LAST_NAME") or "").strip()]
    full_name = " ".join(part for part in parts if part)
    if full_name:
        return full_name
    return str(lead.get("TITLE") or "").strip()


def _first_multifield_value(raw_value: Any, field_name: str) -> str:
    if not isinstance(raw_value, list) or not raw_value:
        raise ValueError(f'El lead no contiene el campo requerido "{field_name}".')

    for item in raw_value:
        if isinstance(item, dict):
            value = str(item.get("VALUE") or "").strip()
            if value:
                return value

    raise ValueError(f'El lead no contiene un valor util en "{field_name}".')


def _required_lead_value(lead: dict[str, Any], field_name: str) -> Any:
    value = _optional_lead_value(lead, field_name)
    if value is None:
        raise ValueError(f'El lead no contiene el campo requerido "{field_name}".')
    return value


def _optional_lead_value(lead: dict[str, Any], field_name: str) -> Any | None:
    value = lead.get(field_name)
    if value is None:
        return None

    if isinstance(value, list):
        if not value:
            return None
        return value[0]

    if str(value).strip() == "":
        return None

    return value

