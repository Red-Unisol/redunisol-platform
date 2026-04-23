from __future__ import annotations

from dataclasses import dataclass
import json
import os
import re
from typing import Any

import requests


DEFAULT_LOGIN_URL = "https://www.pypdatos.com.ar:8444/apiuser/usuario/login"
DEFAULT_PERSONA_URL = "https://www.pypdatos.com.ar:469/ascocco/rest/serviciospyp/persona/json"
DEFAULT_TIMEOUT_SECONDS = 30.0
TOKEN_CACHE_TTL = "PT1H55M"


@dataclass(frozen=True)
class SearchRequest:
    identifier: str
    tipo: str


@dataclass(frozen=True)
class ConsultaEmpleadorConfig:
    usuario: str
    password: str
    login_url: str
    persona_url: str
    timeout_seconds: float
    cached_token: str


def parse_search_request(payload: Any) -> SearchRequest:
    if isinstance(payload, dict):
        raw_tipo = payload.get("tipo")
        raw_identifier = (
            payload.get("cuit")
            or payload.get("cuil")
            or payload.get("cuit_cuil")
            or payload.get("dni")
            or payload.get("documento")
            or payload.get("nro_doc")
        )
    elif payload is None:
        raise ValueError("Missing request body.")
    elif isinstance(payload, (list, tuple)):
        raise ValueError("Body must be an object or string.")
    else:
        raw_tipo = None
        raw_identifier = payload

    identifier = normalize_identifier(raw_identifier)
    tipo = normalize_tipo(raw_tipo, identifier)
    return SearchRequest(identifier=identifier, tipo=tipo)


def load_config_from_env() -> ConsultaEmpleadorConfig:
    usuario = os.getenv("PYPDATOS_USUARIO", "").strip()
    password = os.getenv("PYPDATOS_PASSWORD", "").strip()
    login_url = os.getenv("PYPDATOS_LOGIN_URL", DEFAULT_LOGIN_URL).strip()
    persona_url = os.getenv("PYPDATOS_PERSONA_URL", DEFAULT_PERSONA_URL).strip()
    cached_token = _decode_token_cache(os.getenv("PYPDATOS_TOKEN_CACHE_JSON", ""))
    timeout_raw = os.getenv("PYPDATOS_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)).strip()
    timeout_seconds = float(timeout_raw or DEFAULT_TIMEOUT_SECONDS)

    if not usuario or not password:
        raise ValueError("Missing PYPDATOS_USUARIO or PYPDATOS_PASSWORD.")
    if not login_url or not persona_url:
        raise ValueError("Missing PYPDATOS_LOGIN_URL or PYPDATOS_PERSONA_URL.")
    if timeout_seconds <= 0:
        raise ValueError("PYPDATOS_TIMEOUT_SECONDS must be greater than 0.")

    return ConsultaEmpleadorConfig(
        usuario=usuario,
        password=password,
        login_url=login_url,
        persona_url=persona_url,
        timeout_seconds=timeout_seconds,
        cached_token=cached_token,
    )


def consultar_empleador(
    request: SearchRequest,
    config: ConsultaEmpleadorConfig,
) -> dict[str, Any]:
    session = requests.Session()
    token = config.cached_token
    token_source = "cache" if token else "login"
    token_cache_should_persist = False

    if not token:
        token = login(session, config)
        token_cache_should_persist = True

    response, status_code = call_persona(session, request, config, token)
    if status_code == 401 and token_source == "cache":
        token = login(session, config)
        token_source = "login"
        token_cache_should_persist = True
        response, status_code = call_persona(session, request, config, token)

    if status_code == 401:
        raise RuntimeError(_extract_message(response) or "Token no valido.")
    if status_code >= 400:
        raise RuntimeError(f"PYPDatos persona failed with HTTP {status_code}: {_extract_message(response)}")

    message = _extract_message(response)
    found = message.lower() != "no se pudo encontrar cuil/documento"

    return {
        "ok": True,
        "found": found,
        "identifier": request.identifier,
        "tipo": request.tipo,
        "token_source": token_source,
        "token_cache_should_persist": token_cache_should_persist,
        "token_cache_ttl": TOKEN_CACHE_TTL if token_cache_should_persist else "",
        "token_cache_json": json.dumps({"token": token}, ensure_ascii=True, separators=(",", ":")),
        "data": response,
        "error": "",
    }


def login(session: requests.Session, config: ConsultaEmpleadorConfig) -> str:
    response = session.post(
        config.login_url,
        json={"login": config.usuario, "password": config.password},
        timeout=config.timeout_seconds,
    )
    payload = _parse_json_response(response)
    if response.status_code >= 400:
        raise RuntimeError(f"PYPDatos login failed with HTTP {response.status_code}: {_extract_message(payload)}")

    token = _extract_token(payload)
    if not token:
        raise RuntimeError("PYPDatos login did not return a token.")
    return token


def call_persona(
    session: requests.Session,
    request: SearchRequest,
    config: ConsultaEmpleadorConfig,
    token: str,
) -> tuple[dict[str, Any], int]:
    response = session.post(
        config.persona_url,
        headers={"x-token": token},
        json={
            "usuario": config.usuario,
            "cuit": request.identifier,
            "tipo": request.tipo,
            "json": "",
        },
        timeout=config.timeout_seconds,
    )
    return _parse_json_response(response), response.status_code


def build_error_result(request: SearchRequest | None, error: str) -> dict[str, Any]:
    return {
        "ok": False,
        "found": False,
        "identifier": request.identifier if request else "",
        "tipo": request.tipo if request else "",
        "token_source": "",
        "token_cache_should_persist": False,
        "token_cache_ttl": "",
        "token_cache_json": "",
        "data": {},
        "error": error,
    }


def build_output_payload(result: dict[str, Any]) -> dict[str, Any]:
    response_payload = {
        "ok": bool(result.get("ok", False)),
        "found": bool(result.get("found", False)),
        "identifier": str(result.get("identifier") or ""),
        "tipo": str(result.get("tipo") or ""),
        "data": result.get("data") or {},
        "error": str(result.get("error") or ""),
        "source": "pypdatos_persona",
    }
    return {
        "ok": response_payload["ok"],
        "found": response_payload["found"],
        "identifier": response_payload["identifier"],
        "tipo": response_payload["tipo"],
        "token_source": str(result.get("token_source") or ""),
        "token_cache_should_persist": bool(result.get("token_cache_should_persist", False)),
        "token_cache_ttl": str(result.get("token_cache_ttl") or ""),
        "token_cache_json": str(result.get("token_cache_json") or ""),
        "data_json": json.dumps(response_payload["data"], ensure_ascii=True, separators=(",", ":")),
        "response_json": json.dumps(response_payload, ensure_ascii=True, separators=(",", ":")),
        "error": response_payload["error"],
    }


def normalize_identifier(value: Any) -> str:
    digits = re.sub(r"\D+", "", str(value or ""))
    if len(digits) not in {7, 8, 11}:
        raise ValueError("Expected a DNI with 7/8 digits or a CUIT/CUIL with 11 digits.")
    return digits


def normalize_tipo(value: Any, identifier: str) -> str:
    raw_tipo = str(value or "").strip().upper()
    if raw_tipo:
        if raw_tipo not in {"M", "S"}:
            raise ValueError("tipo must be 'M' for DNI or 'S' for CUIT/CUIL.")
        return raw_tipo

    if len(identifier) == 11:
        return "S"
    return "M"


def _decode_token_cache(value: str) -> str:
    raw_value = (value or "").strip()
    if not raw_value or raw_value == "null":
        return ""
    payload = json.loads(raw_value)
    if not isinstance(payload, dict):
        raise ValueError("PYPDATOS_TOKEN_CACHE_JSON must be a JSON object.")
    return str(payload.get("token") or "").strip()


def _parse_json_response(response: requests.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError as exc:
        raise RuntimeError(f"PYPDatos returned a non-JSON response: {response.text[:300]}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("PYPDatos returned an unexpected JSON payload.")
    return payload


def _extract_token(payload: dict[str, Any]) -> str:
    direct_candidates = [
        payload.get("token"),
        payload.get("access_token"),
        payload.get("x-token"),
    ]
    for candidate in direct_candidates:
        if candidate:
            return str(candidate).strip()

    for key in ("data", "result", "usuario"):
        nested = payload.get(key)
        if isinstance(nested, dict):
            token = _extract_token(nested)
            if token:
                return token

    return ""


def _extract_message(payload: dict[str, Any]) -> str:
    for key in ("msg", "message", "error"):
        value = payload.get(key)
        if value:
            return str(value)
    return ""
