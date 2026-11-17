from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4

import requests

from tope_descuento_caja.kestra_webhook_entrypoint import (
    _decodificar_jwt,
    cifrar_permisos,
    construir_payload_permisos,
)
from .diagnostics import emit, redact, response_diagnostic

SCOPE_CIDI = (
    "cidi.api.login cidi.api.actividad.cuenta cidi.api.buscador "
    "cidi.api.buscador.ciudadano cidi.api.ciudadano "
    "cidi.api.ciudadano.alta cidi.api.ciudadano.misdatos "
    "cidi.api.ciudadano.relaciones cidi.api.comunicaciones "
    "cidi.api.documentacion offline_access cidi.api.credenciales "
    "cidi.api.chatbot"
)


class CajaError(RuntimeError):
    pass


class CajaTechnicalError(CajaError):
    def __init__(self, message: str, *, diagnostics: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.diagnostics = diagnostics or {}


class CajaRateLimitedError(CajaTechnicalError):
    pass


class CajaSessionExpiredError(CajaTechnicalError):
    pass


class CajaPersonNotFoundError(CajaError):
    pass


@dataclass(frozen=True)
class CajaResult:
    cuil: str
    nombre: str
    apellido: str
    disponible: float
    tope_descuento: float


class CajaSession:
    def __init__(
        self,
        *,
        cidi_base_url: str,
        cidi_client_id: str,
        cidi_client_secret: str,
        cidi_user: str,
        cidi_password: str,
        caja_base_url: str,
        caja_encrypt_password: str,
        caja_user_type_id: str = "",
        timeout: float = 30,
        max_session_age_seconds: float = 2400,
        session: requests.Session | None = None,
    ) -> None:
        self.cidi_base_url = cidi_base_url.rstrip("/")
        self.cidi_client_id = cidi_client_id or "cidi"
        self.cidi_client_secret = cidi_client_secret
        self.cidi_user = cidi_user
        self.cidi_password = cidi_password
        self.caja_base_url = caja_base_url.rstrip("/")
        self.caja_encrypt_password = caja_encrypt_password
        self.caja_user_type_id = caja_user_type_id
        self.timeout = timeout
        self.max_session_age_seconds = max_session_age_seconds
        self.http = session or requests.Session()
        self.cidi_cookie = ""
        self.caja_token = ""
        self.opened_at = 0.0
        self.open_count = 0
        self.open_attempts = 0
        self._sensitive_tokens: set[str] = set()
        self._current_cuil = ""
        self._current_encrypted = ""
        self._request_context: dict[str, Any] = {}

    @classmethod
    def from_env(cls) -> "CajaSession":
        return cls(
            cidi_base_url=_required_env("CIDI_BASE_URL"),
            cidi_client_id=os.getenv("CIDI_CLIENT_ID", "cidi").strip(),
            cidi_client_secret=os.getenv("CIDI_CLIENT_SECRET", "").strip(),
            cidi_user=_required_env("CIDI_USER"),
            cidi_password=_required_env("CIDI_PASS"),
            caja_base_url=_required_env("CAJA_BASE_URL"),
            caja_encrypt_password=_required_env("CAJA_ENCRYPT_PASS"),
            caja_user_type_id=os.getenv("CAJA_ID_TIPO_USUARIO", "").strip(),
            timeout=float(os.getenv("CAJA_TIMEOUT_SECONDS", "30")),
            max_session_age_seconds=float(
                os.getenv("CAJA_SESSION_MAX_AGE_SECONDS", "2400")
            ),
        )

    def open(self, *, reason: str = "manual") -> None:
        self.open_attempts += 1
        age = round(time.monotonic() - self.opened_at, 3) if self.opened_at else None
        emit("caja_session_open_started", reason=reason, open_attempt=self.open_attempts,
             session_open_count=self.open_count, session_age_seconds=age)
        try:
            session_hash = self._login_cidi()
            self.cidi_cookie = f"CiDi={session_hash}"
            seed = self._get_seed_token()
            self.caja_token = self._exchange_permissions(seed)
        except CajaTechnicalError as exc:
            emit("caja_session_open_failed", reason=reason, open_attempt=self.open_attempts,
                 error=str(exc), diagnostic_id=exc.diagnostics.get("diagnostic_id"))
            raise
        self.opened_at = time.monotonic()
        self.open_count += 1
        emit("caja_session_open_completed", reason=reason, open_attempt=self.open_attempts,
             session_open_count=self.open_count)

    def query(self, cuil: str) -> CajaResult:
        self._current_cuil = cuil
        self._ensure_session()
        try:
            return self._query_once(cuil)
        except CajaSessionExpiredError:
            self.open(reason="http_401_403")
            return self._query_once(cuil)

    def _ensure_session(self) -> None:
        expired_by_age = (
            self.opened_at > 0
            and time.monotonic() - self.opened_at >= self.max_session_age_seconds
        )
        if not self.cidi_cookie or not self.caja_token or expired_by_age:
            self.open(reason="max_age" if expired_by_age else "initial")

    def _query_once(self, cuil: str) -> CajaResult:
        persona = self._post_encrypted(
            "/api/utilidades/obtener-datos-persona", {"cuil": cuil}
        )
        cupo = self._post_encrypted(
            "/api/transaccion/obtener-haber-disponible", {"cuil": cuil}
        )
        return CajaResult(
            cuil=cuil,
            nombre=str(persona.get("nombre") or ""),
            apellido=str(persona.get("apellido") or ""),
            disponible=_to_float(cupo.get("balance")),
            tope_descuento=_to_float(cupo.get("discountLimit")),
        )

    def _login_cidi(self) -> str:
        response = self._request(
            "post",
            f"{self.cidi_base_url}/api/cidi/ciudadano/login/oauth/v1",
            data={
                "grant_type": "password",
                "client_id": self.cidi_client_id,
                "client_secret": self.cidi_client_secret,
                "username": self.cidi_user,
                "password": self.cidi_password,
                "scope": SCOPE_CIDI,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            stage="cidi_login",
        )
        if response.status_code >= 400:
            raise self._response_error(
                CajaTechnicalError, f"CIDI rechazo el login con HTTP {response.status_code}.", response,
            )
        try:
            payload = response.json()
        except ValueError:
            raise self._response_error(
                CajaTechnicalError, "CIDI devolvio una respuesta no JSON.", response,
            ) from None
        if not isinstance(payload, dict):
            raise self._response_error(CajaTechnicalError, "CIDI devolvio un objeto invalido.", response)
        token = str(payload.get("access_token") or "")
        self._sensitive_tokens.update(filter(None, (token, str(payload.get("refresh_token") or ""))))
        token_data = _decodificar_jwt(token) if token else {}
        result = payload.get("resultado")
        data = result.get("datos") if isinstance(result, dict) else None
        session_hash = (
            (data.get("hashSesion") if isinstance(data, dict) else None)
            or (token_data.get("session_hash") if isinstance(token_data, dict) else None)
            or ""
        )
        if not session_hash:
            raise self._response_error(CajaTechnicalError, "CIDI no devolvio hashSesion.", response)
        self._sensitive_tokens.add(str(session_hash))
        return str(session_hash)

    def _get_seed_token(self) -> str:
        response = self._request(
            "get",
            f"{self.caja_base_url}/api/security/login",
            headers=self._headers(token="", referer="/login"),
            stage="caja_seed_login",
        )
        if response.status_code >= 400:
            raise self._response_error(
                CajaTechnicalError, f"Caja rechazo el inicio de sesion con HTTP {response.status_code}.", response,
            )
        token = response.headers.get("authorization", "")
        if not token:
            raise self._response_error(CajaTechnicalError, "Caja no devolvio el seed token.", response)
        self._sensitive_tokens.add(token)
        return token

    def _exchange_permissions(self, seed: str) -> str:
        payload = construir_payload_permisos(seed)
        if self.caja_user_type_id.isdigit() and isinstance(payload, dict):
            payload["idTipoUsuario"] = int(self.caja_user_type_id)
        encrypted = cifrar_permisos(payload, self.caja_encrypt_password)
        if not encrypted:
            raise CajaTechnicalError("No se pudo cifrar el payload de permisos.")
        self._current_encrypted = encrypted
        response = self._request(
            "post",
            f"{self.caja_base_url}/api/security/permissions",
            headers=self._headers(token=seed),
            json={"body": encrypted},
            stage="caja_permissions",
        )
        if response.status_code >= 400:
            raise self._response_error(
                CajaTechnicalError, f"Caja rechazo los permisos con HTTP {response.status_code}.", response,
            )
        token = response.headers.get("authorization", "")
        if not token:
            raise self._response_error(CajaTechnicalError, "Caja no devolvio token de sesion.", response)
        self._sensitive_tokens.add(token)
        return token

    def _post_encrypted(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        encrypted = cifrar_permisos(payload, self.caja_encrypt_password)
        if not encrypted:
            raise CajaTechnicalError(f"No se pudo cifrar el body para {path}.")
        self._current_encrypted = encrypted
        response = self._request(
            "post",
            f"{self.caja_base_url}{path}",
            headers=self._headers(token=self.caja_token),
            json={"body": encrypted},
            stage="caja_persona" if "datos-persona" in path else "caja_disponible",
        )
        text = _decode_response(response)
        if response.status_code in {401, 403}:
            raise self._response_error(
                CajaSessionExpiredError, f"Caja rechazo la sesion con HTTP {response.status_code}.", response,
            )
        if response.status_code == 429:
            raise self._response_error(CajaRateLimitedError, "Caja respondio HTTP 429.", response)
        if response.status_code >= 400:
            if _is_person_not_found(text):
                raise CajaPersonNotFoundError(_short(redact(text, self._secrets())))
            raise self._response_error(CajaTechnicalError, f"Caja respondio HTTP {response.status_code}.", response)
        try:
            value = json.loads(text)
        except ValueError:
            raise self._response_error(CajaTechnicalError, "Caja devolvio una respuesta no JSON.", response) from None
        if not isinstance(value, dict):
            raise self._response_error(CajaTechnicalError, "Caja devolvio un objeto invalido.", response)
        return value

    def _headers(self, *, token: str, referer: str = "/") -> dict[str, str]:
        headers = {
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "Cookie": self.cidi_cookie,
            "Origin": self.caja_base_url,
            "Referer": f"{self.caja_base_url}{referer}",
        }
        if token:
            headers["authorization"] = token
        return headers

    def _secrets(self) -> set[str]:
        cookies = getattr(self.http, "cookies", None)
        cookie_values = set(cookies.values()) if cookies is not None else set()
        return self._sensitive_tokens | cookie_values | {
            self.cidi_user, self.cidi_password, self.cidi_client_secret,
            self.caja_encrypt_password, self.cidi_cookie, self.caja_token,
            self._current_cuil, self._current_encrypted,
        }

    def _response_error(
        self, error_type: type[CajaTechnicalError], message: str, response: requests.Response,
    ) -> CajaTechnicalError:
        details = response_diagnostic(response, self._request_context, self._secrets())
        emit("caja_http_error", **details)
        body = details["response_body"]
        reason = json.dumps(body, ensure_ascii=True) if isinstance(body, (dict, list)) else str(body)
        return error_type(f"{message} {reason[:1000]}", diagnostics=details)

    def _request(self, method: str, url: str, *, stage: str, **kwargs: Any) -> requests.Response:
        started = time.monotonic()
        self._request_context = {
            "stage": stage, "method": method.upper(), "path": urlsplit(url).path,
            "session_open_count": self.open_count, "open_attempt": self.open_attempts,
        }
        try:
            response = self.http.request(method, url, timeout=self.timeout, **kwargs)
        except requests.RequestException as exc:
            details = {
                "diagnostic_id": uuid4().hex,
                **self._request_context, "exception_type": type(exc).__name__,
                "message": redact(str(exc), self._secrets()),
                "duration_ms": round((time.monotonic() - started) * 1000, 3),
            }
            emit("caja_network_error", **details)
            # The original exception can contain credentials in a URL/header.
            raise CajaTechnicalError(
                f"Fallo de red contra Caja/CIDI: {details['message']}", diagnostics=details,
            ) from None
        self._request_context["duration_ms"] = round((time.monotonic() - started) * 1000, 3)
        return response


def _decode_response(response: requests.Response) -> str:
    content_type = (response.headers.get("content-type") or "").lower()
    if "charset=" in content_type:
        charset = content_type.split("charset=", 1)[1].split(";", 1)[0].strip()
        try:
            return response.content.decode(charset, errors="replace")
        except LookupError:
            pass
    for charset in ("utf-8", "cp1252", "latin-1"):
        try:
            return response.content.decode(charset)
        except UnicodeDecodeError:
            continue
    return response.text


def _is_person_not_found(value: str) -> bool:
    normalized = " ".join(value.lower().split())
    normalized = normalized.replace("ó", "o")
    return "no se encontr" in normalized and "la persona" in normalized


def _short(value: str, limit: int = 300) -> str:
    return " ".join(str(value or "").split())[:limit]


def _to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(f"Falta la variable {name}.")
    return value
