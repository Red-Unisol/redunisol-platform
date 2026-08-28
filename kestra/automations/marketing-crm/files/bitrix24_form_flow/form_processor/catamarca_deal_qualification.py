from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
import json
import os
import unicodedata
from typing import Any
from zoneinfo import ZoneInfo

from .bcra_service import (
    BCRA_RETRY_EXHAUSTED_OUTCOME,
    BCRA_RETRY_PENDING_OUTCOMES,
    bcra_retry_state_from_lead,
    bcra_retry_waiting,
    sync_lead_bcra,
)
from .bitrix_client import BitrixClient
from .config import AppConfig, load_config
from .commercial_trace import (
    TRACE_SCHEMA_VERSION,
    business_decision,
    business_reason,
)
from .deal_service import (
    DEAL_DIRECT_FIELD_MAPPINGS,
    DEAL_ENTITY_TYPE_ID,
    NoOnlineSellersError,
    assign_open_line_chats_to_user,
    bind_open_line_activities_to_deal,
    notify_distribution_supervisor,
    notify_unmatched_routing,
    resolve_round_robin_assignee,
    user_display_name,
)
from .lead_service import (
    build_submission_from_lead,
    get_lead,
    lead_enum_label,
)
from .logger import Logger, create_logger
from .routing_bucket import resolve_routing_bucket, routing_bucket_by_key


@dataclass(frozen=True)
class CommercialDecision:
    action: str
    reason: str
    stage_id: str
    commercial_line: str | None = None


@dataclass(frozen=True)
class DistributionDecision:
    action: str
    reason: str
    strategy: str


@dataclass(frozen=True)
class BcraSnapshotResolution:
    lead: dict[str, Any]
    decision_override: CommercialDecision | None
    checked_at: str
    age_days: float | None
    refreshed: bool
    refresh_outcome: str
    pending: bool = False
    retry_attempts: int = 0
    next_retry_at: str = ""


BUSINESS_HOURS_ONLY_ENV = "BITRIX24_DISTRIBUTION_BUSINESS_HOURS_ONLY"
BUSINESS_HOURS_TIMEZONE_ENV = "BITRIX24_DISTRIBUTION_TIMEZONE"
BUSINESS_HOURS_WORKDAYS_ENV = "BITRIX24_DISTRIBUTION_WORKDAYS"
BUSINESS_HOURS_FROM_ENV = "BITRIX24_DISTRIBUTION_FROM"
BUSINESS_HOURS_TO_ENV = "BITRIX24_DISTRIBUTION_TO"
WEEKDAY_CODES = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
COMMERCIAL_RULE_VERSION = "2026-08-26-cordoba-publico-policia-cbu-v1"
BCRA_MAX_AGE_DAYS_ENV = "BITRIX24_DEAL_BCRA_MAX_AGE_DAYS"
BCRA_MAX_AGE_DAYS_DEFAULT = 7
QUEUE_BUCKET_KEYS = (
    "catamarca_general",
    "cordoba_jubilados",
    "cordoba_unc",
    "cordoba_general",
)


def select_next_pending_catamarca_deal(
    *,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    logger: Logger | None = None,
    now: datetime | None = None,
) -> dict[str, object]:
    active_logger = logger or create_logger()
    config = load_config(env)
    client = bitrix_client or BitrixClient(config, active_logger)
    current_time = _local_datetime(
        dict(os.environ if env is None else env),
        now,
    )
    start = 0
    while True:
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
                "start": start,
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
            lead = get_lead(client, lead_id, active_logger)
            if bcra_retry_waiting(
                lead,
                config,
                now=current_time,
            ):
                active_logger.info(
                    f"Negociacion {deal_id} omitida por ahora: "
                    "la consulta BCRA tiene un reintento programado."
                )
                continue
            return _result(
                action="selected",
                has_pending=True,
                deal_id=deal_id,
                lead_id=lead_id,
                message=f"Negociacion {deal_id} seleccionada para clasificación comercial.",
            )

        next_page = response.get("next")
        if next_page is None and isinstance(result, dict):
            next_page = result.get("next")
        if next_page is None:
            break
        start = int(next_page)

    return _result(
        action="no_pending",
        has_pending=False,
        message="No hay negociaciones pendientes de clasificación comercial.",
    )


def qualify_catamarca_deal(
    deal_id: int | str,
    *,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    bcra_client: Any | None = None,
    logger: Logger | None = None,
    now: datetime | None = None,
) -> dict[str, object]:
    active_logger = logger or create_logger()
    config = load_config(env)
    client = bitrix_client or BitrixClient(config, active_logger)
    source = os.environ if env is None else env
    processed_at = _local_datetime(source, now)
    within_business_hours = _is_within_business_hours(source, processed_at)
    deal_id_int = int(str(deal_id))
    deal = _get_deal(client, deal_id_int)
    lead_id = _required_int(deal.get("leadId") or deal.get("LEAD_ID"), "leadId")
    contact_id = _optional_int(deal.get("contactId") or deal.get("CONTACT_ID"))
    deal_title = str(deal.get("title") or deal.get("TITLE") or "").strip()
    current_stage = str(deal.get("stageId") or deal.get("STAGE_ID") or "").strip()
    previous_assignee_id = _optional_int(
        deal.get("assignedById") or deal.get("ASSIGNED_BY_ID")
    )


    created_at = _parse_bitrix_datetime(
        deal.get("createdTime") or deal.get("CREATED_TIME"),
        source,
    )
    created_within_distribution_window = _is_within_business_hours(
        source,
        created_at or processed_at,
    )

    if current_stage != config.deal.pending_qualification_stage_id:
        trace_context = _lead_trace_context(
            client, config, lead_id, active_logger
        )
        trace_contact_id = _optional_int(trace_context.pop("contact_id"))
        contact_id = contact_id or trace_contact_id
        return _result(
            action="skipped",
            has_pending=False,
            deal_id=deal_id_int,
            lead_id=lead_id,
            stage_id=current_stage,
            reason="deal_not_pending",
            processed_at=processed_at,
            contact_id=contact_id,
            deal_title=deal_title,
            stage_before=current_stage,
            previous_assigned_by_id=previous_assignee_id,
            within_business_hours=within_business_hours,
            assignment_strategy="not_applicable",
            message="La negociacion ya no esta pendiente de calificacion Kestra.",
            **trace_context,
        )

    lead = get_lead(client, lead_id, active_logger)
    contact_id = contact_id or _optional_int(lead.get("CONTACT_ID"))
    province = lead_enum_label(client, lead, config.fields.lead_province) or ""
    employment_status = lead_enum_label(
        client, lead, config.fields.lead_employment_status
    ) or ""
    payment_bank = (
        lead_enum_label(client, lead, config.fields.lead_payment_bank) or ""
    )
    source_label = lead_enum_label(client, lead, config.fields.lead_source) or ""
    bcra_resolution = _resolve_bcra_snapshot(
        client,
        config,
        lead,
        lead_id=lead_id,
        deal_id=deal_id_int,
        source=source,
        processed_at=processed_at,
        logger=active_logger,
        bcra_client=bcra_client,
    )
    lead = bcra_resolution.lead
    bcra_trace = {
        "bcra_snapshot_checked_at": bcra_resolution.checked_at,
        "bcra_snapshot_age_days": bcra_resolution.age_days,
        "bcra_snapshot_refreshed": bcra_resolution.refreshed,
        "bcra_refresh_outcome": bcra_resolution.refresh_outcome,
        "bcra_retry_attempts": bcra_resolution.retry_attempts,
        "bcra_next_retry_at": bcra_resolution.next_retry_at,
    }
    if bcra_resolution.pending:
        return _result(
            action="bcra_pending",
            has_pending=True,
            deal_id=deal_id_int,
            lead_id=lead_id,
            stage_id=config.deal.pending_qualification_stage_id,
            reason="bcra_retry_scheduled",
            processed_at=processed_at,
            contact_id=contact_id,
            deal_title=deal_title,
            stage_before=current_stage,
            previous_assigned_by_id=previous_assignee_id,
            province=province,
            employment_status=employment_status,
            payment_bank=payment_bank,
            source=source_label,
            within_business_hours=within_business_hours,
            assignment_strategy="commercial_data_pending",
            commercial_action="pending_data",
            commercial_reason="bcra_retry_scheduled",
            commercial_stage_id=config.deal.pending_qualification_stage_id,
            distribution_action="not_applicable",
            distribution_reason="commercial_data_pending",
            message=(
                "La decisión comercial queda pendiente; Kestra volverá a consultar BCRA "
                "automáticamente."
            ),
            **bcra_trace,
        )
    decision = bcra_resolution.decision_override or _evaluate_deal(client, config, lead)
    routing = resolve_routing_bucket(config, lead)
    province = routing.province or province
    bucket = routing.bucket
    routing_bucket_key = bucket.key if bucket is not None else ""
    if decision.action in {"rejected", "commercial_rejected"}:
        distribution = DistributionDecision(
            "not_applicable",
            "commercial_rejection",
            "rejection_without_distribution",
        )
        _assign_lead_responsible(
            client,
            lead_id=lead_id,
            assigned_by_id=config.deal.provisional_user_id,
            logger=active_logger,
        )
        client.call(
            "crm.item.update",
            {
                "entityTypeId": DEAL_ENTITY_TYPE_ID,
                "id": deal_id_int,
                "fields": {
                    "stageId": decision.stage_id,
                    "assignedById": config.deal.provisional_user_id,
                    config.deal.commercial_line_field: "",
                    config.deal.routing_bucket_field: routing_bucket_key,
                    config.deal.queue_action_field: "",
                    config.deal.queue_reason_field: "",
                    config.deal.queue_target_stage_field: "",
                    config.deal.queue_enqueued_at_field: "",
                },
            },
        )
        return _result(
            action=decision.action,
            has_pending=False,
            deal_id=deal_id_int,
            lead_id=lead_id,
            stage_id=decision.stage_id,
            reason=decision.reason,
            assigned_by_id=config.deal.provisional_user_id,
            assigned_by_name="Maru Lopez",
            routing_bucket=routing_bucket_key,
            processed_at=processed_at,
            contact_id=contact_id,
            deal_title=deal_title,
            stage_before=current_stage,
            previous_assigned_by_id=previous_assignee_id,
            province=province,
            employment_status=employment_status,
            payment_bank=payment_bank,
            source=source_label,
            within_business_hours=within_business_hours,
            assignment_strategy=distribution.strategy,
            commercial_action=decision.action,
            commercial_reason=decision.reason,
            commercial_stage_id=decision.stage_id,
            distribution_action=distribution.action,
            distribution_reason=distribution.reason,
            message="Rechazo aplicado sin buscar vendedor ni distribuir el chat.",
            **bcra_trace,
        )

    outside_distribution_window = _business_hours_gate_enabled(source) and (
        not within_business_hours or not created_within_distribution_window
    )
    if outside_distribution_window:
        distribution = DistributionDecision(
            "manual_owner",
            "outside_business_hours",
            "outside_hours_manual",
        )
        update_fields: dict[str, Any] = {
            "stageId": decision.stage_id,
            "assignedById": config.deal.provisional_user_id,
            config.deal.routing_bucket_field: routing_bucket_key,
            config.deal.queue_action_field: "",
            config.deal.queue_reason_field: "",
            config.deal.queue_target_stage_field: "",
            config.deal.queue_enqueued_at_field: "",
        }
        if decision.commercial_line is not None:
            update_fields[config.deal.commercial_line_field] = decision.commercial_line
        _assign_lead_responsible(
            client,
            lead_id=lead_id,
            assigned_by_id=config.deal.provisional_user_id,
            logger=active_logger,
        )
        client.call(
            "crm.item.update",
            {
                "entityTypeId": DEAL_ENTITY_TYPE_ID,
                "id": deal_id_int,
                "fields": update_fields,
            },
        )
        return _result(
            action=decision.action,
            has_pending=False,
            deal_id=deal_id_int,
            lead_id=lead_id,
            stage_id=decision.stage_id,
            reason=decision.reason,
            assigned_by_id=config.deal.provisional_user_id,
            assigned_by_name="Maru Lopez",
            routing_bucket=routing_bucket_key,
            commercial_line=decision.commercial_line,
            processed_at=processed_at,
            contact_id=contact_id,
            deal_title=deal_title,
            stage_before=current_stage,
            previous_assigned_by_id=previous_assignee_id,
            province=province,
            employment_status=employment_status,
            payment_bank=payment_bank,
            source=source_label,
            within_business_hours=False,
            assignment_strategy=distribution.strategy,
            commercial_action=decision.action,
            commercial_reason=decision.reason,
            commercial_stage_id=decision.stage_id,
            distribution_action=distribution.action,
            distribution_reason=distribution.reason,
            message=(
                "Clasificacion comercial aplicada; la distribucion queda con Maru "
                "por estar fuera de la ventana automatica."
            ),
            **bcra_trace,
        )

    if bucket is None:
        distribution = DistributionDecision(
            "routing_review",
            routing.reason,
            "no_matching_bucket",
        )
        client.call(
            "crm.item.update",
            {
                "entityTypeId": DEAL_ENTITY_TYPE_ID,
                "id": deal_id_int,
                "fields": {
                    "stageId": config.deal.routing_review_stage_id,
                    "assignedById": config.deal.provisional_user_id,
                },
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
        return _result(
            action="routing_review",
            has_pending=False,
            deal_id=deal_id_int,
            lead_id=lead_id,
            stage_id=config.deal.routing_review_stage_id,
            reason=routing.reason,
            assigned_by_id=config.deal.provisional_user_id,
            assigned_by_name="Maru Lopez",
            processed_at=processed_at,
            contact_id=contact_id,
            deal_title=deal_title,
            stage_before=current_stage,
            previous_assigned_by_id=previous_assignee_id,
            province=province,
            employment_status=employment_status,
            payment_bank=payment_bank,
            source=source_label,
            within_business_hours=within_business_hours,
            assignment_strategy=distribution.strategy,
            commercial_action=decision.action,
            commercial_reason=decision.reason,
            commercial_stage_id=decision.stage_id,
            commercial_line=decision.commercial_line,
            distribution_action=distribution.action,
            distribution_reason=distribution.reason,
            message="La clasificacion comercial se conservo; falta resolver el enrutamiento.",
            **bcra_trace,
        )
    try:
        assignment = resolve_round_robin_assignee(
            client,
            config,
            contact_id=contact_id,
            lead_id=lead_id,
            deal_id=deal_id_int,
            bucket_key=bucket.key,
            bucket_field=config.deal.routing_bucket_field,
            pool=bucket.seller_ids,
            legacy_province_label=bucket.legacy_province_label,
            logger=active_logger,
            now=processed_at,
        )
    except NoOnlineSellersError as exc:
        can_enqueue = (
            not _business_hours_gate_enabled(source)
            or (within_business_hours and created_within_distribution_window)
        )
        distribution = DistributionDecision(
            "queued" if can_enqueue else "manual_owner",
            "assignment_queued" if can_enqueue else "no_online_sellers",
            "assignment_queue" if can_enqueue else "no_online_sellers_manual",
        )
        update_fields: dict[str, Any] = {
            "stageId": (
                config.deal.assignment_queue_stage_id
                if can_enqueue
                else config.deal.manual_review_stage_id
            ),
            "assignedById": config.deal.provisional_user_id,
            config.deal.routing_bucket_field: bucket.key,
        }
        if can_enqueue:
            update_fields.update(
                {
                    config.deal.queue_action_field: decision.action,
                    config.deal.queue_reason_field: decision.reason,
                    config.deal.queue_target_stage_field: decision.stage_id,
                    config.deal.queue_enqueued_at_field: processed_at.isoformat(),
                }
            )
        if decision.commercial_line is not None:
            update_fields[config.deal.commercial_line_field] = decision.commercial_line
        _assign_lead_responsible(
            client,
            lead_id=lead_id,
            assigned_by_id=config.deal.provisional_user_id,
            logger=active_logger,
        )
        client.call(
            "crm.item.update",
            {
                "entityTypeId": DEAL_ENTITY_TYPE_ID,
                "id": deal_id_int,
                "fields": update_fields,
            },
        )
        queue_stage = (
            config.deal.assignment_queue_stage_id
            if can_enqueue
            else config.deal.manual_review_stage_id
        )
        return _result(
            action="queued" if can_enqueue else "manual_review",
            has_pending=False,
            deal_id=deal_id_int,
            lead_id=lead_id,
            stage_id=queue_stage,
            reason="assignment_queued" if can_enqueue else "no_online_sellers",
            assigned_by_id=config.deal.provisional_user_id,
            assigned_by_name="Maru Lopez",
            routing_bucket=bucket.key,
            commercial_line=decision.commercial_line,
            processed_at=processed_at,
            contact_id=contact_id,
            deal_title=deal_title,
            stage_before=current_stage,
            previous_assigned_by_id=previous_assignee_id,
            province=province,
            employment_status=employment_status,
            payment_bank=payment_bank,
            source=source_label,
            within_business_hours=within_business_hours,
            assignment_strategy=distribution.strategy,
            configured_pool=exc.configured_pool,
            online_pool=(),
            commercial_action=decision.action,
            commercial_reason=decision.reason,
            commercial_stage_id=decision.stage_id,
            distribution_action=distribution.action,
            distribution_reason=distribution.reason,
            message=(
                "No habia vendedores disponibles; la negociacion queda en cola temporal."
                if can_enqueue
                else "No habia vendedores disponibles; queda con Maru para gestion manual."
            ),
            **bcra_trace,
        )
    distribution = DistributionDecision(
        "assigned",
        "seller_selected",
        assignment.strategy,
    )
    assigned_by_id = assignment.assigned_by_id
    assigned_by_name = user_display_name(
        client,
        assigned_by_id=assigned_by_id,
        logger=active_logger,
    )
    update_fields: dict[str, Any] = {
        "stageId": decision.stage_id,
        "assignedById": assigned_by_id,
        config.deal.routing_bucket_field: bucket.key,
    }
    if decision.commercial_line is not None:
        update_fields[config.deal.commercial_line_field] = decision.commercial_line

    _assign_lead_responsible(
        client,
        lead_id=lead_id,
        assigned_by_id=assigned_by_id,
        logger=active_logger,
    )
    client.call(
        "crm.item.update",
        {
            "entityTypeId": DEAL_ENTITY_TYPE_ID,
            "id": deal_id_int,
            "fields": update_fields,
        },
    )
    linked_activity_count = bind_open_line_activities_to_deal(
        client,
        lead_id=lead_id,
        contact_id=contact_id,
        deal_id=deal_id_int,
        logger=active_logger,
    )
    chat_transfer = assign_open_line_chats_to_user(
        client,
        lead_id=lead_id,
        contact_id=contact_id,
        deal_id=deal_id_int,
        assigned_by_id=assigned_by_id,
        distributable_open_line_ids=config.deal.distributable_open_line_ids,
        logger=active_logger,
    )
    notify_distribution_supervisor(
        client,
        config,
        deal_id=deal_id_int,
        deal_title=deal_title,
        bucket_label=bucket.label,
        assigned_by_id=assigned_by_id,
        assigned_by_name=assigned_by_name,
        action=decision.action,
        chat_transferred=chat_transfer.transferred_count > 0,
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
        assigned_by_name=assigned_by_name,
        routing_bucket=bucket.key,
        commercial_line=decision.commercial_line,
        processed_at=processed_at,
        contact_id=contact_id,
        deal_title=deal_title,
        stage_before=current_stage,
        previous_assigned_by_id=previous_assignee_id,
        province=province,
        employment_status=employment_status,
        payment_bank=payment_bank,
        source=source_label,
        within_business_hours=within_business_hours,
        assignment_strategy=distribution.strategy,
        configured_pool=assignment.configured_pool,
        online_pool=assignment.online_pool,
        commercial_action=decision.action,
        commercial_reason=decision.reason,
        commercial_stage_id=decision.stage_id,
        distribution_action=distribution.action,
        distribution_reason=distribution.reason,
        linked_activity_count=linked_activity_count,
        transferred_chat_count=chat_transfer.transferred_count,
        chat_transfer_status=chat_transfer.status,
        found_chat_ids=chat_transfer.found_chat_ids,
        transferred_chat_ids=chat_transfer.transferred_chat_ids,
        skipped_chats=chat_transfer.skipped_chats,
        skipped_non_distributable_chat_count=(
            chat_transfer.skipped_non_distributable_count
        ),
        message="Clasificación comercial aplicada a la negociación.",
        **bcra_trace,
    )


def process_distribution_queue(
    *,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    logger: Logger | None = None,
    now: datetime | None = None,
) -> dict[str, object]:
    """Retry one oldest negotiation per bucket without cross-bucket blocking."""
    active_logger = logger or create_logger()
    config = load_config(env)
    client = bitrix_client or BitrixClient(config, active_logger)
    source = os.environ if env is None else env
    processed_at = _local_datetime(source, now)
    queued = _list_queued_deals(client, config)
    events: list[dict[str, object]] = []

    if not _is_within_business_hours(source, processed_at):
        for deal in queued:
            try:
                events.append(
                    _close_queued_deal(
                        client, config, deal, active_logger, processed_at
                    )
                )
            except Exception as exc:
                active_logger.error(
                    f"No se pudo cerrar la negociacion {_optional_int(deal.get('id'))}: {exc}"
                )
                events.append(
                    _queue_error_result(config, deal, processed_at, exc)
                )
        return _queue_batch_result(events, processed_at)

    current_week_start = (
        processed_at - timedelta(days=processed_at.weekday())
    ).replace(hour=0, minute=0, second=0, microsecond=0)
    current: dict[str, list[dict[str, Any]]] = {
        key: [] for key in QUEUE_BUCKET_KEYS
    }
    for deal in queued:
        enqueued_at = _parse_bitrix_datetime(
            deal.get(config.deal.queue_enqueued_at_field), source
        )
        bucket_key = str(deal.get(config.deal.routing_bucket_field) or "").strip()
        if enqueued_at is None or enqueued_at < current_week_start or bucket_key not in current:
            try:
                events.append(
                    _close_queued_deal(
                        client, config, deal, active_logger, processed_at
                    )
                )
            except Exception as exc:
                active_logger.error(
                    f"No se pudo retirar la negociacion {_optional_int(deal.get('id'))} "
                    f"de la cola: {exc}"
                )
                events.append(
                    _queue_error_result(config, deal, processed_at, exc)
                )
            continue
        current[bucket_key].append(deal)

    for bucket_key in QUEUE_BUCKET_KEYS:
        bucket_deals = current[bucket_key]
        if not bucket_deals:
            continue
        oldest = min(
            bucket_deals,
            key=lambda item: (
                str(item.get("createdTime") or ""),
                int(str(item.get("id") or "0")),
            ),
        )
        try:
            events.append(
                _retry_queued_deal(
                    client, config, oldest, active_logger, processed_at
                )
            )
        except Exception as exc:
            active_logger.error(
                f"No se pudo procesar la cola {bucket_key}: {exc}"
            )
            events.append(
                _queue_error_result(config, oldest, processed_at, exc)
            )
    return _queue_batch_result(events, processed_at)


def _list_queued_deals(client: Any, config: AppConfig) -> list[dict[str, Any]]:
    queued: list[dict[str, Any]] = []
    start = 0
    while True:
        response = client.call_full(
            "crm.item.list",
            {
                "entityTypeId": DEAL_ENTITY_TYPE_ID,
                "filter": {
                    "=categoryId": config.deal.category_id,
                    "=stageId": config.deal.assignment_queue_stage_id,
                },
                "order": {"createdTime": "ASC", "id": "ASC"},
                "select": [
                    "id", "leadId", "contactId", "title", "stageId",
                    "assignedById", "createdTime",
                    config.deal.routing_bucket_field,
                    config.deal.commercial_line_field,
                    config.deal.queue_action_field,
                    config.deal.queue_reason_field,
                    config.deal.queue_target_stage_field,
                    config.deal.queue_enqueued_at_field,
                ],
                "start": start,
            },
        )
        result = response.get("result")
        items = result.get("items") if isinstance(result, dict) else result
        if not isinstance(items, list):
            raise RuntimeError("crm.item.list devolvio una cola invalida.")
        queued.extend(items)
        next_start = response.get("next")
        if next_start is None and isinstance(result, dict):
            next_start = result.get("next")
        if next_start is None:
            break
        start = int(next_start)
    return queued


def _retry_queued_deal(
    client: Any,
    config: AppConfig,
    deal: dict[str, Any],
    logger: Logger,
    processed_at: datetime,
) -> dict[str, object]:
    deal_id = _required_int(deal.get("id"), "id")
    lead_id = _required_int(deal.get("leadId"), "leadId")
    contact_id = _optional_int(deal.get("contactId"))
    bucket_key = str(deal.get(config.deal.routing_bucket_field) or "").strip()
    bucket = routing_bucket_by_key(config, bucket_key)
    if bucket is None:
        return _close_queued_deal(client, config, deal, logger, processed_at)

    try:
        assignment = resolve_round_robin_assignee(
            client,
            config,
            contact_id=contact_id,
            lead_id=lead_id,
            deal_id=deal_id,
            bucket_key=bucket.key,
            bucket_field=config.deal.routing_bucket_field,
            pool=bucket.seller_ids,
            legacy_province_label=bucket.legacy_province_label,
            logger=logger,
            now=processed_at,
        )
    except NoOnlineSellersError as exc:
        return _queue_context_result(
            client, config, deal, logger,
            action="queue_waiting",
            reason="assignment_queue_waiting",
            processed_at=processed_at,
            assignment_strategy="assignment_queue_waiting",
            configured_pool=exc.configured_pool,
            online_pool=(),
            message="El bucket continúa sin vendedores disponibles.",
        )

    assigned_by_id = assignment.assigned_by_id
    assigned_by_name = user_display_name(
        client, assigned_by_id=assigned_by_id, logger=logger
    )
    target_stage = str(
        deal.get(config.deal.queue_target_stage_field)
        or config.deal.manual_review_stage_id
    )
    _assign_lead_responsible(
        client, lead_id=lead_id, assigned_by_id=assigned_by_id, logger=logger
    )
    client.call(
        "crm.item.update",
        {
            "entityTypeId": DEAL_ENTITY_TYPE_ID,
            "id": deal_id,
            "fields": {
                "stageId": target_stage,
                "assignedById": assigned_by_id,
                config.deal.queue_action_field: "",
                config.deal.queue_reason_field: "",
                config.deal.queue_target_stage_field: "",
                config.deal.queue_enqueued_at_field: "",
            },
        },
    )
    linked = bind_open_line_activities_to_deal(
        client, lead_id=lead_id, contact_id=contact_id,
        deal_id=deal_id, logger=logger,
    )
    chat_transfer = assign_open_line_chats_to_user(
        client, lead_id=lead_id, contact_id=contact_id, deal_id=deal_id,
        assigned_by_id=assigned_by_id,
        distributable_open_line_ids=config.deal.distributable_open_line_ids,
        logger=logger,
    )
    notify_distribution_supervisor(
        client, config, deal_id=deal_id,
        deal_title=str(deal.get("title") or ""), bucket_label=bucket.label,
        assigned_by_id=assigned_by_id, assigned_by_name=assigned_by_name,
        action=str(deal.get(config.deal.queue_action_field) or "approved"),
        chat_transferred=chat_transfer.transferred_count > 0, logger=logger,
    )
    return _queue_context_result(
        client, config, deal, logger,
        action="queue_distributed",
        reason="assignment_queue_distributed",
        processed_at=processed_at,
        assigned_by_id=assigned_by_id,
        assigned_by_name=assigned_by_name,
        stage_id=target_stage,
        assignment_strategy=assignment.strategy,
        configured_pool=assignment.configured_pool,
        online_pool=assignment.online_pool,
        linked_activity_count=linked,
        transferred_chat_count=chat_transfer.transferred_count,
        chat_transfer_status=chat_transfer.status,
        found_chat_ids=chat_transfer.found_chat_ids,
        transferred_chat_ids=chat_transfer.transferred_chat_ids,
        skipped_chats=chat_transfer.skipped_chats,
        skipped_non_distributable_chat_count=(
            chat_transfer.skipped_non_distributable_count
        ),
        message="Negociación distribuida desde la cola temporal.",
    )


def _close_queued_deal(
    client: Any,
    config: AppConfig,
    deal: dict[str, Any],
    logger: Logger,
    processed_at: datetime,
) -> dict[str, object]:
    deal_id = _required_int(deal.get("id"), "id")
    lead_id = _required_int(deal.get("leadId"), "leadId")
    _assign_lead_responsible(
        client, lead_id=lead_id,
        assigned_by_id=config.deal.provisional_user_id, logger=logger,
    )
    client.call(
        "crm.item.update",
        {
            "entityTypeId": DEAL_ENTITY_TYPE_ID,
            "id": deal_id,
            "fields": {
                "stageId": config.deal.manual_review_stage_id,
                "assignedById": config.deal.provisional_user_id,
            },
        },
    )
    return _queue_context_result(
        client, config, deal, logger,
        action="queue_closed",
        reason="assignment_queue_closed",
        processed_at=processed_at,
        assigned_by_id=config.deal.provisional_user_id,
        assigned_by_name="Maru Lopez",
        stage_id=config.deal.manual_review_stage_id,
        assignment_strategy="assignment_queue_closed_manual",
        message="Sin vendedor disponible al cierre de la ventana semanal.",
    )


def _queue_context_result(
    client: Any,
    config: AppConfig,
    deal: dict[str, Any],
    logger: Logger,
    **overrides: Any,
) -> dict[str, object]:
    lead_id = _optional_int(deal.get("leadId"))
    context = (
        _lead_trace_context(client, config, lead_id, logger)
        if lead_id is not None else {}
    )
    contact_id = _optional_int(context.pop("contact_id", None)) or _optional_int(
        deal.get("contactId")
    )
    legacy_action = str(overrides.get("action") or "")
    distribution_action = {
        "queue_waiting": "queued",
        "queue_distributed": "assigned",
        "queue_closed": "manual_owner",
    }.get(legacy_action, legacy_action)
    return _result(
        has_pending=overrides.get("action") == "queue_waiting",
        deal_id=_optional_int(deal.get("id")),
        lead_id=lead_id,
        contact_id=contact_id,
        deal_title=str(deal.get("title") or ""),
        stage_before=config.deal.assignment_queue_stage_id,
        routing_bucket=str(deal.get(config.deal.routing_bucket_field) or ""),
        commercial_line=str(deal.get(config.deal.commercial_line_field) or "") or None,
        previous_assigned_by_id=_optional_int(deal.get("assignedById")),
        within_business_hours=overrides.get("action") != "queue_closed",
        commercial_action=str(deal.get(config.deal.queue_action_field) or ""),
        commercial_reason=str(deal.get(config.deal.queue_reason_field) or ""),
        commercial_stage_id=str(
            deal.get(config.deal.queue_target_stage_field) or ""
        ),
        distribution_action=distribution_action,
        distribution_reason=str(overrides.get("reason") or ""),
        **context,
        **overrides,
    )


def _queue_batch_result(
    events: list[dict[str, object]], processed_at: datetime
) -> dict[str, object]:
    return {
        "ok": not any(not bool(event.get("ok")) for event in events),
        "processed_at": processed_at.isoformat(),
        "event_count": len(events),
        "distributed_count": sum(event.get("action") == "queue_distributed" for event in events),
        "waiting_count": sum(event.get("action") == "queue_waiting" for event in events),
        "closed_count": sum(event.get("action") == "queue_closed" for event in events),
        "events": events,
        "events_json": json.dumps(events, ensure_ascii=False),
    }


def _queue_error_result(
    config: AppConfig,
    deal: dict[str, Any],
    processed_at: datetime,
    exc: Exception,
) -> dict[str, object]:
    return _result(
        action="error",
        has_pending=True,
        deal_id=_optional_int(deal.get("id")),
        lead_id=_optional_int(deal.get("leadId")),
        stage_id=config.deal.assignment_queue_stage_id,
        reason="internal_error",
        processed_at=processed_at,
        routing_bucket=str(deal.get(config.deal.routing_bucket_field) or ""),
        assignment_strategy="assignment_queue_error",
        commercial_action=str(deal.get(config.deal.queue_action_field) or ""),
        commercial_reason=str(deal.get(config.deal.queue_reason_field) or ""),
        commercial_stage_id=str(deal.get(config.deal.queue_target_stage_field) or ""),
        distribution_action="error",
        distribution_reason="internal_error",
        message=str(exc),
        ok=False,
    )

def _assign_lead_responsible(
    client: Any,
    *,
    lead_id: int,
    assigned_by_id: int,
    logger: Logger,
) -> None:
    client.call(
        "crm.lead.update",
        {
            "id": lead_id,
            "fields": {"ASSIGNED_BY_ID": assigned_by_id},
        },
    )
    logger.info(
        f"Prospecto {lead_id} sincronizado con responsable {assigned_by_id} "
        "de la negociacion."
    )


def _resolve_bcra_snapshot(
    client: Any,
    config: AppConfig,
    lead: dict[str, Any],
    *,
    lead_id: int,
    deal_id: int,
    source: Mapping[str, str],
    processed_at: datetime,
    logger: Logger,
    bcra_client: Any | None,
) -> BcraSnapshotResolution:
    retry_state = bcra_retry_state_from_lead(lead, config)
    if retry_state is not None and retry_state.is_exhausted:
        return BcraSnapshotResolution(
            lead=lead,
            decision_override=_manual(config, "bcra_retry_exhausted"),
            checked_at=_lead_bcra_checked_at(lead, config),
            age_days=None,
            refreshed=False,
            refresh_outcome=BCRA_RETRY_EXHAUSTED_OUTCOME,
            retry_attempts=retry_state.attempts,
        )

    checked_at = _lead_bcra_checked_at(lead, config)
    parsed_checked_at = _parse_snapshot_datetime(checked_at, processed_at)
    age_days = _snapshot_age_days(parsed_checked_at, processed_at)
    max_age_days = _bcra_max_age_days(source)

    raw_outcome = _lead_bcra_outcome(lead, config)
    if raw_outcome in {"not_found", "invalid_identification"}:
        reason = "bcra_not_found" if raw_outcome == "not_found" else "bcra_invalid_identification"
        return BcraSnapshotResolution(
            lead=lead,
            decision_override=_manual(config, reason),
            checked_at=checked_at,
            age_days=age_days,
            refreshed=False,
            refresh_outcome=f"reused_{raw_outcome}",
        )

    if age_days is not None and age_days < max_age_days and raw_outcome == "ok":
        logger.info(
            f"Snapshot BCRA del lead {lead_id} vigente: "
            f"antiguedad={age_days:.3f} dias."
        )
        return BcraSnapshotResolution(
            lead=lead,
            decision_override=None,
            checked_at=checked_at,
            age_days=age_days,
            refreshed=False,
            refresh_outcome="reused_fresh",
        )

    identification = str(lead.get(config.fields.lead_cuil) or "").strip()
    if not identification:
        logger.error(
            f"No se puede refrescar BCRA para el lead {lead_id}: falta CUIL."
        )
        return BcraSnapshotResolution(
            lead=lead,
            decision_override=_manual(config, "bcra_refresh_missing_cuil"),
            checked_at=checked_at,
            age_days=age_days,
            refreshed=False,
            refresh_outcome="missing_cuil",
        )

    logger.info(
        f"Refrescando snapshot BCRA del lead {lead_id}: "
        f"antiguedad={age_days if age_days is not None else 'desconocida'} dias."
    )
    try:
        result = sync_lead_bcra(
            client,
            config,
            lead_id,
            identification,
            logger,
            bcra_client=bcra_client,
            lead=lead,
            now=processed_at,
        )
    except Exception as exc:
        logger.error(f"No se pudo refrescar BCRA para el lead {lead_id}: {exc}")
        return BcraSnapshotResolution(
            lead=lead,
            decision_override=_manual(config, "bcra_refresh_failed"),
            checked_at=checked_at,
            age_days=age_days,
            refreshed=False,
            refresh_outcome="error",
        )

    if result.outcome in BCRA_RETRY_PENDING_OUTCOMES:
        refreshed_lead = get_lead(client, lead_id, logger)
        refreshed_retry_state = bcra_retry_state_from_lead(refreshed_lead, config)
        _persist_deal_bcra_snapshot(client, config, deal_id, refreshed_lead, logger)
        return BcraSnapshotResolution(
            lead=refreshed_lead,
            decision_override=None,
            checked_at=_lead_bcra_checked_at(refreshed_lead, config),
            age_days=None,
            refreshed=False,
            refresh_outcome=result.outcome,
            pending=True,
            retry_attempts=refreshed_retry_state.attempts if refreshed_retry_state else 0,
            next_retry_at=(
                refreshed_retry_state.next_retry_at.isoformat()
                if refreshed_retry_state and refreshed_retry_state.next_retry_at
                else ""
            ),
        )

    if result.outcome == BCRA_RETRY_EXHAUSTED_OUTCOME:
        refreshed_lead = get_lead(client, lead_id, logger)
        refreshed_retry_state = bcra_retry_state_from_lead(refreshed_lead, config)
        _persist_deal_bcra_snapshot(client, config, deal_id, refreshed_lead, logger)
        return BcraSnapshotResolution(
            lead=refreshed_lead,
            decision_override=_manual(config, "bcra_retry_exhausted"),
            checked_at=_lead_bcra_checked_at(refreshed_lead, config),
            age_days=None,
            refreshed=False,
            refresh_outcome=result.outcome,
            retry_attempts=refreshed_retry_state.attempts if refreshed_retry_state else 0,
        )

    if not result.is_persistable:
        logger.error(
            f"BCRA no produjo un snapshot persistible para el lead {lead_id}: "
            f"outcome={result.outcome}."
        )
        return BcraSnapshotResolution(
            lead=lead,
            decision_override=_manual(config, "bcra_refresh_failed"),
            checked_at=checked_at,
            age_days=age_days,
            refreshed=False,
            refresh_outcome=result.outcome or "not_persistable",
        )

    refreshed_lead = get_lead(client, lead_id, logger)
    _persist_deal_bcra_snapshot(client, config, deal_id, refreshed_lead, logger)
    refreshed_checked_at = _lead_bcra_checked_at(refreshed_lead, config) or result.checked_at
    refreshed_datetime = _parse_snapshot_datetime(refreshed_checked_at, processed_at)
    refreshed_age_days = _snapshot_age_days(refreshed_datetime, processed_at)
    logger.info(
        f"Snapshot BCRA del lead {lead_id} actualizado para clasificacion: "
        f"outcome={result.outcome}."
    )
    return BcraSnapshotResolution(
        lead=refreshed_lead,
        decision_override=(
            _manual(config, "bcra_not_found")
            if result.outcome == "not_found"
            else _manual(config, "bcra_invalid_identification")
            if result.outcome == "invalid_identification"
            else None
        ),
        checked_at=refreshed_checked_at,
        age_days=refreshed_age_days,
        refreshed=True,
        refresh_outcome=result.outcome or "refreshed",
    )


def _lead_bcra_outcome(lead: dict[str, Any], config: AppConfig) -> str:
    raw_field = config.fields.lead_bcra_data_raw
    try:
        payload = json.loads(str(lead.get(raw_field or "") or ""))
    except (TypeError, ValueError, json.JSONDecodeError):
        return ""
    if not isinstance(payload, dict):
        return ""
    return str(payload.get("outcome") or "").strip()


def _lead_bcra_checked_at(lead: dict[str, Any], config: AppConfig) -> str:
    checked_at_field = config.fields.lead_bcra_checked_at
    if checked_at_field:
        checked_at = str(lead.get(checked_at_field) or "").strip()
        if checked_at:
            return checked_at

    raw_field = config.fields.lead_bcra_data_raw
    raw_value = lead.get(raw_field) if raw_field else None
    try:
        payload = json.loads(str(raw_value or ""))
    except (TypeError, ValueError):
        return ""
    if not isinstance(payload, dict):
        return ""
    return str(payload.get("queried_at") or "").strip()


def _parse_snapshot_datetime(value: str, reference: datetime) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=reference.tzinfo)
    return parsed.astimezone(reference.tzinfo)


def _snapshot_age_days(checked_at: datetime | None, reference: datetime) -> float | None:
    if checked_at is None:
        return None
    return max(0.0, (reference - checked_at).total_seconds() / 86_400)


def _bcra_max_age_days(source: Mapping[str, str]) -> int:
    raw_value = str(source.get(BCRA_MAX_AGE_DAYS_ENV) or BCRA_MAX_AGE_DAYS_DEFAULT).strip()
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise ValueError(f"{BCRA_MAX_AGE_DAYS_ENV} debe ser un entero.") from exc
    if value <= 0:
        raise ValueError(f"{BCRA_MAX_AGE_DAYS_ENV} debe ser mayor a cero.")
    return value


def _persist_deal_bcra_snapshot(
    client: Any,
    config: AppConfig,
    deal_id: int,
    lead: dict[str, Any],
    logger: Logger,
) -> None:
    fields: dict[str, Any] = {}
    for lead_field, deal_field in (
        (config.fields.lead_bcra_status, DEAL_DIRECT_FIELD_MAPPINGS["bcra_status"]),
        (config.fields.lead_bcra_result, DEAL_DIRECT_FIELD_MAPPINGS["bcra_result"]),
        (config.fields.lead_bcra_data_raw, DEAL_DIRECT_FIELD_MAPPINGS["bcra_data_raw"]),
        (config.fields.lead_bcra_checked_at, DEAL_DIRECT_FIELD_MAPPINGS["bcra_checked_at"]),
    ):
        if lead_field and lead.get(lead_field) is not None:
            fields[deal_field] = lead.get(lead_field)
    if not fields:
        return
    client.call(
        "crm.item.update",
        {
            "entityTypeId": DEAL_ENTITY_TYPE_ID,
            "id": deal_id,
            "fields": fields,
        },
    )
    logger.info(f"Snapshot BCRA actualizado en la negociacion {deal_id}.")


def _evaluate_deal(client: Any, config: AppConfig, lead: dict[str, Any]) -> CommercialDecision:
    try:
        submission = build_submission_from_lead(lead, config)
    except ValueError:
        return _manual(config, "missing_prequalification_data")

    if submission.province.key == "catamarca":
        return _evaluate_catamarca(client, config, lead, submission.payment_bank.label)
    if submission.province.key == "cordoba":
        return _evaluate_cordoba(
            config,
            lead,
            submission.employment_status.key,
            submission.payment_bank.label,
        )
    return _manual(config, "province_not_supported_for_deal_classification")


def _evaluate_catamarca(
    client: Any,
    config: AppConfig,
    lead: dict[str, Any],
    payment_bank: str,
) -> CommercialDecision:
    entities = _bcra_entities(config, lead)
    if entities is None:
        return _manual(config, "bcra_snapshot_not_conclusive")

    payment_situation = _payment_bank_situation(entities, payment_bank)
    if payment_situation is None:
        return _manual(config, "payment_bank_not_identifiable")
    common_rejection = _common_bcra_rejection(config, entities, payment_situation, 4, 2)
    if common_rejection is not None:
        return common_rejection

    member_label = _normalize_text(
        lead_enum_label(client, lead, config.fields.lead_es_socio)
    )
    if member_label == "si":
        # Core no expone hoy el estado de la cuota social AMEJUCA. Los rechazos
        # BCRA comunes sí se aplican; la aprobación recurrente queda manual.
        return _manual(config, "missing_recurrent_membership_data")
    if member_label != "no":
        return _manual(config, "missing_membership_data")

    situations = _situations(entities)
    situation_two_count = sum(value == 2 for value in situations)
    if (
        situation_two_count <= 5
        and all(value <= 2 for value in situations)
        and payment_situation <= 2
    ):
        return _approved(config, "amejuca_premium", "AMEJUCA Premium")
    if payment_situation <= 1:
        return _approved(config, "amejuca_special", "AMEJUCA Especial")
    return _manual(config, "amejuca_line_ambiguous_for_payment_bank_two")


def _evaluate_cordoba(
    config: AppConfig,
    lead: dict[str, Any],
    employment: str,
    payment_bank: str,
) -> CommercialDecision:
    entities = _bcra_entities(config, lead)
    if entities is None:
        return _manual(config, "missing_bcra_snapshot")
    vimarx = _vimarx_payload(config, lead)

    if employment in {"jubilado_provincial", "jubilado_municipal"}:
        return _evaluate_caja(config, lead, entities, vimarx, payment_bank)
    if employment == "daspu":
        return _manual(config, "daspu_form_691_or_limit_not_available")
    if employment == "empleado_de_la_unc":
        return _evaluate_unc(config, lead, entities, vimarx)
    if employment in {
        "empleado_publico_provincial",
        "policia",
        "docente",
        "empleado_publico_municipal",
        "personal_de_salud",
        "jubilado_nacional",
        "pensionado",
    }:
        return _evaluate_cbu(config, lead, entities, employment, vimarx)
    return _manual(config, "unsupported_cordoba_employment_status")


def _evaluate_cbu(
    config: AppConfig,
    lead: dict[str, Any],
    entities: list[dict[str, Any]],
    employment: str,
    vimarx: dict[str, Any] | None,
) -> CommercialDecision:
    if len(entities) > 5:
        return _bcra_rejected(config, "cbu_more_than_five_entities")
    if any(value > 1 for value in _situations(entities)):
        return _bcra_rejected(config, "cbu_situation_above_one")
    age = _age_from_lead(lead, vimarx)
    if age is None:
        return _manual(config, "missing_birthdate")
    if employment in {"jubilado_nacional", "pensionado"}:
        if age >= 80:
            return _commercial_rejected(config, "cbu_passive_age_80_or_more")
    elif age >= 60:
        return _manual(config, "cbu_gender_required_for_age_limit")
    return _approved(config, "cbu_approved", "CBU")


def _evaluate_caja(
    config: AppConfig,
    lead: dict[str, Any],
    entities: list[dict[str, Any]],
    vimarx: dict[str, Any] | None,
    payment_bank: str,
) -> CommercialDecision:
    age = _age_from_lead(lead, vimarx)
    if age is None:
        return _manual(config, "missing_birthdate")
    if age >= 80:
        return _commercial_rejected(config, "caja_age_80_or_more")
    if vimarx is None:
        return _manual(config, "missing_vimarx_credit_data")

    recurrent_credits = _family_credits(vimarx, 2756)
    recurrent = bool(recurrent_credits)
    situations = _situations(entities)
    payment_situation = _payment_bank_situation(entities, payment_bank)
    if payment_situation is None:
        return _manual(config, "payment_bank_not_identifiable")

    if not recurrent and payment_situation > 1:
        return _bcra_rejected(config, "caja_new_payment_bank_above_one")
    if any(value in {4, 5} for value in situations):
        if payment_situation > 1:
            return _bcra_rejected(config, "caja_morosos_payment_bank_above_one")
        if _has_excluded_caja_entity(entities):
            return _manual(config, "caja_morosos_excluded_entity")
        if recurrent_credits and min(_paid_installments(recurrent_credits)) < 4:
            return _manual(config, "caja_morosos_parallel_minimum_not_met")
        return _approved(config, "caja_morosos", "Caja Morosos")

    if any(value in {2, 3} for value in situations):
        if recurrent_credits and min(_paid_installments(recurrent_credits)) < 4:
            return _manual(config, "caja_irregular_parallel_minimum_not_met")
        return _approved(config, "caja_irregulares", "Caja Irregulares")
    if recurrent:
        if min(_paid_installments(recurrent_credits)) < 1:
            return _manual(config, "caja_general_parallel_minimum_not_met")
        return _approved(config, "caja_general", "Caja General")
    return _approved(config, "caja_nuevo", "Caja Nuevo")


def _evaluate_unc(
    config: AppConfig,
    lead: dict[str, Any],
    entities: list[dict[str, Any]],
    vimarx: dict[str, Any] | None,
) -> CommercialDecision:
    if vimarx is None or not isinstance(vimarx.get("socio"), dict):
        return _manual(config, "unc_activity_not_verifiable")
    socio = vimarx["socio"]
    if socio.get("dado_de_baja") or "club mutual" not in _normalize_text(socio.get("categoria")):
        return _manual(config, "unc_activity_not_verifiable")
    age = _age_from_lead(lead, vimarx)
    if age is None or age >= 60:
        return _manual(config, "unc_gender_required_for_age_limit")
    if _high_risk_count(entities) > 3:
        return _manual(config, "unc_more_than_three_high_risk_situations")
    if _named_bank_situation(entities, "nacion") > 1:
        return _manual(config, "unc_banco_nacion_irregular")
    return _approved(config, "club_mutual_cbu", "Club Mutual CBU")


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


def _bcra_entities(config: AppConfig, lead: dict[str, Any]) -> list[dict[str, Any]] | None:
    raw_value = lead.get(config.fields.lead_bcra_data_raw or "")
    try:
        snapshot = json.loads(str(raw_value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(snapshot, dict) or snapshot.get("outcome") != "ok":
        return None
    payload = snapshot.get("payload")
    results = payload.get("results") if isinstance(payload, dict) else None
    periods = results.get("periodos") if isinstance(results, dict) else None
    if not isinstance(periods, list) or not periods:
        return None
    return _latest_bcra_entities(snapshot)


def _situations(entities: list[dict[str, Any]]) -> list[int]:
    return [
        value
        for entity in entities
        if (value := _optional_int(entity.get("situacion"))) is not None
    ]


def _high_risk_count(entities: list[dict[str, Any]]) -> int:
    return sum(value in {4, 5} for value in _situations(entities))


def _common_bcra_rejection(
    config: AppConfig,
    entities: list[dict[str, Any]],
    payment_situation: int,
    max_high_risk: int,
    max_payment_situation: int,
) -> CommercialDecision | None:
    if _high_risk_count(entities) > max_high_risk:
        return _bcra_rejected(config, "bcra_more_than_four_high_risk_situations")
    if payment_situation > max_payment_situation:
        return _bcra_rejected(config, "payment_bank_situation_above_two")
    return None


def _payment_bank_situation(
    entities: list[dict[str, Any]], payment_bank: str
) -> int | None:
    normalized_bank = _normalize_text(payment_bank)
    aliases = (
        "nacion", "cordoba", "pampa", "neuquen", "patagonia", "bbva",
        "santander", "chubut", "hsbc", "itau", "macro", "galicia",
        "provincia de buenos aires", "icbc", "citibank", "supervielle",
        "ciudad de buenos aires", "hipotecario", "san juan", "municipal de rosario",
        "santa cruz", "corrientes", "bank of china", "brubank", "bibank",
        "open bank", "jpmorgan", "credicoop", "valores", "roela", "mariva",
        "bnp paribas", "tierra del fuego", "republica oriental del uruguay",
        "saenz", "meridian", "comafi", "piano", "julio", "rioja", "banco del sol",
        "chaco", "voii", "formosa", "cmf", "santiago del estero", "industrial",
        "santa fe", "cetelem", "servicios financieros", "servicios y transacciones",
        "rci banque", "bacs", "masventas", "wilobank", "entre rios", "columbia",
        "bica", "comercio", "sucredito", "dino", "coinag",
    )
    key = next((alias for alias in aliases if alias in normalized_bank), None)
    if key is None:
        return None
    return max(
        (
            _optional_int(entity.get("situacion")) or 0
            for entity in entities
            if key in _normalize_text(entity.get("entidad"))
        ),
        default=0,
    )


def _named_bank_situation(entities: list[dict[str, Any]], key: str) -> int:
    return max(
        (
            _optional_int(entity.get("situacion")) or 0
            for entity in entities
            if key in _normalize_text(entity.get("entidad"))
        ),
        default=0,
    )


def _vimarx_payload(config: AppConfig, lead: dict[str, Any]) -> dict[str, Any] | None:
    raw = lead.get(config.fields.lead_vimarx_creditos_activos_raw or "")
    try:
        payload = json.loads(str(raw))
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        return None
    return payload


def _family_credits(vimarx: dict[str, Any] | None, superior_id: int) -> list[dict[str, Any]]:
    if not isinstance(vimarx, dict) or not isinstance(vimarx.get("creditos"), list):
        return []
    return [
        credit
        for credit in vimarx["creditos"]
        if isinstance(credit, dict)
        and _optional_int(credit.get("linea_superior_id")) == superior_id
    ]


def _age_from_lead(
    lead: dict[str, Any], vimarx: dict[str, Any] | None = None
) -> int | None:
    raw = str(lead.get("BIRTHDATE") or "").strip()
    socio = vimarx.get("socio") if isinstance(vimarx, dict) else None
    if not raw and isinstance(socio, dict):
        raw = str(socio.get("fecha_nacimiento") or "").strip()
    if not raw:
        return _optional_int(socio.get("edad")) if isinstance(socio, dict) else None
    try:
        born = datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
    except ValueError:
        try:
            born = date.fromisoformat(raw[:10])
        except ValueError:
            return None
    today = date.today()
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def _has_excluded_caja_entity(entities: list[dict[str, Any]]) -> bool:
    excluded = (
        "candelaria", "banco del sol", "credikot", "proteccion familiar",
        "compania financiera argentina", "firenz",
    )
    return any(
        any(token in _normalize_text(entity.get("entidad")) for token in excluded)
        and (_optional_int(entity.get("situacion")) or 0) in {4, 5}
        for entity in entities
    )


def _paid_installments(credits: list[dict[str, Any]]) -> list[int]:
    return [_optional_int(credit.get("cuotas_pagas")) or 0 for credit in credits]


def _approved(config: AppConfig, reason: str, line: str) -> CommercialDecision:
    return CommercialDecision("approved", reason, config.deal.stage_id, line)


def _bcra_rejected(config: AppConfig, reason: str) -> CommercialDecision:
    return CommercialDecision("rejected", reason, config.deal.bcra_rejected_stage_id)


def _commercial_rejected(config: AppConfig, reason: str) -> CommercialDecision:
    return CommercialDecision(
        "commercial_rejected", reason, config.deal.commercial_rejected_stage_id
    )


def _lead_trace_context(
    client: Any,
    config: AppConfig,
    lead_id: int,
    logger: Logger,
) -> dict[str, Any]:
    context: dict[str, Any] = {
        "contact_id": None,
        "province": "",
        "employment_status": "",
        "payment_bank": "",
        "source": "",
    }
    try:
        lead = get_lead(client, lead_id, logger)
        context.update(
            contact_id=_optional_int(lead.get("CONTACT_ID")),
            province=lead_enum_label(
                client, lead, config.fields.lead_province
            ) or "",
            employment_status=lead_enum_label(
                client, lead, config.fields.lead_employment_status
            ) or "",
            payment_bank=lead_enum_label(
                client, lead, config.fields.lead_payment_bank
            ) or "",
            source=lead_enum_label(
                client, lead, config.fields.lead_source
            ) or "",
        )
    except Exception as error:
        logger.error(
            f"No se pudo completar el contexto del lead {lead_id} para la "
            f"trazabilidad: {error}"
        )
    return context


def technical_deal_trace(
    deal_id: int | str | None,
    error: Exception,
    *,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    logger: Logger | None = None,
    now: datetime | None = None,
) -> dict[str, object]:
    """Build a best-effort, read-only trace for a failed deal execution."""
    active_logger = logger or create_logger()
    source = os.environ if env is None else env
    processed_at = _local_datetime(source, now)
    deal_id_int = _optional_int(deal_id)
    context: dict[str, Any] = {}

    if deal_id_int is not None:
        try:
            config = load_config(env)
            client = bitrix_client or BitrixClient(config, active_logger)
            deal = _get_deal(client, deal_id_int)
            lead_id = _optional_int(deal.get("leadId") or deal.get("LEAD_ID"))
            contact_id = _optional_int(
                deal.get("contactId") or deal.get("CONTACT_ID")
            )
            context = {
                "lead_id": lead_id,
                "contact_id": contact_id,
                "deal_title": str(
                    deal.get("title") or deal.get("TITLE") or ""
                ).strip(),
                "stage_id": str(
                    deal.get("stageId") or deal.get("STAGE_ID") or ""
                ).strip(),
                "previous_assigned_by_id": _optional_int(
                    deal.get("assignedById") or deal.get("ASSIGNED_BY_ID")
                ),
            }
            context["stage_before"] = context["stage_id"]
            if lead_id is not None:
                lead = get_lead(client, lead_id, active_logger)
                context["contact_id"] = contact_id or _optional_int(
                    lead.get("CONTACT_ID")
                )
                context["province"] = lead_enum_label(
                    client, lead, config.fields.lead_province
                ) or ""
                context["employment_status"] = lead_enum_label(
                    client, lead, config.fields.lead_employment_status
                ) or ""
                context["payment_bank"] = lead_enum_label(
                    client, lead, config.fields.lead_payment_bank
                ) or ""
                context["source"] = lead_enum_label(
                    client, lead, config.fields.lead_source
                ) or ""
        except Exception as hydration_error:
            active_logger.error(
                "No se pudo completar el contexto de trazabilidad para la "
                f"negociacion {deal_id_int}: {hydration_error}"
            )

    return _result(
        ok=False,
        action="error",
        has_pending=True,
        deal_id=deal_id_int,
        reason="internal_error",
        processed_at=processed_at,
        within_business_hours=_is_within_business_hours(source, processed_at),
        assignment_strategy="technical_error",
        message=str(error),
        **context,
    )


def _get_deal(client: Any, deal_id: int) -> dict[str, Any]:
    result = client.call(
        "crm.item.get",
        {"entityTypeId": DEAL_ENTITY_TYPE_ID, "id": deal_id},
    )
    item = result.get("item") if isinstance(result, dict) else None
    if not isinstance(item, dict):
        raise RuntimeError("crm.item.get no devolvio la negociacion esperada.")
    return item


def _manual(config: AppConfig, reason: str) -> CommercialDecision:
    return CommercialDecision(
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
    workdays = list(
        dict.fromkeys(
            WEEKDAY_CODES[code.strip()]
            for code in str(source.get(BUSINESS_HOURS_WORKDAYS_ENV, "MO,TU,WE,TH,FR"))
            .upper()
            .split(",")
            if code.strip() in WEEKDAY_CODES
        )
    )
    starts_at = time.fromisoformat(str(source.get(BUSINESS_HOURS_FROM_ENV, "00:00")))
    ends_at = time.fromisoformat(str(source.get(BUSINESS_HOURS_TO_ENV, "17:00")))
    local_time = local_now.time().replace(tzinfo=None)
    weekday = local_now.weekday()

    if weekday not in workdays:
        return False
    if len(workdays) == 1:
        return starts_at <= local_time < ends_at
    if weekday == workdays[0]:
        return local_time >= starts_at
    if weekday == workdays[-1]:
        return local_time < ends_at
    return True


def _local_datetime(
    source: dict[str, str],
    now: datetime | None = None,
) -> datetime:
    timezone = ZoneInfo(
        str(source.get(BUSINESS_HOURS_TIMEZONE_ENV, "America/Argentina/Cordoba")).strip()
    )
    return now.astimezone(timezone) if now is not None else datetime.now(timezone)


def _parse_bitrix_datetime(
    value: Any,
    source: dict[str, str],
) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    timezone = ZoneInfo(
        str(source.get(BUSINESS_HOURS_TIMEZONE_ENV, "America/Argentina/Cordoba")).strip()
    )
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone)
    return parsed.astimezone(timezone)


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
    assigned_by_name: str = "",
    routing_bucket: str = "",
    commercial_line: str | None = None,
    processed_at: datetime | None = None,
    contact_id: int | None = None,
    deal_title: str = "",
    stage_before: str = "",
    previous_assigned_by_id: int | None = None,
    province: str = "",
    employment_status: str = "",
    payment_bank: str = "",
    within_business_hours: bool | None = None,
    assignment_strategy: str = "",
    configured_pool: tuple[int, ...] = (),
    online_pool: tuple[int, ...] = (),
    linked_activity_count: int = 0,
    transferred_chat_count: int = 0,
    chat_transfer_status: str = "not_evaluated",
    found_chat_ids: tuple[int, ...] = (),
    transferred_chat_ids: tuple[int, ...] = (),
    skipped_chats: tuple[tuple[int, str], ...] = (),
    skipped_non_distributable_chat_count: int = 0,
    bcra_snapshot_checked_at: str = "",
    bcra_snapshot_age_days: float | None = None,
    bcra_snapshot_refreshed: bool = False,
    bcra_refresh_outcome: str = "not_evaluated",
    bcra_retry_attempts: int = 0,
    bcra_next_retry_at: str = "",
    source: str = "",
    commercial_action: str = "",
    commercial_reason: str = "",
    commercial_stage_id: str = "",
    distribution_action: str = "",
    distribution_reason: str = "",
    ok: bool = True,
) -> dict[str, object]:
    decision_label = business_decision(
        commercial_action or action,
        commercial_line,
        assigned_by_id,
    )
    reason_label = business_reason(commercial_reason or reason, message)
    return {
        "ok": ok,
        "trace_schema_version": TRACE_SCHEMA_VERSION,
        "event_type": "deal_commercial_distribution_decision",
        "action": action,
        "commercial_action": commercial_action,
        "commercial_reason": commercial_reason,
        "commercial_stage_id": commercial_stage_id,
        "distribution_action": distribution_action,
        "distribution_reason": distribution_reason,
        "business_decision": decision_label,
        "business_reason": reason_label,
        "has_pending": has_pending,
        "message": message,
        "deal_id": deal_id,
        "lead_id": lead_id,
        "stage_id": stage_id,
        "reason": reason,
        "assigned_by_id": assigned_by_id,
        "assigned_by_name": assigned_by_name,
        "previous_assigned_by_id": previous_assigned_by_id,
        "routing_bucket": routing_bucket,
        "commercial_line": commercial_line,
        "processed_at": processed_at.isoformat() if processed_at else "",
        "contact_id": contact_id,
        "deal_title": deal_title,
        "stage_before": stage_before,
        "province": province,
        "employment_status": employment_status,
        "payment_bank": payment_bank,
        "source": source,
        "within_business_hours": within_business_hours,
        "assignment_strategy": assignment_strategy,
        "configured_pool": ",".join(str(user_id) for user_id in configured_pool),
        "online_pool": ",".join(str(user_id) for user_id in online_pool),
        "linked_activity_count": linked_activity_count,
        "transferred_chat_count": transferred_chat_count,
        "chat_transfer_status": chat_transfer_status,
        "found_chat_ids": ",".join(str(chat_id) for chat_id in found_chat_ids),
        "transferred_chat_ids": ",".join(
            str(chat_id) for chat_id in transferred_chat_ids
        ),
        "skipped_chat_ids": ",".join(
            str(chat_id) for chat_id, _reason in skipped_chats
        ),
        "skipped_chat_reasons": "; ".join(
            f"{chat_id}:{reason}" for chat_id, reason in skipped_chats
        ),
        "skipped_non_distributable_chat_count": (
            skipped_non_distributable_chat_count
        ),
        "bcra_snapshot_checked_at": bcra_snapshot_checked_at,
        "bcra_snapshot_age_days": (
            round(bcra_snapshot_age_days, 3)
            if bcra_snapshot_age_days is not None
            else ""
        ),
        "bcra_snapshot_refreshed": bcra_snapshot_refreshed,
        "bcra_refresh_outcome": bcra_refresh_outcome,
        "bcra_retry_attempts": bcra_retry_attempts,
        "bcra_next_retry_at": bcra_next_retry_at,
        "rule_version": COMMERCIAL_RULE_VERSION,
    }
