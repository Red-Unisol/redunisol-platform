from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from time import monotonic
from typing import Any

from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    Header,
    HTTPException,
    Query,
    Request,
    status,
)
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field, field_validator

from . import __version__
from .config import AppSettings, load_settings_from_env
from .db import create_db_engine
from .enrichment import BackgroundEnricher
from .metamap_resource import MetaMapResourceClient, extract_validation_enrichment
from .metrics import MetricsRegistry
from .security import AuthenticatedClient, AuthenticationError, verify_metamap_signature
from .store_sql import SqlValidationStore
from .workflow import (
    ClientRole,
    ValidationStatus,
    WorkflowError,
    extract_resource_url,
    extract_user_id,
    extract_verification_id,
    normalize_event_name,
    normalize_validation_status,
)


logger = logging.getLogger(__name__)
_RECEIPT_CLEANUP_INTERVAL_SECONDS = 60 * 60


class TransferTraceEventInput(BaseModel):
    event_id: str = Field(min_length=1, max_length=120)
    session_id: str = Field(min_length=1, max_length=120)
    client_instance_id: str = Field(min_length=1, max_length=120)
    event_type: str = Field(min_length=1, max_length=120)
    occurred_at: datetime
    operator: str = Field(min_length=1, max_length=255)
    application_version: str = Field(min_length=1, max_length=64)
    request_oid: str | None = Field(default=None, max_length=120)
    mode: str | None = Field(default=None, max_length=32)
    severity: str = Field(default="info", min_length=1, max_length=32)
    data: dict = Field(default_factory=dict)

    @field_validator(
        "event_id",
        "session_id",
        "client_instance_id",
        "event_type",
        "operator",
        "application_version",
        "severity",
    )
    @classmethod
    def require_nonempty_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("El valor no puede estar vacio.")
        return normalized

    @field_validator("occurred_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("occurred_at debe incluir zona horaria.")
        return value


class TransferTraceBatchInput(BaseModel):
    events: list[TransferTraceEventInput] = Field(min_length=1, max_length=100)


def get_store(app: FastAPI) -> Any:
    return app.state.validation_store


def get_settings(app: FastAPI) -> AppSettings:
    return app.state.settings


def create_app(
    settings: AppSettings | None = None,
    store: Any | None = None,
    metamap_resource_fetcher: Any | None = None,
) -> FastAPI:
    resolved_settings = settings or load_settings_from_env()

    @asynccontextmanager
    async def lifespan(current_app: FastAPI):
        _queue_pending_enrichments(current_app)
        cleanup_task = asyncio.create_task(_run_periodic_receipt_cleanup(current_app))
        try:
            yield
        finally:
            cleanup_task.cancel()
            try:
                await cleanup_task
            except asyncio.CancelledError:
                pass
            current_app.state.background_enricher.shutdown()

    app = FastAPI(
        title="MetaMap Platform Server",
        version=__version__,
        lifespan=lifespan,
    )
    app.state.settings = resolved_settings
    app.state.metrics = MetricsRegistry()

    if store is None:
        engine = create_db_engine(resolved_settings.database_url)
        sql_store = SqlValidationStore(engine)
        sql_store.init_schema()
        sql_store.bootstrap_clients(resolved_settings.bootstrap_clients)
        sql_store.prune_old_metamap_webhook_receipts()
        app.state.validation_store = sql_store
    else:
        app.state.validation_store = store

    if metamap_resource_fetcher is not None:
        app.state.metamap_resource_fetcher = metamap_resource_fetcher
    elif resolved_settings.metamap_client_id and resolved_settings.metamap_client_secret:
        resource_client = MetaMapResourceClient(
            client_id=resolved_settings.metamap_client_id,
            client_secret=resolved_settings.metamap_client_secret,
            timeout_seconds=resolved_settings.metamap_timeout_seconds,
            max_attempts=resolved_settings.metamap_max_attempts,
            retry_backoff_seconds=resolved_settings.metamap_retry_backoff_seconds,
            oauth_token_ttl_seconds=resolved_settings.metamap_oauth_token_ttl_seconds,
            metrics=app.state.metrics,
        )
        app.state.metamap_resource_fetcher = resource_client.fetch
    elif resolved_settings.metamap_api_token:
        resource_client = MetaMapResourceClient(
            api_token=resolved_settings.metamap_api_token,
            auth_scheme=resolved_settings.metamap_auth_scheme,
            timeout_seconds=resolved_settings.metamap_timeout_seconds,
            max_attempts=resolved_settings.metamap_max_attempts,
            retry_backoff_seconds=resolved_settings.metamap_retry_backoff_seconds,
            metrics=app.state.metrics,
        )
        app.state.metamap_resource_fetcher = resource_client.fetch
    else:
        app.state.metamap_resource_fetcher = None

    app.state.background_enricher = BackgroundEnricher(
        store=app.state.validation_store,
        resource_fetcher=app.state.metamap_resource_fetcher,
        metrics=app.state.metrics,
        max_workers=resolved_settings.enrichment_workers,
        queue_size=resolved_settings.enrichment_queue_size,
    )

    @app.middleware("http")
    async def observe_http_request(request: Request, call_next):
        started_at = monotonic()
        response_status = 500
        try:
            response = await call_next(request)
            response_status = response.status_code
            return response
        finally:
            route = request.scope.get("route")
            route_path = getattr(route, "path", "__unmatched__")
            labels = {
                "method": request.method,
                "path": route_path,
                "status": str(response_status),
            }
            app.state.metrics.increment("metamap_http_requests_total", **labels)
            app.state.metrics.observe_duration(
                "metamap_http_request_duration_seconds",
                monotonic() - started_at,
                method=request.method,
                path=route_path,
            )

    def _store_dependency() -> Any:
        return get_store(app)

    def _settings_dependency() -> AppSettings:
        return get_settings(app)

    def _require_client_role(
        current_client: AuthenticatedClient,
        expected_role: ClientRole,
    ) -> None:
        if current_client.role != expected_role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Operacion permitida solo para clientes con rol {expected_role.value}.",
            )

    def _authenticate_client(
        x_client_id: str | None = Header(None, alias="X-Client-Id"),
        x_client_secret: str | None = Header(None, alias="X-Client-Secret"),
        validation_store: Any = Depends(_store_dependency),
    ) -> AuthenticatedClient:
        if not x_client_id or not x_client_secret:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Faltan X-Client-Id o X-Client-Secret.",
            )
        try:
            return validation_store.authenticate_client(x_client_id, x_client_secret)
        except AuthenticationError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=str(exc),
            ) from exc

    @app.get("/health")
    def health() -> dict:
        return {
            "status": "ok",
            "service": "metamap-platform-server",
            "version": __version__,
            "git_sha": resolved_settings.git_sha,
        }

    @app.get("/metrics", response_class=PlainTextResponse)
    def metrics() -> str:
        return app.state.metrics.render_prometheus()

    @app.post("/api/v1/metamap/webhooks")
    async def ingest_metamap_webhook(
        request: Request,
        background_tasks: BackgroundTasks,
        validation_store: Any = Depends(_store_dependency),
        settings_value: AppSettings = Depends(_settings_dependency),
        x_signature: str | None = Header(None, alias="x-signature"),
    ) -> dict:
        raw_body = await request.body()
        raw_body_text = raw_body.decode("utf-8", errors="replace")
        headers = {key.lower(): value for key, value in request.headers.items()}
        signature_valid = verify_metamap_signature(
            secret=settings_value.webhook_secret,
            signature=x_signature,
            payload_body=raw_body,
        )
        parsed_payload: dict | None = None
        event_name: str | None = None
        verification_id: str | None = None
        resource_url: str | None = None
        normalized_status: str | None = None
        processing_status = "received"
        processing_error: str | None = None
        validation = None

        try:
            parsed_payload = _parse_metamap_webhook_body(raw_body)
            event_name = _extract_metamap_event_name(parsed_payload)
            normalized_status = normalize_validation_status(event_name).value
            resource_url = extract_resource_url(parsed_payload)
            verification_id = extract_verification_id(parsed_payload, resource_url=resource_url)

            if not signature_valid:
                processing_status = "invalid_signature"
                processing_error = "Firma de webhook MetaMap invalida."
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=processing_error,
                )
            if not event_name:
                processing_status = "invalid_payload"
                processing_error = "eventName es obligatorio."
                raise WorkflowError(processing_error)

            if verification_id:
                enrichment = extract_validation_enrichment(parsed_payload)
                validation = validation_store.upsert_validation_from_metamap_event(
                    event_name=event_name,
                    verification_id=verification_id,
                    resource_url=resource_url,
                    payload=parsed_payload,
                    user_id=extract_user_id(parsed_payload),
                    request_number=enrichment.request_number,
                    loan_number=enrichment.loan_number,
                    amount_raw=enrichment.amount_raw,
                    amount_value=enrichment.amount_value,
                    requested_amount_raw=enrichment.requested_amount_raw,
                    requested_amount_value=enrichment.requested_amount_value,
                    liquidated_amount_raw=enrichment.liquidated_amount_raw,
                    liquidated_amount_value=enrichment.liquidated_amount_value,
                    total_amount_raw=enrichment.total_amount_raw,
                    total_amount_value=enrichment.total_amount_value,
                    applicant_name=enrichment.applicant_name,
                    document_number=enrichment.document_number,
                )
                processing_status = "stored"
                if (
                    resource_url
                    and app.state.metamap_resource_fetcher is not None
                    and _validation_needs_enrichment(validation)
                ):
                    background_tasks.add_task(
                        app.state.background_enricher.submit,
                        verification_id=verification_id,
                        resource_url=resource_url,
                    )
            else:
                if normalized_status == ValidationStatus.COMPLETED.value:
                    processing_status = "invalid_payload"
                    processing_error = (
                        "No se pudo derivar verification_id para un evento terminal de validacion."
                    )
                    raise WorkflowError(processing_error)
                processing_status = "logged_only"
        except WorkflowError as exc:
            if processing_error is None:
                processing_status = "invalid_payload"
                processing_error = str(exc)
            _record_metamap_webhook_receipt(
                workflow_store=validation_store,
                raw_body=raw_body_text,
                headers=headers,
                payload=parsed_payload,
                event_name=event_name,
                verification_id=verification_id,
                resource_url=resource_url,
                signature_valid=signature_valid,
                processing_status=processing_status,
                processing_error=processing_error,
            )
            logger.warning(
                "MetaMap webhook rejected: status=%s event=%s verification_id=%s error=%s",
                processing_status,
                event_name,
                verification_id,
                processing_error,
            )
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except HTTPException:
            _record_metamap_webhook_receipt(
                workflow_store=validation_store,
                raw_body=raw_body_text,
                headers=headers,
                payload=parsed_payload,
                event_name=event_name,
                verification_id=verification_id,
                resource_url=resource_url,
                signature_valid=signature_valid,
                processing_status=processing_status,
                processing_error=processing_error,
            )
            logger.warning(
                "MetaMap webhook unauthorized: status=%s event=%s verification_id=%s",
                processing_status,
                event_name,
                verification_id,
            )
            raise

        _record_metamap_webhook_receipt(
            workflow_store=validation_store,
            raw_body=raw_body_text,
            headers=headers,
            payload=parsed_payload,
            event_name=event_name,
            verification_id=verification_id,
            resource_url=resource_url,
            signature_valid=signature_valid,
            processing_status=processing_status,
            processing_error=processing_error,
        )
        logger.info(
            "MetaMap webhook processed: status=%s event=%s verification_id=%s",
            processing_status,
            event_name,
            verification_id,
        )
        return {
            "processing_status": processing_status,
            "event_name": event_name,
            "normalized_status": (
                validation.normalized_status.value if validation else normalized_status
            ),
            "verification_id": verification_id,
            "resource_url": resource_url,
            "validation": validation.to_dict(include_payload=True) if validation else None,
        }

    @app.get("/api/v1/validations")
    def list_validations(
        limit: int = Query(50, ge=1, le=200),
        offset: int = Query(0, ge=0, le=10_000),
        verification_id: str | None = Query(None),
        user_id: str | None = Query(None),
        flow_id: str | None = Query(None),
        request_number: str | None = Query(None),
        loan_number: str | None = Query(None),
        event_name: str | None = Query(None),
        normalized_status: ValidationStatus | None = Query(None),
        q: str | None = Query(None),
        include_payload: bool = Query(False),
        validation_store: Any = Depends(_store_dependency),
        current_client: AuthenticatedClient = Depends(_authenticate_client),
    ) -> dict:
        _ = current_client
        items, total = validation_store.search_validations(
            limit=limit,
            offset=offset,
            verification_id=verification_id,
            user_id=user_id,
            flow_id=flow_id,
            request_number=request_number,
            loan_number=loan_number,
            event_name=event_name,
            normalized_status=normalized_status,
            q=q,
        )
        return {
            "items": [item.to_dict(include_payload=include_payload) for item in items],
            "pagination": {
                "limit": limit,
                "offset": offset,
                "returned": len(items),
                "total": total,
            },
            "filters": {
                "verification_id": verification_id,
                "user_id": user_id,
                "flow_id": flow_id,
                "request_number": request_number,
                "loan_number": loan_number,
                "event_name": normalize_event_name(event_name),
                "normalized_status": normalized_status.value if normalized_status else None,
                "q": q,
            },
        }

    @app.get("/api/v1/validations/{verification_id}")
    def get_validation(
        verification_id: str,
        include_payload: bool = Query(True),
        validation_store: Any = Depends(_store_dependency),
        current_client: AuthenticatedClient = Depends(_authenticate_client),
    ) -> dict:
        _ = current_client
        try:
            validation = validation_store.get_validation(verification_id)
        except WorkflowError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        return {"validation": validation.to_dict(include_payload=include_payload)}

    @app.post("/api/v1/validations/{verification_id}/review")
    def mark_validation_reviewed(
        verification_id: str,
        validation_store: Any = Depends(_store_dependency),
        current_client: AuthenticatedClient = Depends(_authenticate_client),
    ) -> dict:
        _require_client_role(current_client, ClientRole.VALIDADOR)
        try:
            validation = validation_store.mark_validation_reviewed(
                verification_id=verification_id,
                reviewed_by_client_id=current_client.client_id,
                reviewed_by_display_name=current_client.display_name,
            )
        except WorkflowError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        return {"validation": validation.to_dict(include_payload=False)}

    @app.get("/api/v1/internal/metamap/webhook-receipts")
    def list_metamap_webhook_receipts(
        limit: int = Query(50, ge=1, le=200),
        validation_store: Any = Depends(_store_dependency),
        current_client: AuthenticatedClient = Depends(_authenticate_client),
    ) -> dict:
        _ = current_client
        receipts = validation_store.list_metamap_webhook_receipts(limit=limit)
        return {"receipts": receipts}

    @app.post("/api/v1/transfer-trace-events")
    def ingest_transfer_trace_events(
        batch: TransferTraceBatchInput,
        validation_store: Any = Depends(_store_dependency),
        current_client: AuthenticatedClient = Depends(_authenticate_client),
    ) -> dict:
        _require_client_role(current_client, ClientRole.TRANSFERENCIAS_CELESOL)
        events = []
        for event in batch.events:
            item = event.model_dump(mode="json")
            item["severity"] = item["severity"].strip().lower()
            item["occurred_at"] = event.occurred_at.astimezone(timezone.utc).isoformat()
            events.append(item)
        accepted, duplicates = validation_store.record_transfer_trace_events(
            events=events,
            authenticated_client_id=current_client.client_id,
        )
        return {
            "accepted": accepted,
            "duplicates": duplicates,
            "received": len(events),
        }

    @app.get("/api/v1/transfer-trace-events")
    def list_transfer_trace_events(
        limit: int = Query(100, ge=1, le=500),
        offset: int = Query(0, ge=0, le=100_000),
        request_oid: str | None = Query(None),
        session_id: str | None = Query(None),
        client_instance_id: str | None = Query(None),
        operator: str | None = Query(None),
        event_type: str | None = Query(None),
        occurred_from: datetime | None = Query(None),
        occurred_to: datetime | None = Query(None),
        validation_store: Any = Depends(_store_dependency),
        current_client: AuthenticatedClient = Depends(_authenticate_client),
    ) -> dict:
        _ = current_client
        items, total = validation_store.search_transfer_trace_events(
            limit=limit,
            offset=offset,
            request_oid=request_oid,
            session_id=session_id,
            client_instance_id=client_instance_id,
            operator=operator,
            event_type=event_type,
            occurred_from=(
                occurred_from.astimezone(timezone.utc).isoformat()
                if occurred_from
                else None
            ),
            occurred_to=(
                occurred_to.astimezone(timezone.utc).isoformat() if occurred_to else None
            ),
        )
        return {
            "items": items,
            "pagination": {
                "limit": limit,
                "offset": offset,
                "returned": len(items),
                "total": total,
            },
        }

    return app


def _record_metamap_webhook_receipt(
    *,
    workflow_store: Any,
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
    workflow_store.record_metamap_webhook_receipt(
        raw_body=raw_body,
        headers=headers,
        payload=payload,
        event_name=event_name,
        verification_id=verification_id,
        resource_url=resource_url,
        signature_valid=signature_valid,
        processing_status=processing_status,
        processing_error=processing_error,
    )


def _parse_metamap_webhook_body(raw_body: bytes) -> dict:
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise WorkflowError("El body del webhook MetaMap debe ser JSON valido.") from exc
    if not isinstance(payload, dict):
        raise WorkflowError("El body del webhook MetaMap debe ser un objeto JSON.")
    return payload


def _extract_metamap_event_name(payload: dict) -> str | None:
    raw_value = payload.get("eventName")
    if raw_value is None:
        return None
    event_name = normalize_event_name(str(raw_value))
    return event_name or None


def _validation_needs_enrichment(validation: Any) -> bool:
    return any(
        [
            not validation.request_number,
            not validation.amount_raw and not validation.amount_value,
            not validation.requested_amount_raw and not validation.requested_amount_value,
            not validation.applicant_name,
            not validation.document_number,
        ]
    )


def _queue_pending_enrichments(app: FastAPI) -> None:
    if app.state.metamap_resource_fetcher is None:
        return
    settings: AppSettings = app.state.settings
    limit = settings.enrichment_workers + settings.enrichment_queue_size
    pending = app.state.validation_store.list_validations_needing_enrichment(limit)
    submitted = 0
    for validation in pending:
        if not validation.resource_url:
            continue
        if app.state.background_enricher.submit(
            verification_id=validation.verification_id,
            resource_url=validation.resource_url,
        ):
            submitted += 1
    if pending:
        logger.info(
            "Queued pending MetaMap enrichments at startup: found=%s submitted=%s limit=%s",
            len(pending),
            submitted,
            limit,
        )


async def _run_periodic_receipt_cleanup(app: FastAPI) -> None:
    prune = getattr(app.state.validation_store, "prune_old_metamap_webhook_receipts", None)
    if not callable(prune):
        return
    while True:
        await asyncio.sleep(_RECEIPT_CLEANUP_INTERVAL_SECONDS)
        try:
            deleted = await asyncio.to_thread(prune)
            if deleted:
                logger.info("Pruned expired MetaMap webhook receipts: deleted=%s", deleted)
        except Exception:
            logger.exception("Periodic MetaMap webhook receipt cleanup failed.")
