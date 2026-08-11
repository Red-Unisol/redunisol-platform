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

    if submission.province.key == "cordoba":
        employment = submission.employment_status.key
        if employment in {"empleado_publico_provincial", "policia"}:
            key, label, sellers = (
                "cordoba_publico_policia",
                "Córdoba - Público provincial y Policía",
                config.deal.cordoba_publico_policia_user_ids,
            )
        elif employment in {"jubilado_provincial", "jubilado_nacional", "pensionado"}:
            key, label, sellers = (
                "cordoba_jubilados",
                "Córdoba - Jubilados y pensionados",
                config.deal.cordoba_jubilados_user_ids,
            )
        elif employment in {"empleado_de_la_unc", "daspu"}:
            key, label, sellers = (
                "cordoba_unc",
                "Córdoba - UNC y DASPU",
                config.deal.cordoba_unc_user_ids,
            )
        else:
            key, label, sellers = (
                "cordoba_general",
                "Córdoba - General",
                config.deal.cordoba_general_user_ids,
            )
        return RoutingResolution(
            bucket=RoutingBucket(key=key, label=label, seller_ids=sellers),
            province=submission.province.label,
            reason="province_cordoba",
        )

    return RoutingResolution(
        bucket=None,
        province=submission.province.label,
        reason="no_matching_bucket",
    )
