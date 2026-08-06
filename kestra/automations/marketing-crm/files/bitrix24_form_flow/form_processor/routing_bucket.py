from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .config import AppConfig
from .lead_service import build_submission_from_lead


@dataclass(frozen=True)
class RoutingBucket:
    key: str
    label: str
    seller_ids: tuple[int, ...]
    legacy_province_label: str | None = None


@dataclass(frozen=True)
class RoutingResolution:
    bucket: RoutingBucket | None
    province: str
    reason: str


def resolve_routing_bucket(
    config: AppConfig,
    lead: dict[str, Any],
) -> RoutingResolution:
    try:
        submission = build_submission_from_lead(lead, config)
    except ValueError:
        return RoutingResolution(
            bucket=None,
            province="",
            reason="missing_routing_data",
        )

    if submission.province.key == "catamarca":
        return RoutingResolution(
            bucket=RoutingBucket(
                key="catamarca_general",
                label="Catamarca - General",
                seller_ids=config.deal.round_robin_user_ids,
                legacy_province_label="Catamarca",
            ),
            province=submission.province.label,
            reason="province_catamarca",
        )

    return RoutingResolution(
        bucket=None,
        province=submission.province.label,
        reason="no_matching_bucket",
    )
