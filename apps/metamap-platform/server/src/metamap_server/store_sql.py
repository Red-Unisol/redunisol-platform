from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, Integer, String, Text, delete, func, inspect, or_, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.types import JSON

from .config import BootstrapClient
from .security import (
    AuthenticatedClient,
    AuthenticationError,
    hash_client_secret,
    verify_client_secret,
)
from .workflow import (
    ClientRole,
    METAMAP_WEBHOOK_RECEIPT_RETENTION,
    ValidationRecord,
    ValidationStatus,
    WorkflowError,
    extract_event_timestamp,
    extract_flow_id,
    extract_metadata,
    extract_user_id,
    normalize_event_name,
    normalize_validation_status,
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


class ValidationRow(Base):
    __tablename__ = "validations"

    verification_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    latest_event_name: Mapped[str] = mapped_column(String(120), nullable=False)
    normalized_status: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_url: Mapped[str | None] = mapped_column(String(1024))
    flow_id: Mapped[str | None] = mapped_column(String(255))
    user_id: Mapped[str | None] = mapped_column(String(120))
    request_number: Mapped[str | None] = mapped_column(String(120))
    loan_number: Mapped[str | None] = mapped_column(String(120))
    amount_raw: Mapped[str | None] = mapped_column(String(120))
    amount_value: Mapped[str | None] = mapped_column(String(64))
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
    latest_payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    first_received_at: Mapped[str] = mapped_column(String(64), default=_utc_now, nullable=False)
    last_received_at: Mapped[str] = mapped_column(String(64), default=_utc_now, nullable=False)
    latest_event_timestamp: Mapped[str | None] = mapped_column(String(64))
    completed_at: Mapped[str | None] = mapped_column(String(64))
    event_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


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


class SqlValidationStore:
    """Validation store backed by SQLAlchemy and intended for Postgres or SQLite."""

    def __init__(self, engine: Engine) -> None:
        self._engine = engine
        self._session_factory = sessionmaker(bind=engine, future=True, expire_on_commit=False)

    def init_schema(self) -> None:
        Base.metadata.create_all(self._engine)
        self._ensure_validation_columns()

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

    def upsert_validation_from_metamap_event(
        self,
        *,
        event_name: str,
        verification_id: str,
        resource_url: str | None,
        payload: dict,
        user_id: str | None,
        request_number: str | None = None,
        loan_number: str | None = None,
        amount_raw: str | None = None,
        amount_value: str | None = None,
    ) -> ValidationRecord:
        normalized_event_name = normalize_event_name(event_name)
        if not normalized_event_name:
            raise WorkflowError("eventName es obligatorio.")
        if not verification_id:
            raise WorkflowError("verification_id es obligatorio.")

        now = _utc_now()
        normalized_status = normalize_validation_status(normalized_event_name)
        flow_id = extract_flow_id(payload)
        metadata = extract_metadata(payload)
        resolved_user_id = user_id or extract_user_id(payload)
        event_timestamp = extract_event_timestamp(payload)

        with self._session_factory() as session:
            self._prune_old_metamap_webhook_receipts(session)
            row = session.get(ValidationRow, verification_id)
            if row is None:
                row = ValidationRow(
                    verification_id=verification_id,
                    latest_event_name=normalized_event_name,
                    normalized_status=normalized_status.value,
                    resource_url=resource_url,
                    flow_id=flow_id,
                    user_id=resolved_user_id,
                    request_number=request_number,
                    loan_number=loan_number,
                    amount_raw=amount_raw,
                    amount_value=amount_value,
                    metadata_json=metadata,
                    latest_payload=payload,
                    first_received_at=now,
                    last_received_at=now,
                    latest_event_timestamp=event_timestamp,
                    completed_at=event_timestamp or now
                    if normalized_status == ValidationStatus.COMPLETED
                    else None,
                    event_count=1,
                )
                session.add(row)
            else:
                row.latest_event_name = normalized_event_name
                row.normalized_status = normalized_status.value
                row.resource_url = resource_url or row.resource_url
                row.flow_id = flow_id or row.flow_id
                row.user_id = resolved_user_id or row.user_id
                row.request_number = request_number or row.request_number
                row.loan_number = loan_number or row.loan_number
                row.amount_raw = amount_raw or row.amount_raw
                row.amount_value = amount_value or row.amount_value
                row.metadata_json = metadata or row.metadata_json
                row.latest_payload = payload
                row.last_received_at = now
                row.latest_event_timestamp = event_timestamp or row.latest_event_timestamp
                row.event_count += 1
                if normalized_status == ValidationStatus.COMPLETED:
                    row.completed_at = event_timestamp or now
            session.commit()
            return self._to_validation_record(row)

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
            self._prune_old_metamap_webhook_receipts(session)
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

    def list_metamap_webhook_receipts(self, limit: int = 50) -> list[dict]:
        with self._session_factory() as session:
            if self._prune_old_metamap_webhook_receipts(session):
                session.commit()
            stmt = (
                select(MetamapWebhookReceiptRow)
                .order_by(MetamapWebhookReceiptRow.id.desc())
                .limit(limit)
            )
            rows = session.execute(stmt).scalars().all()
            return [self._serialize_metamap_webhook_receipt(row) for row in rows]

    def get_validation(self, verification_id: str) -> ValidationRecord:
        with self._session_factory() as session:
            if self._prune_old_metamap_webhook_receipts(session):
                session.commit()
            row = session.get(ValidationRow, verification_id)
            if row is None:
                raise WorkflowError(f"Validacion {verification_id} inexistente.")
            return self._to_validation_record(row)

    def search_validations(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        verification_id: str | None = None,
        user_id: str | None = None,
        flow_id: str | None = None,
        request_number: str | None = None,
        loan_number: str | None = None,
        event_name: str | None = None,
        normalized_status: ValidationStatus | None = None,
        q: str | None = None,
    ) -> tuple[list[ValidationRecord], int]:
        with self._session_factory() as session:
            if self._prune_old_metamap_webhook_receipts(session):
                session.commit()
            conditions = self._build_validation_conditions(
                verification_id=verification_id,
                user_id=user_id,
                flow_id=flow_id,
                request_number=request_number,
                loan_number=loan_number,
                event_name=event_name,
                normalized_status=normalized_status,
                q=q,
            )
            stmt = select(ValidationRow)
            count_stmt = select(func.count()).select_from(ValidationRow)
            if conditions:
                stmt = stmt.where(*conditions)
                count_stmt = count_stmt.where(*conditions)
            stmt = stmt.order_by(ValidationRow.last_received_at.desc()).limit(limit).offset(offset)
            rows = session.execute(stmt).scalars().all()
            total = session.execute(count_stmt).scalar_one()
            return [self._to_validation_record(row) for row in rows], int(total)

    def _prune_old_metamap_webhook_receipts(self, session: Session) -> bool:
        threshold = (datetime.now(timezone.utc) - METAMAP_WEBHOOK_RECEIPT_RETENTION).isoformat()
        result = session.execute(
            delete(MetamapWebhookReceiptRow).where(
                MetamapWebhookReceiptRow.received_at < threshold
            )
        )
        return bool(result.rowcount)

    def _build_validation_conditions(
        self,
        *,
        verification_id: str | None,
        user_id: str | None,
        flow_id: str | None,
        request_number: str | None,
        loan_number: str | None,
        event_name: str | None,
        normalized_status: ValidationStatus | None,
        q: str | None,
    ) -> list:
        conditions = []
        if verification_id:
            conditions.append(ValidationRow.verification_id == verification_id.strip())
        if user_id:
            conditions.append(ValidationRow.user_id == user_id.strip())
        if flow_id:
            conditions.append(ValidationRow.flow_id == flow_id.strip())
        if request_number:
            conditions.append(ValidationRow.request_number == request_number.strip())
        if loan_number:
            conditions.append(ValidationRow.loan_number == loan_number.strip())
        if event_name:
            normalized_event_name = normalize_event_name(event_name)
            if normalized_event_name:
                conditions.append(ValidationRow.latest_event_name == normalized_event_name)
        if normalized_status is not None:
            conditions.append(ValidationRow.normalized_status == normalized_status.value)
        if q and q.strip():
            pattern = f"%{q.strip().lower()}%"
            conditions.append(
                or_(
                    func.lower(ValidationRow.verification_id).like(pattern),
                    func.lower(func.coalesce(ValidationRow.user_id, "")).like(pattern),
                    func.lower(func.coalesce(ValidationRow.flow_id, "")).like(pattern),
                    func.lower(func.coalesce(ValidationRow.request_number, "")).like(pattern),
                    func.lower(func.coalesce(ValidationRow.loan_number, "")).like(pattern),
                    func.lower(func.coalesce(ValidationRow.amount_raw, "")).like(pattern),
                    func.lower(func.coalesce(ValidationRow.amount_value, "")).like(pattern),
                    func.lower(func.coalesce(ValidationRow.resource_url, "")).like(pattern),
                )
            )
        return conditions

    def _to_validation_record(self, row: ValidationRow) -> ValidationRecord:
        return ValidationRecord(
            verification_id=row.verification_id,
            latest_event_name=row.latest_event_name,
            normalized_status=ValidationStatus(row.normalized_status),
            resource_url=row.resource_url,
            flow_id=row.flow_id,
            user_id=row.user_id,
            request_number=row.request_number,
            loan_number=row.loan_number,
            amount_raw=row.amount_raw,
            amount_value=row.amount_value,
            metadata=row.metadata_json or {},
            latest_payload=row.latest_payload or {},
            first_received_at=row.first_received_at,
            last_received_at=row.last_received_at,
            latest_event_timestamp=row.latest_event_timestamp,
            completed_at=row.completed_at,
            event_count=row.event_count,
        )

    def _serialize_metamap_webhook_receipt(self, row: MetamapWebhookReceiptRow) -> dict:
        return {
            "id": row.id,
            "event_name": row.event_name,
            "verification_id": row.verification_id,
            "resource_url": row.resource_url,
            "signature_valid": row.signature_valid,
            "processing_status": row.processing_status,
            "processing_error": row.processing_error,
            "raw_body": row.raw_body,
            "headers": row.headers,
            "payload": row.payload,
            "received_at": row.received_at,
        }

    def _ensure_validation_columns(self) -> None:
        inspector = inspect(self._engine)
        if "validations" not in inspector.get_table_names():
            return
        existing_columns = {column["name"] for column in inspector.get_columns("validations")}
        required_columns = {
            "request_number": "VARCHAR(120)",
            "loan_number": "VARCHAR(120)",
            "amount_raw": "VARCHAR(120)",
            "amount_value": "VARCHAR(64)",
        }
        missing_columns = [
            (name, ddl)
            for name, ddl in required_columns.items()
            if name not in existing_columns
        ]
        if not missing_columns:
            return
        with self._engine.begin() as connection:
            for column_name, ddl in missing_columns:
                connection.execute(
                    text(f"ALTER TABLE validations ADD COLUMN {column_name} {ddl}")
                )
