from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from threading import Lock
from typing import Optional


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_case_payload(*, resource_url: str | None) -> dict:
    if not resource_url:
        return {}
    return {"resource_url": resource_url}


def extract_resource_url(payload: dict) -> str | None:
    if not isinstance(payload, dict):
        return None
    raw_value = payload.get("resource_url") or payload.get("resource")
    if raw_value is None:
        return None
    resource_url = str(raw_value).strip()
    return resource_url or None


class WorkflowError(Exception):
    """Raised when a workflow transition is invalid."""


class ClientRole(str, Enum):
    VALIDADOR = "validador"
    TRANSFERENCIAS_CELESOL = "transferencias_celesol"


class WorkflowStage(str, Enum):
    RECEIVED_FROM_METAMAP = "received_from_metamap"
    PENDING_VALIDADOR_REVIEW = "pending_validador_review"
    APPROVED_BY_VALIDADOR = "approved_by_validador"
    REJECTED_BY_VALIDADOR = "rejected_by_validador"
    TRANSFER_SUBMITTED = "transfer_submitted"
    BANK_CONFIRMED = "bank_confirmed"
    BANK_REVERSED = "bank_reversed"
    MANUAL_INTERVENTION_REQUIRED = "manual_intervention_required"


class DeliveryStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"


class CaseAction(str, Enum):
    APPROVED = "approved"
    REJECTED = "rejected"
    TRANSFER_SUBMITTED = "transfer_submitted"


@dataclass
class DeliveryRecord:
    role: ClientRole
    status: DeliveryStatus = DeliveryStatus.PENDING
    updated_at: str = field(default_factory=_utc_now)


@dataclass
class AuditEntry:
    action: str
    actor: str
    actor_role: Optional[ClientRole]
    at: str = field(default_factory=_utc_now)
    details: dict = field(default_factory=dict)


@dataclass
class CaseRecord:
    case_id: str
    verification_id: str
    latest_event_name: str
    current_stage: WorkflowStage
    source_payload: dict
    user_id: Optional[str] = None
    external_transfer_id: Optional[str] = None
    created_at: str = field(default_factory=_utc_now)
    updated_at: str = field(default_factory=_utc_now)
    deliveries: list[DeliveryRecord] = field(default_factory=list)
    audit_log: list[AuditEntry] = field(default_factory=list)

    def delivery_for_role(self, role: ClientRole) -> Optional[DeliveryRecord]:
        for delivery in self.deliveries:
            if delivery.role == role:
                return delivery
        return None

    def ensure_pending_delivery(self, role: ClientRole) -> None:
        delivery = self.delivery_for_role(role)
        if delivery:
            delivery.status = DeliveryStatus.PENDING
            delivery.updated_at = _utc_now()
            return
        self.deliveries.append(DeliveryRecord(role=role))

    def complete_delivery(self, role: ClientRole) -> None:
        delivery = self.delivery_for_role(role)
        if not delivery:
            raise WorkflowError(f"No existe entrega pendiente para el rol {role.value}.")
        delivery.status = DeliveryStatus.COMPLETED
        delivery.updated_at = _utc_now()

    def add_audit(self, action: str, actor: str, actor_role: Optional[ClientRole], **details: object) -> None:
        self.audit_log.append(
            AuditEntry(
                action=action,
                actor=actor,
                actor_role=actor_role,
                details={k: v for k, v in details.items() if v is not None},
            )
        )
        self.updated_at = _utc_now()

    def to_dict(self) -> dict:
        data = asdict(self)
        resource_url = extract_resource_url(self.source_payload)
        data["resource_url"] = resource_url
        data["queue_payload"] = {
            "verification_id": self.verification_id,
            "resource_url": resource_url,
        }
        data["pending_roles"] = [
            delivery.role.value
            for delivery in self.deliveries
            if delivery.status == DeliveryStatus.PENDING
        ]
        return data


class InMemoryWorkflowStore:
    """Server-first workflow scaffold backed by in-memory state."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._cases: dict[str, CaseRecord] = {}
        self._callback_dedupe: set[str] = set()
        self._metamap_webhook_receipts: list[dict] = []

    def list_cases_for_role(self, role: ClientRole) -> list[CaseRecord]:
        with self._lock:
            cases = [
                case
                for case in self._cases.values()
                if any(
                    delivery.role == role and delivery.status == DeliveryStatus.PENDING
                    for delivery in case.deliveries
                )
            ]
            return sorted(cases, key=lambda case: case.updated_at)

    def get_case(self, case_id: str) -> CaseRecord:
        with self._lock:
            case = self._cases.get(case_id)
            if not case:
                raise WorkflowError(f"Case {case_id} inexistente.")
            return case

    def ingest_metamap_event(
        self,
        *,
        event_name: str,
        verification_id: str,
        resource_url: str | None,
        payload: dict,
        user_id: Optional[str],
    ) -> CaseRecord:
        if not verification_id:
            raise WorkflowError("verification_id es obligatorio.")
        if not event_name:
            raise WorkflowError("event_name es obligatorio.")
        if event_name.lower() == "verification_completed" and not resource_url:
            raise WorkflowError("resource_url es obligatorio para verification_completed.")
        with self._lock:
            case = self._cases.get(verification_id)
            if not case:
                case = CaseRecord(
                    case_id=verification_id,
                    verification_id=verification_id,
                    latest_event_name=event_name,
                    current_stage=WorkflowStage.RECEIVED_FROM_METAMAP,
                    source_payload=build_case_payload(resource_url=resource_url),
                    user_id=user_id,
                )
                self._cases[verification_id] = case
            case.latest_event_name = event_name
            case.source_payload = build_case_payload(resource_url=resource_url)
            case.user_id = user_id or case.user_id
            case.updated_at = _utc_now()
            if event_name.lower() == "verification_completed":
                if case.current_stage == WorkflowStage.RECEIVED_FROM_METAMAP:
                    case.current_stage = WorkflowStage.PENDING_VALIDADOR_REVIEW
                    case.ensure_pending_delivery(ClientRole.VALIDADOR)
                elif case.current_stage == WorkflowStage.PENDING_VALIDADOR_REVIEW:
                    case.ensure_pending_delivery(ClientRole.VALIDADOR)
            case.add_audit(
                "metamap_event_received",
                actor="metamap",
                actor_role=None,
                event_name=event_name,
                resource_url=resource_url,
            )
            return case

    def record_metamap_webhook_receipt(
        self,
        *,
        raw_body: str,
        headers: dict[str, str],
        payload: dict | None,
        event_name: str | None,
        verification_id: str | None,
        resource_url: str | None,
        signature_valid: bool,
        processing_status: str,
        processing_error: str | None = None,
    ) -> None:
        with self._lock:
            self._metamap_webhook_receipts.append(
                {
                    "received_at": _utc_now(),
                    "raw_body": raw_body,
                    "headers": headers,
                    "payload": payload,
                    "event_name": event_name,
                    "verification_id": verification_id,
                    "resource_url": resource_url,
                    "signature_valid": signature_valid,
                    "processing_status": processing_status,
                    "processing_error": processing_error,
                }
            )

    def apply_case_action(
        self,
        *,
        case_id: str,
        role: ClientRole,
        action: CaseAction,
        actor: str,
        notes: Optional[str] = None,
        external_transfer_id: Optional[str] = None,
    ) -> CaseRecord:
        with self._lock:
            case = self._cases.get(case_id)
            if not case:
                raise WorkflowError(f"Case {case_id} inexistente.")

            if role == ClientRole.VALIDADOR:
                if case.current_stage != WorkflowStage.PENDING_VALIDADOR_REVIEW:
                    raise WorkflowError("El case no esta esperando revision de validador.")
                if action == CaseAction.APPROVED:
                    case.complete_delivery(ClientRole.VALIDADOR)
                    case.current_stage = WorkflowStage.APPROVED_BY_VALIDADOR
                    case.ensure_pending_delivery(ClientRole.TRANSFERENCIAS_CELESOL)
                elif action == CaseAction.REJECTED:
                    case.complete_delivery(ClientRole.VALIDADOR)
                    case.current_stage = WorkflowStage.REJECTED_BY_VALIDADOR
                else:
                    raise WorkflowError("Accion invalida para el rol validador.")
            elif role == ClientRole.TRANSFERENCIAS_CELESOL:
                if case.current_stage != WorkflowStage.APPROVED_BY_VALIDADOR:
                    raise WorkflowError(
                        "El case no esta habilitado para transferencias_celesol."
                    )
                if action != CaseAction.TRANSFER_SUBMITTED:
                    raise WorkflowError("Accion invalida para transferencias_celesol.")
                case.complete_delivery(ClientRole.TRANSFERENCIAS_CELESOL)
                case.current_stage = WorkflowStage.TRANSFER_SUBMITTED
                case.external_transfer_id = external_transfer_id or case.external_transfer_id
            else:
                raise WorkflowError(f"Rol no soportado: {role.value}")

            case.add_audit(
                action.value,
                actor=actor,
                actor_role=role,
                notes=notes,
                external_transfer_id=external_transfer_id,
            )
            return case

    def register_bank_callback(self, callback_type: str, payload: dict) -> tuple[CaseRecord, bool]:
        dedupe_key = self._build_callback_dedupe_key(callback_type, payload)
        with self._lock:
            if dedupe_key in self._callback_dedupe:
                case = self._find_case_for_callback(payload)
                case.add_audit(
                    "bank_callback_duplicate",
                    actor="bank",
                    actor_role=None,
                    callback_type=callback_type,
                    dedupe_key=dedupe_key,
                )
                return case, True

            case = self._find_case_for_callback(payload)
            self._callback_dedupe.add(dedupe_key)

            if callback_type == "aviso_transferencia_cbu":
                case.current_stage = WorkflowStage.BANK_CONFIRMED
            elif callback_type == "aviso_reversa_debito":
                case.current_stage = WorkflowStage.BANK_REVERSED
            else:
                raise WorkflowError(f"Callback bancario no soportado: {callback_type}")

            case.add_audit(
                "bank_callback_processed",
                actor="bank",
                actor_role=None,
                callback_type=callback_type,
                dedupe_key=dedupe_key,
            )
            return case, False

    def _build_callback_dedupe_key(self, callback_type: str, payload: dict) -> str:
        callback_id = (
            payload.get("IdAviso")
            or payload.get("idAviso")
            or payload.get("IdAnulacion")
            or payload.get("idAnulacion")
            or payload.get("Id")
            or payload.get("id")
            or payload.get("external_transfer_id")
            or payload.get("case_id")
        )
        if not callback_id:
            raise WorkflowError("El callback bancario necesita un identificador para idempotencia.")
        return f"{callback_type}:{str(callback_id).strip()}"

    def _find_case_for_callback(self, payload: dict) -> CaseRecord:
        case_id = payload.get("case_id")
        if case_id:
            case = self._cases.get(str(case_id))
            if case:
                return case

        external_transfer_id = payload.get("external_transfer_id")
        if external_transfer_id:
            for case in self._cases.values():
                if case.external_transfer_id == external_transfer_id:
                    return case

        raise WorkflowError("No se pudo correlacionar el callback bancario con ningun case.")
