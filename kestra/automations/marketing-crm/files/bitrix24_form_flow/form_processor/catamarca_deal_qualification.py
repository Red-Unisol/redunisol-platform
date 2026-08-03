from __future__ import annotations

from dataclasses import dataclass
import json
import unicodedata
from typing import Any

from .bitrix_client import BitrixClient
from .config import AppConfig, load_config
from .deal_service import DEAL_ENTITY_TYPE_ID, resolve_round_robin_assignee
from .lead_service import (
    build_submission_from_lead,
    get_lead,
    lead_enum_label,
    lead_has_commercial_owner,
)
from .logger import Logger, create_logger


@dataclass(frozen=True)
class CatamarcaDecision:
    action: str
    reason: str
    stage_id: str
    commercial_line: str | None = None


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

    lead = get_lead(client, lead_id, active_logger)
    decision = _evaluate_catamarca(client, config, lead)
    update_fields: dict[str, Any] = {"stageId": decision.stage_id}
    assigned_by_id = config.deal.provisional_user_id
    if decision.action == "approved":
        contact_id = _optional_int(deal.get("contactId") or lead.get("CONTACT_ID"))
        assigned_by_id = resolve_round_robin_assignee(
            client,
            config,
            contact_id=contact_id,
            lead_id=lead_id,
            logger=active_logger,
        )
        update_fields["assignedById"] = assigned_by_id
        update_fields[config.deal.commercial_line_field] = decision.commercial_line

    client.call(
        "crm.item.update",
        {
            "entityTypeId": DEAL_ENTITY_TYPE_ID,
            "id": deal_id_int,
            "fields": update_fields,
        },
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

    return _evaluate_bcra(
        config,
        lead,
        submission.payment_bank.label,
        member_label=member_label,
        active_credits=active_credits,
    )


def _evaluate_bcra(
    config: AppConfig,
    lead: dict[str, Any],
    payment_bank_label: str,
    *,
    member_label: str,
    active_credits: int | None,
) -> CatamarcaDecision:
    raw_value = lead.get(config.fields.lead_bcra_data_raw or "")
    try:
        snapshot = json.loads(str(raw_value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return _member_review(config, member_label, active_credits) or _manual(
            config,
            "missing_bcra_snapshot",
        )
    if not isinstance(snapshot, dict) or snapshot.get("outcome") != "ok":
        return _member_review(config, member_label, active_credits) or _manual(
            config,
            "bcra_snapshot_not_conclusive",
        )

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

    if any(
        _is_banco_nacion(entity.get("entidad"))
        and (_optional_int(entity.get("situacion")) or 0) > 2
        for entity in entities
    ):
        return CatamarcaDecision(
            action="rejected",
            reason="banco_nacion_situation_above_two",
            stage_id=config.deal.bcra_rejected_stage_id,
        )

    member_review = _member_review(config, member_label, active_credits)
    if member_review is not None:
        return member_review

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

    if high_risk_count <= 4 and _payment_bank_is_acceptable(
        entities,
        payment_bank_label,
    ):
        return CatamarcaDecision(
            action="approved",
            reason="amejuca_special",
            stage_id=config.deal.stage_id,
            commercial_line="AMEJUCA Especial",
        )

    return _manual(config, "amejuca_line_requires_manual_review")


def _member_review(
    config: AppConfig,
    member_label: str,
    active_credits: int | None,
) -> CatamarcaDecision | None:
    if active_credits is not None and active_credits > 0:
        return _manual(config, "member_credit_rules_require_manual_review")
    if member_label == "si" and active_credits is None:
        return _manual(config, "missing_active_credit_data")
    if member_label not in {"no", "si"} and active_credits is None:
        return _manual(config, "missing_membership_data")
    return None


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


def _payment_bank_is_acceptable(
    entities: list[dict[str, Any]],
    payment_bank_label: str,
) -> bool:
    bank = _normalize_text(payment_bank_label)
    bank_tokens = {
        token
        for token in bank.split()
        if len(token) >= 4 and token not in {"banco", "argentina", "provincia"}
    }
    if not bank_tokens:
        return False
    matching_situations: list[int] = []
    for entity in entities:
        entity_name = _normalize_text(entity.get("entidad"))
        if not bank_tokens.intersection(entity_name.split()):
            continue
        situation = _optional_int(entity.get("situacion"))
        if situation is not None:
            matching_situations.append(situation)

    if matching_situations:
        return all(situation <= 1 for situation in matching_situations)

    # Banco Nacion ausente en el snapshot equivale a situacion cero.
    return _is_banco_nacion(payment_bank_label)


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
        "commercial_line": commercial_line,
    }
