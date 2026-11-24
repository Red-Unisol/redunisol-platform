"""Read-only legacy check. This module cannot confirm a provider payment or charge it."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
import os
import re
from urllib.parse import urlsplit

import requests


class DiagnosticError(ValueError):
    pass


FIELDS = "ID;NroCuota;Descripcion;MontoTotal;SaldoCuota;SaldoCuotaConPunitorios;Fecha;FechaCobro"
UNVERIFIED = ["PROVIDER_PAYMENT", "PORTAL_OPERATION_UUID", "KESTRA_DELIVERY", "LEGACY_RECEIPT"]


def positive_id(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,14}", value):
        raise DiagnosticError("Invalid numeric identifier")
    return value


def cents(value: object, *, positive: bool = False) -> int:
    if isinstance(value, bool) or not isinstance(value, (str, int, Decimal)):
        raise DiagnosticError("Exact decimal amount required")
    try:
        amount = Decimal(value)
        if not amount.is_finite() or amount < 0 or (positive and amount == 0):
            raise DiagnosticError("Invalid amount")
        scaled = amount * 100
        if scaled != scaled.to_integral_value():
            raise DiagnosticError("Amount has fractions of a cent")
        return int(scaled)
    except (InvalidOperation, ValueError, OverflowError):
        raise DiagnosticError("Invalid exact amount") from None


def inspect_legacy(provider_id: str, loan_number: str, installment_number: str,
                   amount: str, base_url: str, *, token: str = "") -> dict:
    """The supplied amount is operator-reported, NOT verified with Pago360."""
    positive_id(provider_id)
    positive_id(loan_number)
    positive_id(installment_number)
    reported = cents(amount, positive=True)
    url = urlsplit(base_url)
    if (url.scheme != "https" or not url.hostname or url.username is not None
            or url.password is not None or url.query or url.fragment or url.path not in ("", "/")):
        raise DiagnosticError("An HTTPS Vimarx origin without credentials is required")

    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    description = f"{loan_number}/{installment_number}"
    try:
        # Fixed read-only endpoint. No Processor, claim, begin, callback or charge call.
        response = requests.post(base_url.rstrip("/") + "/api/Empresa/EvaluateList",
                                 json={
                                     "tipo": "F.Module.Cuentas.Prestamos.CuotaPrestamo",
                                     "cmd": (f"[Prestamo.NroCuenta] = {loan_number} And "
                                             f"[NroCuota] = {installment_number} And "
                                             f"[Descripcion] = '{description}'"),
                                     "campos": FIELDS, "max": 2,
                                 }, headers=headers, timeout=(5, 20),
                                 allow_redirects=False, verify=True)
    except requests.RequestException:
        raise DiagnosticError("Vimarx read unavailable") from None
    if response.status_code != 200:
        raise DiagnosticError(f"Vimarx read returned HTTP {response.status_code}")
    try:
        rows = json.loads(response.text, parse_float=Decimal)
        if isinstance(rows, str):
            rows = json.loads(rows, parse_float=Decimal)
    except (ValueError, TypeError):
        raise DiagnosticError("Invalid Vimarx response") from None
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], list) or len(rows[0]) != 8:
        raise DiagnosticError("A unique scheduled installment is required")
    identifier, number, label, original, base, total, due_on, collected_on = rows[0]
    positive_id(str(identifier))
    if type(number) is not int or number != int(installment_number) or label != description:
        raise DiagnosticError("Installment identity mismatch")
    original_cents, base_cents, total_cents = (cents(x) for x in (original, base, total))
    if not isinstance(due_on, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:T.*)?", due_on):
        raise DiagnosticError("Invalid installment date")
    try:
        datetime.fromisoformat(due_on)
    except ValueError:
        raise DiagnosticError("Invalid installment date") from None
    if collected_on is not None and not isinstance(collected_on, str):
        raise DiagnosticError("Invalid collection date")
    findings = []
    if reported != total_cents:
        findings.append("AMOUNT_DIFFERS_FROM_CURRENT_TOTAL")
    if base_cents == 0 or collected_on:
        findings.append("PAYMENT_STATUS_REQUIRES_REVIEW")
    return {
        "mode": "READ_ONLY", "result": "DIAGNOSTIC_ONLY", "write_enabled": False,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "provider_id": provider_id, "provider_payment_verified": False,
        "reported_amount_cents": reported, "reported_amount_source": "OPERATOR",
        "legacy": {
            "loan_number": loan_number, "installment_number": int(installment_number),
            "installment_id": str(identifier), "original_amount_cents": original_cents,
            "base_balance_cents": base_cents, "total_balance_cents": total_cents,
            "due_on": due_on, "collected_on": collected_on,
        },
        "findings": findings, "unverified": UNVERIFIED.copy(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider-id", required=True)
    parser.add_argument("--loan-number", required=True)
    parser.add_argument("--installment-number", required=True)
    parser.add_argument("--amount", required=True, help="Operator-reported amount, e.g. 2599.90")
    args = parser.parse_args()
    try:
        report = inspect_legacy(args.provider_id, args.loan_number, args.installment_number,
                                args.amount, os.environ.get("VIMARX_EVAL_BASE_URL", ""),
                                token=os.environ.get("VIMARX_BEARER_TOKEN", ""))
    except DiagnosticError as error:
        print(json.dumps({"mode": "READ_ONLY", "result": "UNAVAILABLE",
                          "write_enabled": False, "reason": str(error)}))
        return 1
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
