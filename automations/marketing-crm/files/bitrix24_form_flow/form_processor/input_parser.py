from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any
from urllib.parse import parse_qs

from .catalogs import BANCOS, ORIGENES_LEAD, PROVINCIAS, SITUACIONES_LABORALES, CatalogItem
from .normalization import normalize_cuil, normalize_email, normalize_full_name, normalize_whatsapp


@dataclass(frozen=True)
class NormalizedInput:
    full_name: str
    email: str
    whatsapp: str
    cuil_digits: str
    cuil_formatted: str
    province: CatalogItem
    employment_status: CatalogItem
    payment_bank: CatalogItem
    lead_source: CatalogItem


def parse_body(body: str, content_type: str | None = None) -> dict[str, Any]:
    body = body or ""
    content_type = (content_type or "").lower()

    if "application/json" in content_type:
        return _parse_json_body(body)

    if "application/x-www-form-urlencoded" in content_type:
        return _parse_form_body(body)

    trimmed = body.lstrip()
    if trimmed.startswith("{"):
        return _parse_json_body(body)

    return _parse_form_body(body)


def normalize_business_input(payload: dict[str, Any]) -> NormalizedInput:
    if not isinstance(payload, dict):
        raise ValueError("El payload debe ser un objeto JSON o un body de formulario parseable.")

    cuil_digits, cuil_formatted = normalize_cuil(_first(payload, ["cuil"]))

    return NormalizedInput(
        full_name=normalize_full_name(_first(payload, ["full_name", "nombre_completo", "name"])),
        email=normalize_email(_first(payload, ["email", "correo"])),
        whatsapp=normalize_whatsapp(_first(payload, ["whatsapp", "telefono", "phone"])),
        cuil_digits=cuil_digits,
        cuil_formatted=cuil_formatted,
        province=PROVINCIAS.resolve(
            _first(payload, ["province", "provincia", "ProvinciaDeContacto"]),
            "province",
        ),
        employment_status=SITUACIONES_LABORALES.resolve(
            _first(payload, ["employment_status", "situacion_laboral", "Situacion_Laboral"]),
            "employment_status",
        ),
        payment_bank=BANCOS.resolve(
            _first(payload, ["payment_bank", "banco_cobro", "bancoCobroCliente"]),
            "payment_bank",
        ),
        lead_source=ORIGENES_LEAD.resolve(
            _first(payload, ["lead_source", "origen_lead", "origen_formulario", "origenFormulario"]),
            "lead_source",
        ),
    )


def _parse_json_body(body: str) -> dict[str, Any]:
    if not body.strip():
        raise ValueError("No se recibio ningun body.")
    parsed = json.loads(body)
    if not isinstance(parsed, dict):
        raise ValueError("El body JSON debe ser un objeto.")
    return parsed


def _parse_form_body(body: str) -> dict[str, str]:
    if not body.strip():
        raise ValueError("No se recibio ningun body.")
    parsed = parse_qs(body, keep_blank_values=True)
    return {key: values[-1] if values else "" for key, values in parsed.items()}


def _first(payload: dict[str, Any], keys: list[str]) -> Any:
    for key in keys:
        if key in payload and str(payload[key]).strip():
            return payload[key]
    raise ValueError(f"Falta el campo requerido: {keys[0]}.")
