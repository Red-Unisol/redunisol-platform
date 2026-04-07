from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    Session,
    mapped_column,
    relationship,
    sessionmaker,
)
from sqlalchemy.types import JSON

from .config import BootstrapClient
from .security import AuthenticatedClient, AuthenticationError, hash_client_secret, verify_client_secret
from .workflow import (
    AuditEntry,
    CaseAction,
    CaseRecord,
    ClientRole,
    DeliveryRecord,
    DeliveryStatus,
    WorkflowError,
    WorkflowStage,
    build_case_payload,
    extract_resource_url,
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Base(DeclarativeBase):
    pass


class ClientRow(Base):
    __tablename__ = "clients"

    client_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    role: Mapped[str] = mapped_column(String(120), nullable=False)
    secret_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[str] = mapped_column(String(64), default=_utc_now, nullable=False)
    updated_at: Mapped[str] = mapped_column(String(64), default=_utc_now, nullable=False)


class CaseRow(Base):
    __tablename__ = "cases"

    case_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    verification_id: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    latest_event_name: Mapped[str] = mapped_column(String(120), nullable=False)
    current_stage: Mapped[str] = mapped_column(String(120), nullable=False)
    source_payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    user_id: Mapped[str | None] = mapped_column(String(120))
    external_transfer_id: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[str] = mapped_column(String(64), default=_utc_now, nullable=False)
    updated_at: Mapped[str] = mapped_column(String(64), default=_utc_now, nullable=False)

    deliveries: Mapped[list["DeliveryRow"]] = relationship(
        back_populates="case",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    audit_entries: Mapped[list["AuditRow"]] = relationship(
        back_populates="case",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="AuditRow.id",
    )


class DeliveryRow(Base):
    __tablename__ = "deliveries"
    __table_args__ = (UniqueConstraint("case_id", "role", name="uq_deliveries_case_role"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.case_id"), nullable=False)
    role: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(120), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(64), default=_utc_now, nullable=False)

    case: Mapped[CaseRow] = relationship(back_populates="deliveries")


class AuditRow(Base):
    __tablename__ = "audit_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.case_id"), nullable=False)
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    actor: Mapped[str] = mapped_column(String(255), nullable=False)
    actor_role: Mapped[str | None] = mapped_column(String(120))
    at: Mapped[str] = mapped_column(String(64), default=_utc_now, nullable=False)
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    case: Mapped[CaseRow] = relationship(back_populates="audit_entries")


class CallbackReceiptRow(Base):
    __tablename__ = "callback_receipts"

    dedupe_key: Mapped[str] = mapped_column(String(255), primary_key=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.case_id"), nullable=False)
    callback_type: Mapped[str] = mapped_column(String(120), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    received_at: Mapped[str] = mapped_column(String(64), default=_utc_now, nullable=False)


class MetamapWebhookReceiptRow(Base):
    __tablename__ = "metamap_webhook_receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_name: Mapped[str | None] = mapped_column(String(120))
    verification_id: Mapped[str | None] = mapped_column(String(120))
    resource_url: Mapped[str | None] = mapped_column(String(1024))
    signature_valid: Mapped[bool] = mapped_column(Boolean, nullable=False)
    processing_status: Mapped[str] = mapped_column(String(120), nullable=False)
    processing_error: Mapped[str | None] = mapped_column(Text)
    raw_body: Mapped[str] = mapped_column(Text, nullable=False)
    headers: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    payload: Mapped[dict | None] = mapped_column(JSON)
    received_at: Mapped[str] = mapped_column(String(64), default=_utc_now, nullable=False)


class SqlWorkflowStore:
    """Workflow store backed by SQLAlchemy and intended for Postgres."""

    def __init__(self, engine: Engine) -> None:
        self._engine = engine
        self._session_factory = sessionmaker(bind=engine, future=True, expire_on_commit=False)

    def init_schema(self) -> None:
        Base.metadata.create_all(self._engine)

    def close(self) -> None:
        self._engine.dispose()

    def bootstrap_clients(self, clients: list[BootstrapClient]) -> None:
        if not clients:
            return
        with self._session_factory() as session:
            for bootstrap in clients:
                row = session.get(ClientRow, bootstrap.client_id)
                hashed_secret = hash_client_secret(bootstrap.client_secret)
                if row is None:
                    row = ClientRow(
                        client_id=bootstrap.client_id,
                        role=bootstrap.role.value,
                        secret_hash=hashed_secret,
                        display_name=bootstrap.display_name,
                    )
                    session.add(row)
                else:
                    row.role = bootstrap.role.value
                    row.secret_hash = hashed_secret
                    row.display_name = bootstrap.display_name
                    row.is_active = True
                    row.updated_at = _utc_now()
            session.commit()

    def authenticate_client(self, client_id: str, client_secret: str) -> AuthenticatedClient:
        with self._session_factory() as session:
            row = session.get(ClientRow, client_id)
            if row is None or not row.is_active:
                raise AuthenticationError("Credenciales invalidas.")
            if not verify_client_secret(client_secret, row.secret_hash):
                raise AuthenticationError("Credenciales invalidas.")
            return AuthenticatedClient(
                client_id=row.client_id,
                role=ClientRole(row.role),
                display_name=row.display_name,
            )

    def list_cases_for_role(self, role: ClientRole) -> list[CaseRecord]:
        with self._session_factory() as session:
            stmt = (
                select(CaseRow)
                .join(DeliveryRow)
                .where(
                    DeliveryRow.role == role.value,
                    DeliveryRow.status == DeliveryStatus.PENDING.value,
                )
                .order_by(CaseRow.updated_at)
            )
            rows = session.execute(stmt).scalars().unique().all()
            return [self._to_case_record(row) for row in rows]

    def get_case(self, case_id: str) -> CaseRecord:
        with self._session_factory() as session:
            row = session.get(CaseRow, case_id)
            if row is None:
                raise WorkflowError(f"Case {case_id} inexistente.")
            return self._to_case_record(row)

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

        with self._session_factory() as session:
            row = session.get(CaseRow, verification_id)
            if row is None:
                row = CaseRow(
                    case_id=verification_id,
                    verification_id=verification_id,
                    latest_event_name=event_name,
                    current_stage=WorkflowStage.RECEIVED_FROM_METAMAP.value,
                    source_payload=build_case_payload(resource_url=resource_url),
                    user_id=user_id,
                )
                session.add(row)
                session.flush()
            row.latest_event_name = event_name
            row.source_payload = build_case_payload(resource_url=resource_url)
            row.user_id = user_id or row.user_id
            row.updated_at = _utc_now()
            if event_name.lower() == "verification_completed":
                current_stage = WorkflowStage(row.current_stage)
                if current_stage == WorkflowStage.RECEIVED_FROM_METAMAP:
                    row.current_stage = WorkflowStage.PENDING_VALIDADOR_REVIEW.value
                    self._ensure_delivery(row, ClientRole.VALIDADOR, DeliveryStatus.PENDING)
                elif current_stage == WorkflowStage.PENDING_VALIDADOR_REVIEW:
                    self._ensure_delivery(row, ClientRole.VALIDADOR, DeliveryStatus.PENDING)
            self._append_audit(
                row,
                action="metamap_event_received",
                actor="metamap",
                actor_role=None,
                event_name=event_name,
                resource_url=resource_url,
            )
            session.commit()
            return self._to_case_record(row)

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
        with self._session_factory() as session:
            session.add(
                MetamapWebhookReceiptRow(
                    event_name=event_name,
                    verification_id=verification_id,
                    resource_url=resource_url,
                    signature_valid=signature_valid,
                    processing_status=processing_status,
                    processing_error=processing_error,
                    raw_body=raw_body,
                    headers=headers,
                    payload=payload,
                )
            )
            session.commit()

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
        with self._session_factory() as session:
            row = session.get(CaseRow, case_id)
            if row is None:
                raise WorkflowError(f"Case {case_id} inexistente.")

            current_stage = WorkflowStage(row.current_stage)
            if role == ClientRole.VALIDADOR:
                if current_stage != WorkflowStage.PENDING_VALIDADOR_REVIEW:
                    raise WorkflowError("El case no esta esperando revision de validador.")
                if action == CaseAction.APPROVED:
                    self._set_delivery_status(row, ClientRole.VALIDADOR, DeliveryStatus.COMPLETED)
                    row.current_stage = WorkflowStage.APPROVED_BY_VALIDADOR.value
                    self._ensure_delivery(
                        row,
                        ClientRole.TRANSFERENCIAS_CELESOL,
                        DeliveryStatus.PENDING,
                    )
                elif action == CaseAction.REJECTED:
                    self._set_delivery_status(row, ClientRole.VALIDADOR, DeliveryStatus.COMPLETED)
                    row.current_stage = WorkflowStage.REJECTED_BY_VALIDADOR.value
                else:
                    raise WorkflowError("Accion invalida para el rol validador.")
            elif role == ClientRole.TRANSFERENCIAS_CELESOL:
                if current_stage != WorkflowStage.APPROVED_BY_VALIDADOR:
                    raise WorkflowError(
                        "El case no esta habilitado para transferencias_celesol."
                    )
                if action != CaseAction.TRANSFER_SUBMITTED:
                    raise WorkflowError("Accion invalida para transferencias_celesol.")
                self._set_delivery_status(
                    row,
                    ClientRole.TRANSFERENCIAS_CELESOL,
                    DeliveryStatus.COMPLETED,
                )
                row.current_stage = WorkflowStage.TRANSFER_SUBMITTED.value
                row.external_transfer_id = external_transfer_id or row.external_transfer_id
            else:
                raise WorkflowError(f"Rol no soportado: {role.value}")

            row.updated_at = _utc_now()
            self._append_audit(
                row,
                action=action.value,
                actor=actor,
                actor_role=role,
                notes=notes,
                external_transfer_id=external_transfer_id,
            )
            session.commit()
            return self._to_case_record(row)

    def register_bank_callback(self, callback_type: str, payload: dict) -> tuple[CaseRecord, bool]:
        dedupe_key = self._build_callback_dedupe_key(callback_type, payload)
        with self._session_factory() as session:
            receipt = session.get(CallbackReceiptRow, dedupe_key)
            if receipt is not None:
                row = session.get(CaseRow, receipt.case_id)
                if row is None:
                    raise WorkflowError("El callback duplicado referencia un case inexistente.")
                self._append_audit(
                    row,
                    action="bank_callback_duplicate",
                    actor="bank",
                    actor_role=None,
                    callback_type=callback_type,
                    dedupe_key=dedupe_key,
                )
                session.commit()
                return self._to_case_record(row), True

            row = self._find_case_for_callback(session, payload)
            session.add(
                CallbackReceiptRow(
                    dedupe_key=dedupe_key,
                    case_id=row.case_id,
                    callback_type=callback_type,
                    payload=payload,
                )
            )

            if callback_type == "aviso_transferencia_cbu":
                row.current_stage = WorkflowStage.BANK_CONFIRMED.value
            elif callback_type == "aviso_reversa_debito":
                row.current_stage = WorkflowStage.BANK_REVERSED.value
            else:
                raise WorkflowError(f"Callback bancario no soportado: {callback_type}")

            row.updated_at = _utc_now()
            self._append_audit(
                row,
                action="bank_callback_processed",
                actor="bank",
                actor_role=None,
                callback_type=callback_type,
                dedupe_key=dedupe_key,
            )
            session.commit()
            return self._to_case_record(row), False

    def _ensure_delivery(
        self,
        case_row: CaseRow,
        role: ClientRole,
        status: DeliveryStatus,
    ) -> DeliveryRow:
        delivery = self._delivery_for_role(case_row, role)
        if delivery is None:
            delivery = DeliveryRow(
                case=case_row,
                role=role.value,
                status=status.value,
                updated_at=_utc_now(),
            )
            case_row.deliveries.append(delivery)
            return delivery
        delivery.status = status.value
        delivery.updated_at = _utc_now()
        return delivery

    def _set_delivery_status(
        self,
        case_row: CaseRow,
        role: ClientRole,
        status: DeliveryStatus,
    ) -> None:
        delivery = self._delivery_for_role(case_row, role)
        if delivery is None:
            raise WorkflowError(f"No existe entrega pendiente para el rol {role.value}.")
        delivery.status = status.value
        delivery.updated_at = _utc_now()

    def _delivery_for_role(self, case_row: CaseRow, role: ClientRole) -> DeliveryRow | None:
        for delivery in case_row.deliveries:
            if delivery.role == role.value:
                return delivery
        return None

    def _append_audit(
        self,
        case_row: CaseRow,
        *,
        action: str,
        actor: str,
        actor_role: ClientRole | None,
        **details: object,
    ) -> None:
        case_row.audit_entries.append(
            AuditRow(
                action=action,
                actor=actor,
                actor_role=actor_role.value if actor_role else None,
                details={k: v for k, v in details.items() if v is not None},
            )
        )

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

    def _find_case_for_callback(self, session: Session, payload: dict) -> CaseRow:
        case_id = payload.get("case_id")
        if case_id:
            row = session.get(CaseRow, str(case_id))
            if row is not None:
                return row

        external_transfer_id = payload.get("external_transfer_id")
        if external_transfer_id:
            stmt = select(CaseRow).where(CaseRow.external_transfer_id == external_transfer_id)
            row = session.execute(stmt).scalar_one_or_none()
            if row is not None:
                return row

        raise WorkflowError("No se pudo correlacionar el callback bancario con ningun case.")

    def _to_case_record(self, row: CaseRow) -> CaseRecord:
        deliveries = [
            DeliveryRecord(
                role=ClientRole(delivery.role),
                status=DeliveryStatus(delivery.status),
                updated_at=delivery.updated_at,
            )
            for delivery in sorted(row.deliveries, key=lambda item: item.id or 0)
        ]
        audit_entries = [
            AuditEntry(
                action=entry.action,
                actor=entry.actor,
                actor_role=ClientRole(entry.actor_role) if entry.actor_role else None,
                at=entry.at,
                details=entry.details or {},
            )
            for entry in row.audit_entries
        ]
        return CaseRecord(
            case_id=row.case_id,
            verification_id=row.verification_id,
            latest_event_name=row.latest_event_name,
            current_stage=WorkflowStage(row.current_stage),
            source_payload=row.source_payload or {},
            user_id=row.user_id,
            external_transfer_id=row.external_transfer_id,
            created_at=row.created_at,
            updated_at=row.updated_at,
            deliveries=deliveries,
            audit_log=audit_entries,
        )
