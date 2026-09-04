from __future__ import annotations

from typing import Any

from .bcra_client import BcraConsultationResult
from .bitrix_client import BitrixClient
from .catalogs import ORIGENES_LEAD
from .config import AppConfig
from .input_parser import (
    NormalizedInput,
    PrequalificationInput,
    RoutingInput,
    normalize_business_input,
    normalize_prequalification_input,
    normalize_routing_input,
)
from .logger import Logger
from .normalization import normalize_birthdate
from .receipt_file import build_bitrix_file_data


def create_lead(
    client: BitrixClient,
    config: AppConfig,
    submission: NormalizedInput,
    contact_id: int,
    logger: Logger,
) -> int:
    logger.info(f"Creando lead para el contacto {contact_id}.")
    fields = {
        "TITLE": prequalification_title(submission),
        "NAME": submission.full_name,
        "STATUS_ID": config.lead_statuses.new,
        "EMAIL": [{"VALUE": submission.email, "VALUE_TYPE": "WORK"}],
        "PHONE": [{"VALUE": submission.whatsapp, "VALUE_TYPE": "WORK"}],
        "CONTACT_ID": contact_id,
        config.fields.lead_processing_policy: _resolve_enum_id(
            client,
            config.fields.lead_processing_policy,
            config.processing_policy.skip,
        ),
        config.fields.lead_commercial_owner: resolve_commercial_owner_enum_id(
            client,
            config,
            determine_commercial_owner(submission),
        ),
        config.fields.lead_cuil: submission.cuil_digits,
        config.fields.lead_employment_status: submission.employment_status.bitrix_id,
        config.fields.lead_payment_bank: [submission.payment_bank.bitrix_id],
        config.fields.lead_province: submission.province.bitrix_id,
        config.fields.lead_source: submission.lead_source.bitrix_id,
    }

    fields.update(_build_optional_tracking_fields(config, submission))
    if config.fields.lead_recibo_file and submission.recibo_url:
        logger.info("Adjuntando recibo al lead.")
        fields[config.fields.lead_recibo_file] = build_bitrix_file_data(
            submission.recibo_url,
            timeout_seconds=config.timeout_seconds,
        )

    lead_id = client.call(
        "crm.lead.add",
        {
            "fields": fields
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


def resolve_commercial_owner_enum_id(
    client: BitrixClient,
    config: AppConfig,
    owner: str,
) -> str:
    owner_label = _commercial_owner_label(config, owner)
    return _resolve_enum_id(client, config.fields.lead_commercial_owner, owner_label)


def resolve_processing_policy_enum_id(
    client: BitrixClient,
    config: AppConfig,
    policy: str,
) -> str:
    normalized = policy.strip().casefold()
    label = (
        config.processing_policy.skip
        if normalized in {"skip", "no procesar"}
        else config.processing_policy.process
    )
    return _resolve_enum_id(client, config.fields.lead_processing_policy, label)


def lead_has_commercial_owner(
    client: BitrixClient,
    lead: dict[str, Any],
    config: AppConfig,
    owner: str,
) -> bool:
    current_value = _optional_lead_value(lead, config.fields.lead_commercial_owner)
    if current_value is None:
        return False

    expected_value = resolve_commercial_owner_enum_id(client, config, owner)
    return str(current_value) == expected_value


def lead_enum_label(
    client: BitrixClient,
    lead: dict[str, Any],
    field_name: str | None,
) -> str | None:
    if not field_name:
        return None
    current_value = _optional_lead_value(lead, field_name)
    if current_value is None:
        return None

    field = client.get_lead_field(field_name)
    for item in field.get("items") or []:
        if str(item.get("ID")) == str(current_value):
            value = str(item.get("VALUE") or "").strip()
            return value or None

    value = str(current_value).strip()
    return value or None


def determine_commercial_owner(submission: NormalizedInput) -> str:
    return "kestra"


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


def build_prequalification_input_from_lead(
    lead: dict[str, Any],
    config: AppConfig,
) -> PrequalificationInput:
    payload = {
        "province": _required_lead_value(lead, config.fields.lead_province),
        "employment_status": _required_lead_value(
            lead,
            config.fields.lead_employment_status,
        ),
        "payment_bank": _required_lead_value(lead, config.fields.lead_payment_bank),
    }
    return normalize_prequalification_input(payload)


def build_routing_input_from_lead(
    lead: dict[str, Any],
    config: AppConfig,
) -> RoutingInput:
    payload = {
        "province": _required_lead_value(lead, config.fields.lead_province),
        "employment_status": _required_lead_value(
            lead,
            config.fields.lead_employment_status,
        ),
    }
    return normalize_routing_input(payload)


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


def update_lead_prequalification_result(
    client: BitrixClient,
    config: AppConfig,
    lead_id: int,
    *,
    outcome: str,
    rejection_reason: str | None,
    title: str | None,
    commercial_owner_id: str | None = None,
    logger: Logger,
) -> str:
    if outcome == "qualified":
        status_id = config.lead_statuses.qualified
    elif outcome == "external_referral":
        status_id = config.lead_statuses.external_referral
    else:
        status_id = config.lead_statuses.rejected

    logger.info(f"Actualizando resultado de precalificacion del lead {lead_id} a {status_id}.")
    fields = {"STATUS_ID": status_id}
    if commercial_owner_id:
        fields[config.fields.lead_commercial_owner] = commercial_owner_id
    if title:
        fields["TITLE"] = title
    if outcome == "rejected" and rejection_reason:
        fields[config.fields.lead_rejection_reason] = _resolve_rejection_reason_enum_id(
            client,
            config.fields.lead_rejection_reason,
            rejection_reason,
        )
    client.call("crm.lead.update", {"id": lead_id, "fields": fields})
    return status_id


def prequalification_title(submission: NormalizedInput) -> str:
    if submission.lead_source.key == "finguru":
        return submission.full_name
    return f"{submission.full_name} - {submission.province.label}"


def prequalification_title_from_lead(
    lead: dict[str, Any],
    config: AppConfig,
    submission: PrequalificationInput,
) -> str | None:
    full_name = _lead_full_name(lead)
    source_value = _optional_lead_value(lead, config.fields.lead_source)
    if source_value is not None:
        try:
            source = ORIGENES_LEAD.resolve(source_value, "lead_source")
        except ValueError:
            source = None
        if source is not None and source.key == "finguru":
            return full_name or None

    if full_name:
        return f"{full_name} - {submission.province.label}"
    return None


def update_lead_bcra_snapshot(
    client: BitrixClient,
    config: AppConfig,
    lead_id: int,
    bcra_result: BcraConsultationResult,
    logger: Logger,
) -> None:
    if not config.fields.has_bcra_storage_fields():
        raise RuntimeError("La configuracion no incluye los campos de storage BCRA.")

    logger.info(f"Persistiendo snapshot BCRA en el lead {lead_id}.")
    fields = {
        config.fields.lead_bcra_status: bcra_result.formatted_field_value,
        config.fields.lead_bcra_data_raw: bcra_result.raw_field_value,
        config.fields.lead_bcra_checked_at: bcra_result.checked_at,
    }
    if config.fields.lead_bcra_result and bcra_result.summary_field_value is not None:
        fields[config.fields.lead_bcra_result] = bcra_result.summary_field_value
    update_lead_fields(client, lead_id, fields)


def update_lead_fields(
    client: BitrixClient,
    lead_id: int,
    fields: dict[str, Any],
) -> None:
    client.call("crm.lead.update", {"id": lead_id, "fields": fields})


def build_lead_contact_birthdate_field(
    config: AppConfig,
    birthdate: str,
) -> dict[str, str]:
    if not config.fields.lead_contact_birthdate or not birthdate:
        return {}
    return {config.fields.lead_contact_birthdate: birthdate}


def sync_contact_birthdate_to_leads(
    client: BitrixClient,
    config: AppConfig,
    contact_id: int,
    birthdate: str,
    logger: Logger,
    *,
    exclude_lead_ids: set[int] | None = None,
    dry_run: bool = False,
) -> int:
    fields = build_lead_contact_birthdate_field(config, birthdate)
    if not fields:
        return 0

    excluded = exclude_lead_ids or set()
    field_name = next(iter(fields))
    leads = list_leads_by_contact(
        client,
        contact_id=contact_id,
        field_names=["ID", field_name],
        logger=logger,
    )
    updated_count = 0
    for lead in leads:
        lead_id = int(str(lead.get("ID") or "0"))
        if not lead_id or lead_id in excluded:
            continue
        if normalize_birthdate(_optional_lead_value(lead, field_name)) == birthdate:
            continue

        logger.info(f"Sincronizando fecha de nacimiento de contacto en lead {lead_id}.")
        updated_count += 1
        if not dry_run:
            update_lead_fields(client, lead_id, fields)

    return updated_count


def list_leads_by_contact(
    client: BitrixClient,
    *,
    contact_id: int,
    field_names: list[str],
    logger: Logger,
) -> list[dict[str, Any]]:
    logger.info(f"Listando leads del contacto {contact_id}.")
    leads: list[dict[str, Any]] = []
    start = 0

    while True:
        payload = {
            "filter": {
                "CONTACT_ID": contact_id,
            },
            "order": {"ID": "ASC"},
            "select": field_names,
            "start": start,
        }
        response = client.call_full("crm.lead.list", payload)
        result = response.get("result") or []
        if not isinstance(result, list):
            raise RuntimeError("crm.lead.list devolvio un payload invalido.")
        leads.extend(result)

        next_page = response.get("next")
        if next_page is None:
            break
        start = int(next_page)

    return leads


def list_leads_created_between(
    client: BitrixClient,
    *,
    date_from: str,
    date_to: str,
    field_names: list[str],
    logger: Logger,
) -> list[dict[str, Any]]:
    logger.info(f"Listando leads entre {date_from} y {date_to}.")
    leads: list[dict[str, Any]] = []
    start = 0

    while True:
        payload = {
            "filter": {
                ">=DATE_CREATE": date_from,
                "<=DATE_CREATE": date_to,
            },
            "order": {"ID": "ASC"},
            "select": field_names,
            "start": start,
        }
        response = client.call_full("crm.lead.list", payload)
        result = response.get("result") or []
        if not isinstance(result, list):
            raise RuntimeError("crm.lead.list devolvio un payload invalido.")
        leads.extend(result)

        next_page = response.get("next")
        if next_page is None:
            break
        start = int(next_page)

    return leads


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


def _commercial_owner_label(config: AppConfig, owner: str) -> str:
    normalized_owner = owner.strip().lower()
    if normalized_owner == "bitrix":
        return config.commercial_owner.bitrix
    if normalized_owner == "kestra":
        return config.commercial_owner.kestra
    if normalized_owner == "manual":
        return config.commercial_owner.manual
    return owner


def _build_optional_tracking_fields(
    config: AppConfig,
    submission: NormalizedInput,
) -> dict[str, str]:
    optional_fields = {
        config.fields.lead_utm_source: submission.utm_source,
        config.fields.lead_utm_medium: submission.utm_medium,
        config.fields.lead_utm_campaign: submission.utm_campaign,
        config.fields.lead_utm_term: submission.utm_term,
        config.fields.lead_utm_content: submission.utm_content,
    }
    return {
        field_name: value
        for field_name, value in optional_fields.items()
        if value is not None and value != ""
    }


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

