from __future__ import annotations

import os
from typing import Any

from .bitrix_client import BitrixClient
from .config import load_config
from .deal_service import ensure_won_lead_deal, find_deal_by_lead
from .lead_service import get_lead
from .logger import create_logger, Logger


EXPECTED_EVENT = "ONCRMLEADUPDATE"


def process_lead_update_event(
    payload: dict[str, Any],
    *,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    expected_application_token: str | None = None,
    logger: Logger | None = None,
) -> dict[str, object]:
    active_logger = logger or create_logger()
    source = dict(os.environ if env is None else env)

    try:
        _validate_event(payload, source, expected_application_token)
        lead_id = _extract_lead_id(payload)
        active_logger.info(f"Webhook lead update recibido para lead {lead_id}.")

        config = load_config(source)
        client = bitrix_client or BitrixClient(config, active_logger)
        lead = get_lead(client, lead_id, active_logger)
        lead_status = _optional_str(lead.get("STATUS_ID"))
        contact_id = _optional_int(lead.get("CONTACT_ID"))

        if lead_status != config.lead_statuses.qualified:
            return _event_result(
                ok=True,
                action="skipped",
                reason="lead_not_won",
                lead_id=lead_id,
                lead_status=lead_status,
                message="El lead no esta en estado ganado; no se crea negociacion.",
            )

        existing_deal = find_deal_by_lead(client, lead_id=lead_id, logger=active_logger)
        if existing_deal is not None:
            deal_id = _optional_int(existing_deal.get("id") or existing_deal.get("ID"))
            return _event_result(
                ok=True,
                action="deal_exists",
                reason="deal_already_exists",
                lead_id=lead_id,
                lead_status=lead_status,
                deal_id=deal_id,
                message="El lead ganado ya tiene una negociacion vinculada.",
            )

        deal_id = ensure_won_lead_deal(
            client,
            config,
            lead,
            lead_id=lead_id,
            contact_id=contact_id,
            logger=active_logger,
        )
        return _event_result(
            ok=True,
            action="deal_created",
            reason="lead_won",
            lead_id=lead_id,
            lead_status=lead_status,
            deal_id=deal_id,
            message="Negociacion creada para lead ganado.",
        )
    except Exception as exc:
        active_logger.error(str(exc))
        return _event_result(
            ok=False,
            action="error",
            reason="error",
            message=str(exc),
        )


def _validate_event(
    payload: dict[str, Any],
    env: dict[str, str],
    expected_application_token: str | None,
) -> None:
    event_name = str(payload.get("event") or payload.get("EVENT") or "").strip().upper()
    if event_name and event_name != EXPECTED_EVENT:
        raise ValueError(f"Evento Bitrix inesperado: {event_name}.")

    expected_token = (
        expected_application_token
        if expected_application_token is not None
        else env.get("BITRIX24_LEAD_WON_DEAL_APPLICATION_TOKEN", "")
    )
    expected_token = expected_token.strip()
    if not expected_token:
        raise ValueError("Falta BITRIX24_LEAD_WON_DEAL_APPLICATION_TOKEN para validar el webhook.")

    received_token = _extract_application_token(payload)
    if received_token != expected_token:
        raise ValueError("Token de aplicacion Bitrix invalido.")


def _extract_application_token(payload: dict[str, Any]) -> str:
    auth = payload.get("auth") or payload.get("AUTH")
    if isinstance(auth, dict):
        token = auth.get("application_token") or auth.get("APPLICATION_TOKEN")
        if token:
            return str(token).strip()

    for key in (
        "auth[application_token]",
        "AUTH[APPLICATION_TOKEN]",
        "application_token",
        "APPLICATION_TOKEN",
    ):
        token = payload.get(key)
        if token:
            return str(token).strip()

    return ""


def _extract_lead_id(payload: dict[str, Any]) -> int:
    candidates = [
        _nested_get(payload, ("data", "FIELDS", "ID")),
        _nested_get(payload, ("data", "fields", "ID")),
        _nested_get(payload, ("DATA", "FIELDS", "ID")),
        _nested_get(payload, ("data", "ID")),
        payload.get("data[FIELDS][ID]"),
        payload.get("data[fields][ID]"),
        payload.get("DATA[FIELDS][ID]"),
        payload.get("FIELDS[ID]"),
        payload.get("ID"),
    ]
    for candidate in candidates:
        lead_id = _optional_int(candidate)
        if lead_id is not None:
            return lead_id
    raise ValueError("El evento Bitrix no contiene data.FIELDS.ID.")


def _nested_get(payload: dict[str, Any], path: tuple[str, ...]) -> Any:
    current: Any = payload
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _optional_int(raw_value: Any) -> int | None:
    if raw_value is None or str(raw_value).strip() == "":
        return None
    return int(str(raw_value))


def _optional_str(raw_value: Any) -> str | None:
    if raw_value is None:
        return None
    value = str(raw_value).strip()
    return value or None


def _event_result(
    *,
    ok: bool,
    action: str,
    reason: str,
    message: str,
    lead_id: int | None = None,
    lead_status: str | None = None,
    deal_id: int | None = None,
) -> dict[str, object]:
    return {
        "ok": ok,
        "action": action,
        "reason": reason,
        "message": message,
        "lead_id": lead_id,
        "lead_status": lead_status,
        "deal_id": deal_id,
    }
