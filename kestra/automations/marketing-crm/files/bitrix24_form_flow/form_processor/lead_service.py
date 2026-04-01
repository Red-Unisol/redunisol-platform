from __future__ import annotations

from typing import Any

from .catalogs import BANCOS, PROVINCIAS, SITUACIONES_LABORALES, CatalogItem, slugify
from .bitrix_client import BitrixClient
from .config import AppConfig
from .input_parser import NormalizedInput
from .logger import Logger
from .normalization import normalize_cuil, normalize_email, normalize_full_name, normalize_whatsapp


def create_lead(
    client: BitrixClient,
    config: AppConfig,
    submission: NormalizedInput,
    contact_id: int,
    logger: Logger,
) -> int:
    if submission.lead_source is None:
        raise ValueError("El lead_source es obligatorio para crear leads desde el formulario.")

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
                config.fields.lead_dni: _derive_dni_from_cuil(submission.cuil_digits),
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
    client: BitrixClient,
    lead: dict[str, Any],
    config: AppConfig,
) -> NormalizedInput:
    cuil_digits, cuil_formatted = normalize_cuil(_required_lead_value(lead, config.fields.lead_cuil))
    return NormalizedInput(
        full_name=normalize_full_name(_lead_full_name(lead)),
        email=normalize_email(_first_multifield_value(lead.get("EMAIL"), "EMAIL")),
        whatsapp=normalize_whatsapp(_first_multifield_value(lead.get("PHONE"), "PHONE")),
        cuil_digits=cuil_digits,
        cuil_formatted=cuil_formatted,
        province=PROVINCIAS.resolve(
            _required_lead_value(lead, config.fields.lead_province),
            "province",
        ),
        employment_status=resolve_employment_status(
            client,
            config.fields.lead_employment_status,
            _required_lead_value(lead, config.fields.lead_employment_status),
        ),
        payment_bank=BANCOS.resolve(
            _required_lead_value(lead, config.fields.lead_payment_bank),
            "payment_bank",
        ),
        lead_source=None,
    )


def update_lead_status(
    client: BitrixClient,
    config: AppConfig,
    lead_id: int,
    qualified: bool,
    rejection_reason: str | None,
    member_status_label: str | None,
    logger: Logger,
) -> str:
    status_id = config.lead_statuses.qualified if qualified else config.lead_statuses.rejected
    logger.info(f"Actualizando estado del lead {lead_id} a {status_id}.")
    fields = {"STATUS_ID": status_id}
    if member_status_label:
        fields[config.fields.lead_member_status] = _resolve_enum_id(
            client,
            config.fields.lead_member_status,
            member_status_label,
        )
    if not qualified and rejection_reason:
        try:
            fields[config.fields.lead_rejection_reason] = _resolve_rejection_reason_enum_id(
                client,
                config.fields.lead_rejection_reason,
                rejection_reason,
            )
        except RuntimeError:
            logger.info(
                f'No se encontro el motivo de rechazo "{rejection_reason}" en Bitrix; se actualiza solo el estado.'
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


def _derive_dni_from_cuil(cuil_digits: str) -> str:
    digits = "".join(ch for ch in str(cuil_digits or "") if ch.isdigit())
    if len(digits) != 11:
        raise ValueError("No se puede derivar el DNI: el CUIL debe contener 11 digitos.")

    dni = digits[2:10].lstrip("0")
    return dni or "0"


def resolve_employment_status(
    client: BitrixClient,
    field_name: str,
    raw_value: Any,
) -> CatalogItem:
    try:
        return SITUACIONES_LABORALES.resolve(raw_value, "employment_status")
    except ValueError:
        pass

    item = _find_field_enum_item(client, field_name, raw_value)
    if item is None:
        raise ValueError(f'El campo "employment_status" tiene un valor no soportado: "{raw_value}".')

    label = str(item.get("VALUE") or "").strip()
    if not label:
        raise ValueError(f'El campo "employment_status" tiene un valor no soportado: "{raw_value}".')

    try:
        return SITUACIONES_LABORALES.resolve(label, "employment_status")
    except ValueError:
        return CatalogItem(
            key=slugify(label),
            label=label,
            bitrix_id=str(item.get("ID") or raw_value),
        )


def _find_field_enum_item(
    client: BitrixClient,
    field_name: str,
    raw_value: Any,
) -> dict[str, Any] | None:
    field = client.get_lead_field(field_name)
    items = field.get("items")
    if not isinstance(items, list):
        return None

    raw_text = str(raw_value).strip()
    for item in items:
        if str(item.get("ID") or "").strip() == raw_text:
            return item
        if str(item.get("VALUE") or "").strip().lower() == raw_text.lower():
            return item
    return None

