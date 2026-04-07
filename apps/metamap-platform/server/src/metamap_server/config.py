from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

from .workflow import ClientRole


@dataclass(frozen=True)
class BootstrapClient:
    client_id: str
    client_secret: str
    role: ClientRole
    display_name: str | None = None


@dataclass(frozen=True)
class AppSettings:
    database_url: str
    bootstrap_clients: list[BootstrapClient] = field(default_factory=list)
    webhook_token: str | None = None
    bank_callback_token: str | None = None


def load_settings_from_env() -> AppSettings:
    return AppSettings(
        database_url=os.environ.get(
            "METAMAP_SERVER_DATABASE_URL",
            "sqlite+pysqlite:///./metamap_platform_server.db",
        ),
        bootstrap_clients=_parse_bootstrap_clients(
            os.environ.get("METAMAP_SERVER_BOOTSTRAP_CLIENTS_JSON", "[]")
        ),
        webhook_token=_empty_to_none(os.environ.get("METAMAP_SERVER_WEBHOOK_TOKEN")),
        bank_callback_token=_empty_to_none(
            os.environ.get("METAMAP_SERVER_BANK_CALLBACK_TOKEN")
        ),
    )


def _parse_bootstrap_clients(raw_value: str) -> list[BootstrapClient]:
    raw_value = _strip_matching_quotes(raw_value.strip())
    try:
        payload = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise ValueError(
            "METAMAP_SERVER_BOOTSTRAP_CLIENTS_JSON debe ser JSON valido."
        ) from exc
    if not isinstance(payload, list):
        raise ValueError(
            "METAMAP_SERVER_BOOTSTRAP_CLIENTS_JSON debe ser un array de clientes."
        )

    clients: list[BootstrapClient] = []
    for row in payload:
        if not isinstance(row, dict):
            raise ValueError("Cada cliente bootstrap debe ser un objeto.")
        client_id = str(row.get("client_id", "")).strip()
        client_secret = str(row.get("client_secret", "")).strip()
        role_value = str(row.get("role", "")).strip()
        if not client_id or not client_secret or not role_value:
            raise ValueError(
                "Cada cliente bootstrap debe incluir client_id, client_secret y role."
            )
        try:
            role = ClientRole(role_value)
        except ValueError as exc:
            raise ValueError(f"Rol bootstrap invalido: {role_value}") from exc
        display_name = _empty_to_none(str(row.get("display_name", "")).strip())
        clients.append(
            BootstrapClient(
                client_id=client_id,
                client_secret=client_secret,
                role=role,
                display_name=display_name,
            )
        )
    return clients


def _empty_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _strip_matching_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value
