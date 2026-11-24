"""Production ports. Journal mutations go to the portal; only Legacy.charge writes Vimarx."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
import json
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import requests

from pago360.portal import PortalClient, PortalError, normalize_operation, uuid_text
from pago360_cuotas.domain import (Attempt, AttemptStatus, ContractError, Debt, Installment,
                                  Operation, Receipt, Status, VerifiedPayment, cents, legacy_id)
from pago360_cuotas.processor import (Claim, ClaimConflict, CumulativeCapExceeded,
                                     OperationNotFound, OperationTerminal)

STATES = {"pendiente": Status.PENDING, "en_proceso": Status.PROCESSING,
          "aplicado": Status.APPLIED, "a_conciliar": Status.RECONCILIATION}


def amount_text(value: int) -> str:
    return f"{value // 100}.{value % 100:02d}"


def decode(text: str):
    value = json.loads(text, parse_float=Decimal)
    return json.loads(value, parse_float=Decimal) if isinstance(value, str) and value[:1] in "[{" else value


class Provider:
    """Fresh provider GET is performed server-side using the portal's existing key."""
    def __init__(self, client: PortalClient):
        self.client = client

    def verify(self, op: Operation) -> VerifiedPayment:
        try:
            p = self.client.verify_payment(op.operation_id)
        except PortalError as error:
            if error.status == 409:
                return VerifiedPayment(op.provider_reference, op.operation_id, op.environment,
                                       "ARS", "not_verified", None, None)
            raise
        return VerifiedPayment(str(p["proveedor_ref"]), p["external_reference"],
                               {"live": "production", "sandbox": "sandbox"}[p["ambiente"]],
                               p["moneda"], p["estado"], cents(p["importe_cobrado"]), None,
                               date.fromisoformat(p["pagado_el"]))


class Legacy:
    COLLECTOR_ID = 42  # PAGOS 360, verified by ID/name/active flag before every write.

    def __init__(self, base_url: str):
        url = urlsplit(base_url)
        if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ("", "/"):
            raise ContractError("An HTTPS legacy origin is required")
        self.base = base_url.rstrip("/")

    def _read(self, entity: str, criteria: str, fields: str, limit: int = 500) -> list:
        try:
            r = requests.post(self.base + "/api/Empresa/EvaluateList",
                              json={"tipo": entity, "cmd": criteria, "campos": fields, "max": limit},
                              headers={"Accept": "*/*"}, timeout=(5, 20), allow_redirects=False, verify=True)
            if r.status_code != 200:
                raise RuntimeError("Legacy read rejected")
            rows = decode(r.text)
            if not isinstance(rows, list) or len(rows) >= limit:
                raise RuntimeError("Invalid or truncated legacy read")
            return rows
        except (requests.RequestException, ValueError, TypeError):
            raise RuntimeError("Legacy read unavailable") from None

    def debt(self, i: Installment) -> Debt:
        rows = self._read("F.Module.Cuentas.Prestamos.CuotaPrestamo",
                          f"[ID] = {legacy_id(i.installment_id)} And [Prestamo.ID] = {legacy_id(i.loan_id)}",
                          "ID;Prestamo.ID;NroCuota;Fecha;FechaCobro;IsDeleted", 2)
        if len(rows) != 1 or len(rows[0]) != 6:
            raise ContractError("Installment not unique")
        identifier, loan, number, due, paid, deleted = rows[0]
        if deleted is not False:
            raise ContractError("Deleted or unknown installment")
        # Balance is deliberately not used as a financial precondition in this circuit.
        return Debt(str(identifier), str(loan), int(number), date.fromisoformat(str(due)[:10]),
                    i.amount_cents, paid is not None)

    def charge(self, op: Operation, payment: VerifiedPayment, i: Installment, attempt_id: str) -> Receipt:
        collector = self._read("F.Module.CobradorCuenta", f"[ID] = {self.COLLECTOR_ID}",
                               "ID;Denominacion;Activo;IsDeleted", 2)
        if collector != [[self.COLLECTOR_ID, "PAGOS 360", True, False]]:
            raise ContractError("Pago360 collector not verified")
        if not 0 < i.amount_cents <= 5_000_000:
            raise ContractError("Amount outside pilot")
        # The legacy records execution day; provider payment day remains separate in evidence.
        execution_day = datetime.now(ZoneInfo("America/Argentina/Buenos_Aires")).date().isoformat()
        payload = {"fecha": execution_day + "T00:00:00-03:00", "importe": float(amount_text(i.amount_cents)),
                   "idCuota": i.installment_id, "idCobrador": self.COLLECTOR_ID,
                   "idCuentaAmv": None, "permitirPagarFueraDeOrden": False}
        try:
            # No retries or redirect following. A lost response preserves WRITING/UNCERTAIN.
            response = requests.post(self.base + "/fapi/PagoDeuda", json=payload,
                                     headers={"Accept": "application/json"}, timeout=(5, 45),
                                     allow_redirects=False, verify=True)
            if response.status_code != 200:
                raise RuntimeError("Legacy write result requires review")
            identifier = decode(response.text)
            if type(identifier) is not int or identifier <= 0:
                raise RuntimeError("Unknown legacy receipt response")
            return Receipt(str(identifier), i.loan_id, i.installment_id, i.amount_cents)
        except (requests.RequestException, ValueError, TypeError):
            raise RuntimeError("Legacy write outcome uncertain") from None

    def read_receipt(self, receipt: Receipt, i: Installment) -> dict:
        if not receipt.matches(i):
            raise ContractError("Receipt identity mismatch")
        rows = self._read("F.Module.Cuentas.Prestamos.CuotaPrestamoCobro",
                          f"[ID] = {legacy_id(receipt.receipt_id)}",
                          "ID;Prestamo.ID;Cobrador.ID;Fecha;TotalPago;IsDeleted", 2)
        if len(rows) != 1 or len(rows[0]) != 6:
            raise ContractError("Receipt not unique")
        rid, loan, collector, accounting_day, total_paid, deleted = rows[0]
        if (str(rid) != receipt.receipt_id or str(loan) != i.loan_id or collector != self.COLLECTOR_ID
                or deleted is not False or not isinstance(total_paid, (Decimal, int))
                or cents(-total_paid) != i.amount_cents):
            raise ContractError("Receipt loan/collector/amount mismatch")
        movement = self._read("F.Module.Cuentas.Prestamos.MovimientoPrestamo",
                              f"[TransaccionPrestamo.ID] = {legacy_id(i.installment_id)} And "
                              f"[TransaccionPrestamo.Prestamo.ID] = {legacy_id(i.loan_id)} And "
                              f"[TransaccionAjuste.ID] = {legacy_id(receipt.receipt_id)}",
                              "ID;TransaccionPrestamo.ID;TransaccionAjuste.ID;Monto")
        if not movement or any(len(row) != 4 or str(row[1]) != i.installment_id or str(row[2]) != receipt.receipt_id for row in movement):
            raise ContractError("Receipt is not linked to the selected installment")
        return {"cuota_prestamo_id": i.installment_id, "importe": amount_text(i.amount_cents),
                "referencia": receipt.receipt_id, "prestamo_id": i.loan_id,
                "cobrador_id": str(self.COLLECTOR_ID), "fecha_contable": date.fromisoformat(str(accounting_day)[:10]).isoformat()}

    def verify(self, receipt: Receipt, i: Installment) -> bool:
        self.read_receipt(receipt, i)
        return True


@dataclass
class Lease:
    operation: Operation
    fencing: int
    item_ids: dict
    receipts: dict = field(default_factory=dict)
    expected_state: str | None = None


class Repository:
    def __init__(self, client: PortalClient, legacy: Legacy):
        self.client, self.legacy = client, legacy
        self.leases: dict[str, Lease] = {}
        self.results: dict[str, str] = {}

    def claim(self, operation_id: str, executor_id: str) -> Claim | None:
        try:
            payload = self.client.claim(operation_id, executor_id, lease_seconds=3600)
        except PortalError as error:
            if error.code == "ocupado":
                return None
            if error.code == "no_existe":
                raise OperationNotFound() from None
            if error.code == "terminal":
                terminal = self.client.snapshot(operation_id)
                state = STATES[terminal["trabajo"]["estado"]]
                if state not in {Status.APPLIED, Status.RECONCILIATION}:
                    raise ContractError("Invalid terminal state")
                raise OperationTerminal(state) from None
            raise
        token = uuid_text(payload["token"])
        fencing = payload["fencing"]
        if type(fencing) is not int or fencing < 1 or payload.get("resultado") != "tomado":
            raise ContractError("Invalid lease")
        snapshot = payload["snapshot"]
        op = normalize_operation(snapshot)
        if op.operation_id != operation_id:
            raise ContractError("Claim returned another operation")
        items = {i.key: i for i in op.installments}
        lease = Lease(op, fencing, {})
        attempts = []
        for row in snapshot["cuotas"]:
            key = (row["prestamo_id"], row["cuota_prestamo_id"])
            lease.item_ids[key] = uuid_text(row["pago_cuota_id"])
            if row["estado"] == "pendiente":
                continue
            state = AttemptStatus(row["estado"].upper())
            aid = uuid_text(row["attempt_id"])
            r = row.get("recibo")
            receipt = None
            if r:
                receipt = Receipt(legacy_id(r["referencia"]), key[0], legacy_id(r["cuota_prestamo_id"]), cents(r["importe"]))
                if not receipt.matches(items[key]):
                    raise ContractError("Journal receipt mismatch")
                lease.receipts[aid] = receipt
            attempts.append(Attempt(aid, items[key], state, receipt))
        self.leases[token] = lease
        return Claim(token, op, STATES[snapshot["trabajo"]["estado"]], tuple(attempts))

    def begin(self, token: str, i: Installment) -> dict:
        ctx = self.leases[token]
        try:
            return self.client.begin(ctx.operation.operation_id, ctx.item_ids[i.key], token, ctx.fencing)
        except PortalError as error:
            if error.code == "cupo_acumulado_excedido":
                raise CumulativeCapExceeded() from None
            if not error.uncertain:
                raise ClaimConflict() from None
            raise

    def received(self, token: str, attempt_id: str, receipt: Receipt) -> None:
        ctx = self.leases[token]
        proof = {"cuota_prestamo_id": receipt.installment_id, "importe": amount_text(receipt.amount_cents), "referencia": receipt.receipt_id}
        self.client.record(ctx.operation.operation_id, attempt_id, "received", token, ctx.fencing, proof=proof)
        ctx.receipts[attempt_id] = receipt

    def verified(self, token: str, attempt_id: str) -> None:
        ctx = self.leases[token]
        receipt = ctx.receipts[attempt_id]
        i = next(i for i in ctx.operation.installments if i.key == (receipt.loan_id, receipt.installment_id))
        proof = self.legacy.read_receipt(receipt, i)  # New read, not a copy of stored evidence.
        self.client.record(ctx.operation.operation_id, attempt_id, "verified", token, ctx.fencing, proof=proof)

    def uncertain(self, token: str, attempt_id: str, receipt: Receipt | None) -> None:
        ctx = self.leases[token]
        proof = ({"cuota_prestamo_id": receipt.installment_id, "importe": amount_text(receipt.amount_cents),
                  "referencia": receipt.receipt_id} if receipt else None)
        self.client.record(ctx.operation.operation_id, attempt_id, "uncertain", token, ctx.fencing,
                           proof=proof, detail="legacy_or_journal_result_uncertain")

    def rejected(self, token: str, attempt_id: str) -> None:
        ctx = self.leases[token]
        self.client.record(ctx.operation.operation_id, attempt_id, "rejected", token, ctx.fencing)

    def finish(self, token: str, status: Status, reason: str | None) -> None:
        ctx = self.leases[token]
        state = {Status.PENDING: "pendiente", Status.APPLIED: "aplicado", Status.RECONCILIATION: "a_conciliar"}[status]
        if status == Status.PENDING:
            self.client.release(ctx.operation.operation_id, token, ctx.fencing, reason or "read_unavailable")
        else:
            self.client.finish(ctx.operation.operation_id, state, token, ctx.fencing, reason)
        self.results[ctx.operation.operation_id] = state

    def release(self, token: str) -> None:
        ctx = self.leases[token]
        self.client.release(ctx.operation.operation_id, token, ctx.fencing, "release_without_write")

    def publish(self, operation_id: str) -> None:
        data = self.client.snapshot(operation_id)
        if data["trabajo"]["estado"] != self.results[operation_id]:
            raise ContractError("Portal result was not persisted")
