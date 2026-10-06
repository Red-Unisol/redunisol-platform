from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
from typing import Any

from .bcra_client import BcraClient, BcraConsultationResult
from .bitrix_client import BitrixClient
from .config import AppConfig, load_config
from .lead_service import (
    lead_has_commercial_owner,
    get_lead,
    list_leads_created_between,
    update_lead_bcra_snapshot,
    update_lead_fields,
    update_lead_status,
)
from .logger import Logger, create_logger


ARGENTINA_TIMEZONE = timezone(timedelta(hours=-3))
BCRA_RETRYABLE_OUTCOMES = frozenset({"temporary_error", "rate_limited"})
BCRA_RETRY_PENDING_OUTCOMES = frozenset(
    {"temporary_error", "rate_limited", "retry_scheduled"}
)
BCRA_RETRY_EXHAUSTED_OUTCOME = "retry_exhausted"
BCRA_RETRY_WINDOW = timedelta(hours=24)
BCRA_RETRY_DELAYS = (
    timedelta(minutes=5),
    timedelta(minutes=30),
    timedelta(hours=2),
)
BCRA_RETRY_LONG_DELAY = timedelta(hours=6)


@dataclass(frozen=True)
class BcraRetryState:
    outcome: str
    attempts: int
    first_failed_at: datetime | None
    last_failed_at: datetime | None
    next_retry_at: datetime | None
    expires_at: datetime | None
    message: str

    @property
    def is_pending(self) -> bool:
        return self.outcome in BCRA_RETRY_PENDING_OUTCOMES

    @property
    def is_exhausted(self) -> bool:
        return self.outcome == BCRA_RETRY_EXHAUSTED_OUTCOME

    def is_due(self, now: datetime) -> bool:
        if self.is_exhausted:
            return False
        if self.expires_at is not None and now >= self.expires_at:
            return True
        if not self.is_pending or self.next_retry_at is None:
            return True
        return now >= self.next_retry_at


def sync_lead_bcra(
    client: BitrixClient,
    config: AppConfig,
    lead_id: int,
    identification: str,
    logger: Logger,
    *,
    bcra_client: Any | None = None,
    lead: dict[str, Any] | None = None,
    now: datetime | None = None,
    force: bool = False,
) -> BcraConsultationResult:
    current_time = _as_argentina_time(now or datetime.now(ARGENTINA_TIMEZONE))
    current_lead = lead or get_lead(client, lead_id, logger)
    retry_state = bcra_retry_state_from_lead(current_lead, config)
    if retry_state is not None and not force:
        if retry_state.is_exhausted:
            return _retry_state_result(
                retry_state,
                identification=str(identification).strip(),
            )
        if retry_state.is_pending and not retry_state.is_due(current_time):
            return _retry_state_result(
                retry_state,
                identification=str(identification).strip(),
                outcome="retry_scheduled",
            )

    active_bcra_client = bcra_client or BcraClient(logger)
    result = active_bcra_client.consult_snapshot(str(identification).strip())

    if result.is_persistable:
        if config.fields.has_bcra_storage_fields():
            update_lead_bcra_snapshot(client, config, lead_id, result, logger)
        else:
            logger.error(
                "BCRA respondio pero faltan los campos Bitrix para persistir snapshot formateado y raw."
            )
    elif result.outcome in BCRA_RETRYABLE_OUTCOMES:
        result = _persist_retryable_failure(
            client,
            config,
            lead_id,
            result,
            retry_state=retry_state,
            now=current_time,
            logger=logger,
        )

    return result


def bcra_retry_state_from_lead(
    lead: dict[str, Any],
    config: AppConfig,
) -> BcraRetryState | None:
    raw_field = config.fields.lead_bcra_data_raw
    if not raw_field:
        return None
    try:
        payload = json.loads(str(lead.get(raw_field) or ""))
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    outcome = str(payload.get("outcome") or "").strip()
    if outcome not in BCRA_RETRY_PENDING_OUTCOMES | {BCRA_RETRY_EXHAUSTED_OUTCOME}:
        return None
    retry = payload.get("retry")
    retry_payload = retry if isinstance(retry, dict) else {}
    return BcraRetryState(
        outcome=outcome,
        attempts=_safe_int(retry_payload.get("attempts")),
        first_failed_at=_parse_datetime(retry_payload.get("first_failed_at")),
        last_failed_at=_parse_datetime(retry_payload.get("last_failed_at")),
        next_retry_at=_parse_datetime(retry_payload.get("next_retry_at")),
        expires_at=_parse_datetime(retry_payload.get("expires_at")),
        message=str(payload.get("message") or "").strip(),
    )


def bcra_retry_waiting(
    lead: dict[str, Any],
    config: AppConfig,
    *,
    now: datetime,
) -> bool:
    state = bcra_retry_state_from_lead(lead, config)
    return bool(state and state.is_pending and not state.is_due(_as_argentina_time(now)))


def _persist_retryable_failure(
    client: BitrixClient,
    config: AppConfig,
    lead_id: int,
    result: BcraConsultationResult,
    *,
    retry_state: BcraRetryState | None,
    now: datetime,
    logger: Logger,
) -> BcraConsultationResult:
    attempts = (retry_state.attempts if retry_state else 0) + 1
    first_failed_at = (
        retry_state.first_failed_at
        if retry_state and retry_state.first_failed_at
        else now
    )
    expires_at = first_failed_at + BCRA_RETRY_WINDOW
    exhausted = now >= expires_at
    outcome = BCRA_RETRY_EXHAUSTED_OUTCOME if exhausted else result.outcome
    next_retry_at = None if exhausted else now + _retry_delay(attempts)
    message = result.message or "BCRA no disponible temporalmente."
    raw_snapshot = {
        "source": "bcra_central_deudores_v1",
        "queried_at": result.checked_at or now.isoformat(),
        "http_status": result.http_status,
        "identification": str(result.identification or "").strip(),
        "outcome": outcome,
        "should_reject": False,
        "negative_entity_count": 0,
        "negative_entities": [],
        "message": message,
        "retry": {
            "attempts": attempts,
            "first_failed_at": first_failed_at.isoformat(),
            "last_failed_at": now.isoformat(),
            "next_retry_at": next_retry_at.isoformat() if next_retry_at else None,
            "expires_at": expires_at.isoformat(),
        },
    }
    status_label = "REVISIÓN MANUAL" if exhausted else "PENDIENTE"
    status_text = (
        f"Estado: {status_label}\n"
        f"Consultado: {result.checked_at or now.isoformat()}\n"
        f"Intentos: {attempts}\n"
        f"Detalle: {message}"
    )
    summary_text = (
        "BCRA: reintentos agotados; requiere revisión manual."
        if exhausted
        else f"BCRA pendiente; próximo intento {next_retry_at.isoformat()}."
    )
    fields: dict[str, Any] = {}
    if config.fields.lead_bcra_status:
        fields[config.fields.lead_bcra_status] = status_text
    if config.fields.lead_bcra_result:
        fields[config.fields.lead_bcra_result] = summary_text
    if config.fields.lead_bcra_data_raw:
        fields[config.fields.lead_bcra_data_raw] = json.dumps(
            raw_snapshot, ensure_ascii=True, separators=(",", ":")
        )
    if config.fields.lead_bcra_checked_at:
        fields[config.fields.lead_bcra_checked_at] = result.checked_at or now.isoformat()
    if fields:
        update_lead_fields(client, lead_id, fields)
    logger.info(
        f"Estado BCRA persistido para lead {lead_id}: outcome={outcome}, "
        f"attempts={attempts}, next_retry_at={next_retry_at}."
    )
    return BcraConsultationResult(
        outcome=outcome,
        checked_at=result.checked_at or now.isoformat(),
        identification=result.identification,
        http_status=result.http_status,
        formatted_field_value=None,
        summary_field_value=None,
        raw_field_value=None,
        should_reject=False,
        negative_entity_count=0,
        negative_entities=(),
        message=message,
        denominacion=None,
    )


def _retry_state_result(
    state: BcraRetryState,
    *,
    identification: str,
    outcome: str | None = None,
) -> BcraConsultationResult:
    checked_at = state.last_failed_at.isoformat() if state.last_failed_at else ""
    return BcraConsultationResult(
        outcome=outcome or state.outcome,
        checked_at=checked_at,
        identification=identification,
        http_status=None,
        formatted_field_value=None,
        summary_field_value=None,
        raw_field_value=None,
        should_reject=False,
        negative_entity_count=0,
        negative_entities=(),
        message=state.message,
        denominacion=None,
    )


def _retry_delay(attempts: int) -> timedelta:
    if attempts <= len(BCRA_RETRY_DELAYS):
        return BCRA_RETRY_DELAYS[attempts - 1]
    return BCRA_RETRY_LONG_DELAY


def _parse_datetime(value: object) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return _as_argentina_time(parsed)


def _as_argentina_time(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=ARGENTINA_TIMEZONE)
    return value.astimezone(ARGENTINA_TIMEZONE)


def _safe_int(value: object) -> int:
    try:
        return max(0, int(str(value or "0")))
    except ValueError:
        return 0


def backfill_bcra_for_today(
    *,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    bcra_client: Any | None = None,
    logger: Logger | None = None,
    now: datetime | None = None,
) -> dict[str, object]:
    active_logger = logger or create_logger()
    config = load_config(env)
    if not config.fields.has_bcra_storage_fields():
        return {
            "ok": True,
            "action": "skipped",
            "processed_count": 0,
            "populated_count": 0,
            "rejected_count": 0,
            "commercial_rejection_skipped_count": 0,
            "skipped_populated_count": 0,
            "skipped_missing_cuil_count": 0,
            "temporary_error_count": 0,
            "rate_limited": False,
            "message": (
                "Backfill BCRA omitido: faltan los campos Bitrix para snapshot formateado y raw."
            ),
        }

    client = bitrix_client or BitrixClient(config, active_logger)
    current_time = now or datetime.now(ARGENTINA_TIMEZONE)
    start_of_day = current_time.replace(hour=0, minute=0, second=0, microsecond=0)
    date_from = start_of_day.isoformat()
    date_to = current_time.replace(microsecond=0).isoformat()

    active_logger.info(f"Inicio de backfill BCRA para leads entre {date_from} y {date_to}.")
    leads = list_leads_created_between(
        client,
        date_from=date_from,
        date_to=date_to,
        field_names=[
            "ID",
            "STATUS_ID",
            config.fields.lead_commercial_owner,
            config.fields.lead_cuil,
            config.fields.lead_bcra_data_raw or "",
        ],
        logger=active_logger,
    )

    result = {
        "ok": True,
        "action": "backfilled",
        "processed_count": 0,
        "populated_count": 0,
        "rejected_count": 0,
        "commercial_rejection_skipped_count": 0,
        "skipped_populated_count": 0,
        "skipped_missing_cuil_count": 0,
        "temporary_error_count": 0,
        "rate_limited": False,
        "message": "Backfill BCRA finalizado.",
    }

    for lead in leads:
        lead_id = int(str(lead.get("ID") or "0"))
        if not lead_id:
            continue

        current_bcra_raw = _optional_str(lead.get(config.fields.lead_bcra_data_raw or ""))
        if current_bcra_raw is not None:
            result["skipped_populated_count"] = int(result["skipped_populated_count"]) + 1
            continue

        identification = _optional_str(lead.get(config.fields.lead_cuil))
        if identification is None:
            active_logger.info(f"Lead {lead_id} omitido: no tiene CUIL para consultar BCRA.")
            result["skipped_missing_cuil_count"] = int(result["skipped_missing_cuil_count"]) + 1
            continue

        bcra_result = sync_lead_bcra(
            client,
            config,
            lead_id,
            identification,
            active_logger,
            bcra_client=bcra_client,
            lead=lead,
            now=current_time,
        )
        result["processed_count"] = int(result["processed_count"]) + 1

        if bcra_result.is_rate_limited:
            result["rate_limited"] = True
            result["message"] = "Backfill BCRA detenido por rate limiting del upstream."
            break

        if not bcra_result.is_persistable:
            result["temporary_error_count"] = int(result["temporary_error_count"]) + 1
            continue

        result["populated_count"] = int(result["populated_count"]) + 1

        if bcra_result.should_reject:
            if not lead_has_commercial_owner(client, lead, config, "kestra"):
                active_logger.info(
                    f"Lead {lead_id} con BCRA negativo no se rechaza: "
                    "Motor decision comercial distinto de Kestra."
                )
                result["commercial_rejection_skipped_count"] = (
                    int(result["commercial_rejection_skipped_count"]) + 1
                )
                continue

            update_lead_status(
                client,
                config,
                lead_id,
                False,
                "SIT NEG BCRA",
                active_logger,
            )
            result["rejected_count"] = int(result["rejected_count"]) + 1

    return result


def _optional_str(raw_value: object) -> str | None:
    if raw_value is None:
        return None
    value = str(raw_value).strip()
    return value or None
