from __future__ import annotations

from typing import Any, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field

from . import __version__
from .config import AppSettings, load_settings_from_env
from .db import create_db_engine
from .security import AuthenticatedClient, AuthenticationError
from .store_sql import SqlWorkflowStore
from .workflow import CaseAction, ClientRole, WorkflowError


class MetamapWebhookRequest(BaseModel):
    event_name: str = Field(..., min_length=1)
    verification_id: str = Field(..., min_length=1)
    user_id: Optional[str] = None
    payload: dict = Field(default_factory=dict)


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
    def ingest_metamap_webhook(
        request: MetamapWebhookRequest,
        workflow_store: Any = Depends(_store_dependency),
        settings_value: AppSettings = Depends(_settings_dependency),
        x_metamap_webhook_token: str | None = Header(None, alias="X-Metamap-Webhook-Token"),
    ) -> dict:
        _check_shared_token(
            expected_token=settings_value.webhook_token,
            provided_token=x_metamap_webhook_token,
            missing_detail="Falta X-Metamap-Webhook-Token.",
            invalid_detail="Token de webhook MetaMap invalido.",
        )
        try:
            case = workflow_store.ingest_metamap_event(
                event_name=request.event_name,
                verification_id=request.verification_id,
                payload=request.payload,
                user_id=request.user_id,
            )
        except WorkflowError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        return {"case": case.to_dict()}

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
