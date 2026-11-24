"""Motor de imputación; runtime conecta los adaptadores y la persistencia del portal."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, TypedDict
from zoneinfo import ZoneInfo

from .domain import (Attempt, AttemptStatus, ContractError, Debt, Installment,
                     Operation, Receipt, Status, VerifiedPayment, identifier,
                     positive_cents, validate_debt, validate_payment)


PILOT_LIMIT_CENTS = 5_000_000  # ARS 50.000 para todo el piloto, compartido por los dos flows.


class DefiniteRejection(Exception):
    """Solo un rechazo sin efectos demostrado por el contrato del adaptador."""


class OperationNotFound(Exception):
    pass


class OperationTerminal(Exception):
    def __init__(self, status: Status):
        self.status = status
        super().__init__(status.value)


class ClaimConflict(Exception):
    """Lease/fencing inválido o cuota reservada por otra operación."""


class CumulativeCapExceeded(Exception):
    """El portal rechazó la reserva íntegra del cupón por falta de cupo."""


class PilotReservation(TypedDict):
    operacion_id: str
    reservado_centavos: int
    limite_centavos: int


class WriteIntent(TypedDict):
    attempt_id: str
    cupo: PilotReservation


def reserved_attempt_id(intent: object, operation: Operation) -> str:
    """Exige la respuesta del COMMIT de imp_begin antes de autorizar Vimarx."""
    if not isinstance(intent, dict) or not isinstance(intent.get("cupo"), dict):
        raise ContractError("Falta el comprobante de reserva del piloto")
    reservation = intent["cupo"]
    reserved = positive_cents(reservation.get("reservado_centavos"))
    limit = positive_cents(reservation.get("limite_centavos"))
    if (reservation.get("operacion_id") != operation.operation_id
            or reserved != operation.total_cents or limit != PILOT_LIMIT_CENTS or reserved > limit):
        raise ContractError("La reserva del piloto no corresponde a la operación")
    return identifier(intent.get("attempt_id"))


@dataclass(frozen=True)
class Claim:
    token: str
    operation: Operation
    status: Status
    attempts: tuple[Attempt, ...] = ()
    reason: str | None = None

    def __post_init__(self):
        identifier(self.token)
        if not isinstance(self.status, Status):
            raise ContractError("Estado de operación inválido")


class Repository(Protocol):
    def claim(self, operation_id: str, executor_id: str) -> Claim | None:
        """Atomiza lease + versión. Retorna None si otro ejecutor está activo.

        No reinicia terminales. Un WRITING/UNCERTAIN no se libera por caducidad.
        Unicidad por (ambiente, proveedor_ref), operación y cuota activa global.
        """
        ...

    def begin(self, token: str, installment: Installment) -> WriteIntent:
        """En un COMMIT valida fencing, reserva el total del cupón una sola vez y registra WRITING.

        El cupo es acumulativo y global. Si no alcanza, el adaptador traduce
        el rechazo del portal en CumulativeCapExceeded antes del POST a Vimarx.
        """
        ...

    def received(self, token: str, attempt_id: str, receipt: Receipt) -> None: ...
    def verified(self, token: str, attempt_id: str) -> None: ...
    def uncertain(self, token: str, attempt_id: str, receipt: Receipt | None) -> None: ...
    def rejected(self, token: str, attempt_id: str) -> None: ...

    def finish(self, token: str, status: Status, reason: str | None) -> None:
        """COMMIT estado + resultado parcial + outbox; APPLIED exige todas VERIFIED.

        Liberar lease no elimina reservas/intent ni evidencia de un cobro incierto.
        """
        ...

    def release(self, token: str) -> None:
        """Libera solo el lease del token vigente, revalidando fencing.

        No modifica estado, intentos, reservas de cuotas ni outbox. Un token
        vencido no puede liberar el lease de otro ejecutor.
        """
        ...

    def publish(self, operation_id: str) -> None:
        """Publica desde el resultado persistido; idempotente y sin volver a cobrar."""
        ...


class Provider(Protocol):
    def verify(self, operation: Operation) -> VerifiedPayment:
        """Consulta autenticada al proveedor; nunca confía en el body del evento."""
        ...


class Legacy(Protocol):
    def debt(self, installment: Installment) -> Debt: ...

    def charge(self, operation: Operation, payment: VerifiedPayment,
               installment: Installment, attempt_id: str) -> Receipt:
        """Sin retry HTTP. Endpoint/cobrador/cuenta/fecha deben verificarse antes.

        attempt_id es correlación local, no una garantía de idempotencia legacy.
        """
        ...

    def verify(self, receipt: Receipt, installment: Installment) -> bool:
        """Reconsulta cobro vinculado inequívocamente a esa cuota e importe.

        Una fecha de cobro o saldo cero sin identidad del cobro NO es evidencia.
        """
        ...


@dataclass(frozen=True)
class Result:
    status: str
    reason: str | None = None
    notified: bool = False


class Processor:
    def __init__(self, repository: Repository | None = None, provider: Provider | None = None,
                 legacy: Legacy | None = None, *, contracts_verified: bool = False,
                 apply_collected_amount: bool = False):
        if contracts_verified and (repository is None or provider is None or legacy is None):
            raise ValueError("Los contratos verificados requieren repositorio, proveedor y legacy")
        self.repo = repository
        self.provider = provider
        self.legacy = legacy
        self.contracts_verified = contracts_verified
        self.apply_collected_amount = apply_collected_amount

    def _publish(self, operation_id: str, status: Status, reason: str | None) -> Result:
        try:
            self.repo.publish(operation_id)
            return Result(status.value, reason, True)
        except Exception:
            # El resultado ya está en outbox. Recuperar publicación, no cobro.
            return Result(status.value, reason, False)

    def _finish(self, claim: Claim, status: Status, reason: str | None = None) -> Result:
        self.repo.finish(claim.token, status, reason)
        return self._publish(claim.operation.operation_id, status, reason)

    def _verify_receipt(self, claim: Claim, attempt: Attempt) -> str | None:
        if attempt.receipt is None or not attempt.receipt.matches(attempt.installment):
            return "RECEIPT_MISMATCH"
        try:
            matches = self.legacy.verify(attempt.receipt, attempt.installment)
        except Exception:
            return "VERIFICATION_UNAVAILABLE"
        if matches is not True:
            return "RECEIPT_NOT_PROVEN"
        # Si esta persistencia falla, RECEIVED permanece: nunca se vuelve a cobrar.
        self.repo.verified(claim.token, attempt.attempt_id)
        return None

    def run(self, operation_id: str, executor_id: str) -> Result:
        identifier(operation_id)
        identifier(executor_id)
        if not self.contracts_verified:
            return Result("BLOCKED", "CONTRACTS_NOT_VERIFIED")
        try:
            claim = self.repo.claim(operation_id, executor_id)
        except OperationNotFound:
            return Result("NOT_FOUND", "OPERATION_NOT_FOUND")
        except OperationTerminal as terminal:
            return Result(terminal.status.value, "ALREADY_TERMINAL", True)
        if claim is None:
            return Result("BUSY")
        if claim.operation.operation_id != operation_id:
            raise ContractError("La reserva pertenece a otra operación")
        if claim.status in {Status.APPLIED, Status.RECONCILIATION}:
            # Publicar un terminal no requiere conservar el lease de cobro.
            # Tampoco debe reescribir el resultado ni regenerar su outbox.
            self.repo.release(claim.token)
            return self._publish(operation_id, claim.status, claim.reason)
        operation = claim.operation
        selected = {i.key: i for i in operation.installments}
        attempts: dict[tuple[str, str], Attempt] = {}
        for attempt in claim.attempts:
            if (attempt.installment.key in attempts
                    or selected.get(attempt.installment.key) != attempt.installment):
                return self._finish(claim, Status.RECONCILIATION, "JOURNAL_CONFLICT")
            attempts[attempt.installment.key] = attempt
            if attempt.status in {AttemptStatus.WRITING, AttemptStatus.UNCERTAIN}:
                return self._finish(claim, Status.RECONCILIATION, "WRITE_UNCERTAIN")
            if attempt.status == AttemptStatus.REJECTED:
                return self._finish(claim, Status.RECONCILIATION, "LEGACY_REJECTED")
            if attempt.receipt is None or not attempt.receipt.matches(attempt.installment):
                return self._finish(claim, Status.RECONCILIATION, "JOURNAL_CONFLICT")
        try:
            payment = self.provider.verify(operation)
        except Exception:
            return self._finish(claim, Status.PENDING, "PROVIDER_UNAVAILABLE")
        reason = validate_payment(operation, payment)
        if reason:
            return self._finish(claim, Status.RECONCILIATION, reason)
        paid_on = payment.paid_on or payment.paid_at.astimezone(ZoneInfo("America/Argentina/Buenos_Aires")).date()
        # Recuperar respuestas conocidas solo con lecturas. No crear otro intento.
        for attempt in attempts.values():
            if attempt.status == AttemptStatus.RECEIVED:
                reason = self._verify_receipt(claim, attempt)
                if reason:
                    status = Status.PENDING if reason == "VERIFICATION_UNAVAILABLE" else Status.RECONCILIATION
                    return self._finish(claim, status, reason)
        remaining = sorted(
            (i for i in operation.installments if i.key not in attempts),
            key=lambda i: (int(i.loan_id), i.due_on, i.number),
        )
        if remaining and operation.total_cents > PILOT_LIMIT_CENTS:
            return self._finish(claim, Status.RECONCILIATION, "CUMULATIVE_CAP_EXCEEDED")
        # Validar TODAS las cuotas pendientes antes de la primera escritura.
        for installment in remaining:
            try:
                debt = self.legacy.debt(installment)
            except Exception:
                return self._finish(claim, Status.PENDING, "DEBT_UNAVAILABLE")
            reason = validate_debt(installment, debt, paid_on, exact_balance=not self.apply_collected_amount)
            if reason:
                return self._finish(claim, Status.RECONCILIATION, reason)
        for installment in remaining:
            # Revalidación inmediata. El adaptador aún debe demostrar protección
            # ante cobros de OTROS canales entre lectura y escritura (bloqueante).
            try:
                debt = self.legacy.debt(installment)
            except Exception:
                return self._finish(claim, Status.PENDING, "DEBT_UNAVAILABLE")
            reason = validate_debt(installment, debt, paid_on, exact_balance=not self.apply_collected_amount)
            if reason:
                return self._finish(claim, Status.RECONCILIATION, reason)
            try:
                intent = self.repo.begin(claim.token, installment)
                attempt_id = reserved_attempt_id(intent, operation)
            except CumulativeCapExceeded:
                return self._finish(claim, Status.RECONCILIATION, "CUMULATIVE_CAP_EXCEEDED")
            except ClaimConflict:
                return self._finish(claim, Status.RECONCILIATION, "RESERVATION_CONFLICT")
            except ContractError:
                return self._finish(claim, Status.RECONCILIATION, "CAP_RESERVATION_UNPROVEN")
            try:
                receipt = self.legacy.charge(operation, payment, installment, attempt_id)
                if not isinstance(receipt, Receipt) or not receipt.matches(installment):
                    raise ContractError("Respuesta de cobro inválida")
            except DefiniteRejection:
                self.repo.rejected(claim.token, attempt_id)
                return self._finish(claim, Status.RECONCILIATION, "LEGACY_REJECTED")
            except Exception:
                try:
                    self.repo.uncertain(claim.token, attempt_id, None)
                except Exception:
                    pass  # WRITING confirmado antes del POST continúa bloqueando.
                return self._finish(claim, Status.RECONCILIATION, "WRITE_UNCERTAIN")
            try:
                self.repo.received(claim.token, attempt_id, receipt)
            except Exception:
                try:
                    self.repo.uncertain(claim.token, attempt_id, receipt)
                except Exception:
                    pass
                return self._finish(claim, Status.RECONCILIATION, "LOCAL_CONFIRMATION_FAILED")
            reason = self._verify_receipt(claim, Attempt(attempt_id, installment, AttemptStatus.RECEIVED, receipt))
            if reason:
                status = Status.PENDING if reason == "VERIFICATION_UNAVAILABLE" else Status.RECONCILIATION
                return self._finish(claim, status, reason)
        return self._finish(claim, Status.APPLIED)
