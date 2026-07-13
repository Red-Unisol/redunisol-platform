from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
import unicodedata
from typing import Any

from .bitrix_client import BitrixClient
from .config import AppConfig
from .logger import Logger


DEAL_ENTITY_TYPE_ID = 2
LEAD_ENTITY_TYPE_ID = 1
CONTACT_ENTITY_TYPE_ID = 3
OPEN_LINE_ACTIVITY_PROVIDER_ID = "IMOPENLINES_SESSION"

DEAL_DIRECT_FIELD_MAPPINGS = {
    "cuil": "ufCrm_64FF4F9B5C195",
    "bcra_status": "ufCrm_69E0D50649FEB",
    "bcra_result": "ufCrm_69E0D5066A068",
    "bcra_data_raw": "ufCrm_69E0F0E38EB6C",
    "bcra_checked_at": "ufCrm_69E0D5067FD95",
    "contact_birthdate": "ufCrm_6A3942DDF006B",
    "vimarx_nro_socio": "ufCrm_6A34379BB89A9",
    "vimarx_creditos_activos_count": "ufCrm_6A34379BDE41B",
    "vimarx_creditos_activos_detail": "ufCrm_6A34379BEF025",
    "vimarx_creditos_activos_raw": "ufCrm_6A34379C0D920",
    "credixsa_status": "ufCrm_6A43D31E6DC9E",
    "credixsa_checked_at": "ufCrm_6A43D31E9C6D7",
    "credixsa_employer_name": "ufCrm_6A43D31EBC847",
    "credixsa_employer_cuit": "ufCrm_6A43D31ED9E56",
    "credixsa_employer_count": "ufCrm_6A43D31F06C90",
    "credixsa_employer_periods": "ufCrm_6A43D31F1D7D1",
    "credixsa_alerts": "ufCrm_6A43D31F38377",
}

DEAL_ENUM_FIELD_MAPPINGS = {
    "province": "ufCrm_1684346013612",
    "employment_status": "ufCrm_662B9D2685477",
    "payment_bank": "ufCrm_6602D534A38CF",
    "source": "ufCrm_66A93764BFF96",
    "processing_policy": "ufCrm_69CA882AB72B7",
    "es_socio": "ufCrm_670E6D6216DD4",
}

DEAL_SOCIO_NUEVO_FIELD = "ufCrm_1727360234"


def ensure_won_lead_deal(
    client: BitrixClient,
    config: AppConfig,
    lead: dict[str, Any],
    *,
    lead_id: int,
    contact_id: int | None,
    logger: Logger,
) -> int:
    existing_deal = find_deal_by_lead(client, lead_id=lead_id, logger=logger)
    if existing_deal is not None:
        deal_id = _required_int(existing_deal.get("id") or existing_deal.get("ID"), "id")
        logger.info(f"Lead {lead_id} ya tiene negociacion {deal_id}.")
        return deal_id

    assigned_by_id = resolve_round_robin_assignee(
        client,
        config,
        contact_id=contact_id,
        lead_id=lead_id,
        logger=logger,
    )
    fields = _build_deal_fields(
        client,
        config,
        lead,
        lead_id=lead_id,
        contact_id=contact_id,
        assigned_by_id=assigned_by_id,
    )

    logger.info(f"Creando negociacion para lead {lead_id} con responsable {assigned_by_id}.")
    result = client.call(
        "crm.item.add",
        {
            "entityTypeId": DEAL_ENTITY_TYPE_ID,
            "fields": fields,
        },
    )
    item = result.get("item") if isinstance(result, dict) else None
    if not isinstance(item, dict):
        raise RuntimeError("crm.item.add devolvio un payload invalido al crear la negociacion.")

    return _required_int(item.get("id") or item.get("ID"), "id")


def find_deal_by_lead(
    client: BitrixClient,
    *,
    lead_id: int,
    logger: Logger,
) -> dict[str, Any] | None:
    logger.info(f"Buscando negociacion existente para lead {lead_id}.")
    deals = _list_deals(
        client,
        filter_={"=leadId": lead_id},
        order={"id": "DESC"},
        select=["id", "leadId", "assignedById"],
    )
    return deals[0] if deals else None


def bind_open_line_activities_to_deal(
    client: BitrixClient,
    *,
    lead_id: int,
    contact_id: int | None,
    deal_id: int,
    logger: Logger,
) -> int:
    activity_ids = _list_open_line_activity_ids(
        client,
        owner_type_id=LEAD_ENTITY_TYPE_ID,
        owner_id=lead_id,
    )
    if contact_id is not None:
        activity_ids.extend(
            _list_open_line_activity_ids(
                client,
                owner_type_id=CONTACT_ENTITY_TYPE_ID,
                owner_id=contact_id,
            )
        )

    linked_count = 0
    seen_ids: set[int] = set()
    for activity_id in activity_ids:
        if activity_id in seen_ids:
            continue
        seen_ids.add(activity_id)

        try:
            client.call(
                "crm.activity.binding.add",
                {
                    "activityId": activity_id,
                    "entityTypeId": DEAL_ENTITY_TYPE_ID,
                    "entityId": deal_id,
                },
            )
        except RuntimeError as exc:
            error_text = str(exc)
            if (
                "ACTIVITY_IS_ALREADY_BOUND" in error_text
                or "already bound" in error_text.lower()
            ):
                logger.info(f"Actividad {activity_id} ya estaba vinculada al deal {deal_id}.")
                continue
            logger.error(f"No se pudo vincular actividad {activity_id} al deal {deal_id}: {exc}")
            continue

        linked_count += 1
        logger.info(f"Actividad Open Lines {activity_id} vinculada al deal {deal_id}.")

    return linked_count


def resolve_round_robin_assignee(
    client: BitrixClient,
    config: AppConfig,
    *,
    contact_id: int | None,
    lead_id: int,
    logger: Logger,
) -> int:
    pool = config.deal.round_robin_user_ids
    if not pool:
        raise RuntimeError("No hay vendedores configurados para round-robin de negociaciones.")

    if contact_id is not None:
        previous_assignee = _latest_pool_assignee_for_contact(
            client,
            pool=pool,
            contact_id=contact_id,
            lead_id=lead_id,
            logger=logger,
        )
        if previous_assignee is not None:
            return previous_assignee

    return _least_loaded_pool_assignee(client, config, logger)


def _latest_pool_assignee_for_contact(
    client: BitrixClient,
    *,
    pool: tuple[int, ...],
    contact_id: int,
    lead_id: int,
    logger: Logger,
) -> int | None:
    logger.info(f"Buscando vendedor recurrente para contacto {contact_id}.")
    deals = _list_deals(
        client,
        filter_={"=contactId": contact_id},
        order={"createdTime": "DESC", "id": "DESC"},
        select=["id", "leadId", "contactId", "assignedById", "createdTime"],
    )
    pool_set = {str(user_id) for user_id in pool}
    for deal in deals:
        if str(deal.get("leadId") or "") == str(lead_id):
            continue
        assigned_by_id = str(deal.get("assignedById") or "")
        if assigned_by_id in pool_set:
            logger.info(f"Contacto {contact_id} reutiliza vendedor {assigned_by_id}.")
            return int(assigned_by_id)
    return None


def _least_loaded_pool_assignee(
    client: BitrixClient,
    config: AppConfig,
    logger: Logger,
) -> int:
    date_from = (
        datetime.now(timezone.utc) - timedelta(days=config.deal.round_robin_lookback_days)
    ).isoformat()
    logger.info(f"Calculando carga round-robin desde {date_from}.")
    deals = _list_deals(
        client,
        filter_={
            "=categoryId": config.deal.category_id,
            ">=createdTime": date_from,
        },
        order={"createdTime": "ASC", "id": "ASC"},
        select=["id", "assignedById", "categoryId", "createdTime"],
    )
    counts = Counter(
        int(str(deal.get("assignedById")))
        for deal in deals
        if _is_positive_int(deal.get("assignedById"))
    )
    return min(
        enumerate(config.deal.round_robin_user_ids),
        key=lambda item: (counts[item[1]], item[0]),
    )[1]


def _list_open_line_activity_ids(
    client: BitrixClient,
    *,
    owner_type_id: int,
    owner_id: int,
) -> list[int]:
    activities: list[dict[str, Any]] = []
    start = 0

    while True:
        response = client.call_full(
            "crm.activity.list",
            {
                "filter": {
                    "OWNER_TYPE_ID": owner_type_id,
                    "OWNER_ID": owner_id,
                    "PROVIDER_ID": OPEN_LINE_ACTIVITY_PROVIDER_ID,
                },
                "select": ["ID", "PROVIDER_ID", "OWNER_TYPE_ID", "OWNER_ID"],
                "order": {"ID": "DESC"},
                "start": start,
            },
        )
        result = response.get("result") or []
        if not isinstance(result, list):
            raise RuntimeError("crm.activity.list devolvio un payload invalido.")
        activities.extend(activity for activity in result if isinstance(activity, dict))

        next_page = response.get("next")
        if next_page is None:
            break
        start = int(next_page)

    ids: list[int] = []
    for activity in activities:
        activity_id = activity.get("ID") or activity.get("id")
        if _is_positive_int(activity_id):
            ids.append(int(str(activity_id)))
    return ids


def _list_deals(
    client: BitrixClient,
    *,
    filter_: dict[str, Any],
    order: dict[str, str],
    select: list[str],
) -> list[dict[str, Any]]:
    deals: list[dict[str, Any]] = []
    start = 0

    while True:
        response = client.call_full(
            "crm.item.list",
            {
                "entityTypeId": DEAL_ENTITY_TYPE_ID,
                "filter": filter_,
                "order": order,
                "select": select,
                "start": start,
            },
        )
        result = response.get("result")
        if isinstance(result, dict):
            items = result.get("items") or []
        else:
            items = result or []
        if not isinstance(items, list):
            raise RuntimeError("crm.item.list devolvio un payload invalido.")
        deals.extend(item for item in items if isinstance(item, dict))

        next_page = response.get("next")
        if next_page is None and isinstance(result, dict):
            next_page = result.get("next")
        if next_page is None:
            break
        start = int(next_page)

    return deals


def _build_deal_fields(
    client: BitrixClient,
    config: AppConfig,
    lead: dict[str, Any],
    *,
    lead_id: int,
    contact_id: int | None,
    assigned_by_id: int,
) -> dict[str, Any]:
    fields: dict[str, Any] = {
        "title": _deal_title(lead, lead_id),
        "categoryId": config.deal.category_id,
        "stageId": config.deal.stage_id,
        "leadId": lead_id,
        "assignedById": assigned_by_id,
    }
    if contact_id is not None:
        fields["contactId"] = contact_id

    for lead_field, deal_field in (
        ("SOURCE_ID", "sourceId"),
        ("SOURCE_DESCRIPTION", "sourceDescription"),
        ("UTM_SOURCE", "utmSource"),
        ("UTM_MEDIUM", "utmMedium"),
        ("UTM_CAMPAIGN", "utmCampaign"),
        ("UTM_TERM", "utmTerm"),
        ("UTM_CONTENT", "utmContent"),
    ):
        value = lead.get(lead_field)
        if value:
            fields[deal_field] = value

    _copy_custom_lead_fields_to_deal(client, config, lead, fields)
    return fields


def _copy_custom_lead_fields_to_deal(
    client: BitrixClient,
    config: AppConfig,
    lead: dict[str, Any],
    fields: dict[str, Any],
) -> None:
    for lead_field, deal_field in _direct_custom_field_pairs(config):
        value = lead.get(lead_field or "")
        if _has_value(value):
            fields[deal_field] = value

    enum_pairs = [
        (lead_field, deal_field)
        for lead_field, deal_field in _enum_custom_field_pairs(config)
        if _has_value(lead.get(lead_field or ""))
    ]
    if not enum_pairs:
        return

    lead_fields = client.call("crm.lead.fields", {})
    deal_fields_response = client.call(
        "crm.item.fields",
        {"entityTypeId": DEAL_ENTITY_TYPE_ID},
    )
    deal_fields = (
        deal_fields_response.get("fields", {})
        if isinstance(deal_fields_response, dict)
        else {}
    )

    es_socio_label: str | None = None
    for lead_field, deal_field in enum_pairs:
        label = _enum_label_for_value(lead_fields.get(lead_field, {}), lead.get(lead_field))
        if label is None:
            continue
        deal_value = _enum_id_for_label(deal_fields.get(deal_field, {}), label)
        if deal_value is None:
            continue
        fields[deal_field] = deal_value
        if deal_field == DEAL_ENUM_FIELD_MAPPINGS["es_socio"]:
            es_socio_label = label

    if es_socio_label is not None:
        socio_nuevo_label = _socio_nuevo_label(es_socio_label)
        if socio_nuevo_label is not None:
            socio_nuevo_id = _enum_id_for_label(
                deal_fields.get(DEAL_SOCIO_NUEVO_FIELD, {}),
                socio_nuevo_label,
            )
            if socio_nuevo_id is not None:
                fields[DEAL_SOCIO_NUEVO_FIELD] = socio_nuevo_id


def _direct_custom_field_pairs(config: AppConfig) -> tuple[tuple[str | None, str], ...]:
    return (
        (config.fields.lead_cuil, DEAL_DIRECT_FIELD_MAPPINGS["cuil"]),
        (config.fields.lead_bcra_status, DEAL_DIRECT_FIELD_MAPPINGS["bcra_status"]),
        (config.fields.lead_bcra_result, DEAL_DIRECT_FIELD_MAPPINGS["bcra_result"]),
        (config.fields.lead_bcra_data_raw, DEAL_DIRECT_FIELD_MAPPINGS["bcra_data_raw"]),
        (config.fields.lead_bcra_checked_at, DEAL_DIRECT_FIELD_MAPPINGS["bcra_checked_at"]),
        (config.fields.lead_contact_birthdate, DEAL_DIRECT_FIELD_MAPPINGS["contact_birthdate"]),
        (config.fields.lead_vimarx_nro_socio, DEAL_DIRECT_FIELD_MAPPINGS["vimarx_nro_socio"]),
        (
            config.fields.lead_vimarx_creditos_activos_count,
            DEAL_DIRECT_FIELD_MAPPINGS["vimarx_creditos_activos_count"],
        ),
        (
            config.fields.lead_vimarx_creditos_activos_detail,
            DEAL_DIRECT_FIELD_MAPPINGS["vimarx_creditos_activos_detail"],
        ),
        (
            config.fields.lead_vimarx_creditos_activos_raw,
            DEAL_DIRECT_FIELD_MAPPINGS["vimarx_creditos_activos_raw"],
        ),
        (config.fields.lead_credixsa_status, DEAL_DIRECT_FIELD_MAPPINGS["credixsa_status"]),
        (
            config.fields.lead_credixsa_checked_at,
            DEAL_DIRECT_FIELD_MAPPINGS["credixsa_checked_at"],
        ),
        (
            config.fields.lead_credixsa_employer_name,
            DEAL_DIRECT_FIELD_MAPPINGS["credixsa_employer_name"],
        ),
        (
            config.fields.lead_credixsa_employer_cuit,
            DEAL_DIRECT_FIELD_MAPPINGS["credixsa_employer_cuit"],
        ),
        (
            config.fields.lead_credixsa_employer_count,
            DEAL_DIRECT_FIELD_MAPPINGS["credixsa_employer_count"],
        ),
        (
            config.fields.lead_credixsa_employer_periods,
            DEAL_DIRECT_FIELD_MAPPINGS["credixsa_employer_periods"],
        ),
        (config.fields.lead_credixsa_alerts, DEAL_DIRECT_FIELD_MAPPINGS["credixsa_alerts"]),
    )


def _enum_custom_field_pairs(config: AppConfig) -> tuple[tuple[str | None, str], ...]:
    return (
        (config.fields.lead_province, DEAL_ENUM_FIELD_MAPPINGS["province"]),
        (config.fields.lead_employment_status, DEAL_ENUM_FIELD_MAPPINGS["employment_status"]),
        (config.fields.lead_payment_bank, DEAL_ENUM_FIELD_MAPPINGS["payment_bank"]),
        (config.fields.lead_source, DEAL_ENUM_FIELD_MAPPINGS["source"]),
        (config.fields.lead_processing_policy, DEAL_ENUM_FIELD_MAPPINGS["processing_policy"]),
        (config.fields.lead_es_socio, DEAL_ENUM_FIELD_MAPPINGS["es_socio"]),
    )


def _enum_label_for_value(field_meta: dict[str, Any], raw_value: Any) -> str | None:
    value = _first_scalar(raw_value)
    if value is None:
        return None
    for item in field_meta.get("items") or []:
        if str(item.get("ID") or "") == str(value):
            label = str(item.get("VALUE") or "").strip()
            return label or None
    return None


def _enum_id_for_label(field_meta: dict[str, Any], label: str) -> str | None:
    normalized_label = _normalize_label(label)
    for item in field_meta.get("items") or []:
        item_label = str(item.get("VALUE") or "")
        if _normalize_label(item_label) == normalized_label:
            value = str(item.get("ID") or "").strip()
            return value or None
    return None


def _socio_nuevo_label(es_socio_label: str) -> str | None:
    normalized_label = _normalize_label(es_socio_label)
    if normalized_label == "si":
        return "NO"
    if normalized_label == "no":
        return "SI"
    return None


def _normalize_label(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", str(value).strip().casefold())
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def _first_scalar(raw_value: Any) -> Any | None:
    if isinstance(raw_value, (list, tuple)):
        for item in raw_value:
            if _has_value(item):
                return item
        return None
    return raw_value if _has_value(raw_value) else None


def _has_value(raw_value: Any) -> bool:
    if raw_value is None:
        return False
    if isinstance(raw_value, str):
        return raw_value.strip() != ""
    if isinstance(raw_value, (list, tuple)):
        return any(_has_value(item) for item in raw_value)
    return True


def _deal_title(lead: dict[str, Any], lead_id: int) -> str:
    title = str(lead.get("TITLE") or "").strip()
    if title:
        return title

    full_name = " ".join(
        part
        for part in (
            str(lead.get("NAME") or "").strip(),
            str(lead.get("LAST_NAME") or "").strip(),
        )
        if part
    )
    return full_name or f"Lead {lead_id}"


def _required_int(raw_value: Any, field_name: str) -> int:
    if not _is_positive_int(raw_value):
        raise RuntimeError(f'Bitrix24 devolvio un "{field_name}" invalido para la negociacion.')
    return int(str(raw_value))


def _is_positive_int(raw_value: Any) -> bool:
    try:
        return int(str(raw_value)) > 0
    except (TypeError, ValueError):
        return False
