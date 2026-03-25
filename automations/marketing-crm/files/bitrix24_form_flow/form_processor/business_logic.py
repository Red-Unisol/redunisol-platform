from __future__ import annotations

from typing import Any

from .bitrix_client import BitrixClient
from .config import load_config
from .contact_service import upsert_contact
from .input_parser import normalize_business_input, parse_body
from .lead_service import create_lead, update_lead_status
from .logger import create_logger, Logger
from .qualification import QualificationResult, evaluate_qualification
from .result import failure_result, success_result


def process_form_body(
    body: str,
    *,
    content_type: str | None = None,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    logger: Logger | None = None,
) -> dict[str, object]:
    payload = parse_body(body, content_type)
    return process_submission(payload, env=env, bitrix_client=bitrix_client, logger=logger)


def process_submission(
    payload: dict[str, object],
    *,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    logger: Logger | None = None,
) -> dict[str, object]:
    active_logger = logger or create_logger()
    contact_id: int | None = None
    lead_id: int | None = None
    lead_status: str | None = None
    qualification = QualificationResult(
        qualified=False,
        reason="not_evaluated",
        message="La evaluacion no fue ejecutada.",
    )

    try:
        active_logger.info("Inicio de ejecucion.")
        config = load_config(env)
        client = bitrix_client or BitrixClient(config, active_logger)
        submission = normalize_business_input(payload)
        active_logger.info(f"CUIL normalizado: {submission.cuil_formatted}.")

        contact_id = upsert_contact(client, config, submission, active_logger)
        lead_id = create_lead(client, config, submission, contact_id, active_logger)

        qualification = evaluate_qualification(submission)
        active_logger.info(f"Resultado de calificacion: {qualification.reason}.")

        lead_status = update_lead_status(
            client,
            config,
            lead_id,
            qualification.qualified,
            qualification.rejection_label if not qualification.qualified else None,
            active_logger,
        )

        return success_result(
            qualified=qualification.qualified,
            contact_id=contact_id,
            lead_id=lead_id,
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
            lead_id=lead_id,
            lead_status=lead_status,
            reason=qualification.reason,
        )
