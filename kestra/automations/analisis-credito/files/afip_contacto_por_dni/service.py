from __future__ import annotations

from dataclasses import dataclass
import json
import os
import re
from typing import Any
from urllib.parse import urljoin

import requests


DEFAULT_BASE_URL = "https://servicioscf.afip.gob.ar/publico/crmcit/"
DEFAULT_TIMEOUT_SECONDS = 60.0
DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
DEFAULT_TIPO_DOC = "96"


@dataclass(frozen=True)
class SearchRequest:
    dni: str
    tipo_doc: str


@dataclass(frozen=True)
class AfipConfig:
    base_url: str
    timeout_seconds: float
    user_agent: str


def parse_search_request(payload: Any) -> SearchRequest:
    if isinstance(payload, dict):
        dni = _normalize_digits(payload.get("dni") or payload.get("nro_doc") or payload.get("documento"))
        tipo_doc = _normalize_digits(payload.get("tipo_doc") or payload.get("tipoDoc")) or DEFAULT_TIPO_DOC
    elif payload is None:
        raise ValueError("Missing request body.")
    elif isinstance(payload, (list, tuple)):
        raise ValueError("Body must be an object, number or string.")
    else:
        dni = _normalize_digits(payload)
        tipo_doc = DEFAULT_TIPO_DOC

    if not dni:
        raise ValueError("Field 'dni' is required.")

    return SearchRequest(dni=dni, tipo_doc=tipo_doc)


def load_config_from_env() -> AfipConfig:
    base_url = (os.getenv("AFIP_CRM_BASE_URL", DEFAULT_BASE_URL) or DEFAULT_BASE_URL).strip()
    timeout_raw = (os.getenv("AFIP_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)) or str(DEFAULT_TIMEOUT_SECONDS)).strip()
    user_agent = (os.getenv("AFIP_USER_AGENT", DEFAULT_USER_AGENT) or DEFAULT_USER_AGENT).strip()

    if not base_url:
        raise ValueError("Missing AFIP_CRM_BASE_URL.")
    if not user_agent:
        raise ValueError("Missing AFIP_USER_AGENT.")

    timeout_seconds = float(timeout_raw)
    if timeout_seconds <= 0:
        raise ValueError("AFIP_TIMEOUT_SECONDS must be greater than 0.")

    return AfipConfig(base_url=_ensure_trailing_slash(base_url), timeout_seconds=timeout_seconds, user_agent=user_agent)


def consultar_contacto(
    request: SearchRequest,
    config: AfipConfig,
    *,
    session: requests.Session | None = None,
) -> dict[str, Any]:
    http = session or requests.Session()
    http.headers.update({
        "User-Agent": config.user_agent,
        "Accept": "*/*",
    })

    consulta_url = urljoin(config.base_url, "consulta.aspx")
    consulta_response = http.get(consulta_url, timeout=config.timeout_seconds)
    _ensure_success(consulta_response, "Load AFIP consulta.aspx")

    api_url = urljoin(config.base_url, "data/apis/Contactos.aspx/GetContactoPorTipoDocumento")
    api_response = http.get(
        api_url,
        params={"tipoDoc": request.tipo_doc, "nroDoc": request.dni},
        headers={
            "Referer": consulta_url,
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/json; charset=utf-8",
        },
        timeout=config.timeout_seconds,
    )
    _ensure_success(api_response, "Query AFIP contact API")

    payload = _parse_api_payload(api_response)
    rows = payload.get("valor") or []
    if not isinstance(rows, list):
        raise RuntimeError("AFIP response field 'valor' is not a list.")

    if not rows:
        return _build_result(
            ok=True,
            found=False,
            dni=request.dni,
            tipo_doc=request.tipo_doc,
            cuil="",
            nombre="",
            raw_response=payload,
            error="",
        )

    first_row = rows[0] if isinstance(rows[0], dict) else {}
    cuil = _normalize_digits(first_row.get("cuil"))
    nombre = _normalize_name(first_row.get("denominacion"))
    return _build_result(
        ok=True,
        found=True,
        dni=request.dni,
        tipo_doc=request.tipo_doc,
        cuil=cuil,
        nombre=nombre,
        raw_response=payload,
        error="",
    )


def build_error_result(request: SearchRequest | None, error: str) -> dict[str, Any]:
    safe_request = request or SearchRequest(dni="", tipo_doc=DEFAULT_TIPO_DOC)
    return _build_result(
        ok=False,
        found=False,
        dni=safe_request.dni,
        tipo_doc=safe_request.tipo_doc,
        cuil="",
        nombre="",
        raw_response={},
        error=error,
    )


def build_output_payload(result: dict[str, Any]) -> dict[str, Any]:
    response_payload = {
        "ok": bool(result.get("ok", False)),
        "found": bool(result.get("found", False)),
        "dni": str(result.get("dni") or ""),
        "tipo_doc": str(result.get("tipo_doc") or ""),
        "cuil": str(result.get("cuil") or ""),
        "nombre": str(result.get("nombre") or ""),
        "error": str(result.get("error") or ""),
        "source": "afip_crmcit",
    }
    return {
        "ok": response_payload["ok"],
        "found": response_payload["found"],
        "dni": response_payload["dni"],
        "tipo_doc": response_payload["tipo_doc"],
        "cuil": response_payload["cuil"],
        "nombre": response_payload["nombre"],
        "response_json": json.dumps(response_payload, ensure_ascii=True, separators=(",", ":")),
        "raw_response_json": json.dumps(result.get("raw_response") or {}, ensure_ascii=True, separators=(",", ":")),
        "error": response_payload["error"],
    }


def _parse_api_payload(response: requests.Response) -> dict[str, Any]:
    response_json = response.json()
    if not isinstance(response_json, dict):
        raise RuntimeError("AFIP API returned a non-object JSON payload.")

    wrapped = response_json.get("d")
    if isinstance(wrapped, str):
        payload = json.loads(wrapped)
    elif isinstance(wrapped, dict):
        payload = wrapped
    else:
        raise RuntimeError("AFIP API response does not contain field 'd'.")

    if not isinstance(payload, dict):
        raise RuntimeError("AFIP API field 'd' is not a JSON object.")
    if str(payload.get("result") or "").lower() != "success":
        raise RuntimeError(f"AFIP API returned result={payload.get('result')!r}.")

    return payload


def _build_result(
    *,
    ok: bool,
    found: bool,
    dni: str,
    tipo_doc: str,
    cuil: str,
    nombre: str,
    raw_response: dict[str, Any],
    error: str,
) -> dict[str, Any]:
    return {
        "ok": ok,
        "found": found,
        "dni": dni,
        "tipo_doc": tipo_doc,
        "cuil": cuil,
        "nombre": nombre,
        "raw_response": raw_response,
        "error": error,
    }


def _ensure_success(response: requests.Response, action: str) -> None:
    if response.status_code >= 400:
        preview = (response.text or "")[:500]
        raise RuntimeError(f"{action} failed with {response.status_code}: {preview}")


def _normalize_digits(value: Any) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def _normalize_name(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def _ensure_trailing_slash(value: str) -> str:
    return value if value.endswith("/") else value + "/"