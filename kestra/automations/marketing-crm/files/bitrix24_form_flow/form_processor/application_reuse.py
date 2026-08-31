from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .bitrix_client import BitrixClient
from .config import AppConfig
from .deal_service import find_active_deal_for_identity, refresh_reused_deal_from_lead
from .input_parser import NormalizedInput, RoutingInput
from .lead_service import get_lead, update_lead_from_submission
from .logger import Logger
from .routing_bucket import resolve_routing_bucket_input


@dataclass(frozen=True)
class ReusedApplication:
    lead_id: int
    deal_id: int
    assigned_by_id: int | None
    bucket_key: str


def reuse_active_application(
    client: BitrixClient,
    config: AppConfig,
    submission: NormalizedInput,
    *,
    contact_id: int,
    logger: Logger,
) -> ReusedApplication | None:
    if not config.deal.reuse_active_deal:
        return None

    routing = resolve_routing_bucket_input(
        config,
        RoutingInput(
            province=submission.province,
            employment_status=submission.employment_status,
        ),
    )
    if routing.bucket is None:
        return None

    deal = find_active_deal_for_identity(
        client,
        config,
        cuil=submission.cuil_digits,
        contact_id=contact_id,
        bucket_key=routing.bucket.key,
        logger=logger,
    )
    if deal is None:
        return None

    lead_id = _required_int(deal.get("leadId"), "leadId")
    deal_id = _required_int(deal.get("id"), "id")
    update_lead_from_submission(
        client,
        config,
        submission,
        lead_id=lead_id,
        contact_id=contact_id,
        logger=logger,
    )
    lead = get_lead(client, lead_id, logger)
    refresh_reused_deal_from_lead(
        client,
        config,
        lead,
        lead_id=lead_id,
        deal_id=deal_id,
        contact_id=contact_id,
        logger=logger,
    )
    _record_submission_touch(
        client,
        submission,
        deal_id=deal_id,
        bucket_key=routing.bucket.key,
        logger=logger,
    )
    return ReusedApplication(
        lead_id=lead_id,
        deal_id=deal_id,
        assigned_by_id=_optional_int(deal.get("assignedById")),
        bucket_key=routing.bucket.key,
    )


def _record_submission_touch(
    client: BitrixClient,
    submission: NormalizedInput,
    *,
    deal_id: int,
    bucket_key: str,
    logger: Logger,
) -> None:
    details = [
        "[B]Nueva carga de formulario reutilizada[/B]",
        f"CUIL: {submission.cuil_formatted}",
        f"Bucket: {bucket_key}",
        f"Fuente: {submission.lead_source.label}",
    ]
    for label, value in (
        ("UTM source", submission.utm_source),
        ("UTM medium", submission.utm_medium),
        ("UTM campaign", submission.utm_campaign),
    ):
        if value:
            details.append(f"{label}: {value}")
    result = client.call(
        "crm.timeline.comment.add",
        {
            "fields": {
                "ENTITY_ID": deal_id,
                "ENTITY_TYPE": "deal",
                "COMMENT": "\n".join(details),
            }
        },
    )
    logger.info(f"Touch de formulario {result} registrado en deal {deal_id}.")


def _required_int(value: Any, field_name: str) -> int:
    try:
        parsed = int(str(value))
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"La negociacion activa no tiene {field_name} valido.") from exc
    if parsed <= 0:
        raise RuntimeError(f"La negociacion activa no tiene {field_name} valido.")
    return parsed


def _optional_int(value: Any) -> int | None:
    try:
        parsed = int(str(value))
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None
