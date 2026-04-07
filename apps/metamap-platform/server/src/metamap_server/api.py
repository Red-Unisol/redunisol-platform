from __future__ import annotations

import json
import logging
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from pydantic import BaseModel, Field

from . import __version__
from .config import AppSettings, load_settings_from_env
from .db import create_db_engine
from .security import (
    AuthenticatedClient,
    AuthenticationError,
    verify_metamap_signature,
)
from .store_sql import SqlWorkflowStore
from .workflow import CaseAction, ClientRole, WorkflowError


logger = logging.getLogger(__name__)


class CaseActionRequest(BaseModel):
    role: ClientRole
    action: CaseAction
    actor: str = Field(..., min_length=1)
    notes: Optional[str] = None
    external_transfer_id: Optional[str] = None


class BankCallbackRequest(BaseModel):
    payload: dict = Field(default_factory=dict)


def get_store(app: FastAPI) -> Any:
    return app.state.workflow_store


def get_settings(app: FastAPI) -> AppSettings:
    return app.state.settings


def create_app(
    settings: AppSettings | None = None,
    store: Any | None = None,
) -> FastAPI:
    resolved_settings = settings or load_settings_from_env()
    app = FastAPI(title="MetaMap Platform Server", version=__version__)
    app.state.settings = resolved_settings

    if store is None:
        engine = create_db_engine(resolved_settings.database_url)
        sql_store = SqlWorkflowStore(engine)
        sql_store.init_schema()
        sql_store.bootstrap_clients(resolved_settings.bootstrap_clients)
        app.state.workflow_store = sql_store
    else:
        app.state.workflow_store = store

    def _store_dependency() -> Any:
        return get_store(app)

    def _settings_dependency() -> AppSettings:
        return get_settings(app)

    def _authenticate_client(
        x_client_id: str | None = Header(None, alias="X-Client-Id"),
        x_client_secret: str | None = Header(None, alias="X-Client-Secret"),
        workflow_store: Any = Depends(_store_dependency),
    ) -> AuthenticatedClient:
        if not x_client_id or not x_client_secret:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Faltan X-Client-Id o X-Client-Secret.",
            )
        try:
            return workflow_store.authenticate_client(x_client_id, x_client_secret)
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
        }

    @app.post("/api/v1/metamap/webhooks")
    async def ingest_metamap_webhook(
        request: Request,
        workflow_store: Any = Depends(_store_dependency),
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
        processing_status = "received"
        processing_error: str | None = None
        case = None

        try:
            parsed_payload = _parse_metamap_webhook_body(raw_body)
            event_name = _extract_metamap_event_name(parsed_payload)
            resource_url = _extract_metamap_resource_url(parsed_payload)
            verification_id = _extract_verification_id_from_resource(resource_url)

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

            if event_name.lower() == "verification_completed":
                if not resource_url:
                    processing_status = "invalid_payload"
                    processing_error = "resource es obligatorio para verification_completed."
                    raise WorkflowError(processing_error)
                if not verification_id:
                    processing_status = "invalid_payload"
                    processing_error = "No se pudo derivar verification_id desde resource."
                    raise WorkflowError(processing_error)

                case = workflow_store.ingest_metamap_event(
                    event_name=event_name,
                    verification_id=verification_id,
                    resource_url=resource_url,
                    payload=parsed_payload,
                    user_id=_extract_metamap_user_id(parsed_payload),
                )
                processing_status = "enqueued"
            else:
                processing_status = "ignored"
        except WorkflowError as exc:
            if processing_error is None:
                processing_status = "invalid_payload"
                processing_error = str(exc)
            _record_metamap_webhook_receipt(
                workflow_store=workflow_store,
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
                workflow_store=workflow_store,
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
            workflow_store=workflow_store,
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
            "verification_id": verification_id,
            "resource_url": resource_url,
            "case": case.to_dict() if case else None,
        }

    @app.get("/api/v1/queues/{role}")
    def list_queue(
        role: ClientRole,
        workflow_store: Any = Depends(_store_dependency),
        current_client: AuthenticatedClient = Depends(_authenticate_client),
    ) -> dict:
        _ensure_role_access(current_client, role)
        cases = workflow_store.list_cases_for_role(role)
        return {"role": role.value, "cases": [case.to_dict() for case in cases]}

    @app.get("/api/v1/cases/{case_id}")
    def get_case(
        case_id: str,
        workflow_store: Any = Depends(_store_dependency),
        current_client: AuthenticatedClient = Depends(_authenticate_client),
    ) -> dict:
        _ = current_client
        try:
            case = workflow_store.get_case(case_id)
        except WorkflowError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        return {"case": case.to_dict()}

    @app.post("/api/v1/cases/{case_id}/actions")
    def apply_case_action(
        case_id: str,
        request: CaseActionRequest,
        workflow_store: Any = Depends(_store_dependency),
        current_client: AuthenticatedClient = Depends(_authenticate_client),
    ) -> dict:
        _ensure_role_access(current_client, request.role)
        try:
            case = workflow_store.apply_case_action(
                case_id=case_id,
                role=request.role,
                action=request.action,
                actor=request.actor,
                notes=request.notes,
                external_transfer_id=request.external_transfer_id,
            )
        except WorkflowError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        return {"case": case.to_dict()}

    @app.post("/api/v1/bank/callbacks/aviso-transferencia-cbu")
    def aviso_transferencia_cbu(
        request: BankCallbackRequest,
        workflow_store: Any = Depends(_store_dependency),
        settings_value: AppSettings = Depends(_settings_dependency),
        x_bank_callback_token: str | None = Header(None, alias="X-Bank-Callback-Token"),
    ) -> dict:
        _check_shared_token(
            expected_token=settings_value.bank_callback_token,
            provided_token=x_bank_callback_token,
            missing_detail="Falta X-Bank-Callback-Token.",
            invalid_detail="Token de callback bancario invalido.",
        )
        return _register_bank_callback(
            workflow_store=workflow_store,
            callback_type="aviso_transferencia_cbu",
            payload=request.payload,
        )

    @app.post("/api/v1/bank/callbacks/aviso-reversa-debito")
    def aviso_reversa_debito(
        request: BankCallbackRequest,
        workflow_store: Any = Depends(_store_dependency),
        settings_value: AppSettings = Depends(_settings_dependency),
        x_bank_callback_token: str | None = Header(None, alias="X-Bank-Callback-Token"),
    ) -> dict:
        _check_shared_token(
            expected_token=settings_value.bank_callback_token,
            provided_token=x_bank_callback_token,
            missing_detail="Falta X-Bank-Callback-Token.",
            invalid_detail="Token de callback bancario invalido.",
        )
        return _register_bank_callback(
            workflow_store=workflow_store,
            callback_type="aviso_reversa_debito",
            payload=request.payload,
        )

    return app


def _register_bank_callback(
    *,
    workflow_store: Any,
    callback_type: str,
    payload: dict,
) -> dict:
    try:
        case, duplicate = workflow_store.register_bank_callback(callback_type, payload)
    except WorkflowError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return {
        "callback_type": callback_type,
        "duplicate": duplicate,
        "case": case.to_dict(),
    }


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


def _ensure_role_access(current_client: AuthenticatedClient, expected_role: ClientRole) -> None:
    if current_client.role != expected_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"El cliente autenticado no puede operar como {expected_role.value}.",
        )


def _check_shared_token(
    *,
    expected_token: str | None,
    provided_token: str | None,
    missing_detail: str,
    invalid_detail: str,
) -> None:
    if expected_token is None:
        return
    if not provided_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=missing_detail)
    if provided_token != expected_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=invalid_detail)


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
    event_name = str(raw_value).strip()
    return event_name or None


def _extract_metamap_resource_url(payload: dict) -> str | None:
    raw_value = payload.get("resource")
    if raw_value is None:
        return None
    resource_url = str(raw_value).strip()
    return resource_url or None


def _extract_verification_id_from_resource(resource_url: str | None) -> str | None:
    if not resource_url:
        return None
    path = urlparse(resource_url).path.rstrip("/")
    if not path:
        return None
    verification_id = path.rsplit("/", 1)[-1].strip()
    return verification_id or None


def _extract_metamap_user_id(payload: dict) -> str | None:
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        return None
    for key in ("userId", "user_id", "userID"):
        raw_value = metadata.get(key)
        if raw_value is None:
            continue
        user_id = str(raw_value).strip()
        if user_id:
            return user_id
    return None
