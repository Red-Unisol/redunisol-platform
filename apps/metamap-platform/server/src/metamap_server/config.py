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
    webhook_secret: str | None = None
    bank_callback_token: str | None = None
    git_sha: str | None = None
    metamap_client_id: str | None = None
    metamap_client_secret: str | None = None
    metamap_api_token: str | None = None
    metamap_auth_scheme: str = "Token"
    metamap_timeout_seconds: float = 10.0
    metamap_max_attempts: int = 3
    metamap_retry_backoff_seconds: float = 0.5
    metamap_oauth_token_ttl_seconds: float = 300.0
    enrichment_workers: int = 4
    enrichment_queue_size: int = 200


def load_settings_from_env() -> AppSettings:
    return AppSettings(
        database_url=os.environ.get(
            "METAMAP_SERVER_DATABASE_URL",
            "sqlite+pysqlite:///./metamap_platform_server.db",
        ),
        bootstrap_clients=_parse_bootstrap_clients(
            os.environ.get("METAMAP_SERVER_BOOTSTRAP_CLIENTS_JSON", "[]")
        ),
        webhook_secret=_empty_to_none(
            os.environ.get("METAMAP_SERVER_WEBHOOK_SECRET")
            or os.environ.get("METAMAP_SERVER_WEBHOOK_TOKEN")
        ),
        bank_callback_token=_empty_to_none(
            os.environ.get("METAMAP_SERVER_BANK_CALLBACK_TOKEN")
        ),
        git_sha=_empty_to_none(
            os.environ.get("METAMAP_SERVER_GIT_SHA")
        ),
        metamap_client_id=_empty_to_none(
            os.environ.get("METAMAP_SERVER_METAMAP_CLIENT_ID")
        ),
        metamap_client_secret=_empty_to_none(
            os.environ.get("METAMAP_SERVER_METAMAP_CLIENT_SECRET")
        ),
        metamap_api_token=_empty_to_none(
            os.environ.get("METAMAP_SERVER_METAMAP_API_TOKEN")
        ),
        metamap_auth_scheme=_empty_to_none(
            os.environ.get("METAMAP_SERVER_METAMAP_AUTH_SCHEME")
        )
        or "Token",
        metamap_timeout_seconds=_positive_float_env(
            "METAMAP_SERVER_METAMAP_TIMEOUT_SECONDS", 10.0
        ),
        metamap_max_attempts=_positive_int_env(
            "METAMAP_SERVER_METAMAP_MAX_ATTEMPTS", 3
        ),
        metamap_retry_backoff_seconds=_non_negative_float_env(
            "METAMAP_SERVER_METAMAP_RETRY_BACKOFF_SECONDS", 0.5
        ),
        metamap_oauth_token_ttl_seconds=_positive_float_env(
            "METAMAP_SERVER_METAMAP_OAUTH_TOKEN_TTL_SECONDS", 300.0
        ),
        enrichment_workers=_positive_int_env(
            "METAMAP_SERVER_ENRICHMENT_WORKERS", 4
        ),
        enrichment_queue_size=_positive_int_env(
            "METAMAP_SERVER_ENRICHMENT_QUEUE_SIZE", 200
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


def _positive_int_env(name: str, default: int) -> int:
    value = int(os.environ.get(name, str(default)))
    if value < 1:
        raise ValueError(f"{name} debe ser mayor o igual a 1.")
    return value


def _positive_float_env(name: str, default: float) -> float:
    value = float(os.environ.get(name, str(default)))
    if value <= 0:
        raise ValueError(f"{name} debe ser mayor a 0.")
    return value


def _non_negative_float_env(name: str, default: float) -> float:
    value = float(os.environ.get(name, str(default)))
    if value < 0:
        raise ValueError(f"{name} debe ser mayor o igual a 0.")
    return value
