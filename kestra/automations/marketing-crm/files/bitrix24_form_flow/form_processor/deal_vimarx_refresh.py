from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
import json
from typing import Any

from .config import AppConfig
from .deal_service import (
    DEAL_DIRECT_FIELD_MAPPINGS,
    DEAL_ENTITY_TYPE_ID,
    build_deal_vimarx_fields,
)
from .lead_service import get_lead, update_lead_fields
from .logger import Logger
from .vimarx_service import (
    build_bitrix_enrichment_fields,
    build_error_enrichment,
    consult_vimarx_enrichment,
    load_vimarx_config_from_env,
    only_digits,
    with_raw_json,
)

# Independent attempts by the qualification scheduler, in addition to HTTP retries.
RETRY_DELAYS_MINUTES = (5, 15)
RAW_DEAL_FIELD = DEAL_DIRECT_FIELD_MAPPINGS["vimarx_creditos_activos_raw"]


@dataclass(frozen=True)
class VimarxRefreshResolution:
    lead: dict[str, Any]
    outcome: str
    checked_at: str = ""
    attempts: int = 0
    next_retry_at: str = ""

    @property
    def pending(self) -> bool:
        return self.outcome == "retry_scheduled"

    @property
    def reason(self) -> str:
        return "" if self.outcome in {"member", "not_found"} else f"vimarx_{self.outcome}"

    @property
    def trace(self) -> dict[str, Any]:
        return {
            "vimarx_refresh_outcome": self.outcome,
            "vimarx_snapshot_checked_at": self.checked_at,
            "vimarx_retry_attempts": self.attempts,
            "vimarx_next_retry_at": self.next_retry_at,
        }


def _retry_state(deal: dict[str, Any], cuil: str) -> dict[str, Any]:
    try:
        payload = json.loads(str(deal.get(RAW_DEAL_FIELD) or ""))
        state = payload.get("qualification_refresh")
        if (
            not isinstance(state, dict)
            or str(state.get("deal_id")) != str(deal.get("id") or deal.get("ID"))
            or payload.get("queried_cuil") != cuil
        ):
            return {}
        return state
    except (ValueError, TypeError, AttributeError):
        return {}


def _retry_due(state: dict[str, Any], now: datetime) -> bool:
    try:
        retry_at = datetime.fromisoformat(state["next_retry_at"])
        return retry_at <= now
    except (ValueError, TypeError, KeyError):
        return True


def vimarx_retry_waiting(
    deal: dict[str, Any], lead: dict[str, Any], config: AppConfig, *, now: datetime
) -> bool:
    state = _retry_state(deal, only_digits(str(lead.get(config.fields.lead_cuil) or "")))
    return state.get("outcome") == "retry_scheduled" and not _retry_due(state, now)


def refresh_deal_vimarx(
    client: Any,
    config: AppConfig,
    lead: dict[str, Any],
    *,
    deal: dict[str, Any],
    lead_id: int,
    deal_id: int,
    source: Mapping[str, str],
    processed_at: datetime,
    logger: Logger,
) -> VimarxRefreshResolution:
    """Query current identity for every pending qualification, regardless of lead age/status."""
    cuil = only_digits(str(lead.get(config.fields.lead_cuil) or ""))
    state = _retry_state(deal, cuil)
    try:
        previous_attempts = max(0, int(state.get("attempts", 0)))
    except (ValueError, TypeError):
        previous_attempts = 0
    if state.get("outcome") == "retry_exhausted" or (
        state.get("outcome") == "retry_scheduled" and not _retry_due(state, processed_at)
    ):
        return VimarxRefreshResolution(
            lead, state["outcome"], state.get("checked_at", ""),
            previous_attempts, state.get("next_retry_at", ""),
        )

    required_fields = (
        config.fields.lead_es_socio,
        config.fields.lead_vimarx_nro_socio,
        config.fields.lead_vimarx_creditos_activos_count,
        config.fields.lead_vimarx_creditos_activos_detail,
        config.fields.lead_vimarx_creditos_activos_raw,
    )
    if not all(required_fields):
        raise RuntimeError("Faltan campos de almacenamiento del refresh Vimarx.")

    attempts = previous_attempts + 1 if state.get("outcome") == "retry_scheduled" else 1
    next_retry_at = ""
    if len(cuil) != 11:
        outcome = "missing_cuil"
        enrichment = build_error_enrichment(cuil, "Falta un CUIL de 11 digitos.")
    else:
        try:
            vimarx_config = load_vimarx_config_from_env(source)
        except (ValueError, TypeError):
            outcome = "configuration_error"
            enrichment = build_error_enrichment(cuil, "Configuracion Vimarx invalida.")
        else:
            try:
                enrichment = consult_vimarx_enrichment(cuil, vimarx_config)
                if not enrichment.ok or not isinstance(enrichment.es_socio, bool):
                    raise ValueError("Respuesta Vimarx incompleta.")
                outcome = "member" if enrichment.es_socio else "not_found"
            except Exception as exc:
                # Provider exceptions can include URLs/credentials; persist only the class.
                logger.error(f"Refresh Vimarx fallido para negociacion {deal_id}: {type(exc).__name__}.")
                enrichment = build_error_enrichment(cuil, f"Fallo de consulta ({type(exc).__name__}).")
                outcome = "retry_exhausted"
                if attempts <= len(RETRY_DELAYS_MINUTES):
                    outcome = "retry_scheduled"
                    next_retry_at = (
                        processed_at + timedelta(minutes=RETRY_DELAYS_MINUTES[attempts - 1])
                    ).isoformat()

    checked_at = processed_at.isoformat()
    payload = json.loads(with_raw_json(enrichment).raw_json)
    payload.update({
        "queried_cuil": cuil,
        "queried_at": checked_at,
        "qualification_refresh": {
            "deal_id": deal_id,
            "outcome": outcome,
            "checked_at": checked_at,
            "attempts": attempts,
            "next_retry_at": next_retry_at,
        },
    })
    enrichment = replace(enrichment, raw_json=json.dumps(payload, ensure_ascii=True))
    fields = build_bitrix_enrichment_fields(client, config, enrichment)
    # Errors must invalidate previous credit data, never turn it into zero active loans.
    if not enrichment.ok:
        fields[config.fields.lead_vimarx_nro_socio] = ""
        fields[config.fields.lead_vimarx_creditos_activos_count] = ""
    deal_fields = build_deal_vimarx_fields(
        client, config, {**fields, config.fields.lead_cuil: cuil}
    )

    # Provider calls may take minutes. Do not overwrite a changed identity or moved deal.
    current_lead = get_lead(client, lead_id, logger)
    current_deal = client.call("crm.item.get", {
        "entityTypeId": DEAL_ENTITY_TYPE_ID, "id": deal_id,
    })["item"]
    if (
        only_digits(str(current_lead.get(config.fields.lead_cuil) or "")) != cuil
        or str(current_deal.get("leadId") or current_deal.get("LEAD_ID")) != str(lead_id)
        or str(current_deal.get("stageId") or current_deal.get("STAGE_ID"))
        != config.deal.pending_qualification_stage_id
    ):
        raise RuntimeError("La identidad o etapa cambio durante el refresh Vimarx; se debe reevaluar.")

    # Build/validate both writes before persisting. API failures abort qualification.
    update_lead_fields(client, lead_id, fields)
    client.call("crm.item.update", {
        "entityTypeId": DEAL_ENTITY_TYPE_ID, "id": deal_id, "fields": deal_fields,
    })
    logger.info(f"Refresh Vimarx de negociacion {deal_id}: {outcome}, intento {attempts}.")
    return VimarxRefreshResolution(
        {**current_lead, **fields}, outcome, checked_at, attempts, next_retry_at,
    )
