from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status

from . import __version__
from .config import AppSettings, load_settings_from_env
from .db import create_db_engine
from .metamap_resource import extract_validation_enrichment, fetch_metamap_resource
from .security import AuthenticatedClient, AuthenticationError, verify_metamap_signature
from .store_sql import SqlValidationStore
from .workflow import (
    ValidationStatus,
    WorkflowError,
    extract_resource_url,
    extract_user_id,
    extract_verification_id,
    normalize_event_name,
    normalize_validation_status,
)


logger = logging.getLogger(__name__)


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
    app = FastAPI(title="MetaMap Platform Server", version=__version__)
    app.state.settings = resolved_settings

    if store is None:
        engine = create_db_engine(resolved_settings.database_url)
        sql_store = SqlValidationStore(engine)
        sql_store.init_schema()
        sql_store.bootstrap_clients(resolved_settings.bootstrap_clients)
        app.state.validation_store = sql_store
    else:
        app.state.validation_store = store

    if metamap_resource_fetcher is not None:
        app.state.metamap_resource_fetcher = metamap_resource_fetcher
    elif resolved_settings.metamap_client_id and resolved_settings.metamap_client_secret:
        app.state.metamap_resource_fetcher = lambda resource_url: fetch_metamap_resource(
            resource_url,
            client_id=resolved_settings.metamap_client_id,
            client_secret=resolved_settings.metamap_client_secret,
        )
    elif resolved_settings.metamap_api_token:
        app.state.metamap_resource_fetcher = lambda resource_url: fetch_metamap_resource(
            resource_url,
            api_token=resolved_settings.metamap_api_token,
            auth_scheme=resolved_settings.metamap_auth_scheme,
        )
    else:
        app.state.metamap_resource_fetcher = None

    def _store_dependency() -> Any:
        return get_store(app)

    def _settings_dependency() -> AppSettings:
        return get_settings(app)

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

    @app.post("/api/v1/metamap/webhooks")
    async def ingest_metamap_webhook(
        request: Request,
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
                if resource_url and app.state.metamap_resource_fetcher is not None:
                    try:
                        resource_payload = app.state.metamap_resource_fetcher(resource_url)
                    except Exception as exc:
                        logger.warning(
                            "MetaMap resource hydration failed: verification_id=%s resource=%s error=%s",
                            verification_id,
                            resource_url,
                            exc,
                        )
                    else:
                        resource_enrichment = extract_validation_enrichment(resource_payload)
                        enrichment = resource_enrichment.merged_with(enrichment)
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
                    applicant_name=enrichment.applicant_name,
                    document_number=enrichment.document_number,
                )
                processing_status = "stored"
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
        items = [
            _maybe_backfill_validation_enrichment(
                app=app,
                validation_store=validation_store,
                validation=item,
            )
            for item in items
        ]
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
        validation = _maybe_backfill_validation_enrichment(
            app=app,
            validation_store=validation_store,
            validation=validation,
        )
        return {"validation": validation.to_dict(include_payload=include_payload)}

    @app.get("/api/v1/internal/metamap/webhook-receipts")
    def list_metamap_webhook_receipts(
        limit: int = Query(50, ge=1, le=200),
        validation_store: Any = Depends(_store_dependency),
        current_client: AuthenticatedClient = Depends(_authenticate_client),
    ) -> dict:
        _ = current_client
        receipts = validation_store.list_metamap_webhook_receipts(limit=limit)
        return {"receipts": receipts}

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


def _maybe_backfill_validation_enrichment(
    *,
    app: FastAPI,
    validation_store: Any,
    validation: Any,
) -> Any:
    if app.state.metamap_resource_fetcher is None:
        return validation
    if not validation.resource_url or not _validation_needs_enrichment(validation):
        return validation

    try:
        resource_payload = app.state.metamap_resource_fetcher(validation.resource_url)
    except Exception as exc:
        logger.warning(
            "MetaMap resource backfill failed: verification_id=%s resource=%s error=%s",
            validation.verification_id,
            validation.resource_url,
            exc,
        )
        return validation

    enrichment = extract_validation_enrichment(resource_payload)
    if not any(
        [
            enrichment.request_number,
            enrichment.loan_number,
            enrichment.amount_raw,
            enrichment.amount_value,
            enrichment.requested_amount_raw,
            enrichment.requested_amount_value,
            enrichment.applicant_name,
            enrichment.document_number,
        ]
    ):
        return validation

    try:
        return validation_store.update_validation_enrichment(
            verification_id=validation.verification_id,
            request_number=enrichment.request_number,
            loan_number=enrichment.loan_number,
            amount_raw=enrichment.amount_raw,
            amount_value=enrichment.amount_value,
            requested_amount_raw=enrichment.requested_amount_raw,
            requested_amount_value=enrichment.requested_amount_value,
            applicant_name=enrichment.applicant_name,
            document_number=enrichment.document_number,
        )
    except Exception as exc:
        logger.warning(
            "MetaMap resource backfill persist failed: verification_id=%s error=%s",
            validation.verification_id,
            exc,
        )
        return validation


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
