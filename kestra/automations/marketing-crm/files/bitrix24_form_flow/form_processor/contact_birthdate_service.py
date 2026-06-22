from __future__ import annotations

from typing import Any

from .bitrix_client import BitrixClient
from .config import AppConfig, load_config
from .lead_service import update_lead_fields
from .logger import Logger, create_logger
from .normalization import normalize_birthdate


DEFAULT_MAX_LEADS = 500


def backfill_contact_birthdate_to_leads(
    *,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    logger: Logger | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    max_leads: int = DEFAULT_MAX_LEADS,
    dry_run: bool = True,
) -> dict[str, object]:
    active_logger = logger or create_logger()
    config = load_config(env)
    target_field = config.fields.lead_contact_birthdate
    if not target_field:
        return {
            "ok": True,
            "action": "skipped",
            "dry_run": dry_run,
            "checked_count": 0,
            "updated_count": 0,
            "already_synced_count": 0,
            "skipped_missing_contact_count": 0,
            "skipped_missing_birthdate_count": 0,
            "message": "Backfill omitido: falta BITRIX24_LEAD_CONTACT_BIRTHDATE_FIELD.",
        }

    client = bitrix_client or BitrixClient(config, active_logger)
    leads = list_leads_for_birthdate_backfill(
        client,
        target_field=target_field,
        date_from=date_from,
        date_to=date_to,
        max_leads=max_leads,
        logger=active_logger,
    )
    contact_birthdates: dict[int, str] = {}
    result = {
        "ok": True,
        "action": "dry_run" if dry_run else "backfilled",
        "dry_run": dry_run,
        "checked_count": len(leads),
        "updated_count": 0,
        "already_synced_count": 0,
        "skipped_missing_contact_count": 0,
        "skipped_missing_birthdate_count": 0,
        "message": "Backfill de fecha de nacimiento de contactos finalizado.",
    }

    for lead in leads:
        lead_id = int(str(lead.get("ID") or "0"))
        contact_id = _optional_int(lead.get("CONTACT_ID"))
        if not lead_id or contact_id is None:
            result["skipped_missing_contact_count"] = int(result["skipped_missing_contact_count"]) + 1
            continue

        if contact_id not in contact_birthdates:
            contact_birthdates[contact_id] = get_contact_birthdate(client, contact_id)
        contact_birthdate = contact_birthdates[contact_id]
        if not contact_birthdate:
            result["skipped_missing_birthdate_count"] = (
                int(result["skipped_missing_birthdate_count"]) + 1
            )
            continue

        current_value = normalize_birthdate(lead.get(target_field))
        if current_value == contact_birthdate:
            result["already_synced_count"] = int(result["already_synced_count"]) + 1
            continue

        result["updated_count"] = int(result["updated_count"]) + 1
        active_logger.info(f"Sincronizando fecha de contacto en lead {lead_id}.")
        if not dry_run:
            update_lead_fields(client, lead_id, {target_field: contact_birthdate})

    return result


def list_leads_for_birthdate_backfill(
    client: BitrixClient,
    *,
    target_field: str,
    date_from: str | None,
    date_to: str | None,
    max_leads: int,
    logger: Logger,
) -> list[dict[str, Any]]:
    logger.info("Listando leads para backfill de fecha de nacimiento de contacto.")
    leads: list[dict[str, Any]] = []
    start = 0
    filter_payload: dict[str, Any] = {}
    if date_from:
        filter_payload[">=DATE_CREATE"] = date_from
    if date_to:
        filter_payload["<=DATE_CREATE"] = date_to

    while len(leads) < max_leads:
        payload = {
            "filter": filter_payload,
            "order": {"ID": "ASC"},
            "select": ["ID", "CONTACT_ID", target_field],
            "start": start,
        }
        response = client.call_full("crm.lead.list", payload)
        result = response.get("result") or []
        if not isinstance(result, list):
            raise RuntimeError("crm.lead.list devolvio un payload invalido.")
        leads.extend(result)
        next_page = response.get("next")
        if next_page is None:
            break
        start = int(next_page)

    return leads[:max_leads]


def get_contact_birthdate(client: BitrixClient, contact_id: int) -> str:
    contact = client.call("crm.contact.get", {"id": contact_id})
    if not isinstance(contact, dict):
        raise RuntimeError(f"Bitrix24 devolvio un contacto invalido para {contact_id}.")
    return normalize_birthdate(contact.get("BIRTHDATE"))


def _optional_int(raw_value: object) -> int | None:
    if raw_value is None or str(raw_value).strip() == "":
        return None
    return int(str(raw_value))
