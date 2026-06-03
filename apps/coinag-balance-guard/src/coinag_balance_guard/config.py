from __future__ import annotations

import os
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Optional


@dataclass(frozen=True)
class CoinagConfig:
    balance_api_base: str
    transfer_api_base: str
    token_url: str
    username: str
    password: str
    client_id: str
    client_secret: str
    scope: str
    auth_scheme: str
    transfer_endpoint: str
    concepto: str
    allow_invalid_certs: bool
    request_timeout_seconds: int
    http_log_path: Optional[Path]


@dataclass(frozen=True)
class BalanceGuardConfig:
    monitored_cbu: str
    monitored_cuit: str
    source_cbu: str
    source_cuit: str
    source_titular: str
    minimum_balance: Decimal
    description: str
    id_prefix: str
    id_sequence_start: int
    id_sequence_path: Path
    dry_run: bool
    cooldown_seconds: int
    stale_lock_seconds: int
    state_path: Path
    lock_path: Path


@dataclass(frozen=True)
class AppConfig:
    coinag: CoinagConfig
    guard: BalanceGuardConfig


def load_config(env_file: Optional[Path] = None) -> AppConfig:
    values = dict(os.environ)
    if env_file is not None:
        values.update(read_env_file(env_file))

    coinag = CoinagConfig(
        balance_api_base=required(values, "COINAG_BALANCE_API_BASE").rstrip("/"),
        transfer_api_base=required(values, "COINAG_TRANSFER_API_BASE").rstrip("/"),
        token_url=required(values, "COINAG_TOKEN_URL"),
        username=required(values, "COINAG_USERNAME"),
        password=required(values, "COINAG_PASSWORD"),
        client_id=optional(values, "COINAG_CLIENT_ID"),
        client_secret=optional(values, "COINAG_CLIENT_SECRET"),
        scope=optional(values, "COINAG_SCOPE"),
        auth_scheme=optional(values, "COINAG_AUTH_SCHEME", "Bearer"),
        transfer_endpoint=normalize_path(optional(values, "COINAG_TRANSFER_ENDPOINT", "/Transferencia")),
        concepto=optional(values, "COINAG_CONCEPTO", "VAR"),
        allow_invalid_certs=parse_bool(optional(values, "COINAG_ALLOW_INVALID_CERTS", "false")),
        request_timeout_seconds=parse_int(optional(values, "COINAG_REQUEST_TIMEOUT_SECONDS", "15"), "COINAG_REQUEST_TIMEOUT_SECONDS"),
        http_log_path=optional_path(values, "COINAG_HTTP_LOG_PATH"),
    )
    guard = BalanceGuardConfig(
        monitored_cbu=required_digits(values, "BALANCE_GUARD_MONITORED_CBU"),
        monitored_cuit=required_digits(values, "BALANCE_GUARD_MONITORED_CUIT"),
        source_cbu=required_digits(values, "BALANCE_GUARD_SOURCE_CBU"),
        source_cuit=required_digits(values, "BALANCE_GUARD_SOURCE_CUIT"),
        source_titular=required(values, "BALANCE_GUARD_SOURCE_TITULAR"),
        minimum_balance=parse_decimal(
            optional(values, "BALANCE_GUARD_MINIMUM_BALANCE", "30000000"),
            "BALANCE_GUARD_MINIMUM_BALANCE",
        ),
        description=optional(values, "BALANCE_GUARD_DESCRIPTION", "Fondeo automatico por saldo minimo"),
        id_prefix=optional(values, "BALANCE_GUARD_ID_PREFIX", "9036"),
        id_sequence_start=parse_int(
            optional(values, "BALANCE_GUARD_ID_SEQUENCE_START", "10000000"),
            "BALANCE_GUARD_ID_SEQUENCE_START",
        ),
        id_sequence_path=Path(
            optional(
                values,
                "BALANCE_GUARD_ID_SEQUENCE_PATH",
                "/var/lib/coinag-balance-guard/id_sequence.txt",
            )
        ),
        dry_run=parse_bool(optional(values, "BALANCE_GUARD_DRY_RUN", "true")),
        cooldown_seconds=parse_int(optional(values, "BALANCE_GUARD_COOLDOWN_SECONDS", "900"), "BALANCE_GUARD_COOLDOWN_SECONDS"),
        stale_lock_seconds=parse_int(optional(values, "BALANCE_GUARD_STALE_LOCK_SECONDS", "900"), "BALANCE_GUARD_STALE_LOCK_SECONDS"),
        state_path=Path(optional(values, "BALANCE_GUARD_STATE_PATH", "/var/lib/coinag-balance-guard/balance_guard_events.jsonl")),
        lock_path=Path(optional(values, "BALANCE_GUARD_LOCK_PATH", "/var/lib/coinag-balance-guard/balance_guard.lock")),
    )
    return AppConfig(coinag=coinag, guard=guard)


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for index, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"Linea invalida en {path}:{index}. Se esperaba KEY=VALUE.")
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if not key:
            raise ValueError(f"Linea invalida en {path}:{index}. La clave no puede estar vacia.")
        values[key] = value
    return values


def required(values: dict[str, str], name: str) -> str:
    value = optional(values, name)
    if value == "":
        raise ValueError(f"Falta la variable obligatoria {name}.")
    return value


def optional(values: dict[str, str], name: str, default: str = "") -> str:
    value = values.get(name, default)
    return value.strip() if isinstance(value, str) else str(value).strip()


def optional_path(values: dict[str, str], name: str) -> Optional[Path]:
    value = optional(values, name)
    return Path(value) if value else None


def required_digits(values: dict[str, str], name: str) -> str:
    digits = normalize_digits(required(values, name))
    if not digits:
        raise ValueError(f"{name} debe contener digitos.")
    return digits


def normalize_digits(value: str) -> str:
    return "".join(ch for ch in value if ch.isdigit())


def normalize_path(value: str) -> str:
    return value if value.startswith("/") else f"/{value}"


def parse_bool(value: str) -> bool:
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "y", "si"}:
        return True
    if normalized in {"0", "false", "no", "n"}:
        return False
    raise ValueError(f"Valor booleano invalido: {value}")


def parse_int(value: str, name: str) -> int:
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"Valor entero invalido para {name}: {value}") from exc


def parse_decimal(value: str, name: str) -> Decimal:
    raw = value.strip()
    if "," in raw and "." in raw:
        normalized = raw.replace(".", "").replace(",", ".")
    elif "," in raw:
        normalized = raw.replace(",", ".")
    elif raw.count(".") > 1:
        parts = raw.split(".")
        normalized = "".join(parts[:-1]) + "." + parts[-1]
    else:
        normalized = raw
    try:
        return Decimal(normalized)
    except InvalidOperation as exc:
        raise ValueError(f"Valor decimal invalido para {name}: {value}") from exc
