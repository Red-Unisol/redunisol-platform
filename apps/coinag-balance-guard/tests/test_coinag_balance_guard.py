from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from coinag_balance_guard.coinag import extract_balance_amount, sanitize_headers, sanitize_url
from coinag_balance_guard.config import AppConfig, BalanceGuardConfig, CoinagConfig
from coinag_balance_guard.guard import _run_guard_locked, build_id_trx_cliente


class FakeClient:
    def __init__(self, balances: dict[str, Decimal]) -> None:
        self.balances = balances
        self.transfers: list[dict[str, str]] = []

    def fetch_balance(self, cbu: str) -> Decimal:
        return self.balances[cbu]

    def transfer(self, payload: dict[str, str]) -> dict[str, str]:
        self.transfers.append(payload)
        return {"ok": "true", "id": payload["idTrxCliente"]}


def make_config(tmp_path: Path, *, dry_run: bool = False) -> AppConfig:
    return AppConfig(
        coinag=CoinagConfig(
            balance_api_base="https://balance",
            transfer_api_base="https://transfer",
            token_url="https://token",
            username="user",
            password="pass",
            client_id="",
            client_secret="",
            scope="",
            auth_scheme="Bearer",
            transfer_endpoint="/Transferencia",
            concepto="VAR",
            allow_invalid_certs=False,
            request_timeout_seconds=15,
            http_log_path=tmp_path / "http.jsonl",
        ),
        guard=BalanceGuardConfig(
            monitored_cbu="111111",
            monitored_cuit="20111111112",
            source_cbu="222222",
            source_cuit="20222222223",
            source_titular="Fondeadora",
            minimum_balance=Decimal("30000000"),
            description="Fondeo automatico",
            id_prefix="9036",
            id_sequence_start=10000000,
            id_sequence_path=tmp_path / "id_sequence.txt",
            dry_run=dry_run,
            cooldown_seconds=900,
            stale_lock_seconds=900,
            state_path=tmp_path / "events.jsonl",
            lock_path=tmp_path / "guard.lock",
        ),
    )


class CoinagBalanceGuardTests(unittest.TestCase):
    def test_extract_balance_amount_accepts_nested_saldo(self) -> None:
        body = {"response": {"cuenta": {"Saldo": "30.123.456,78"}}}

        self.assertEqual(extract_balance_amount(body), Decimal("30123456.78"))

    def test_http_log_sanitizers_mask_secrets_and_account_ids(self) -> None:
        url = sanitize_url("https://bank.test/SaldoActual", {"cbu": "1234567890123456789012"})
        headers = sanitize_headers({"Authorization": "Bearer abcdefghijk"})

        self.assertEqual(url, "https://bank.test/SaldoActual?cbu=%2A%2A%2A789012")
        self.assertEqual(headers["Authorization"], "Bearer ***hijk")

    def test_guard_does_nothing_when_balance_is_enough(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config = make_config(Path(tmp))
            client = FakeClient({"111111": Decimal("30000000"), "222222": Decimal("1")})

            result = _run_guard_locked(config, client)  # type: ignore[arg-type]

        self.assertEqual(result.event, "balance_ok")
        self.assertEqual(client.transfers, [])

    def test_guard_transfers_missing_amount(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config = make_config(Path(tmp))
            client = FakeClient({"111111": Decimal("25000000"), "222222": Decimal("10000000")})

            result = _run_guard_locked(config, client)  # type: ignore[arg-type]

        self.assertEqual(result.event, "topup_submitted")
        self.assertEqual(client.transfers[0]["importe"], "5000000.00")
        self.assertEqual(client.transfers[0]["cbuDebito"], "222222")
        self.assertEqual(client.transfers[0]["cbuCredito"], "111111")
        self.assertEqual(client.transfers[0]["idTrxCliente"], "9036000000010000000")

    def test_guard_transfers_even_when_source_balance_is_negative(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config = make_config(Path(tmp))
            client = FakeClient({"111111": Decimal("25000000"), "222222": Decimal("-1000")})

            result = _run_guard_locked(config, client)  # type: ignore[arg-type]

        self.assertEqual(result.event, "topup_submitted")
        self.assertEqual(result.payload["source_balance_before"], "-1000")
        self.assertEqual(client.transfers[0]["importe"], "5000000.00")

    def test_guard_dry_run_does_not_transfer(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config = make_config(Path(tmp), dry_run=True)
            client = FakeClient({"111111": Decimal("25000000"), "222222": Decimal("10000000")})

            result = _run_guard_locked(config, client)  # type: ignore[arg-type]

        self.assertEqual(result.event, "dry_run_topup")
        self.assertEqual(client.transfers, [])

    def test_guard_respects_cooldown_after_submitted_transfer(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config = make_config(Path(tmp))
            config.guard.state_path.write_text(
                (
                    '{"event":"topup_submitted","created_at":"'
                    f'{datetime.now(timezone.utc).isoformat()}'
                    '","id_trx_cliente":"FONDEO-1"}\n'
                ),
                encoding="utf-8",
            )
            client = FakeClient({"111111": Decimal("1"), "222222": Decimal("10000000")})

            result = _run_guard_locked(config, client)  # type: ignore[arg-type]

        self.assertEqual(result.event, "cooldown_active")
        self.assertEqual(client.transfers, [])

    def test_id_trx_cliente_uses_persistent_incremental_sequence(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "id_sequence.txt"

            first = build_id_trx_cliente("9036", path, 10000000)
            second = build_id_trx_cliente("9036", path, 10000000)
            third = build_id_trx_cliente("9036", path, 10000000)

        self.assertEqual(first, "9036000000010000000")
        self.assertEqual(second, "9036000000010000001")
        self.assertEqual(third, "9036000000010000002")


if __name__ == "__main__":
    unittest.main()
