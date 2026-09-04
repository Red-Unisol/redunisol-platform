from __future__ import annotations

from datetime import datetime, timedelta, timezone
import re
from typing import Any

from .bcra_service import sync_lead_bcra
from .bitrix_client import BitrixClient
from .config import AppConfig, load_config
from .contact_service import upsert_contact
from .credixsa_employer_service import update_lead_with_credixsa_output
from .lead_service import (
    build_submission_from_lead,
    get_lead,
    resolve_processing_policy_enum_id,
    update_lead_fields,
)
from .logger import Logger, create_logger
from .normalization import normalize_birthdate
from .vimarx_service import sync_lead_vimarx_enrichment


ARGENTINA_TIMEZONE = timezone(timedelta(hours=-3))
FINGURU_SOURCE_ID = "3729"
IDENTITY_UNCHANGED = "unchanged"
IDENTITY_SANITIZED = "sanitized"
IDENTITY_UNRESOLVED = "unresolved"


def select_next_new_lead_for_prefill(
    *,
    date_from: str | None = None,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    logger: Logger | None = None,
) -> dict[str, object]:
    active_logger = logger or create_logger()
    config = load_config(env)
    client = bitrix_client or BitrixClient(config, active_logger)
    lead_filter = {"STATUS_ID": config.lead_statuses.new}
    if date_from and date_from.strip():
        lead_filter[">=DATE_CREATE"] = date_from.strip()

    response = client.call_full(
        "crm.lead.list",
        {
            "filter": lead_filter,
            "order": {
                config.fields.lead_backfill_attempts: "ASC",
                "ID": "ASC",
            },
            "select": [
                "ID",
                "CONTACT_ID",
                config.fields.lead_cuil,
                config.fields.lead_dni,
                config.fields.lead_source,
                config.fields.lead_backfill_attempts,
            ],
            "start": 0,
        },
    )
    leads = response.get("result") or []
    if not isinstance(leads, list):
        raise RuntimeError("crm.lead.list devolvio un payload invalido.")

    for lead in leads:
        lead_id = _optional_int(lead.get("ID"))
        if lead_id is None:
            continue
        cuil = _digits(lead.get(config.fields.lead_cuil))
        dni = _digits(lead.get(config.fields.lead_dni))
        source_id = _optional_str(lead.get(config.fields.lead_source)) or ""
        credix_identifier = credix_identifier_for_prefill(
            source_id=source_id,
            cuil=cuil,
            dni=dni,
        )
        return {
            "ok": True,
            "action": "selected",
            "has_pending": True,
            "lead_id": str(lead_id),
            "cuil": cuil,
            "dni": dni,
            "source_id": source_id,
            "credix_identifier": credix_identifier,
            "needs_identity_sanitization": (
                source_id == FINGURU_SOURCE_ID and len(cuil) == 8
            ),
            "attempts": _optional_int(lead.get(config.fields.lead_backfill_attempts)) or 0,
            "message": f"Lead {lead_id} seleccionado para backfill.",
        }

    return {
        "ok": True,
        "action": "no_pending",
        "has_pending": False,
        "lead_id": "",
        "cuil": "",
        "dni": "",
        "source_id": "",
        "credix_identifier": "",
        "needs_identity_sanitization": False,
        "attempts": 0,
        "message": "No hay leads en INGRESO pendientes de backfill.",
    }


def prefill_lead(
    lead_id: int | str,
    *,
    arca_output: dict[str, Any],
    credixsa_output: dict[str, Any],
    max_attempts: int = 3,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    bcra_client: Any | None = None,
    logger: Logger | None = None,
) -> dict[str, object]:
    if max_attempts <= 0:
        raise ValueError("max_attempts debe ser mayor a cero.")

    active_logger = logger or create_logger()
    config = load_config(env)
    client = bitrix_client or BitrixClient(config, active_logger)
    lead_id_int = int(str(lead_id))
    lead = get_lead(client, lead_id_int, active_logger)
    current_status = _optional_str(lead.get("STATUS_ID"))

    if current_status != config.lead_statuses.new:
        return _result(
            action="skipped",
            lead_id=lead_id_int,
            lead_status=current_status,
            attempts=_optional_int(lead.get(config.fields.lead_backfill_attempts)) or 0,
            message="El lead ya no esta en INGRESO; no se ejecuta backfill.",
        )

    previous_attempts = _optional_int(lead.get(config.fields.lead_backfill_attempts)) or 0
    cuil = _optional_str(lead.get(config.fields.lead_cuil))

    if cuil is None:
        update_lead_fields(
            client,
            lead_id_int,
            {"STATUS_ID": config.lead_statuses.preclassification},
        )
        return _result(
            action="advanced_partial",
            lead_id=lead_id_int,
            lead_status=config.lead_statuses.preclassification,
            attempts=previous_attempts,
            errors=["missing_cuil"],
            message=(
                "Lead sin CUIL; se omite el enriquecimiento dependiente del CUIL "
                "y se avanza a PRECLASIFICACION."
            ),
        )

    if previous_attempts >= max_attempts:
        completed_fields = {
            "STATUS_ID": config.lead_statuses.preclassification,
            config.fields.lead_processing_policy: resolve_processing_policy_enum_id(
                client,
                config,
                "skip",
            ),
        }
        update_lead_fields(
            client,
            lead_id_int,
            completed_fields,
        )
        return _result(
            action="advanced_partial",
            lead_id=lead_id_int,
            lead_status=config.lead_statuses.preclassification,
            attempts=previous_attempts,
            errors=["attempts_exhausted"],
            message=(
                "Backfill previamente agotado; "
                "lead movido a PRECLASIFICACION sin ejecutar otro intento."
            ),
        )

    attempts = previous_attempts + 1
    counter_persisted = False
    try:
        update_lead_fields(
            client,
            lead_id_int,
            {config.fields.lead_backfill_attempts: attempts},
        )
        refreshed_lead = get_lead(client, lead_id_int, active_logger)
        persisted_attempts = (
            _optional_int(
                refreshed_lead.get(config.fields.lead_backfill_attempts)
            ) or 0
        )
        counter_persisted = persisted_attempts >= attempts
    except Exception as exc:
        active_logger.error(
            f"No se pudo persistir o verificar el contador del lead "
            f"{lead_id_int}: {exc}"
        )
    errors: list[str] = []
    if not counter_persisted:
        errors.append("attempt_counter_not_persisted")

    identity = resolve_prefill_identity(
        source_id=lead.get(config.fields.lead_source),
        cuil=lead.get(config.fields.lead_cuil),
        dni=lead.get(config.fields.lead_dni),
        credixsa_output=credixsa_output,
    )
    cuil = _optional_str(identity["effective_cuil"])

    if identity["status"] == IDENTITY_SANITIZED and cuil:
        update_lead_fields(client, lead_id_int, {config.fields.lead_cuil: cuil})
        lead[config.fields.lead_cuil] = cuil

    should_link_finguru_contact = (
        str(lead.get(config.fields.lead_source) or "").strip() == FINGURU_SOURCE_ID
        and bool(cuil)
        and _is_valid_cuil(cuil or "")
        and (_optional_int(lead.get("CONTACT_ID")) or 0) <= 0
    )
    if identity["status"] == IDENTITY_SANITIZED or should_link_finguru_contact:
        try:
            contact = upsert_contact(
                client,
                config,
                build_submission_from_lead(lead, config),
                active_logger,
                birthdate=normalize_birthdate(arca_output.get("fecha_nacimiento")),
            )
            update_lead_fields(client, lead_id_int, {"CONTACT_ID": contact.contact_id})
            lead["CONTACT_ID"] = str(contact.contact_id)
        except Exception as exc:
            active_logger.error(
                f"CUIL saneado, pero no se pudo vincular el contacto del lead {lead_id_int}: {exc}"
            )
            errors.append("contact")
    if identity["status"] == IDENTITY_UNRESOLVED:
        errors.append("identity")

    if cuil is None:
        try:
            credix_result = update_lead_with_credixsa_output(
                lead_id=lead_id_int,
                credixsa_output=credixsa_output,
                env=env,
                bitrix_client=client,
                logger=active_logger,
            )
            if not bool(credixsa_output.get("ok")) or not bool(credix_result.get("ok")):
                errors.append("credixsa")
        except Exception as exc:
            active_logger.error(f"Fallo CredixSA para el lead {lead_id_int}: {exc}")
            errors.append("credixsa")
        if identity["status"] != IDENTITY_UNRESOLVED:
            errors.append("missing_cuil")
    else:
        arca_applied = False
        try:
            arca_applied = _apply_arca_output(client, config, lead, arca_output, active_logger)
            if not arca_applied:
                errors.append("arca")
        except Exception as exc:
            active_logger.error(f"Fallo ARCA para el lead {lead_id_int}: {exc}")
            errors.append("arca")

        try:
            credix_result = update_lead_with_credixsa_output(
                lead_id=lead_id_int,
                credixsa_output=credixsa_output,
                env=env,
                bitrix_client=client,
                logger=active_logger,
            )
            if not bool(credixsa_output.get("ok")) or not bool(credix_result.get("ok")):
                errors.append("credixsa")
        except Exception as exc:
            active_logger.error(f"Fallo CredixSA para el lead {lead_id_int}: {exc}")
            errors.append("credixsa")

        try:
            if not sync_lead_vimarx_enrichment(
                client,
                config,
                lead_id_int,
                cuil,
                active_logger,
            ):
                errors.append("vimarx")
        except Exception as exc:
            active_logger.error(f"Fallo Vimarx para el lead {lead_id_int}: {exc}")
            errors.append("vimarx")

        try:
            bcra_result = sync_lead_bcra(
                client,
                config,
                lead_id_int,
                cuil,
                active_logger,
                bcra_client=bcra_client,
            )
            if not arca_applied and bcra_result.denominacion:
                _apply_bcra_name_fallback(
                    client,
                    lead,
                    bcra_result.denominacion,
                    active_logger,
                )
            if not bcra_result.is_persistable:
                errors.append("bcra")
        except Exception as exc:
            active_logger.error(f"Fallo BCRA para el lead {lead_id_int}: {exc}")
            errors.append("bcra")

    errors = list(dict.fromkeys(errors))
    exhausted = attempts >= max_attempts
    should_advance = not errors or exhausted or not counter_persisted
    next_status = current_status
    if should_advance:
        next_status = config.lead_statuses.preclassification
        update_lead_fields(
            client,
            lead_id_int,
            {
                "STATUS_ID": next_status,
                config.fields.lead_processing_policy: resolve_processing_policy_enum_id(
                    client,
                    config,
                    "skip",
                ),
            },
        )

    if not errors:
        action = "advanced"
        message = "Backfill completo; lead movido a PRECLASIFICACION."
    elif exhausted or not counter_persisted:
        action = "advanced_partial"
        if exhausted:
            message = (
                "Backfill parcial luego de agotar reintentos; "
                "lead movido a PRECLASIFICACION."
            )
        else:
            message = (
                "No se pudo persistir el contador de reintentos; "
                "para no bloquear la cola, el lead se movio a PRECLASIFICACION."
            )
    else:
        action = "retry_pending"
        message = "Backfill incompleto; el lead permanece en INGRESO para reintentar."

    active_logger.info(
        f"Backfill lead {lead_id_int}: action={action}, attempts={attempts}, errors={errors}."
    )
    return _result(
        action=action,
        lead_id=lead_id_int,
        lead_status=next_status,
        attempts=attempts,
        errors=errors,
        message=message,
    )


def _apply_arca_output(
    client: Any,
    config: AppConfig,
    lead: dict[str, Any],
    output: dict[str, Any],
    logger: Logger,
) -> bool:
    if not bool(output.get("ok")):
        return False

    contact_id = _optional_int(lead.get("CONTACT_ID"))
    birthdate = normalize_birthdate(output.get("fecha_nacimiento"))
    nombre = _optional_str(output.get("nombre"))
    apellido = _optional_str(output.get("apellido"))
    razon_social = _optional_str(output.get("razon_social"))
    full_name = " ".join(part for part in (nombre, apellido) if part) or razon_social

    if contact_id is not None:
        contact_fields: dict[str, Any] = {}
        if nombre:
            contact_fields["NAME"] = nombre
            contact_fields["LAST_NAME"] = apellido or ""
        elif razon_social:
            contact_fields["NAME"] = razon_social
            contact_fields["LAST_NAME"] = ""
        if birthdate:
            contact_fields["BIRTHDATE"] = birthdate
        if contact_fields:
            logger.info(f"Actualizando contacto {contact_id} con datos ARCA.")
            client.call(
                "crm.contact.update",
                {"id": contact_id, "fields": contact_fields},
            )

    lead_fields: dict[str, Any] = {}
    if full_name:
        lead_fields["TITLE"] = full_name
        lead_fields["NAME"] = full_name
        lead_fields["LAST_NAME"] = ""
    if birthdate and config.fields.lead_birthdate:
        lead_fields[config.fields.lead_birthdate] = birthdate
    if birthdate and config.fields.lead_contact_birthdate:
        lead_fields[config.fields.lead_contact_birthdate] = birthdate
    if lead_fields:
        update_lead_fields(client, int(str(lead["ID"])), lead_fields)
    return True


def _apply_bcra_name_fallback(
    client: Any,
    lead: dict[str, Any],
    denominacion: str,
    logger: Logger,
) -> bool:
    """Replace only email-derived placeholder names with BCRA's holder name."""
    contact_id = _optional_int(lead.get("CONTACT_ID"))
    resolved_name = _optional_str(denominacion)
    if contact_id is None or resolved_name is None:
        return False

    contact = client.call("crm.contact.get", {"id": contact_id})
    if not isinstance(contact, dict) or not _contact_name_is_email_inferred(contact):
        return False

    logger.info(f"Actualizando contacto {contact_id} con titular informado por BCRA.")
    client.call(
        "crm.contact.update",
        {"id": contact_id, "fields": {"NAME": resolved_name, "LAST_NAME": ""}},
    )
    update_lead_fields(
        client,
        int(str(lead["ID"])),
        {"TITLE": resolved_name, "NAME": resolved_name, "LAST_NAME": ""},
    )
    return True


def _contact_name_is_email_inferred(contact: dict[str, Any]) -> bool:
    full_name = " ".join(
        part
        for part in (
            str(contact.get("NAME") or "").strip(),
            str(contact.get("LAST_NAME") or "").strip(),
        )
        if part
    )
    emails = contact.get("EMAIL") or []
    if not full_name or not isinstance(emails, list):
        return False
    normalized_name = re.sub(r"[^a-z0-9]", "", full_name.casefold())
    return any(
        normalized_name
        == re.sub(r"[^a-z0-9]", "", str(item.get("VALUE") or "").split("@", 1)[0].casefold())
        for item in emails
        if isinstance(item, dict) and "@" in str(item.get("VALUE") or "")
    )


def _result(
    *,
    action: str,
    lead_id: int,
    lead_status: str | None,
    attempts: int,
    message: str,
    errors: list[str] | None = None,
) -> dict[str, object]:
    return {
        "ok": True,
        "action": action,
        "lead_id": str(lead_id),
        "lead_status": lead_status or "",
        "attempts": attempts,
        "errors": errors or [],
        "completed_at": datetime.now(ARGENTINA_TIMEZONE).isoformat(timespec="seconds"),
        "message": message,
    }


def _optional_int(raw_value: object) -> int | None:
    if raw_value is None or str(raw_value).strip() == "":
        return None
    return int(str(raw_value))


def _optional_str(raw_value: object) -> str | None:
    if raw_value is None:
        return None
    value = str(raw_value).strip()
    return value or None


def credix_identifier_for_prefill(
    *,
    source_id: object,
    cuil: object,
    dni: object,
) -> str:
    normalized_cuil = _digits(cuil)
    normalized_dni = _digits(dni)
    if str(source_id or "").strip() != FINGURU_SOURCE_ID or len(normalized_cuil) != 8:
        return normalized_cuil
    if len(normalized_dni) != 8 or normalized_dni != normalized_cuil:
        return ""
    return normalized_dni


def resolve_prefill_identity(
    *,
    source_id: object,
    cuil: object,
    dni: object,
    credixsa_output: dict[str, Any],
) -> dict[str, object]:
    normalized_cuil = _digits(cuil)
    normalized_dni = _digits(dni)
    source = str(source_id or "").strip()
    if source != FINGURU_SOURCE_ID or len(normalized_cuil) != 8:
        return {
            "status": IDENTITY_UNCHANGED,
            "effective_cuil": normalized_cuil,
            "sanitized": False,
            "reason": "not_required",
        }

    identifier = credix_identifier_for_prefill(
        source_id=source,
        cuil=normalized_cuil,
        dni=normalized_dni,
    )
    if not identifier:
        return _unresolved_identity("dni_cuil_mismatch")

    returned_cuil = _digits(credixsa_output.get("cuit"))
    if not bool(credixsa_output.get("ok")):
        return _unresolved_identity("credixsa_error")
    if str(credixsa_output.get("status") or "").strip() != "single":
        return _unresolved_identity("credixsa_not_single")
    if not _is_valid_cuil(returned_cuil):
        return _unresolved_identity("invalid_returned_cuil")
    if returned_cuil[2:10] != identifier:
        return _unresolved_identity("returned_cuil_dni_mismatch")

    return {
        "status": IDENTITY_SANITIZED,
        "effective_cuil": returned_cuil,
        "sanitized": True,
        "reason": "credixsa_single_match",
    }


def _unresolved_identity(reason: str) -> dict[str, object]:
    return {
        "status": IDENTITY_UNRESOLVED,
        "effective_cuil": "",
        "sanitized": False,
        "reason": reason,
    }


def _digits(value: object) -> str:
    return re.sub(r"\D", "", str(value or ""))


def _is_valid_cuil(value: str) -> bool:
    if len(value) != 11:
        return False
    weights = (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)
    check_digit = 11 - sum(int(digit) * weight for digit, weight in zip(value[:10], weights)) % 11
    if check_digit == 11:
        check_digit = 0
    elif check_digit == 10:
        check_digit = 9
    return check_digit == int(value[-1])
