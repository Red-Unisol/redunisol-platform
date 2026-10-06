"""Resolve a DNI through the official A13 service; never match on names."""
from __future__ import annotations

import json
import os
import re
import xml.etree.ElementTree as ET

from . import service


def call_ids_by_documento(dni: str, config: service.ArcaConfig, ta: dict) -> list[str]:
    soap = f'''<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a13="{service.A13_NS}">
<soapenv:Header/><soapenv:Body><a13:getIdPersonaListByDocumento>
<token>{service.escape_xml(ta['token'])}</token><sign>{service.escape_xml(ta['sign'])}</sign>
<cuitRepresentada>{config.cuit_representada}</cuitRepresentada>
<documento>{dni}</documento>
</a13:getIdPersonaListByDocumento></soapenv:Body></soapenv:Envelope>'''
    raw = service.http_post_xml(service.PADRON_A13_URL, soap, timeout_seconds=config.timeout_seconds)
    root = ET.fromstring(raw)
    containers = [node for node in root.iter() if service.strip_ns(node.tag) == "idPersonaListReturn"]
    if len(containers) != 1:
        raise service.TechnicalError("A13 did not return idPersonaListReturn.")
    return list(dict.fromkeys((node.text or "").strip() for node in containers[0].iter()
                             if service.strip_ns(node.tag) == "idPersona"))


def valid_identifier(value: str) -> bool:
    if not re.fullmatch(r"[0-9]{11}", value):
        return False
    digit = 11 - sum(int(n) * w for n, w in zip(value[:10], (5, 4, 3, 2, 7, 6, 5, 4, 3, 2))) % 11
    return int(value[-1]) == (0 if digit == 11 else 9 if digit == 10 else digit)


def resolve_documento(dni: str, config: service.ArcaConfig) -> dict:
    result = dict(ok=False, status="technical_error", cuil="", candidate_count=0,
                  ta_cache_should_persist=False, ta_cache_json="", ta_cache_ttl="")
    if not re.fullmatch(r"[0-9]{7,8}", dni):
        return {**result, "status": "invalid_request"}
    try:
        ta, _, persist, ttl = service.get_ta(config)
        result.update(ta_cache_should_persist=persist, ta_cache_json=json.dumps(ta), ta_cache_ttl=ttl)
        identifiers = call_ids_by_documento(dni, config, ta)
        candidates = []
        for identifier in identifiers:
            if not valid_identifier(identifier):
                raise service.TechnicalError("Invalid identifier in A13 response.")
            try:
                response = service.call_get_persona(token=ta["token"], sign=ta["sign"],
                    cuit_representada=config.cuit_representada, id_persona=identifier,
                    timeout_seconds=config.timeout_seconds)
            except Exception as exc:
                if service._is_inactive_key_fault(str(exc)):
                    continue
                raise
            person = service.extract_persona(response)
            if str(person.get("idPersona", "")) != identifier:
                raise service.TechnicalError("Inconsistent person in A13 response.")
            if (str(person.get("tipoClave", "")).strip().upper() in {"CUIT", "CUIL"}
                    and str(person.get("estadoClave", "")).strip().upper() == "ACTIVO"):
                document = str(person.get("numeroDocumento", "")).strip()
                if (not document.isdigit() or document.lstrip("0") != dni.lstrip("0")
                        or identifier[2:10].lstrip("0") != dni.lstrip("0")):
                    raise service.TechnicalError("Inconsistent document in A13 response.")
                candidates.append(identifier)
        result.update(ok=True, candidate_count=len(candidates),
                      status="single" if len(candidates) == 1 else "multiple" if candidates else "none",
                      cuil=candidates[0] if len(candidates) == 1 else "")
    except Exception:
        # Partial lookups must never be interpreted as a unique match.
        result.update(ok=False, status="technical_error", cuil="", candidate_count=0)
    return result


def main() -> int:
    try:
        result = resolve_documento(os.getenv("ARCA_INPUT_DNI", "").strip(), service.load_config_from_env())
    except Exception:
        result = dict(ok=False, status="technical_error", cuil="", candidate_count=0,
                      ta_cache_should_persist=False, ta_cache_json="", ta_cache_ttl="")
    from kestra import Kestra
    Kestra.outputs(result)
    print(json.dumps({k: result[k] for k in ("ok", "status", "candidate_count")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
