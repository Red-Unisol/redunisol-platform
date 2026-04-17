from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from .bcra_client import BcraClient, BcraConsultationResult
from .bitrix_client import BitrixClient
from .config import AppConfig, load_config
from .lead_service import list_leads_created_between, update_lead_bcra_snapshot, update_lead_status
from .logger import Logger, create_logger


ARGENTINA_TIMEZONE = timezone(timedelta(hours=-3))


def sync_lead_bcra(
    client: BitrixClient,
    config: AppConfig,
    lead_id: int,
    identification: str,
    logger: Logger,
    *,
    bcra_client: Any | None = None,
) -> BcraConsultationResult:
    active_bcra_client = bcra_client or BcraClient(logger)
    result = active_bcra_client.consult_snapshot(str(identification).strip())

    if result.is_persistable:
        if config.fields.has_bcra_storage_fields():
            update_lead_bcra_snapshot(client, config, lead_id, result, logger)
        else:
            logger.error(
                "BCRA respondio pero faltan los campos Bitrix para persistir snapshot formateado y raw."
            )

    return result


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
