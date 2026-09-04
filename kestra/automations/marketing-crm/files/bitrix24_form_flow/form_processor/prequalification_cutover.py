from __future__ import annotations

from typing import Any

from .bitrix_client import BitrixClient
from .config import load_config
from .lead_service import resolve_commercial_owner_enum_id
from .logger import Logger, create_logger


def centralize_active_prequalification_ownership(
    *,
    dry_run: bool,
    date_from: str | None = None,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    logger: Logger | None = None,
) -> dict[str, object]:
    active_logger = logger or create_logger()
    config = load_config(env)
    client = bitrix_client or BitrixClient(config, active_logger)
    kestra_owner_id = resolve_commercial_owner_enum_id(client, config, "kestra")

    scanned_count = 0
    already_kestra_count = 0
    changed_count = 0
    candidate_ids: list[int] = []

    for status_id in (config.lead_statuses.new, config.lead_statuses.preclassification):
        for lead in _list_leads(
            client,
            status_id=status_id,
            date_from=date_from,
            owner_field=config.fields.lead_commercial_owner,
        ):
            lead_id = _required_int(lead.get("ID"), "ID")
            scanned_count += 1
            if str(lead.get(config.fields.lead_commercial_owner) or "") == kestra_owner_id:
                already_kestra_count += 1
                continue

            candidate_ids.append(lead_id)
            if dry_run:
                continue

            client.call(
                "crm.lead.update",
                {
                    "id": lead_id,
                    "fields": {config.fields.lead_commercial_owner: kestra_owner_id},
                },
            )
            changed_count += 1

    return {
        "ok": True,
        "action": "dry_run" if dry_run else "ownership_centralized",
        "dry_run": dry_run,
        "scanned_count": scanned_count,
        "already_kestra_count": already_kestra_count,
        "candidate_count": len(candidate_ids),
        "changed_count": changed_count,
        "candidate_ids": candidate_ids,
        "message": (
            f"Se encontraron {len(candidate_ids)} leads activos para transferir a Kestra."
            if dry_run
            else f"Se transfirieron {changed_count} leads activos a Kestra."
        ),
    }


def _list_leads(
    client: BitrixClient,
    *,
    status_id: str,
    date_from: str | None,
    owner_field: str,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        lead_filter: dict[str, object] = {"STATUS_ID": status_id}
        if date_from and date_from.strip():
            lead_filter[">=DATE_CREATE"] = date_from.strip()

        response = client.call_full(
            "crm.lead.list",
            {
                "filter": lead_filter,
                "order": {"ID": "ASC"},
                "select": ["ID", "STATUS_ID", "DATE_CREATE", owner_field],
                "start": start,
            },
        )
        result = response.get("result") or []
        if not isinstance(result, list):
            raise RuntimeError("crm.lead.list devolvio un payload invalido durante el cutover.")
        rows.extend(item for item in result if isinstance(item, dict))

        next_page = response.get("next")
        if next_page is None:
            return rows
        start = int(next_page)


def _required_int(value: object, field_name: str) -> int:
    try:
        return int(str(value))
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f'El campo "{field_name}" no contiene un entero valido.') from exc
