from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time
import json
import os
import unicodedata
from typing import Any
from zoneinfo import ZoneInfo

from .bitrix_client import BitrixClient
from .config import AppConfig, load_config
from .deal_service import (
    DEAL_ENTITY_TYPE_ID,
    assign_open_line_chats_to_user,
    bind_open_line_activities_to_deal,
    notify_distribution_supervisor,
    notify_unmatched_routing,
    resolve_round_robin_assignee,
)
from .lead_service import (
    build_submission_from_lead,
    get_lead,
    lead_enum_label,
)
from .logger import Logger, create_logger
from .routing_bucket import resolve_routing_bucket


@dataclass(frozen=True)
class CatamarcaDecision:
    action: str
    reason: str
    stage_id: str
    commercial_line: str | None = None


BUSINESS_HOURS_ONLY_ENV = "BITRIX24_DISTRIBUTION_BUSINESS_HOURS_ONLY"
BUSINESS_HOURS_TIMEZONE_ENV = "BITRIX24_DISTRIBUTION_TIMEZONE"
BUSINESS_HOURS_WORKDAYS_ENV = "BITRIX24_DISTRIBUTION_WORKDAYS"
BUSINESS_HOURS_FROM_ENV = "BITRIX24_DISTRIBUTION_FROM"
BUSINESS_HOURS_TO_ENV = "BITRIX24_DISTRIBUTION_TO"
WEEKDAY_CODES = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


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
            message=f"Negociacion {deal_id} seleccionada para clasificación comercial.",
        )

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
    logger: Logger | None = None,
    now: datetime | None = None,
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

    source = os.environ if env is None else env
    if _business_hours_gate_enabled(source) and not _is_within_business_hours(source, now):
        client.call(
            "crm.item.update",
            {
                "entityTypeId": DEAL_ENTITY_TYPE_ID,
                "id": deal_id_int,
                "fields": {
                    "stageId": config.deal.manual_review_stage_id,
                    "assignedById": config.deal.provisional_user_id,
                },
            },
        )
        active_logger.info(
            f"Negociacion {deal_id_int} recibida fuera de horario laboral: "
            "queda asignada a Maru para distribucion manual."
        )
        return _result(
            action="manual_review",
            has_pending=False,
            deal_id=deal_id_int,
            lead_id=lead_id,
            stage_id=config.deal.manual_review_stage_id,
            reason="outside_business_hours",
            assigned_by_id=config.deal.provisional_user_id,
            message=(
                "Negociacion fuera de horario laboral; queda en manos de Maru "
                "para distribucion manual."
            ),
        )

    lead = get_lead(client, lead_id, active_logger)
    contact_id = _optional_int(deal.get("contactId") or lead.get("CONTACT_ID"))
    deal_title = str(deal.get("title") or deal.get("TITLE") or "").strip()
    routing = resolve_routing_bucket(config, lead)
    if routing.bucket is None:
        client.call(
            "crm.item.update",
            {
                "entityTypeId": DEAL_ENTITY_TYPE_ID,
                "id": deal_id_int,
                "fields": {"stageId": config.deal.routing_review_stage_id},
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
        active_logger.info(
            f"Negociacion {deal_id_int} sin bucket: {routing.reason}; "
            "no se asigna vendedor ni se transfiere chat."
        )
        return _result(
            action="routing_review",
            has_pending=False,
            deal_id=deal_id_int,
            lead_id=lead_id,
            stage_id=config.deal.routing_review_stage_id,
            reason=routing.reason,
            message="Negociacion enviada a revision por no tener bucket de distribucion.",
        )

    bucket = routing.bucket
    decision = _evaluate_deal(client, config, lead)
    if decision.action == "commercial_rejected":
        client.call(
            "crm.item.update",
            {
                "entityTypeId": DEAL_ENTITY_TYPE_ID,
                "id": deal_id_int,
                "fields": {
                    "stageId": decision.stage_id,
                    "assignedById": config.deal.provisional_user_id,
                    config.deal.commercial_line_field: "",
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
            message="Rechazo comercial aplicado sin distribución automática.",
        )
    assigned_by_id = resolve_round_robin_assignee(
        client,
        config,
        contact_id=contact_id,
        lead_id=lead_id,
        bucket_key=bucket.key,
        bucket_field=config.deal.routing_bucket_field,
        pool=bucket.seller_ids,
        legacy_province_label=bucket.legacy_province_label,
        logger=active_logger,
    )
    update_fields: dict[str, Any] = {
        "stageId": decision.stage_id,
        "assignedById": assigned_by_id,
        config.deal.routing_bucket_field: bucket.key,
    }
    if decision.commercial_line is not None:
        update_fields[config.deal.commercial_line_field] = decision.commercial_line

    client.call(
        "crm.item.update",
        {
            "entityTypeId": DEAL_ENTITY_TYPE_ID,
            "id": deal_id_int,
            "fields": update_fields,
        },
    )
    bind_open_line_activities_to_deal(
        client,
        lead_id=lead_id,
        contact_id=contact_id,
        deal_id=deal_id_int,
        logger=active_logger,
    )
    transferred_chat_count = assign_open_line_chats_to_user(
        client,
        lead_id=lead_id,
        contact_id=contact_id,
        deal_id=deal_id_int,
        assigned_by_id=assigned_by_id,
        logger=active_logger,
    )
    notify_distribution_supervisor(
        client,
        config,
        deal_id=deal_id_int,
        deal_title=deal_title,
        bucket_label=bucket.label,
        assigned_by_id=assigned_by_id,
        action=decision.action,
        chat_transferred=transferred_chat_count > 0,
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
        routing_bucket=bucket.key,
        commercial_line=decision.commercial_line,
        message="Clasificación comercial aplicada a la negociación.",
    )


def _evaluate_deal(client: Any, config: AppConfig, lead: dict[str, Any]) -> CatamarcaDecision:
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
) -> CatamarcaDecision:
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
) -> CatamarcaDecision:
    entities = _bcra_entities(config, lead)
    if entities is None:
        return _manual(config, "missing_bcra_snapshot")
    vimarx = _vimarx_payload(config, lead)

    if employment in {"empleado_publico_provincial", "policia"}:
        return _evaluate_cruz_del_eje(config, entities, vimarx)
    if employment == "jubilado_provincial":
        return _evaluate_caja(config, lead, entities, vimarx, payment_bank)
    if employment == "daspu":
        return _manual(config, "daspu_form_691_or_limit_not_available")
    if employment == "empleado_de_la_unc":
        return _evaluate_unc(config, lead, entities, vimarx)
    if employment in {
        "docente",
        "empleado_publico_municipal",
        "personal_de_salud",
        "jubilado_nacional",
        "pensionado",
    }:
        return _evaluate_cbu(config, lead, entities, employment, vimarx)
    return _manual(config, "unsupported_cordoba_employment_status")


def _evaluate_cruz_del_eje(
    config: AppConfig,
    entities: list[dict[str, Any]],
    vimarx: dict[str, Any] | None,
) -> CatamarcaDecision:
    bank_situation = _named_bank_situation(entities, "cordoba")
    if bank_situation >= 2:
        return _bcra_rejected(config, "cordoba_bank_situation_above_one")
    if _high_risk_count(entities) > 2:
        return _bcra_rejected(config, "cde_more_than_two_high_risk_situations")

    credits = _family_credits(vimarx, 2712)
    if vimarx is None:
        return _manual(config, "missing_vimarx_credit_data")
    if len(credits) > 1:
        return _manual(config, "cde_parallel_requires_manual_review")
    if credits:
        credit = credits[0]
        if _optional_int(credit.get("dias_atraso")) not in {None, 0}:
            return _manual(config, "cde_active_loan_in_arrears")
        prefix = "cde_ren"
    else:
        prefix = "cde"

    if all(value <= 1 for value in _situations(entities)):
        return _approved(config, prefix + "_premium", "Cruz del Eje")
    return _approved(config, prefix + "_special", "Cruz del Eje")


def _evaluate_cbu(
    config: AppConfig,
    lead: dict[str, Any],
    entities: list[dict[str, Any]],
    employment: str,
    vimarx: dict[str, Any] | None,
) -> CatamarcaDecision:
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
) -> CatamarcaDecision:
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
) -> CatamarcaDecision:
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
) -> CatamarcaDecision | None:
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


def _approved(config: AppConfig, reason: str, line: str) -> CatamarcaDecision:
    return CatamarcaDecision("approved", reason, config.deal.stage_id, line)


def _bcra_rejected(config: AppConfig, reason: str) -> CatamarcaDecision:
    return CatamarcaDecision("rejected", reason, config.deal.bcra_rejected_stage_id)


def _commercial_rejected(config: AppConfig, reason: str) -> CatamarcaDecision:
    return CatamarcaDecision(
        "commercial_rejected", reason, config.deal.commercial_rejected_stage_id
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


def _manual(config: AppConfig, reason: str) -> CatamarcaDecision:
    return CatamarcaDecision(
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
    workdays = {
        WEEKDAY_CODES[code.strip()]
        for code in str(source.get(BUSINESS_HOURS_WORKDAYS_ENV, "MO,TU,WE,TH,FR"))
        .upper()
        .split(",")
        if code.strip() in WEEKDAY_CODES
    }
    starts_at = time.fromisoformat(str(source.get(BUSINESS_HOURS_FROM_ENV, "09:00")))
    ends_at = time.fromisoformat(str(source.get(BUSINESS_HOURS_TO_ENV, "17:00")))
    local_time = local_now.time().replace(tzinfo=None)
    return local_now.weekday() in workdays and starts_at <= local_time < ends_at


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
    routing_bucket: str = "",
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
        "routing_bucket": routing_bucket,
        "commercial_line": commercial_line,
    }
