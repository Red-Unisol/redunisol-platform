from __future__ import annotations

from dataclasses import dataclass
import json
from collections.abc import Callable
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
    lead_source: CatalogItem | None


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


def normalize_business_input(
    payload: dict[str, Any],
    *,
    employment_status_resolver: Callable[[Any], CatalogItem] | None = None,
    require_lead_source: bool = True,
) -> NormalizedInput:
    if not isinstance(payload, dict):
        raise ValueError("El payload debe ser un objeto JSON o un body de formulario parseable.")

    cuil_digits, cuil_formatted = normalize_cuil(_first(payload, ["cuil"]))
    raw_lead_source = _optional_first(
        payload,
        ["lead_source", "origen_lead", "origen_formulario", "origenFormulario"],
    )
    resolve_employment_status = employment_status_resolver or (
        lambda raw_value: SITUACIONES_LABORALES.resolve(raw_value, "employment_status")
    )

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
        employment_status=resolve_employment_status(
            _first(payload, ["employment_status", "situacion_laboral", "Situacion_Laboral"])
        ),
        payment_bank=BANCOS.resolve(
            _first(payload, ["payment_bank", "banco_cobro", "bancoCobroCliente"]),
            "payment_bank",
        ),
        lead_source=_resolve_lead_source(raw_lead_source, require_lead_source=require_lead_source),
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


def _optional_first(payload: dict[str, Any], keys: list[str]) -> Any | None:
    for key in keys:
        if key in payload and str(payload[key]).strip():
            return payload[key]
    return None


def _resolve_lead_source(
    raw_value: Any | None,
    *,
    require_lead_source: bool,
) -> CatalogItem | None:
    if raw_value is None:
        if require_lead_source:
            raise ValueError("Falta el campo requerido: lead_source.")
        return None

    return ORIGENES_LEAD.resolve(raw_value, "lead_source")
