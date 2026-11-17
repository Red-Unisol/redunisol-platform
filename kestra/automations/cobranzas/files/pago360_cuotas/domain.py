"""Contratos normalizados, no payloads supuestos de Pago360 o Vimarx.

Importes en centavos: el adaptador del proveedor debe identificar el importe
realmente cobrado. Ni el importe del cupón ni el neto de comisiones lo sustituyen.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from enum import Enum
import re


class ContractError(ValueError):
    pass


def cents(value: str | int | Decimal) -> int:
    """Convierte un decimal explícito sin redondear ni interpretar formato local."""
    if isinstance(value, (bool, float)):
        raise ContractError("Importe decimal explícito requerido")
    try:
        amount = Decimal(value)
        if not amount.is_finite() or amount <= 0 or amount * 100 != (amount * 100).to_integral_value():
            raise ContractError("Importe positivo con precisión de centavos requerido")
        return int(amount * 100)
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ContractError("Importe decimal inválido") from exc



def resolve_currency(provider_currency: str | None, configured_currency: str | None = None) -> str:
    """Moneda normalizada por BACKEND, nunca por el cuerpo del webhook/cliente.

    El usuario definió este circuito en ARS (17/11/2026). Cuando el proveedor
    omita moneda, el adaptador podrá usar la configuración explícita ARS del
    backend. No sustituye una moneda contradictoria ni valida otros datos.
    """
    if configured_currency not in (None, "", "ARS"):
        raise ContractError("Este circuito solo admite configuración ARS")
    if provider_currency == "ARS":
        return "ARS"
    if provider_currency not in (None, ""):
        raise ContractError("La moneda del proveedor no coincide con ARS")
    if configured_currency == "ARS":
        return "ARS"
    raise ContractError("Falta moneda del proveedor o configuración explícita del backend")


def identifier(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value):
        raise ContractError("Identificador inválido")
    return value


def legacy_id(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]*", value):
        raise ContractError("ID legacy positivo requerido")
    return value


def positive_cents(value: int) -> int:
    if type(value) is not int or value <= 0:
        raise ContractError("Importe en centavos positivo requerido")
    return value


class Status(str, Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    APPLIED = "APPLIED"
    RECONCILIATION = "RECONCILIATION"


class AttemptStatus(str, Enum):
    WRITING = "WRITING"
    UNCERTAIN = "UNCERTAIN"
    RECEIVED = "RECEIVED"
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"


@dataclass(frozen=True)
class Installment:
    loan_id: str
    installment_id: str  # ID real de CuotaPrestamo; no es nroCuota ni idPrestamo.
    number: int
    due_on: date
    amount_cents: int

    def __post_init__(self):
        legacy_id(self.loan_id)
        legacy_id(self.installment_id)
        if type(self.number) is not int or self.number < 0 or type(self.due_on) is not date:
            raise ContractError("Cuota o vencimiento inválido")
        positive_cents(self.amount_cents)

    @property
    def key(self) -> tuple[str, str]:
        return self.loan_id, self.installment_id


@dataclass(frozen=True)
class Operation:
    operation_id: str
    provider_reference: str
    environment: str
    total_cents: int
    installments: tuple[Installment, ...]
    kind: str = "overdue_installments"
    currency: str = "ARS"

    def __post_init__(self):
        identifier(self.operation_id)
        identifier(self.provider_reference)
        positive_cents(self.total_cents)
        if self.environment not in {"sandbox", "production"}:
            raise ContractError("Ambiente explícito requerido")
        if (not isinstance(self.installments, tuple) or not self.installments
                or any(not isinstance(i, Installment) for i in self.installments)):
            raise ContractError("Cuotas normalizadas requeridas")
        if len({i.key for i in self.installments}) != len(self.installments):
            raise ContractError("Selección vacía o cuota duplicada")
        if len({(i.loan_id, i.number) for i in self.installments}) != len(self.installments):
            raise ContractError("Número de cuota ambiguo")
        if sum(i.amount_cents for i in self.installments) != self.total_cents:
            raise ContractError("El total no coincide con las cuotas")


@dataclass(frozen=True)
class VerifiedPayment:
    """Evidencia de backend: API del proveedor y moneda normalizada por resolve_currency."""
    provider_reference: str
    external_reference: str
    environment: str
    currency: str
    state: str
    collected_cents: int | None
    paid_at: datetime | None


@dataclass(frozen=True)
class Debt:
    installment_id: str
    loan_id: str
    number: int
    due_on: date
    payable_cents: int
    paid: bool

    def __post_init__(self):
        legacy_id(self.loan_id)
        legacy_id(self.installment_id)
        if (type(self.number) is not int or self.number < 0 or type(self.due_on) is not date
                or type(self.payable_cents) is not int or self.payable_cents < 0
                or type(self.paid) is not bool):
            raise ContractError("Deuda normalizada inválida")


@dataclass(frozen=True)
class Receipt:
    """El adaptador debe demostrar la relación cobro-cuota y el saldo posterior."""
    receipt_id: str
    loan_id: str
    installment_id: str
    amount_cents: int

    def matches(self, installment: Installment) -> bool:
        return (isinstance(self.receipt_id, str) and bool(re.fullmatch(r"[1-9][0-9]*", self.receipt_id))
                and self.loan_id == installment.loan_id
                and self.installment_id == installment.installment_id
                and type(self.amount_cents) is int
                and self.amount_cents == installment.amount_cents)


@dataclass(frozen=True)
class Attempt:
    attempt_id: str
    installment: Installment
    status: AttemptStatus
    receipt: Receipt | None = None

    def __post_init__(self):
        identifier(self.attempt_id)
        if not isinstance(self.status, AttemptStatus):
            raise ContractError("Estado de intento inválido")


def validate_payment(operation: Operation, payment: VerifiedPayment) -> str | None:
    if operation.kind != "overdue_installments":
        return "OUT_OF_SCOPE"
    if (payment.provider_reference != operation.provider_reference
            or payment.external_reference != operation.operation_id
            or payment.environment != operation.environment):
        return "REFERENCE_MISMATCH"
    if operation.currency != "ARS" or payment.currency != operation.currency:
        return "CURRENCY_MISMATCH"
    if payment.state != "paid":
        return "PROVIDER_NOT_PAID"
    if (type(payment.collected_cents) is not int
            or payment.collected_cents != operation.total_cents):
        return "AMOUNT_MISMATCH"
    if (not isinstance(payment.paid_at, datetime) or payment.paid_at.tzinfo is None
            or payment.paid_at.utcoffset() is None):
        return "PAID_DATE_UNKNOWN"
    return None


def validate_debt(installment: Installment, debt: Debt, paid_on: date) -> str | None:
    if (debt.loan_id, debt.installment_id, debt.number) != (
            installment.loan_id, installment.installment_id, installment.number):
        return "INSTALLMENT_MISMATCH"
    if debt.due_on != installment.due_on or installment.due_on >= paid_on:
        return "NOT_OVERDUE_OR_CHANGED"
    if debt.paid:
        return "PAID_BY_OTHER_OPERATION"
    if type(debt.payable_cents) is not int or debt.payable_cents != installment.amount_cents:
        return "DEBT_CHANGED"
    return None
