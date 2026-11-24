from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from inspect import signature
from datetime import date, datetime, timedelta
import json
import os
import unicodedata
from time import monotonic
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
from .distribution_schedule import is_within_business_hours as _is_within_business_hours
from . import _sales_opening as schedule
from ._routing_cutover import new_routing_enabled
from .config import AppConfig, load_config
from .expanded_deal_family import expanded_deal_family
from .commercial_trace import (
    TRACE_SCHEMA_VERSION,
    business_decision,
    business_reason,
)
from .deal_service import (
    DEAL_DIRECT_FIELD_MAPPINGS,
    DEAL_ENTITY_TYPE_ID,
    NoOnlineSellersError,
    active_open_line_owners,
    assign_open_line_chats_to_user,
    bind_open_line_activities_to_deal,
    inspect_open_line_assignments,
    notify_distribution_supervisor,
    notify_unmatched_routing,
    resolve_round_robin_assignee,
    user_display_name,
)
from .deal_vimarx_refresh import VimarxRefreshResolution, refresh_deal_vimarx, vimarx_retry_waiting
from .deal_commercial_decision import persist_commercial_decision
from .lead_service import (
    build_submission_from_lead,
    get_lead,
    lead_enum_label,
)
from .logger import Logger, create_logger
from .routing_bucket import resolve_routing_bucket, routing_bucket_by_key
from .qualification import is_policia_federal_caba


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
COMMERCIAL_RULE_VERSION = "2026-11-03-buenos-aires-sin-publico-provincial"
BCRA_MAX_AGE_DAYS_ENV = "BITRIX24_DEAL_BCRA_MAX_AGE_DAYS"
BCRA_MAX_AGE_DAYS_DEFAULT = 7
QUEUE_BUCKET_KEYS = (
    "santa_fe",
    "mutual_paii",
    "neuquen",
    "policia_federal_caba",
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
    selected = _select_pending_catamarca_deals(
        env=env, bitrix_client=bitrix_client, logger=logger, now=now,
    )
    return selected[0] if selected else _result(
        action="no_pending", has_pending=False,
        message="No hay negociaciones pendientes de clasificación comercial.",
    )


def process_pending_catamarca_deals(
    *,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    bcra_client: Any | None = None,
    logger: Logger | None = None,
    now: datetime | None = None,
) -> dict[str, object]:
    """Process a bounded batch serially under the flow's concurrency limit."""
    active_logger = logger or create_logger()
    source = dict(os.environ if env is None else env)
    limit = max(1, min(20, int(source.get("BITRIX24_DEAL_QUALIFICATION_BATCH_SIZE", "5"))))
    client = bitrix_client or BitrixClient(load_config(env), active_logger)
    deadline = monotonic() + 50
    # Materialize before changing stages: offset pagination would otherwise skip
    # deals when an earlier page shrinks during processing.
    selected = _select_pending_catamarca_deals(
        limit=limit, env=env, bitrix_client=client, logger=active_logger, now=now,
    )
    events: list[dict[str, object]] = []
    for candidate in selected:
        if events and monotonic() >= deadline:
            break
        deal_id = candidate["deal_id"]
        try:
            event = qualify_catamarca_deal(
                deal_id, env=env, bitrix_client=client, bcra_client=bcra_client,
                logger=active_logger, now=now,
            )
        except Exception as exc:
            event = technical_deal_trace(
                deal_id, exc, env=env, bitrix_client=client, logger=active_logger, now=now,
            )
        events.append(event)
        from .chat_response_worker import enqueue_classified_deal
        enqueue_classified_deal(event, source, active_logger)
        # Respect provider throttling for the rest of this batch too.
        if event.get("bcra_refresh_outcome") == "rate_limited":
            break
    legacy = events[-1] if events else _result(
        action="no_pending", has_pending=False,
        message="No hay negociaciones pendientes de clasificación comercial.",
    )
    return {
        **legacy,
        "ok": all(bool(event.get("ok")) for event in events),
        "event_count": len(events),
        "deferred_count": len(selected) - len(events),
        "events_json": json.dumps(events, ensure_ascii=False),
        "chat_delivery_totals_json": _chat_delivery_totals_json(events),
    }


def _select_pending_catamarca_deals(
    *,
    limit: int = 1,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    logger: Logger | None = None,
    now: datetime | None = None,
) -> list[dict[str, object]]:
    active_logger = logger or create_logger()
    config = load_config(env)
    client = bitrix_client or BitrixClient(config, active_logger)
    current_time = _local_datetime(
        dict(os.environ if env is None else env),
        now,
    )
    selected: list[dict[str, object]] = []
    seen: set[int] = set()
    filters = {"=categoryId": config.deal.category_id, "=stageId": config.deal.pending_qualification_stage_id}
    lanes = []
    if limit > 1:
        since = (current_time - timedelta(hours=1)).isoformat(timespec="seconds")
        lanes.append(({**filters, ">=createdTime": since}, 1))
    lanes.append((filters, limit))
    for lane_filter, stop_at in lanes:
        for candidate in _eligible_pending_deals(client, config, active_logger, current_time, lane_filter, seen):
            selected.append(candidate)
            if len(selected) >= stop_at:
                break
    return selected


def _eligible_pending_deals(client, config, active_logger, current_time, filters, seen):
    start = 0
    while True:
        response = client.call_full(
            "crm.item.list",
            {
                "entityTypeId": DEAL_ENTITY_TYPE_ID,
                "filter": filters,
                "order": {"id": "ASC"},
                "select": [
                    "id", "leadId", "contactId", "stageId",
                    DEAL_DIRECT_FIELD_MAPPINGS["vimarx_creditos_activos_raw"],
                ],
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
            if deal_id is None or lead_id is None or deal_id in seen:
                continue
            seen.add(deal_id)
            lead = get_lead(client, lead_id, active_logger)
            family = expanded_deal_family(config, lead)
            if not family and vimarx_retry_waiting(deal, lead, config, now=current_time):
                continue
            if family not in {"anses", "neuquen", "buenos_aires"} and bcra_retry_waiting(
                lead,
                config,
                now=current_time,
            ):
                active_logger.info(
                    f"Negociacion {deal_id} omitida por ahora: "
                    "la consulta BCRA tiene un reintento programado."
                )
                continue
            yield _result(
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
        following = int(next_page)
        if following <= start:
            raise RuntimeError("crm.item.list no avanzo la paginacion.")
        start = following



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
    new_intake = _new_owner_policy(deal, lead)
    contact_id = contact_id or _optional_int(lead.get("CONTACT_ID"))
    guarded_sessions, guard_reason = _routing_preflight(client, config, deal, active_logger)
    if guard_reason:
        return _routing_preserved(client, config, deal, processed_at, guard_reason, active_logger)
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
    vimarx_resolution = (
        VimarxRefreshResolution(lead, "not_required")
        if expanded_deal_family(config, lead)
        else refresh_deal_vimarx(
            client, config, lead, deal=deal, lead_id=lead_id, deal_id=deal_id_int,
            source=source, processed_at=processed_at, logger=active_logger,
        )
    )
    lead = vimarx_resolution.lead
    bcra_trace.update(vimarx_resolution.trace)
    if vimarx_resolution.pending:
        return _result(
            action="vimarx_pending",
            has_pending=True,
            deal_id=deal_id_int,
            lead_id=lead_id,
            stage_id=config.deal.pending_qualification_stage_id,
            reason=vimarx_resolution.reason,
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
            commercial_reason=vimarx_resolution.reason,
            commercial_stage_id=config.deal.pending_qualification_stage_id,
            distribution_action="not_applicable",
            distribution_reason="commercial_data_pending",
            message="La decision queda pendiente; Kestra volvera a consultar Vimarx automaticamente.",
            **bcra_trace,
        )
    decision = (
        _manual(config, vimarx_resolution.reason) if vimarx_resolution.reason
        else bcra_resolution.decision_override or _evaluate_deal(client, config, lead)
    )
    fresh_sessions, guard_reason = _routing_preflight(client, config, deal, active_logger)
    if guard_reason or fresh_sessions != guarded_sessions:
        return _routing_preserved(client, config, deal, processed_at, guard_reason or "session_changed_before_assignment", active_logger)
    # Persist before leaving PENDING: stage alone cannot distinguish a rejection
    # from manual review. A failed write keeps this deal out of the chat sweep.
    persist_commercial_decision(client, deal_id_int, decision.action)
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
        preserved = _update_routing_owners(client, config, deal, {
            "stageId": decision.stage_id, "assignedById": config.deal.provisional_user_id,
            config.deal.commercial_line_field: "", config.deal.routing_bucket_field: routing_bucket_key,
            config.deal.queue_action_field: "", config.deal.queue_reason_field: "",
            config.deal.queue_target_stage_field: "", config.deal.queue_enqueued_at_field: "",
        }, guarded_sessions, active_logger, processed_at)
        if preserved:
            return preserved
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

    single_seller_bucket = bucket is not None and len(bucket.seller_ids) == 1
    outside_distribution_window = not new_intake and not single_seller_bucket and _business_hours_gate_enabled(source) and (
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
    window = None
    if new_intake and not single_seller_bucket:
        # Qualification may have spent several minutes waiting for commercial data.
        processed_at = _local_datetime(source, now)
        window = schedule.sales_closed_window(processed_at, config.sales_calendar)
        within_business_hours = window is None
    assignment = None
    configured_pool = bucket.seller_ids
    if window is None:
        try:
            assignment = resolve_round_robin_assignee(
                client, config, contact_id=contact_id, deal_id=deal_id_int, lead_id=lead_id,
                bucket_key=bucket.key, bucket_field=config.deal.routing_bucket_field,
                pool=bucket.seller_ids, legacy_province_label=bucket.legacy_province_label, logger=active_logger,
            )
        except NoOnlineSellersError as exc:
            configured_pool = exc.configured_pool
        if new_intake and not single_seller_bucket:
            processed_at = _local_datetime(source, now)
            window = schedule.sales_closed_window(processed_at, config.sales_calendar)
            within_business_hours = window is None
            if window:
                assignment = None
    if assignment is None:
        fresh_sessions, guard_reason = _routing_preflight(client, config, deal, active_logger)
        if guard_reason or fresh_sessions != guarded_sessions:
            return _routing_preserved(client, config, deal, processed_at, guard_reason or "session_changed_before_assignment", active_logger)
        can_enqueue = (
            new_intake or not _business_hours_gate_enabled(source)
            or (within_business_hours and created_within_distribution_window)
        )
        waiting_reason = "routing_pool_paused" if not configured_pool else "assignment_queued"
        if configured_pool and window is not None:
            waiting_reason = schedule.WAIT_FOR_OPENING
        distribution = DistributionDecision(
            "queued" if can_enqueue else "manual_owner",
            waiting_reason if can_enqueue else "no_online_sellers",
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
                    config.deal.queue_reason_field: (
                        schedule.encode_queue_reason(waiting_reason, decision.reason, processed_at, window)
                        if new_intake else decision.reason
                    ),
                    config.deal.queue_target_stage_field: decision.stage_id,
                    config.deal.queue_enqueued_at_field: processed_at.isoformat(),
                }
            )
        if decision.commercial_line is not None:
            update_fields[config.deal.commercial_line_field] = decision.commercial_line
        preserved = _update_routing_owners(client, config, deal, update_fields,
                                          guarded_sessions, active_logger, processed_at)
        if preserved:
            return preserved
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
            reason=waiting_reason if can_enqueue else "no_online_sellers",
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
            configured_pool=configured_pool,
            online_pool=(),
            commercial_action=decision.action,
            commercial_reason=decision.reason,
            commercial_stage_id=decision.stage_id,
            distribution_action=distribution.action,
            distribution_reason=distribution.reason,
            message=(
                "La negociación espera la apertura de Ventas."
                if waiting_reason == schedule.WAIT_FOR_OPENING
                else "No habia vendedores disponibles; la negociacion queda en cola temporal."
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
    fresh_sessions, guard_reason = _routing_preflight(client, config, deal, active_logger)
    if guard_reason or fresh_sessions != guarded_sessions:
        return _routing_preserved(client, config, deal, processed_at, guard_reason or "session_changed_before_assignment", active_logger)
    handoff, pending = _prepare_chat_handoff(
        client, config, source, deal, guarded_sessions, decision.stage_id, assignment, active_logger, processed_at)
    if pending:
        return pending
    assigned_by_id = handoff.target_id if handoff is not None else assignment.assigned_by_id
    update_fields: dict[str, Any] = {
        "stageId": decision.stage_id,
        "assignedById": assigned_by_id,
        config.deal.routing_bucket_field: bucket.key,
    }
    if decision.commercial_line is not None:
        update_fields[config.deal.commercial_line_field] = decision.commercial_line

    preserved = _update_routing_owners(client, config, deal, update_fields,
                                      guarded_sessions, active_logger, processed_at, guard_writes=handoff is not None)
    if preserved:
        return preserved
    assigned_by_name = user_display_name(client, assigned_by_id=assigned_by_id, logger=active_logger)
    linked_activity_count = bind_open_line_activities_to_deal(
        client,
        lead_id=lead_id,
        # In durable mode a historical contact activity is not proof for this loan.
        contact_id=contact_id if handoff is None else None,
        deal_id=deal_id_int,
        logger=active_logger,
    )
    chat_transfer = handoff or _legacy_chat_transfer(
        client,
        lead_id=lead_id,
        contact_id=contact_id,
        deal_id=deal_id_int,
        assigned_by_id=assigned_by_id,
        distributable_open_line_ids=config.deal.distributable_open_line_ids,
        logger=active_logger,
        expected_stage=decision.stage_id,
        expected_sessions=guarded_sessions,
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
        **({"chat_delivery_status": handoff.status} if handoff else {}),
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
        delivery_states=getattr(chat_transfer, "states", ()),
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
    normalized: list[dict[str, Any]] = []
    for deal in queued:
        try:
            _split_legacy_queue_bucket(client, config, deal)
            normalized.append(deal)
        except Exception as exc:
            active_logger.error(f"No se pudo separar el bucket de la negociacion {deal.get('id')}: {exc}")
            events.append(_queue_error_result(config, deal, processed_at, exc))
    queued = normalized

    within_business_hours = _is_within_business_hours(source, processed_at)
    remaining: list[dict[str, Any]] = []
    for deal in queued:
        bucket_key = str(deal.get(config.deal.routing_bucket_field) or "").strip()
        bucket = routing_bucket_by_key(config, bucket_key)
        if bucket is None or len(bucket.seller_ids) != 1:
            remaining.append(deal)
            continue
        try:
            events.append(_retry_queued_deal(
                client, config, deal, active_logger, processed_at,
                within_business_hours=within_business_hours, env=source,
            ))
        except Exception as exc:
            active_logger.error(f"No se pudo distribuir el bucket de vendedor unico {bucket_key}: {exc}")
            events.append(_queue_error_result(config, deal, processed_at, exc))
    queued = remaining

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
        state, reason = schedule.decode_queue_reason(str(deal.get(config.deal.queue_reason_field) or ""))
        new_intake = bool(state) and new_routing_enabled(deal.get("createdTime"))
        try:
            if state and (not new_intake or state == "invalid_queue_marker"):
                raise ValueError("El registro de espera no coincide con el alta de la negociación.")
            if new_intake and enqueued_at and bucket_key in current and _hold_until_sales_opening(
                client, config, deal, bucket_key, reason, enqueued_at, processed_at
            ):
                continue
        except Exception as exc:
            active_logger.error(f"No se pudo verificar la espera en la negociación {deal.get('id')}: {exc}")
            events.append(_queue_error_result(config, deal, processed_at, exc))
            continue
        legacy_closed = not new_intake and (not within_business_hours or (enqueued_at and enqueued_at < current_week_start))
        if enqueued_at is None or legacy_closed or bucket_key not in current:
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
                    client, config, oldest, active_logger, processed_at,
                    current_time=lambda: _local_datetime(source, now), env=source,
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


def _hold_until_sales_opening(client, config, deal, bucket_key, commercial_reason, enqueued_at, processed_at):
    reason_field = config.deal.queue_reason_field
    window = schedule.sales_closed_window(processed_at, config.sales_calendar)
    if window is None:
        return False
    bucket = routing_bucket_by_key(config, bucket_key)
    state = schedule.WAIT_FOR_OPENING if bucket.seller_ids else "routing_pool_paused"
    marker = schedule.encode_queue_reason(state, commercial_reason, enqueued_at, window)
    if deal.get(reason_field) != marker:
        # The queue page is a snapshot; never restore a stage, owner or prior queue entry.
        deal_id = int(deal["id"])
        fresh = _get_deal(client, deal_id)
        snapshot = ("stageId", "assignedById", reason_field, config.deal.queue_enqueued_at_field,
                    config.deal.routing_bucket_field)
        if all(fresh.get(key) == deal.get(key) for key in snapshot):
            client.call("crm.item.update", {
                "entityTypeId": DEAL_ENTITY_TYPE_ID, "id": deal_id, "fields": {reason_field: marker},
            })
    return True


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


def _split_legacy_queue_bucket(client: Any, config: AppConfig, deal: dict[str, Any]) -> None:
    """Move only pending shared-queue cases, preserving their commercial decision."""
    if deal.get(config.deal.routing_bucket_field) != "santa_fe_anses":
        return
    line = str(deal.get(config.deal.commercial_line_field) or "").strip()
    key = {"Haberes Premium": "santa_fe", "Red Mutual - paii": "mutual_paii"}.get(line)
    if key is None:
        lead = client.call("crm.lead.get", {"id": _required_int(deal.get("leadId"), "leadId")})
        routing = resolve_routing_bucket(config, lead)
        if routing.bucket is None or routing.bucket.key not in {"santa_fe", "mutual_paii"}:
            raise ValueError("No se pudo determinar el bucket del caso en cola.")
        key = routing.bucket.key
    client.call("crm.item.update", {
        "entityTypeId": DEAL_ENTITY_TYPE_ID,
        "id": _required_int(deal.get("id"), "id"),
        "fields": {config.deal.routing_bucket_field: key},
    })
    deal[config.deal.routing_bucket_field] = key


def _new_owner_policy(deal, lead):
    return new_routing_enabled(deal.get("createdTime")) and new_routing_enabled(lead.get("DATE_CREATE"))


def _unverified_initial_owner(owners):
    if 71283 in owners:
        return "integration_owner_unverified"
    if 74827 in owners:
        return "sales_receiver_assignment_preserved"
    return None


def _routing_preflight(client, config, deal, logger):
    """Preserve human CRM owners and attention before changing responsibles."""
    try:
        fresh = _get_deal(client, _required_int(deal.get("id"), "id"))
        if any(str(fresh.get(key) or "") != str(deal.get(key) or "")
               for key in ("id", "leadId", "contactId", "categoryId", "stageId", "assignedById")):
            return {}, "deal_changed_before_assignment"
        lead_id = _required_int(fresh.get("leadId"), "leadId")
        lead = get_lead(client, lead_id, logger)
        snapshot = {key: lead.get(key) for key in ("ID", "CONTACT_ID", "ASSIGNED_BY_ID")}
        expected = deal.setdefault("_routing_lead_snapshot", snapshot)
        deal["_new_owner_policy"] = _new_owner_policy(fresh, lead)
        if deal["_new_owner_policy"] and expected != snapshot:
            return {}, "crm_identity_changed_before_assignment"
        owners = [_optional_int(fresh.get("assignedById")), _optional_int(lead.get("ASSIGNED_BY_ID"))]
        if any(owner not in (None, 0, config.deal.provisional_user_id) for owner in owners):
            if deal["_new_owner_policy"]:
                initial = _unverified_initial_owner(owners)
                if initial:
                    return {}, initial
            return {}, "manual_owner_preserved"
        if lead.get("CONTACT_ID") and str(lead["CONTACT_ID"]) != str(fresh.get("contactId")):
            return {}, "crm_identity_changed_before_assignment"
        return inspect_open_line_assignments(client, lead_id=lead_id,
            contact_id=_optional_int(fresh.get("contactId")), deal_id=_required_int(fresh.get("id"), "id"),
            distributable_open_line_ids=config.deal.distributable_open_line_ids, logger=logger)
    except Exception:
        return {}, "attention_inspection_unavailable"


def _legacy_chat_transfer(client, *, expected_stage, **kwargs):
    # The qualifier and its helper are uploaded as separate namespace files.
    # The main-branch helper still in flight during upload has no stage argument.
    if "expected_stage" in signature(assign_open_line_chats_to_user).parameters:
        kwargs["expected_stage"] = expected_stage
    return assign_open_line_chats_to_user(client, **kwargs)


def _prepare_chat_handoff(client, config, env, deal, sessions, stage, assignment, logger, processed_at):
    # Old flow definitions omit this key. Avoid importing files which a rolling
    # namespace upload may not have installed yet, or calling a new Laravel API.
    if env.get("SALES_CHAT_DELIVERY_MODE", "legacy") == "legacy":
        return None, None
    from .chat_delivery_rollout import chat_delivery_mode
    from .transfer_requests import reserve_sessions
    mode = chat_delivery_mode(env)
    handoff = reserve_sessions(mode, env, sessions, deal, stage, assignment, client=client)
    if handoff.blocked:
        # Keep the selector (including the queue markers) and both owners intact.
        # The next ordinary scan can reacquire the same immutable receipt.
        return handoff, _result(
            action="chat_delivery_pending", has_pending=True, reason=handoff.blocked,
            stage_id=deal["stageId"], deal_id=int(deal["id"]), lead_id=int(deal["leadId"]),
            contact_id=_optional_int(deal.get("contactId")), assigned_by_id=_optional_int(deal.get("assignedById")),
            processed_at=processed_at, distribution_action="waiting", distribution_reason=handoff.blocked,
            chat_transfer_status=handoff.status, found_chat_ids=handoff.found_chat_ids, delivery_states=handoff.states,
            message="La asignación espera la confirmación de custodia de la entrega de chat.")
    # A human may have taken the chat while the handoff was in flight.
    fresh_sessions, reason = _routing_preflight(client, config, deal, logger)
    if reason or fresh_sessions != sessions:
        return handoff, _routing_preserved(client, config, deal, processed_at,
            reason or "session_changed_before_assignment", logger)
    return handoff, None


def _update_routing_owners(client, config, deal, fields, sessions, logger, processed_at, *, guard_writes=False):
    lead_id, deal_id = int(deal["leadId"]), int(deal["id"])
    target = fields["assignedById"]
    new_policy = deal.get("_new_owner_policy", False) or guard_writes
    snapshot = deal.get("_routing_lead_snapshot", {})

    def crm_still_matches():
        fresh = _get_deal(client, deal_id)
        lead = get_lead(client, lead_id, logger)
        return (all(str(fresh.get(key) or "") == str(deal.get(key) or "") for key in
                    ("id", "leadId", "contactId", "categoryId", "stageId", "assignedById"))
                and all(str(lead.get(key) or "") == str(snapshot.get(key) or "") for key in
                        ("ID", "CONTACT_ID", "ASSIGNED_BY_ID")))

    if new_policy and not crm_still_matches():
        return _routing_preserved(client, config, deal, processed_at, "crm_changed_before_assignment", logger)
    if not new_policy or str(snapshot.get("ASSIGNED_BY_ID")) != str(target):
        _assign_lead_responsible(client, lead_id=lead_id, assigned_by_id=target, logger=logger)
        if new_policy:
            # Bitrix has no multi-record compare-and-swap. Recheck human attention and
            # both records after our first write, and never roll back over a later edit.
            snapshot["ASSIGNED_BY_ID"] = target
            current_sessions, reason = inspect_open_line_assignments(
                client, lead_id=lead_id, contact_id=_optional_int(deal.get("contactId")), deal_id=deal_id,
                distributable_open_line_ids=config.deal.distributable_open_line_ids, logger=logger)
            if reason or sessions != current_sessions or not crm_still_matches():
                return _routing_preserved(client, config, deal, processed_at,
                                          reason or "crm_or_session_changed_before_assignment", logger)
    if new_policy and str(deal.get("assignedById")) == str(target):
        fields = {key: value for key, value in fields.items() if key != "assignedById"}
    client.call("crm.item.update", {"entityTypeId": DEAL_ENTITY_TYPE_ID, "id": deal_id, "fields": fields})
    return None


def _routing_preserved(client, config, deal, processed_at, reason, logger):
    action = "skipped"
    current = deal
    try:
        current = _get_deal(client, _required_int(deal.get("id"), "id"))
        same = all(str(current.get(key) or "") == str(deal.get(key) or "")
                   for key in ("id", "leadId", "contactId", "categoryId", "stageId", "assignedById"))
        expected = deal.get("_routing_lead_snapshot")
        lead = get_lead(client, _required_int(current.get("leadId"), "leadId"), logger)
        same_lead = isinstance(expected, dict) and all(str(lead.get(key) or "") == str(expected.get(key) or "")
                   for key in ("ID", "CONTACT_ID", "ASSIGNED_BY_ID"))
        coherent = (str(lead.get("ID")) == str(current.get("leadId"))
                    and str(current.get("categoryId")) == str(config.deal.category_id)
                    and (not lead.get("CONTACT_ID") or str(lead["CONTACT_ID"]) == str(current.get("contactId"))))
        if (same and same_lead and coherent and current.get("stageId") in
                {config.deal.pending_qualification_stage_id, config.deal.assignment_queue_stage_id}):
            # Remove only this automatic selector entry. Responsibles, chat and
            # commercial decision are untouched; this is a routing review.
            client.call("crm.item.update", {"entityTypeId": DEAL_ENTITY_TYPE_ID, "id": current["id"],
                "fields": {"stageId": config.deal.routing_review_stage_id, config.deal.queue_reason_field: reason}})
            current = {**current, "stageId": config.deal.routing_review_stage_id}
            action = "routing_review"
    except Exception:
        # A failed/uncertain stage write never authorizes a responsible change.
        pass
    return _result(action=action, has_pending=False, reason=reason, processed_at=processed_at,
        deal_id=_optional_int(current.get("id")), lead_id=_optional_int(current.get("leadId")),
        contact_id=_optional_int(current.get("contactId")), stage_id=current.get("stageId"),
        assigned_by_id=_optional_int(current.get("assignedById")),
        assignment_strategy="manual_assignment_preserved", distribution_action="preserved",
        distribution_reason=reason, chat_transfer_status="manual_owner_preserved",
        message="Se conservan responsables y chat; atención o identidad requieren revisión de enrutamiento.")


def _guard_queued_ownership(client, config, deal, logger, processed_at):
    """Re-read live ownership; a queue entry never overrides a human handoff."""
    fresh = _get_deal(client, _required_int(deal.get("id"), "id"))
    if fresh.get("stageId") != config.deal.assignment_queue_stage_id:
        return fresh, _queue_context_result(
            client, config, fresh, logger, action="queue_skipped", reason="deal_left_queue",
            processed_at=processed_at, stage_id=fresh.get("stageId"),
            assigned_by_id=_optional_int(fresh.get("assignedById")),
            assignment_strategy="manual_assignment_preserved",
            message="La negociacion ya salio de la cola; no se modifica.",
        )
    lead_id = _required_int(fresh.get("leadId"), "leadId")
    lead = get_lead(client, lead_id, logger)
    fresh["_routing_lead_snapshot"] = {key: lead.get(key) for key in ("ID", "CONTACT_ID", "ASSIGNED_BY_ID")}
    _, attention_reason = inspect_open_line_assignments(
        client, lead_id=lead_id, contact_id=_optional_int(fresh.get("contactId")),
        deal_id=_required_int(fresh.get("id"), "id"),
        distributable_open_line_ids=config.deal.distributable_open_line_ids, logger=logger)
    new_policy = _new_owner_policy(fresh, lead)
    if attention_reason and (new_policy or attention_reason != "manual_owner_preserved"):
        return fresh, _routing_preserved(client, config, fresh, processed_at, attention_reason, logger)
    owners = {owner for value in (fresh.get("assignedById"), lead.get("ASSIGNED_BY_ID"))
              if (owner := _optional_int(value)) is not None and owner > 0}
    if new_policy:
        # The live attention check above already verified every active chat. Its
        # unattended receiver is not a seller to copy onto the CRM records.
        owners.discard(config.deal.provisional_user_id)
        if owners:
            reason = _unverified_initial_owner(owners) or "manual_owner_preserved"
            return fresh, _routing_preserved(client, config, fresh, processed_at, reason, logger)
    else:
        owners.update(active_open_line_owners(
            client, lead_id=lead_id, contact_id=_optional_int(fresh.get("contactId")),
            deal_id=_required_int(fresh.get("id"), "id"),
            distributable_open_line_ids=config.deal.distributable_open_line_ids,
        ))
    owners.discard(config.deal.provisional_user_id)
    if not owners:
        return fresh, None
    conflict = len(owners) > 1
    owner = _optional_int(fresh.get("assignedById")) if conflict else next(iter(owners))
    stage = config.deal.manual_review_stage_id if conflict else str(
        fresh.get(config.deal.queue_target_stage_field) or config.deal.manual_review_stage_id)
    fields = {
        "stageId": stage,
        config.deal.queue_action_field: "", config.deal.queue_reason_field: "",
        config.deal.queue_target_stage_field: "", config.deal.queue_enqueued_at_field: "",
    }
    if not conflict:
        fields["assignedById"] = owner
        _assign_lead_responsible(client, lead_id=lead_id, assigned_by_id=owner, logger=logger)
    client.call("crm.item.update", {"entityTypeId": DEAL_ENTITY_TYPE_ID, "id": fresh["id"], "fields": fields})
    return fresh, _queue_context_result(
        client, config, fresh, logger,
        action="queue_closed" if conflict else "queue_distributed",
        reason="manual_assignment_conflict" if conflict else "manual_assignment_preserved",
        processed_at=processed_at, stage_id=stage, assigned_by_id=owner,
        assignment_strategy="manual_assignment_preserved", chat_transfer_status="manual_owner_preserved",
        message="Se conservan responsables distintos para revision manual." if conflict else "Se conserva la asignacion existente sin transferir chats.",
    )


def _retry_queued_deal(
    client: Any,
    config: AppConfig,
    deal: dict[str, Any],
    logger: Logger,
    processed_at: datetime,
    *,
    within_business_hours: bool = True,
    current_time=None,
    env=None,
) -> dict[str, object]:
    deal, preserved = _guard_queued_ownership(client, config, deal, logger, processed_at)
    if preserved is not None:
        return preserved
    deal_id = _required_int(deal.get("id"), "id")
    lead_id = _required_int(deal.get("leadId"), "leadId")
    contact_id = _optional_int(deal.get("contactId"))
    bucket_key = str(deal.get(config.deal.routing_bucket_field) or "").strip()
    bucket = routing_bucket_by_key(config, bucket_key)
    if bucket is None:
        return _close_queued_deal(client, config, deal, logger, processed_at)

    state, commercial_reason = schedule.decode_queue_reason(str(deal.get(config.deal.queue_reason_field) or ""))

    def closing_wait():
        if current_time is None or not state or len(bucket.seller_ids) == 1 or not new_routing_enabled(deal.get("createdTime")):
            return None
        instant = current_time()
        enqueued_at = datetime.fromisoformat(str(deal[config.deal.queue_enqueued_at_field]))
        if _hold_until_sales_opening(client, config, deal, bucket_key, commercial_reason, enqueued_at, instant):
            return _queue_context_result(
                client, config, deal, logger, action="queue_waiting",
                reason=schedule.WAIT_FOR_OPENING if bucket.seller_ids else "routing_pool_paused",
                within_business_hours=False, processed_at=instant, assignment_strategy="assignment_queue",
                message="La negociación sigue en la cola comercial.",
            )
        return None

    waiting = closing_wait()
    if waiting:
        return waiting
    try:
        assignment = resolve_round_robin_assignee(
            client,
            config,
            contact_id=contact_id,
            deal_id=deal_id,
            lead_id=lead_id,
            bucket_key=bucket.key,
            bucket_field=config.deal.routing_bucket_field,
            pool=bucket.seller_ids,
            legacy_province_label=bucket.legacy_province_label,
            logger=logger,
        )
    except NoOnlineSellersError as exc:
        return _queue_context_result(
            client, config, deal, logger,
            action="queue_waiting",
            reason="routing_pool_paused" if not exc.configured_pool else "assignment_queue_waiting",
            processed_at=processed_at,
            assignment_strategy="assignment_queue_waiting",
            configured_pool=exc.configured_pool,
            online_pool=(),
            message="El bucket continúa sin vendedores disponibles.",
        )

    deal, preserved = _guard_queued_ownership(client, config, deal, logger, processed_at)
    if preserved is not None:
        return preserved
    target_stage = str(
        deal.get(config.deal.queue_target_stage_field)
        or config.deal.manual_review_stage_id
    )
    guarded_sessions, guard_reason = _routing_preflight(client, config, deal, logger)
    if guard_reason:
        return _routing_preserved(client, config, deal, processed_at, guard_reason, logger)
    waiting = closing_wait()
    if waiting:
        return waiting
    handoff, pending = _prepare_chat_handoff(
        client, config, os.environ if env is None else env, deal, guarded_sessions,
        target_stage, assignment, logger, processed_at)
    if pending:
        return pending
    assigned_by_id = handoff.target_id if handoff is not None else assignment.assigned_by_id
    preserved = _update_routing_owners(client, config, deal, {
        "stageId": target_stage, "assignedById": assigned_by_id,
        config.deal.queue_action_field: "", config.deal.queue_reason_field: "",
        config.deal.queue_target_stage_field: "", config.deal.queue_enqueued_at_field: "",
    }, guarded_sessions, logger, processed_at, guard_writes=handoff is not None)
    if preserved:
        return preserved
    assigned_by_name = user_display_name(client, assigned_by_id=assigned_by_id, logger=logger)
    linked = bind_open_line_activities_to_deal(
        client, lead_id=lead_id, contact_id=contact_id if handoff is None else None,
        deal_id=deal_id, logger=logger,
    )
    chat_transfer = handoff or _legacy_chat_transfer(
        client, lead_id=lead_id, contact_id=contact_id, deal_id=deal_id,
        assigned_by_id=assigned_by_id,
        distributable_open_line_ids=config.deal.distributable_open_line_ids,
        logger=logger,
        preserve_existing_ownership=True,
        provisional_user_id=config.deal.provisional_user_id,
        expected_stage=target_stage,
        expected_sessions=guarded_sessions,
    )
    notify_distribution_supervisor(
        client, config, deal_id=deal_id,
        deal_title=str(deal.get("title") or ""), bucket_label=bucket.label,
        assigned_by_id=assigned_by_id, assigned_by_name=assigned_by_name,
        action=str(deal.get(config.deal.queue_action_field) or "approved"),
        **({"chat_delivery_status": handoff.status} if handoff else {}),
        chat_transferred=chat_transfer.transferred_count > 0, logger=logger,
    )
    return _queue_context_result(
        client, config, deal, logger,
        action="queue_distributed",
        reason="assignment_queue_distributed",
        within_business_hours=within_business_hours,
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
        delivery_states=getattr(chat_transfer, "states", ()),
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
    deal, preserved = _guard_queued_ownership(client, config, deal, logger, processed_at)
    if preserved is not None:
        return preserved
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
        within_business_hours=overrides.pop("within_business_hours", overrides.get("action") != "queue_closed"),
        commercial_action=str(deal.get(config.deal.queue_action_field) or ""),
        commercial_reason=schedule.decode_queue_reason(str(deal.get(config.deal.queue_reason_field) or ""))[1],
        commercial_stage_id=str(
            deal.get(config.deal.queue_target_stage_field) or ""
        ),
        distribution_action=distribution_action,
        distribution_reason=str(overrides.get("reason") or ""),
        **context,
        **overrides,
    )


def _chat_delivery_totals_json(events):
    # A contact can appear in several decisions in a batch. Count distinct
    # chats per observed state. Only an actual write in this run is "transferred".
    chats_by_state = {}
    for event in events:
        for chat_id, state in event.get("chat_delivery_states", {}).items():
            chats_by_state.setdefault(state, set()).add(chat_id)
        for chat_id in str(event.get("transferred_chat_ids") or "").split(","):
            if chat_id:
                chats_by_state.setdefault("transferred", set()).add(chat_id)
    return json.dumps({key: len(chats) for key, chats in sorted(chats_by_state.items())})


def _queue_batch_result(
    events: list[dict[str, object]], processed_at: datetime
) -> dict[str, object]:
    return {
        "ok": not any(not bool(event.get("ok")) for event in events),
        "processed_at": processed_at.isoformat(),
        "event_count": len(events),
        "distributed_count": sum(event.get("action") == "queue_distributed" for event in events),
        "waiting_count": sum(event.get("action") in ("queue_waiting", "chat_delivery_pending") for event in events),
        "closed_count": sum(event.get("action") == "queue_closed" for event in events),
        "events": events,
        "events_json": json.dumps(events, ensure_ascii=False),
        "chat_delivery_totals_json": _chat_delivery_totals_json(events),
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
        commercial_reason=schedule.decode_queue_reason(str(deal.get(config.deal.queue_reason_field) or ""))[1],
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
    family = expanded_deal_family(config, lead)
    if family in {"anses", "neuquen", "buenos_aires"}:
        return BcraSnapshotResolution(lead, None, "", None, False, "not_required")
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
    santa_fe_zero_entities = family == "santa_fe" and raw_outcome == "not_found"
    if santa_fe_zero_entities and age_days is not None and age_days < max_age_days:
        return BcraSnapshotResolution(lead, None, checked_at, age_days, False, "reused_not_found")
    if raw_outcome in {"not_found", "invalid_identification"} and not santa_fe_zero_entities:
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
            if result.outcome == "not_found" and family != "santa_fe"
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
    family = expanded_deal_family(config, lead)
    if family == "anses":
        return _approved(config, "anses_approved", "Red Mutual - paii")
    if family == "buenos_aires":
        return _approved(config, "buenos_aires_approved", "Red Mutual - paii")
    if family == "neuquen":
        return _approved(config, "neuquen_approved", "MUDON")
    if family == "santa_fe":
        entities = _santa_fe_bcra_entities(config, lead)
        if entities is None:
            return _manual(config, "bcra_snapshot_not_conclusive")
        if len(entities) > 7:
            return _bcra_rejected(config, "santa_fe_more_than_seven_entities")
        return _approved(config, "santa_fe_haberes_premium", "Haberes Premium")

    try:
        submission = build_submission_from_lead(lead, config)
    except ValueError:
        return _manual(config, "missing_prequalification_data")

    if is_policia_federal_caba(submission):
        return _manual(config, "policia_federal_caba_requires_commercial_review")
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
        return _evaluate_caja(
            config, lead, entities, vimarx, payment_bank, employment=employment
        )
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
    *,
    employment: str,
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
        if not recurrent and employment == "jubilado_provincial" and len(entities) > 8:
            return _bcra_rejected(config, "caja_morosos_new_more_than_eight_entities")
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


def _santa_fe_bcra_entities(config: AppConfig, lead: dict[str, Any]) -> list[dict[str, Any]] | None:
    try:
        snapshot = json.loads(str(lead.get(config.fields.lead_bcra_data_raw or "") or ""))
    except (TypeError, ValueError):
        return None
    if not isinstance(snapshot, dict):
        return None
    if snapshot.get("outcome") == "not_found":
        return []
    if snapshot.get("outcome") != "ok":
        return None
    payload = snapshot.get("payload")
    results = payload.get("results") if isinstance(payload, dict) else None
    periods = results.get("periodos") if isinstance(results, dict) else None
    if not isinstance(periods, list) or not periods or any(not isinstance(p, dict) for p in periods):
        return None
    latest = max(periods, key=lambda period: str(period.get("periodo") or ""))
    entities = latest.get("entidades")
    if not isinstance(entities, list) or any(not isinstance(entity, dict) for entity in entities):
        return None
    return entities


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
    delivery_states: tuple[tuple[int, str], ...] = (),
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
    vimarx_refresh_outcome: str = "not_evaluated",
    vimarx_snapshot_checked_at: str = "",
    vimarx_retry_attempts: int = 0,
    vimarx_next_retry_at: str = "",
    source: str = "",
    commercial_action: str = "",
    commercial_reason: str = "",
    commercial_stage_id: str = "",
    distribution_action: str = "",
    distribution_reason: str = "",
    ok: bool = True,
) -> dict[str, object]:
    decision_label = business_decision(
        action if commercial_action == "pending_data" else commercial_action or action,
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
        "chat_delivery_states": {str(chat): state for chat, state in delivery_states},
        "queued_chat_count": sum(state == "delivery_queued" for _, state in delivery_states),
        "waiting_chat_count": sum(state in ("delivery_waiting", "delivery_paused", "delivery_target_conflict", "delivery_binding_pending") for _, state in delivery_states),
        "unverified_chat_binding_count": sum(state == "delivery_binding_unverified" for _, state in delivery_states),
        "uncertain_chat_count": sum(state in ("delivery_uncertain", "handoff_unconfirmed") for _, state in delivery_states),
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
        "vimarx_refresh_outcome": vimarx_refresh_outcome,
        "vimarx_snapshot_checked_at": vimarx_snapshot_checked_at,
        "vimarx_retry_attempts": vimarx_retry_attempts,
        "vimarx_next_retry_at": vimarx_next_retry_at,
        "rule_version": COMMERCIAL_RULE_VERSION,
    }
