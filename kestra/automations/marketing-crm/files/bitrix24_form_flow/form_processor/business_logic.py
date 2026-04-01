from __future__ import annotations

from typing import Any
from collections.abc import Callable

from .bitrix_client import BitrixClient
from .config import load_config
from .contact_service import upsert_contact
from .core_socio import CoreSocioResult, resolve_member_status
from .input_parser import normalize_business_input, parse_body
from .lead_service import (
    build_submission_from_lead,
    create_lead,
    get_lead,
    resolve_employment_status,
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
    socio_resolver: Callable[[str, Any, Logger], CoreSocioResult] | None = None,
    logger: Logger | None = None,
) -> dict[str, object]:
    intake_result = ingest_form_body(
        body,
        content_type=content_type,
        env=env,
        bitrix_client=bitrix_client,
        socio_resolver=socio_resolver,
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
        socio_resolver=socio_resolver,
        logger=logger,
        force_processing=True,
    )


def process_submission(
    payload: dict[str, object],
    *,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    socio_resolver: Callable[[str, Any, Logger], CoreSocioResult] | None = None,
    logger: Logger | None = None,
) -> dict[str, object]:
    intake_result = ingest_submission(
        payload,
        env=env,
        bitrix_client=bitrix_client,
        socio_resolver=socio_resolver,
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
        socio_resolver=socio_resolver,
        logger=logger,
        force_processing=True,
    )


def ingest_form_body(
    body: str,
    *,
    content_type: str | None = None,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    socio_resolver: Callable[[str, Any, Logger], CoreSocioResult] | None = None,
    logger: Logger | None = None,
) -> dict[str, object]:
    payload = parse_body(body, content_type)
    return ingest_submission(
        payload,
        env=env,
        bitrix_client=bitrix_client,
        socio_resolver=socio_resolver,
        logger=logger,
    )


def ingest_submission(
    payload: dict[str, object],
    *,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    socio_resolver: Callable[[str, Any, Logger], CoreSocioResult] | None = None,
    logger: Logger | None = None,
) -> dict[str, object]:
    active_logger = logger or create_logger()
    contact_id: int | None = None
    lead_id: int | None = None

    try:
        active_logger.info("Inicio de intake.")
        config = load_config(env)
        client = bitrix_client or BitrixClient(config, active_logger)
        submission = normalize_business_input(
            payload,
            employment_status_resolver=lambda raw_value: resolve_employment_status(
                client,
                config.fields.lead_employment_status,
                raw_value,
            ),
        )
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
    socio_resolver: Callable[[str, Any, Logger], CoreSocioResult] | None = None,
    logger: Logger | None = None,
    force_processing: bool = False,
) -> dict[str, object]:
    active_logger = logger or create_logger()
    contact_id: int | None = None
    lead_status: str | None = None
    lead_id_int = int(lead_id)
    member_status_label: str | None = None
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

        submission = build_submission_from_lead(client, lead, config)
        member_lookup = socio_resolver or resolve_member_status
        member_status = member_lookup(submission.cuil_digits, config, active_logger)
        member_status_label = member_status.bitrix_label
        active_logger.info(f"Resultado de consulta de socio: {member_status.reason}.")
        qualification = evaluate_qualification(submission)
        active_logger.info(f"Resultado de calificacion: {qualification.reason}.")

        lead_status = update_lead_status(
            client,
            config,
            lead_id_int,
            qualification.qualified,
            qualification.rejection_label if not qualification.qualified else None,
            member_status_label,
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
