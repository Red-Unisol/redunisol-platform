from __future__ import annotations

import json
from typing import Any

from .bcra_client import (
    BCRA_STATUS_INVALID_IDENTIFICATION,
    BCRA_STATUS_NEGATIVE,
    BCRA_STATUS_NOT_FOUND,
    BCRA_STATUS_OK,
)
from .bcra_service import sync_lead_bcra
from .bitrix_client import BitrixClient
from .config import load_config
from .contact_service import upsert_contact
from .input_parser import normalize_business_input, parse_body
from .lead_service import (
    build_submission_from_lead,
    create_lead,
    get_lead,
    should_process_lead,
    update_lead_status,
)
from .logger import create_logger, Logger
from .qualification import QualificationResult, evaluate_qualification
from .result import failure_result, intake_success_result, skipped_result, success_result


def process_form_body(
    body: str,
    *,
    content_type: str | None = None,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    bcra_client: Any | None = None,
    logger: Logger | None = None,
) -> dict[str, object]:
    intake_result = ingest_form_body(
        body,
        content_type=content_type,
        env=env,
        bitrix_client=bitrix_client,
        logger=logger,
    )
    if not intake_result.get("ok"):
        return intake_result

    lead_id = intake_result.get("lead_id")
    if lead_id is None:
        return failure_result(message="No se pudo obtener el lead creado.")

    return classify_lead(
        lead_id,
        env=env,
        bitrix_client=bitrix_client,
        bcra_client=bcra_client,
        logger=logger,
        force_processing=True,
    )


def process_submission(
    payload: dict[str, object],
    *,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    bcra_client: Any | None = None,
    logger: Logger | None = None,
) -> dict[str, object]:
    intake_result = ingest_submission(payload, env=env, bitrix_client=bitrix_client, logger=logger)
    if not intake_result.get("ok"):
        return intake_result

    lead_id = intake_result.get("lead_id")
    if lead_id is None:
        return failure_result(message="No se pudo obtener el lead creado.")

    return classify_lead(
        lead_id,
        env=env,
        bitrix_client=bitrix_client,
        bcra_client=bcra_client,
        logger=logger,
        force_processing=True,
    )


def ingest_form_body(
    body: str,
    *,
    content_type: str | None = None,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    logger: Logger | None = None,
) -> dict[str, object]:
    payload = parse_body(body, content_type)
    return ingest_submission(payload, env=env, bitrix_client=bitrix_client, logger=logger)


def ingest_submission(
    payload: dict[str, object],
    *,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    logger: Logger | None = None,
) -> dict[str, object]:
    active_logger = logger or create_logger()
    contact_id: int | None = None
    lead_id: int | None = None

    try:
        active_logger.info("Inicio de intake.")
        config = load_config(env)
        client = bitrix_client or BitrixClient(config, active_logger)
        submission = normalize_business_input(payload)
        active_logger.info(f"CUIL normalizado: {submission.cuil_formatted}.")

        contact_id = upsert_contact(client, config, submission, active_logger)
        lead_id = create_lead(client, config, submission, contact_id, active_logger)
        return intake_success_result(
            contact_id=contact_id,
            lead_id=lead_id,
            message="Lead creado para clasificacion posterior.",
        )
    except Exception as exc:
        active_logger.error(str(exc))
        return failure_result(
            message=str(exc),
            contact_id=contact_id,
            lead_id=lead_id,
        )


def classify_lead(
    lead_id: int | str,
    *,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    bcra_client: Any | None = None,
    logger: Logger | None = None,
    force_processing: bool = False,
) -> dict[str, object]:
    active_logger = logger or create_logger()
    contact_id: int | None = None
    lead_status: str | None = None
    lead_id_int = int(lead_id)
    qualification = QualificationResult(
        qualified=False,
        reason="not_evaluated",
        message="La evaluacion no fue ejecutada.",
    )

    try:
        active_logger.info(f"Inicio de clasificacion para lead {lead_id_int}.")
        config = load_config(env)
        client = bitrix_client or BitrixClient(config, active_logger)
        lead = get_lead(client, lead_id_int, active_logger)
        contact_id = _optional_int(lead.get("CONTACT_ID"))
        lead_status = _optional_str(lead.get("STATUS_ID"))

        if not force_processing and not should_process_lead(client, lead, config):
            active_logger.info(
                f"Lead {lead_id_int} omitido: politica de procesamiento distinta de 'Procesar'."
            )
            return skipped_result(
                contact_id=contact_id,
                lead_id=lead_id_int,
                lead_status=lead_status,
                message="El lead no esta marcado para procesamiento automatico.",
            )

        submission = build_submission_from_lead(lead, config)
        qualification = evaluate_qualification(submission)

        stored_bcra_rejection = _stored_bcra_should_reject(lead, config, active_logger, lead_id_int)

        if stored_bcra_rejection is None:
            bcra_result = sync_lead_bcra(
                client,
                config,
                lead_id_int,
                submission.cuil_digits,
                active_logger,
                bcra_client=bcra_client,
            )
            should_reject_by_bcra = bcra_result.should_reject
        else:
            should_reject_by_bcra = stored_bcra_rejection

        if should_reject_by_bcra:
            qualification = QualificationResult(
                qualified=False,
                reason="bcra_negative_situation",
                message=(
                    "El snapshot actual del BCRA supera el umbral permitido de situaciones 5."
                ),
                rejection_label="SIT NEG BCRA",
            )
        active_logger.info(f"Resultado de calificacion: {qualification.reason}.")

        lead_status = update_lead_status(
            client,
            config,
            lead_id_int,
            qualification.qualified,
            qualification.rejection_label if not qualification.qualified else None,
            active_logger,
        )

        return success_result(
            qualified=qualification.qualified,
            contact_id=contact_id or 0,
            lead_id=lead_id_int,
            lead_status=lead_status,
            message=qualification.message,
            reason=qualification.reason,
        )
    except Exception as exc:
        active_logger.error(str(exc))
        return failure_result(
            message=str(exc),
            qualified=qualification.qualified,
            contact_id=contact_id,
            lead_id=lead_id_int,
            lead_status=lead_status,
            reason=qualification.reason,
        )


def _optional_int(raw_value: object) -> int | None:
    if raw_value is None or str(raw_value).strip() == "":
        return None
    return int(str(raw_value))


def _optional_str(raw_value: object) -> str | None:
    if raw_value is None:
        return None
    value = str(raw_value).strip()
    return value or None


def _stored_bcra_should_reject(
    lead: dict[str, Any],
    config: Any,
    logger: Logger,
    lead_id: int,
) -> bool | None:
    stored_bcra_raw = None
    if config.fields.lead_bcra_data_raw:
        stored_bcra_raw = _optional_str(lead.get(config.fields.lead_bcra_data_raw))

    if stored_bcra_raw is not None:
        stored_value = _extract_should_reject_from_raw(stored_bcra_raw)
        if stored_value is not None:
            logger.info(f"Lead {lead_id} ya tiene snapshot BCRA en campo raw.")
            return stored_value

    stored_bcra_formatted = None
    if config.fields.lead_bcra_status:
        stored_bcra_formatted = _optional_str(lead.get(config.fields.lead_bcra_status))

    if stored_bcra_formatted is None:
        return None

    legacy_status = stored_bcra_formatted.upper()
    if legacy_status == BCRA_STATUS_NEGATIVE:
        logger.info(f"Lead {lead_id} reutiliza snapshot BCRA legacy NEGATIVO.")
        return True

    if legacy_status in (BCRA_STATUS_OK, BCRA_STATUS_NOT_FOUND, BCRA_STATUS_INVALID_IDENTIFICATION):
        logger.info(f"Lead {lead_id} reutiliza snapshot BCRA legacy {legacy_status}.")
        return False

    return None


def _extract_should_reject_from_raw(raw_payload: str) -> bool | None:
    try:
        parsed = json.loads(raw_payload)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed, dict):
        return None

    if isinstance(parsed.get("should_reject"), bool):
        return bool(parsed["should_reject"])

    payload = parsed.get("payload")
    if not isinstance(payload, dict):
        return None

    if isinstance(payload.get("should_reject"), bool):
        return bool(payload["should_reject"])

    return None
