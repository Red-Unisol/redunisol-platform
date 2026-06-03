from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Optional

from .coinag import CoinagClient
from .config import AppConfig


@dataclass(frozen=True)
class GuardResult:
    event: str
    message: str
    payload: dict[str, Any]


class RunLock:
    def __init__(self, path: Path, stale_seconds: int) -> None:
        self.path = path
        self.stale_seconds = stale_seconds
        self.fd: Optional[int] = None

    def __enter__(self) -> RunLock:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists() and self._is_stale():
            self.path.unlink()
        try:
            self.fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError as exc:
            raise RuntimeError(f"Otra ejecucion parece activa; lock={self.path}") from exc
        os.write(self.fd, f"pid={os.getpid()}\ncreated_at={utc_now().isoformat()}\n".encode())
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        if self.fd is not None:
            os.close(self.fd)
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass

    def _is_stale(self) -> bool:
        age = time.time() - self.path.stat().st_mtime
        return age > self.stale_seconds


def run_guard(config: AppConfig, client: Optional[CoinagClient] = None) -> GuardResult:
    with RunLock(config.guard.lock_path, config.guard.stale_lock_seconds):
        return _run_guard_locked(config, client or CoinagClient(config.coinag))


def _run_guard_locked(config: AppConfig, client: CoinagClient) -> GuardResult:
    last_transfer = read_last_transfer(config.guard.state_path)
    if last_transfer is not None:
        age = (utc_now() - last_transfer["created_at"]).total_seconds()
        if 0 <= age < config.guard.cooldown_seconds:
            remaining = int(config.guard.cooldown_seconds - age)
            result = GuardResult(
                event="cooldown_active",
                message=f"Cooldown activo; faltan {remaining}s.",
                payload={"remaining_seconds": remaining},
            )
            append_event(config.guard.state_path, result.event, result.payload)
            return result

    monitored_balance = client.fetch_balance(config.guard.monitored_cbu)
    if monitored_balance >= config.guard.minimum_balance:
        result = GuardResult(
            event="balance_ok",
            message=f"Saldo suficiente: {format_money(monitored_balance)}.",
            payload={
                "monitored_cbu": mask_value(config.guard.monitored_cbu, 6),
                "balance": str(monitored_balance),
                "minimum_balance": str(config.guard.minimum_balance),
            },
        )
        append_event(config.guard.state_path, result.event, result.payload)
        return result

    missing_amount = (config.guard.minimum_balance - monitored_balance).quantize(Decimal("0.01"))
    source_balance = client.fetch_balance(config.guard.source_cbu)

    transfer_payload = build_transfer_payload(config, missing_amount)
    if config.guard.dry_run:
        result = GuardResult(
            event="dry_run_topup",
            message=(
                "DRY_RUN activo; no se envio transferencia. "
                f"Faltante={format_money(missing_amount)}."
            ),
            payload={
                "balance_before": str(monitored_balance),
                "source_balance_before": str(source_balance),
                "minimum_balance": str(config.guard.minimum_balance),
                "amount": str(missing_amount),
                "transfer_payload": masked_transfer_payload(transfer_payload),
            },
        )
        append_event(config.guard.state_path, result.event, result.payload)
        return result

    response = client.transfer(transfer_payload)
    result = GuardResult(
        event="topup_submitted",
        message=(
            f"Transferencia enviada: idTrxCliente={transfer_payload['idTrxCliente']}, "
            f"importe={format_money(missing_amount)}."
        ),
        payload={
            "id_trx_cliente": transfer_payload["idTrxCliente"],
            "balance_before": str(monitored_balance),
            "source_balance_before": str(source_balance),
            "minimum_balance": str(config.guard.minimum_balance),
            "amount": str(missing_amount),
            "source_cbu": mask_value(config.guard.source_cbu, 6),
            "monitored_cbu": mask_value(config.guard.monitored_cbu, 6),
            "response": response,
        },
    )
    append_event(config.guard.state_path, result.event, result.payload)
    return result


def build_transfer_payload(config: AppConfig, amount: Decimal) -> dict[str, str]:
    return {
        "idTrxCliente": build_id_trx_cliente(
            config.guard.id_prefix,
            config.guard.id_sequence_path,
            config.guard.id_sequence_start,
        ),
        "cuitDebito": config.guard.source_cuit,
        "cbuDebito": config.guard.source_cbu,
        "titularDebito": config.guard.source_titular,
        "cuitCredito": config.guard.monitored_cuit,
        "cbuCredito": config.guard.monitored_cbu,
        "concepto": config.coinag.concepto,
        "importe": str(amount),
        "descripcion": config.guard.description,
    }


def build_id_trx_cliente(prefix: str, sequence_path: Path, sequence_start: int) -> str:
    clean_prefix = "".join(ch for ch in prefix if ch.isdigit())
    if not clean_prefix:
        raise ValueError("BALANCE_GUARD_ID_PREFIX debe contener digitos.")
    if len(clean_prefix) > 4:
        raise ValueError("BALANCE_GUARD_ID_PREFIX debe tener entre 1 y 4 digitos.")
    if sequence_start < 0:
        raise ValueError("BALANCE_GUARD_ID_SEQUENCE_START debe ser mayor o igual a 0.")

    sequence_path.parent.mkdir(parents=True, exist_ok=True)
    sequence = read_next_id_sequence(sequence_path, sequence_start)
    if sequence > 999_999_999_999_999:
        raise ValueError("BALANCE_GUARD_ID_SEQUENCE excede los 15 digitos.")
    sequence_path.write_text(f"{sequence + 1}\n", encoding="utf-8")
    return f"{clean_prefix}{sequence:015d}"


def read_next_id_sequence(path: Path, sequence_start: int) -> int:
    if not path.exists():
        return sequence_start
    raw = path.read_text(encoding="utf-8").strip()
    if not raw:
        return sequence_start
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"Secuencia invalida en {path}: {raw}") from exc


def read_last_transfer(path: Path) -> Optional[dict[str, Any]]:
    if not path.exists():
        return None
    for line in reversed(path.read_text(encoding="utf-8").splitlines()):
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("event") != "topup_submitted":
            continue
        created_at = datetime.fromisoformat(event["created_at"])
        return {"created_at": created_at, "id_trx_cliente": event.get("id_trx_cliente")}
    return None


def append_event(path: Path, event: str, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {"event": event, "created_at": utc_now().isoformat(), **payload}
    with path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(record, ensure_ascii=True, default=str))
        file.write("\n")


def masked_transfer_payload(payload: dict[str, str]) -> dict[str, str]:
    masked = dict(payload)
    for key in ("cbuDebito", "cbuCredito", "cuitDebito", "cuitCredito"):
        masked[key] = mask_value(masked[key], 6)
    return masked


def mask_value(value: str, visible_suffix: int) -> str:
    return value if len(value) <= visible_suffix else f"***{value[-visible_suffix:]}"


def format_money(value: Decimal) -> str:
    return f"$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
