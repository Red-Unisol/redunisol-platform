from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Any

import requests

from tope_descuento_caja.kestra_webhook_entrypoint import (
    _decodificar_jwt,
    cifrar_permisos,
    construir_payload_permisos,
)

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
    pass


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

    def open(self) -> None:
        session_hash = self._login_cidi()
        self.cidi_cookie = f"CiDi={session_hash}"
        seed = self._get_seed_token()
        self.caja_token = self._exchange_permissions(seed)
        self.opened_at = time.monotonic()
        self.open_count += 1

    def query(self, cuil: str) -> CajaResult:
        self._ensure_session()
        try:
            return self._query_once(cuil)
        except CajaSessionExpiredError:
            self.open()
            return self._query_once(cuil)

    def _ensure_session(self) -> None:
        expired_by_age = (
            self.opened_at > 0
            and time.monotonic() - self.opened_at >= self.max_session_age_seconds
        )
        if not self.cidi_cookie or not self.caja_token or expired_by_age:
            self.open()

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
        )
        if response.status_code >= 400:
            raise CajaTechnicalError(
                f"CIDI rechazo el login con HTTP {response.status_code}."
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise CajaTechnicalError("CIDI devolvio una respuesta no JSON.") from exc
        token = str(payload.get("access_token") or "")
        token_data = _decodificar_jwt(token) if token else {}
        session_hash = (
            payload.get("resultado", {}).get("datos", {}).get("hashSesion")
            or token_data.get("session_hash")
            or ""
        )
        if not session_hash:
            raise CajaTechnicalError("CIDI no devolvio hashSesion.")
        return str(session_hash)

    def _get_seed_token(self) -> str:
        response = self._request(
            "get",
            f"{self.caja_base_url}/api/security/login",
            headers=self._headers(token="", referer="/login"),
        )
        if response.status_code >= 400:
            raise CajaTechnicalError(
                f"Caja rechazo el inicio de sesion con HTTP {response.status_code}."
            )
        token = response.headers.get("authorization", "")
        if not token:
            raise CajaTechnicalError("Caja no devolvio el seed token.")
        return token

    def _exchange_permissions(self, seed: str) -> str:
        payload = construir_payload_permisos(seed)
        if self.caja_user_type_id.isdigit() and isinstance(payload, dict):
            payload["idTipoUsuario"] = int(self.caja_user_type_id)
        encrypted = cifrar_permisos(payload, self.caja_encrypt_password)
        if not encrypted:
            raise CajaTechnicalError("No se pudo cifrar el payload de permisos.")
        response = self._request(
            "post",
            f"{self.caja_base_url}/api/security/permissions",
            headers=self._headers(token=seed),
            json={"body": encrypted},
        )
        if response.status_code >= 400:
            raise CajaTechnicalError(
                f"Caja rechazo los permisos con HTTP {response.status_code}."
            )
        token = response.headers.get("authorization", "")
        if not token:
            raise CajaTechnicalError("Caja no devolvio token de sesion.")
        return token

    def _post_encrypted(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        encrypted = cifrar_permisos(payload, self.caja_encrypt_password)
        if not encrypted:
            raise CajaTechnicalError(f"No se pudo cifrar el body para {path}.")
        response = self._request(
            "post",
            f"{self.caja_base_url}{path}",
            headers=self._headers(token=self.caja_token),
            json={"body": encrypted},
        )
        text = _decode_response(response)
        if response.status_code in {401, 403}:
            raise CajaSessionExpiredError(
                f"Caja rechazo la sesion con HTTP {response.status_code}."
            )
        if response.status_code == 429:
            raise CajaRateLimitedError("Caja respondio HTTP 429.")
        if response.status_code >= 400:
            if _is_person_not_found(text):
                raise CajaPersonNotFoundError(_short(text))
            raise CajaTechnicalError(f"Caja respondio HTTP {response.status_code}: {_short(text)}")
        try:
            value = json.loads(text)
        except ValueError as exc:
            raise CajaTechnicalError(f"Caja devolvio una respuesta no JSON: {_short(text)}") from exc
        if not isinstance(value, dict):
            raise CajaTechnicalError("Caja devolvio un objeto invalido.")
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

    def _request(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        try:
            return self.http.request(method, url, timeout=self.timeout, **kwargs)
        except requests.RequestException as exc:
            raise CajaTechnicalError(f"Fallo de red contra Caja/CIDI: {exc}") from exc


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
