from __future__ import annotations

from typing import Any

from .catalogs import PROVINCIAS, SITUACIONES_LABORALES
from .config import AppConfig
from .qualification import QUALIFICATION_RULES


def expanded_deal_family(config: AppConfig, lead: dict[str, Any]) -> str:
    """Resolve the new families without requiring unrelated identity or bank fields."""
    try:
        employment = SITUACIONES_LABORALES.resolve(
            lead.get(config.fields.lead_employment_status), "employment_status",
        )
    except ValueError:
        return ""
    if employment.key == "jubilado_nacional":
        return "anses"
    try:
        province = PROVINCIAS.resolve(lead.get(config.fields.lead_province), "province")
    except ValueError:
        return ""
    if (province.key in {"santa_fe", "neuquen", "buenos_aires"}
            and employment.key in QUALIFICATION_RULES[province.key]["allowed_employment_statuses"]):
        return province.key
    return ""
