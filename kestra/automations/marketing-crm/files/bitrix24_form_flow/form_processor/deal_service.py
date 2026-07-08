from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from .bitrix_client import BitrixClient
from .config import AppConfig
from .logger import Logger


DEAL_ENTITY_TYPE_ID = 2


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
        ("UTM_SOURCE", "utmSource"),
        ("UTM_MEDIUM", "utmMedium"),
        ("UTM_CAMPAIGN", "utmCampaign"),
        ("UTM_TERM", "utmTerm"),
        ("UTM_CONTENT", "utmContent"),
    ):
        value = lead.get(lead_field)
        if value:
            fields[deal_field] = value

    return fields


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
