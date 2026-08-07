from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time
import json
import os
import unicodedata
from typing import Any
from zoneinfo import ZoneInfo

from .bitrix_client import BitrixClient
from .config import AppConfig, load_config
from .deal_service import (
    DEAL_ENTITY_TYPE_ID,
    assign_open_line_chats_to_user,
    bind_open_line_activities_to_deal,
    notify_distribution_supervisor,
    notify_unmatched_routing,
    resolve_round_robin_assignee,
)
from .lead_service import (
    build_submission_from_lead,
    get_lead,
    lead_enum_label,
    lead_has_commercial_owner,
)
from .logger import Logger, create_logger
from .routing_bucket import resolve_routing_bucket


@dataclass(frozen=True)
class CatamarcaDecision:
    action: str
    reason: str
    stage_id: str
    commercial_line: str | None = None


BUSINESS_HOURS_ONLY_ENV = "BITRIX24_DISTRIBUTION_BUSINESS_HOURS_ONLY"
BUSINESS_HOURS_TIMEZONE_ENV = "BITRIX24_DISTRIBUTION_TIMEZONE"
BUSINESS_HOURS_WORKDAYS_ENV = "BITRIX24_DISTRIBUTION_WORKDAYS"
BUSINESS_HOURS_FROM_ENV = "BITRIX24_DISTRIBUTION_FROM"
BUSINESS_HOURS_TO_ENV = "BITRIX24_DISTRIBUTION_TO"
WEEKDAY_CODES = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


def select_next_pending_catamarca_deal(
    *,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    logger: Logger | None = None,
) -> dict[str, object]:
    active_logger = logger or create_logger()
    config = load_config(env)
    client = bitrix_client or BitrixClient(config, active_logger)
    response = client.call_full(
        "crm.item.list",
        {
            "entityTypeId": DEAL_ENTITY_TYPE_ID,
            "filter": {
                "=categoryId": config.deal.category_id,
                "=stageId": config.deal.pending_qualification_stage_id,
            },
            "order": {"id": "ASC"},
            "select": ["id", "leadId", "contactId", "stageId"],
            "start": 0,
        },
    )
    result = response.get("result")
    items = result.get("items") if isinstance(result, dict) else result
    if not isinstance(items, list):
        raise RuntimeError("crm.item.list devolvio un payload invalido.")

    for deal in items:
        deal_id = _optional_int(deal.get("id") or deal.get("ID"))
        lead_id = _optional_int(deal.get("leadId") or deal.get("LEAD_ID"))
        if deal_id is None or lead_id is None:
            continue
        return _result(
            action="selected",
            has_pending=True,
            deal_id=deal_id,
            lead_id=lead_id,
            message=f"Negociacion {deal_id} seleccionada para calificacion Catamarca.",
        )

    return _result(
        action="no_pending",
        has_pending=False,
        message="No hay negociaciones Catamarca pendientes de calificacion.",
    )


def qualify_catamarca_deal(
    deal_id: int | str,
    *,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    logger: Logger | None = None,
    now: datetime | None = None,
) -> dict[str, object]:
    active_logger = logger or create_logger()
    config = load_config(env)
    client = bitrix_client or BitrixClient(config, active_logger)
    deal_id_int = int(str(deal_id))
    deal = _get_deal(client, deal_id_int)
    lead_id = _required_int(deal.get("leadId") or deal.get("LEAD_ID"), "leadId")
    current_stage = str(deal.get("stageId") or deal.get("STAGE_ID") or "").strip()

    if current_stage != config.deal.pending_qualification_stage_id:
        return _result(
            action="skipped",
            has_pending=False,
            deal_id=deal_id_int,
            lead_id=lead_id,
            stage_id=current_stage,
            reason="deal_not_pending",
            message="La negociacion ya no esta pendiente de calificacion Kestra.",
        )

    source = os.environ if env is None else env
    if _business_hours_gate_enabled(source) and not _is_within_business_hours(source, now):
        client.call(
            "crm.item.update",
            {
                "entityTypeId": DEAL_ENTITY_TYPE_ID,
                "id": deal_id_int,
                "fields": {
                    "stageId": config.deal.manual_review_stage_id,
                    "assignedById": config.deal.provisional_user_id,
                },
            },
        )
        active_logger.info(
            f"Negociacion {deal_id_int} recibida fuera de horario laboral: "
            "queda asignada a Maru para distribucion manual."
        )
        return _result(
            action="manual_review",
            has_pending=False,
            deal_id=deal_id_int,
            lead_id=lead_id,
            stage_id=config.deal.manual_review_stage_id,
            reason="outside_business_hours",
            assigned_by_id=config.deal.provisional_user_id,
            message=(
                "Negociacion fuera de horario laboral; queda en manos de Maru "
                "para distribucion manual."
            ),
        )

    lead = get_lead(client, lead_id, active_logger)
    contact_id = _optional_int(deal.get("contactId") or lead.get("CONTACT_ID"))
    deal_title = str(deal.get("title") or deal.get("TITLE") or "").strip()
    routing = resolve_routing_bucket(config, lead)
    if routing.bucket is None:
        client.call(
            "crm.item.update",
            {
                "entityTypeId": DEAL_ENTITY_TYPE_ID,
                "id": deal_id_int,
                "fields": {"stageId": config.deal.routing_review_stage_id},
            },
        )
        notify_unmatched_routing(
            client,
            config,
            deal_id=deal_id_int,
            deal_title=deal_title,
            province=routing.province,
            reason=routing.reason,
            logger=active_logger,
        )
        active_logger.info(
            f"Negociacion {deal_id_int} sin bucket: {routing.reason}; "
            "no se asigna vendedor ni se transfiere chat."
        )
        return _result(
            action="routing_review",
            has_pending=False,
            deal_id=deal_id_int,
            lead_id=lead_id,
            stage_id=config.deal.routing_review_stage_id,
            reason=routing.reason,
            message="Negociacion enviada a revision por no tener bucket de distribucion.",
        )

    bucket = routing.bucket
    decision = _evaluate_catamarca(client, config, lead)
    assigned_by_id = resolve_round_robin_assignee(
        client,
        config,
        contact_id=contact_id,
        lead_id=lead_id,
        bucket_key=bucket.key,
        bucket_field=config.deal.routing_bucket_field,
        pool=bucket.seller_ids,
        legacy_province_label=bucket.legacy_province_label,
        logger=active_logger,
    )
    update_fields: dict[str, Any] = {
        "stageId": decision.stage_id,
        "assignedById": assigned_by_id,
        config.deal.routing_bucket_field: bucket.key,
    }
    if decision.commercial_line is not None:
        update_fields[config.deal.commercial_line_field] = decision.commercial_line

    client.call(
        "crm.item.update",
        {
            "entityTypeId": DEAL_ENTITY_TYPE_ID,
            "id": deal_id_int,
            "fields": update_fields,
        },
    )
    bind_open_line_activities_to_deal(
        client,
        lead_id=lead_id,
        contact_id=contact_id,
        deal_id=deal_id_int,
        logger=active_logger,
    )
    transferred_chat_count = assign_open_line_chats_to_user(
        client,
        lead_id=lead_id,
        contact_id=contact_id,
        deal_id=deal_id_int,
        assigned_by_id=assigned_by_id,
        logger=active_logger,
    )
    notify_distribution_supervisor(
        client,
        config,
        deal_id=deal_id_int,
        deal_title=deal_title,
        bucket_label=bucket.label,
        assigned_by_id=assigned_by_id,
        action=decision.action,
        chat_transferred=transferred_chat_count > 0,
        logger=active_logger,
    )
    active_logger.info(
        f"Negociacion {deal_id_int}: {decision.action}, "
        f"reason={decision.reason}, stage={decision.stage_id}."
    )
    return _result(
        action=decision.action,
        has_pending=False,
        deal_id=deal_id_int,
        lead_id=lead_id,
        stage_id=decision.stage_id,
        reason=decision.reason,
        assigned_by_id=assigned_by_id,
        routing_bucket=bucket.key,
        commercial_line=decision.commercial_line,
        message="Calificacion comercial Catamarca aplicada a la negociacion.",
    )


def _evaluate_catamarca(
    client: Any,
    config: AppConfig,
    lead: dict[str, Any],
) -> CatamarcaDecision:
    try:
        submission = build_submission_from_lead(lead, config)
    except ValueError:
        return _manual(config, "missing_prequalification_data")

    if submission.province.key != "catamarca":
        return _manual(config, "province_not_catamarca")
    if not lead_has_commercial_owner(client, lead, config, "kestra"):
        return _manual(config, "commercial_owner_not_kestra")

    member_label = _normalize_text(
        lead_enum_label(client, lead, config.fields.lead_es_socio)
    )
    active_credits = _optional_int(
        lead.get(config.fields.lead_vimarx_creditos_activos_count or "")
    )
    if member_label == "si" or (active_credits is not None and active_credits > 0):
        return _manual(config, "member_rules_require_manual_review")
    if member_label != "no":
        return _manual(config, "missing_membership_data")

    return _evaluate_bcra(config, lead)


def _evaluate_bcra(
    config: AppConfig,
    lead: dict[str, Any],
) -> CatamarcaDecision:
    raw_value = lead.get(config.fields.lead_bcra_data_raw or "")
    try:
        snapshot = json.loads(str(raw_value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return _manual(config, "missing_bcra_snapshot")
    if not isinstance(snapshot, dict) or snapshot.get("outcome") != "ok":
        return _manual(config, "bcra_snapshot_not_conclusive")

    entities = _latest_bcra_entities(snapshot)
    high_risk_count = sum(
        1 for entity in entities if _optional_int(entity.get("situacion")) in {4, 5}
    )
    if high_risk_count > 4:
        return CatamarcaDecision(
            action="rejected",
            reason="bcra_more_than_four_high_risk_situations",
            stage_id=config.deal.bcra_rejected_stage_id,
        )

    if _banco_nacion_situation(entities) > 2:
        return CatamarcaDecision(
            action="rejected",
            reason="banco_nacion_situation_above_two",
            stage_id=config.deal.bcra_rejected_stage_id,
        )

    situations = [
        value
        for entity in entities
        if (value := _optional_int(entity.get("situacion"))) is not None
    ]
    if not situations or all(situation <= 1 for situation in situations):
        return CatamarcaDecision(
            action="approved",
            reason="amejuca_premium",
            stage_id=config.deal.stage_id,
            commercial_line="AMEJUCA Premium",
        )

    return CatamarcaDecision(
        action="approved",
        reason="amejuca_special",
        stage_id=config.deal.stage_id,
        commercial_line="AMEJUCA Especial",
    )


def _latest_bcra_entities(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    payload = snapshot.get("payload")
    results = payload.get("results") if isinstance(payload, dict) else None
    periods = results.get("periodos") if isinstance(results, dict) else None
    if not isinstance(periods, list) or not periods:
        return []
    valid_periods = [period for period in periods if isinstance(period, dict)]
    if not valid_periods:
        return []
    latest = max(valid_periods, key=lambda period: str(period.get("periodo") or ""))
    entities = latest.get("entidades")
    if not isinstance(entities, list):
        return []
    return [entity for entity in entities if isinstance(entity, dict)]


def _banco_nacion_situation(entities: list[dict[str, Any]]) -> int:
    situations: list[int] = []
    for entity in entities:
        if not _is_banco_nacion(entity.get("entidad")):
            continue
        situation = _optional_int(entity.get("situacion"))
        if situation is not None:
            situations.append(situation)

    return max(situations, default=0)


def _is_banco_nacion(value: Any) -> bool:
    normalized = _normalize_text(value)
    return "nacion" in normalized and "banco" in normalized


def _get_deal(client: Any, deal_id: int) -> dict[str, Any]:
    result = client.call(
        "crm.item.get",
        {"entityTypeId": DEAL_ENTITY_TYPE_ID, "id": deal_id},
    )
    item = result.get("item") if isinstance(result, dict) else None
    if not isinstance(item, dict):
        raise RuntimeError("crm.item.get no devolvio la negociacion esperada.")
    return item


def _manual(config: AppConfig, reason: str) -> CatamarcaDecision:
    return CatamarcaDecision(
        action="manual_review",
        reason=reason,
        stage_id=config.deal.manual_review_stage_id,
    )


def _business_hours_gate_enabled(source: dict[str, str]) -> bool:
    return str(source.get(BUSINESS_HOURS_ONLY_ENV, "false")).strip().lower() in {
        "1",
        "true",
        "yes",
        "y",
        "si",
        "s",
    }


def _is_within_business_hours(
    source: dict[str, str],
    now: datetime | None = None,
) -> bool:
    timezone = ZoneInfo(
        str(source.get(BUSINESS_HOURS_TIMEZONE_ENV, "America/Argentina/Cordoba")).strip()
    )
    local_now = now.astimezone(timezone) if now is not None else datetime.now(timezone)
    workdays = {
        WEEKDAY_CODES[code.strip()]
        for code in str(source.get(BUSINESS_HOURS_WORKDAYS_ENV, "MO,TU,WE,TH,FR"))
        .upper()
        .split(",")
        if code.strip() in WEEKDAY_CODES
    }
    starts_at = time.fromisoformat(str(source.get(BUSINESS_HOURS_FROM_ENV, "09:00")))
    ends_at = time.fromisoformat(str(source.get(BUSINESS_HOURS_TO_ENV, "17:00")))
    local_time = local_now.time().replace(tzinfo=None)
    return local_now.weekday() in workdays and starts_at <= local_time < ends_at


def _normalize_text(value: Any) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    return " ".join(ascii_value.lower().split())


def _required_int(raw_value: Any, field_name: str) -> int:
    value = _optional_int(raw_value)
    if value is None:
        raise RuntimeError(f"La negociacion no tiene {field_name} valido.")
    return value


def _optional_int(raw_value: Any) -> int | None:
    if raw_value is None or str(raw_value).strip() == "":
        return None
    try:
        return int(str(raw_value))
    except ValueError:
        return None


def _result(
    *,
    action: str,
    has_pending: bool,
    message: str,
    deal_id: int | None = None,
    lead_id: int | None = None,
    stage_id: str = "",
    reason: str = "",
    assigned_by_id: int | None = None,
    routing_bucket: str = "",
    commercial_line: str | None = None,
) -> dict[str, object]:
    return {
        "ok": True,
        "action": action,
        "has_pending": has_pending,
        "message": message,
        "deal_id": deal_id,
        "lead_id": lead_id,
        "stage_id": stage_id,
        "reason": reason,
        "assigned_by_id": assigned_by_id,
        "routing_bucket": routing_bucket,
        "commercial_line": commercial_line,
    }
