from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import base64
import json
import os
import re
from typing import Any
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.serialization import pkcs7


WSAA_URL = "https://wsaa.afip.gov.ar/ws/services/LoginCms"
PADRON_A13_URL = "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA13"
WSAA_NS = "http://wsaa.view.sua.dvadac.desein.afip.gov"
A13_NS = "http://a13.soap.ws.server.puc.sr/"
SOAP_NS = {"soapenv": "http://schemas.xmlsoap.org/soap/envelope/"}
SERVICE_NAME = "ws_sr_padron_a13"
DEFAULT_TIMEOUT_SECONDS = 60.0


@dataclass(frozen=True)
class SearchRequest:
    cuit_cuil: str


@dataclass(frozen=True)
class ArcaConfig:
    cuit_representada: str
    cert_pem: bytes
    key_pem: bytes
    timeout_seconds: float
    cached_ta: dict[str, str] | None


def parse_search_request(payload: Any) -> SearchRequest:
    if isinstance(payload, dict):
        raw_value = (
            payload.get("cuit_cuil")
            or payload.get("cuit")
            or payload.get("cuil")
        )
    elif payload is None:
        raise ValueError("Missing request body.")
    elif isinstance(payload, (list, tuple)):
        raise ValueError("Body must be an object or string.")
    else:
        raw_value = payload

    cuit_cuil = normalize_identifier(raw_value)
    return SearchRequest(cuit_cuil=cuit_cuil)


def load_config_from_env() -> ArcaConfig:
    cuit_representada = normalize_identifier(os.getenv("ARCA_CUIT_REPRESENTADA", ""))
    cert_pem = decode_pem_secret(os.getenv("ARCA_CERT_PEM_B64", ""), "ARCA_CERT_PEM_B64")
    key_pem = decode_pem_secret(os.getenv("ARCA_KEY_PEM_B64", ""), "ARCA_KEY_PEM_B64")
    cached_ta = decode_ta_cache(os.getenv("ARCA_TA_CACHE_JSON", ""))
    timeout_raw = (os.getenv("ARCA_TIMEOUT_SECONDS", "") or "").strip()
    timeout_seconds = float(timeout_raw or DEFAULT_TIMEOUT_SECONDS)

    if not cert_pem or not key_pem:
        raise ValueError("Missing ARCA_CERT_PEM_B64 or ARCA_KEY_PEM_B64.")
    if timeout_seconds <= 0:
        raise ValueError("ARCA_TIMEOUT_SECONDS must be greater than 0.")

    return ArcaConfig(
        cuit_representada=cuit_representada,
        cert_pem=cert_pem,
        key_pem=key_pem,
        timeout_seconds=timeout_seconds,
        cached_ta=cached_ta,
    )


def consultar_padron(request: SearchRequest, config: ArcaConfig) -> dict[str, Any]:
    ta, ta_source, ta_cache_should_persist, ta_cache_ttl = get_ta(config)
    response = call_get_persona(
        token=ta["token"],
        sign=ta["sign"],
        cuit_representada=config.cuit_representada,
        id_persona=request.cuit_cuil,
        timeout_seconds=config.timeout_seconds,
    )
    persona = response.get("persona") if isinstance(response.get("persona"), dict) else {}

    return {
        "ok": True,
        "cuit_cuil": request.cuit_cuil,
        "cuit_representada": config.cuit_representada,
        "ta_expiration_time": ta["expirationTime"],
        "ta_source": ta_source,
        "ta_cache_should_persist": ta_cache_should_persist,
        "ta_cache_ttl": ta_cache_ttl,
        "ta_cache_json": json.dumps(ta, ensure_ascii=True, separators=(",", ":")),
        "response": response,
        "persona": persona,
        "error": "",
    }


def build_error_result(request: SearchRequest | None, error: str) -> dict[str, Any]:
    return {
        "ok": False,
        "cuit_cuil": request.cuit_cuil if request else "",
        "cuit_representada": "",
        "ta_expiration_time": "",
        "ta_source": "",
        "ta_cache_should_persist": False,
        "ta_cache_ttl": "",
        "ta_cache_json": "",
        "response": {},
        "persona": {},
        "error": error,
    }


def build_output_payload(result: dict[str, Any]) -> dict[str, Any]:
    persona = result.get("persona") or {}
    response = result.get("response") or {}

    return {
        "ok": bool(result.get("ok", False)),
        "cuit_cuil": str(result.get("cuit_cuil") or ""),
        "cuit_representada": str(result.get("cuit_representada") or ""),
        "id_persona": str(persona.get("idPersona") or ""),
        "nombre": str(persona.get("nombre") or ""),
        "apellido": str(persona.get("apellido") or ""),
        "razon_social": str(persona.get("razonSocial") or ""),
        "estado_clave": str(persona.get("estadoClave") or ""),
        "tipo_persona": str(persona.get("tipoPersona") or ""),
        "tipo_clave": str(persona.get("tipoClave") or ""),
        "numero_documento": str(persona.get("numeroDocumento") or ""),
        "ta_expiration_time": str(result.get("ta_expiration_time") or ""),
        "ta_source": str(result.get("ta_source") or ""),
        "ta_cache_should_persist": bool(result.get("ta_cache_should_persist", False)),
        "ta_cache_ttl": str(result.get("ta_cache_ttl") or ""),
        "ta_cache_json": str(result.get("ta_cache_json") or ""),
        "persona_json": json.dumps(persona, ensure_ascii=True, separators=(",", ":")),
        "response_json": json.dumps(response, ensure_ascii=True, separators=(",", ":")),
        "error": str(result.get("error") or ""),
    }


def normalize_identifier(value: Any) -> str:
    digits = re.sub(r"\D+", "", str(value or ""))
    if len(digits) != 11:
        raise ValueError("Expected a CUIT/CUIL with 11 digits.")
    return digits


def build_login_ticket_request(service_name: str, now: datetime | None = None) -> bytes:
    current_time = now or datetime.now(timezone.utc)
    generation_time = current_time - timedelta(minutes=5)
    expiration_time = current_time + timedelta(minutes=5)
    unique_id = int(current_time.timestamp())
    payload = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<loginTicketRequest version=\"1.0\">\n"
        "  <header>\n"
        f"    <uniqueId>{unique_id}</uniqueId>\n"
        f"    <generationTime>{generation_time.isoformat()}</generationTime>\n"
        f"    <expirationTime>{expiration_time.isoformat()}</expirationTime>\n"
        "  </header>\n"
        f"  <service>{service_name}</service>\n"
        "</loginTicketRequest>\n"
    )
    return payload.encode("utf-8")


def sign_tra(cert_pem: bytes, key_pem: bytes, tra_xml: bytes) -> bytes:
    certificate = x509.load_pem_x509_certificate(cert_pem)
    private_key = serialization.load_pem_private_key(
        key_pem,
        password=None,
    )
    builder = pkcs7.PKCS7SignatureBuilder().set_data(tra_xml).add_signer(
        certificate,
        private_key,
        hashes.SHA256(),
    )
    return builder.sign(
        serialization.Encoding.DER,
        [pkcs7.PKCS7Options.Binary],
    )


def get_ta(config: ArcaConfig) -> tuple[dict[str, str], str, bool, str]:
    if is_ta_valid(config.cached_ta):
        return config.cached_ta, "cache", False, ""

    tra_xml = build_login_ticket_request(SERVICE_NAME)
    signed_tra = sign_tra(config.cert_pem, config.key_pem, tra_xml)
    signed_tra_b64 = base64.b64encode(signed_tra).decode("ascii")
    ta = request_ta(signed_tra_b64, timeout_seconds=config.timeout_seconds)
    return ta, "wsaa", True, build_ta_cache_ttl(ta["expirationTime"])


def request_ta(signed_tra_b64: str, *, timeout_seconds: float) -> dict[str, str]:
    soap = f"""<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:wsaa="{WSAA_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>{signed_tra_b64}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>
"""
    response_xml = http_post_xml(WSAA_URL, soap, timeout_seconds=timeout_seconds)
    envelope = ET.fromstring(response_xml)
    login_return = envelope.findtext(f".//{{{WSAA_NS}}}loginCmsReturn")
    if not login_return:
        fault = parse_soap_fault(response_xml)
        if fault:
            raise RuntimeError(f"WSAA fault: {fault}")
        raise RuntimeError("WSAA did not return loginCmsReturn.")

    ticket = ET.fromstring(login_return)
    header = ticket.find("header")
    credentials = ticket.find("credentials")
    if header is None or credentials is None:
        raise RuntimeError("WSAA returned an unexpected TA payload.")

    token = credentials.findtext("token")
    sign = credentials.findtext("sign")
    expiration_time = header.findtext("expirationTime")
    if not token or not sign or not expiration_time:
        raise RuntimeError("WSAA returned an incomplete TA.")

    return {
        "token": token,
        "sign": sign,
        "expirationTime": expiration_time,
    }


def call_get_persona(
    *,
    token: str,
    sign: str,
    cuit_representada: str,
    id_persona: str,
    timeout_seconds: float,
) -> dict[str, Any]:
    soap = f"""<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:a13="{A13_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <a13:getPersona>
      <token>{escape_xml(token)}</token>
      <sign>{escape_xml(sign)}</sign>
      <cuitRepresentada>{cuit_representada}</cuitRepresentada>
      <idPersona>{id_persona}</idPersona>
    </a13:getPersona>
  </soapenv:Body>
</soapenv:Envelope>
"""
    response_xml = http_post_xml(PADRON_A13_URL, soap, timeout_seconds=timeout_seconds)
    envelope = ET.fromstring(response_xml)
    persona_return = find_first(
        envelope,
        [
            f".//{{{A13_NS}}}personaReturn",
            ".//personaReturn",
        ],
    )
    if persona_return is None:
        fault = parse_soap_fault(response_xml)
        if fault:
            raise RuntimeError(f"A13 fault: {fault}")
        raise RuntimeError("A13 did not return personaReturn.")
    return xml_to_dict(persona_return)


def http_post_xml(url: str, body: str, *, timeout_seconds: float) -> str:
    request = urllib.request.Request(
        url,
        data=body.encode("utf-8"),
        headers={
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction": '""',
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            return response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        payload = exc.read().decode("utf-8", errors="replace")
        fault = parse_soap_fault(payload)
        if fault:
            raise RuntimeError(fault) from exc
        raise RuntimeError(f"HTTP {exc.code}: {payload}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error against {url}: {exc.reason}") from exc


def parse_soap_fault(xml_text: str) -> str | None:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None

    fault = root.find(".//soapenv:Fault", SOAP_NS)
    if fault is None:
        return None

    return fault.findtext("faultstring") or ET.tostring(
        fault,
        encoding="unicode",
    )


def find_first(element: ET.Element, paths: list[str]) -> ET.Element | None:
    for path in paths:
        found = element.find(path)
        if found is not None:
            return found
    return None


def xml_to_dict(element: ET.Element) -> Any:
    children = list(element)
    if not children:
        return (element.text or "").strip()

    result: dict[str, Any] = {}
    for child in children:
        key = strip_ns(child.tag)
        value = xml_to_dict(child)
        if key in result:
            current_value = result[key]
            if not isinstance(current_value, list):
                result[key] = [current_value]
            result[key].append(value)
        else:
            result[key] = value
    return result


def strip_ns(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def escape_xml(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def decode_pem_secret(value: str, variable_name: str) -> bytes:
    raw_value = (value or "").strip()
    if not raw_value:
        return b""
    if raw_value.startswith("-----BEGIN "):
        return raw_value.encode("utf-8")
    try:
        return base64.b64decode(raw_value.encode("ascii"), validate=True)
    except ValueError as exc:
        raise ValueError(f"{variable_name} is not valid Base64.") from exc


def decode_ta_cache(value: str) -> dict[str, str] | None:
    raw_value = (value or "").strip()
    if not raw_value or raw_value == "null":
        return None

    payload = json.loads(raw_value)
    if not isinstance(payload, dict):
        raise ValueError("ARCA_TA_CACHE_JSON must be a JSON object.")

    token = str(payload.get("token") or "").strip()
    sign = str(payload.get("sign") or "").strip()
    expiration_time = str(payload.get("expirationTime") or "").strip()
    if not token or not sign or not expiration_time:
        return None

    return {
        "token": token,
        "sign": sign,
        "expirationTime": expiration_time,
    }


def is_ta_valid(
    ta: dict[str, str] | None,
    *,
    now: datetime | None = None,
    min_remaining: timedelta = timedelta(minutes=2),
) -> bool:
    if not ta:
        return False

    try:
        expiration_time = datetime.fromisoformat(ta["expirationTime"])
    except (KeyError, TypeError, ValueError):
        return False

    current_time = now or datetime.now(expiration_time.tzinfo or timezone.utc)
    return expiration_time - current_time > min_remaining


def build_ta_cache_ttl(expiration_time: str, *, now: datetime | None = None) -> str:
    expiration_dt = datetime.fromisoformat(expiration_time)
    current_time = now or datetime.now(expiration_dt.tzinfo or timezone.utc)
    remaining = expiration_dt - current_time - timedelta(minutes=1)
    if remaining.total_seconds() <= 0:
        return "PT1S"
    return format_duration_iso8601(remaining)


def format_duration_iso8601(duration: timedelta) -> str:
    total_seconds = max(1, int(duration.total_seconds()))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)

    parts = ["PT"]
    if hours:
        parts.append(f"{hours}H")
    if minutes:
        parts.append(f"{minutes}M")
    if seconds or len(parts) == 1:
        parts.append(f"{seconds}S")
    return "".join(parts)
