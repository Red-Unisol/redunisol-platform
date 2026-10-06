from __future__ import annotations

from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import re
import sqlite3
from typing import Any
import unicodedata

from consulta_quiebra_credix.service import (
    CredixConfig,
    SearchRequest,
    build_output_payload,
    cached_result_if_fresh,
    consultar_tabla,
)
from consulta_quiebra_credix.sqlite_cache import write_cache_entries


@dataclass(frozen=True)
class ProcessedCredixResult:
    status: str
    ok: bool
    checked_at: str
    source: str
    employers: list[dict[str, Any]]
    qualifies_issn: bool
    output: dict[str, Any]


def normalize_label(value: Any) -> str:
    value = "".join(
        character
        for character in unicodedata.normalize("NFD", str(value or "").upper())
        if unicodedata.category(character) != "Mn"
    )
    return " ".join(re.sub(r"[^A-Z0-9 ]", " ", value).split())


def is_issn_employer(name: Any) -> bool:
    normalized = normalize_label(name)
    return (
        "INSTITUTO" in normalized
        and "SEGURIDAD SOCIAL" in normalized
        and "NEUQUEN" in normalized
    )


def decode_normalized(output: dict[str, Any]) -> dict[str, Any]:
    value = output.get("normalized_json")
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return decoded if isinstance(decoded, dict) else {}
    return {}


def extract_employers(output: dict[str, Any]) -> list[dict[str, Any]]:
    normalized = decode_normalized(output)
    previsional = normalized.get("previsional")
    if not isinstance(previsional, dict):
        return []
    situations = previsional.get("situaciones_por_empleador")
    employers_by_key: dict[str, dict[str, Any]] = {}
    if isinstance(situations, list):
        for situation in situations:
            if not isinstance(situation, dict):
                continue
            employer = situation.get("empleador")
            if not isinstance(employer, dict):
                employer = {}
            periods = situation.get("periodos")
            period_values = [item for item in periods if isinstance(item, dict)] if isinstance(periods, list) else []
            key = str(employer.get("cuit") or employer.get("nombre") or situation.get("indice") or "").strip()
            if not key:
                continue
            employers_by_key[key] = {
                "nombre": str(employer.get("nombre") or ""),
                "cuit": str(employer.get("cuit") or ""),
                "actividad": str(employer.get("actividad") or ""),
                "domicilio": str(employer.get("domicilio") or ""),
                "periodos": period_values,
            }
    employers = previsional.get("empleadores")
    if isinstance(employers, list):
        for employer in employers:
            if not isinstance(employer, dict):
                continue
            key = str(employer.get("cuit") or employer.get("nombre") or employer.get("indice") or "").strip()
            if not key or key in employers_by_key:
                continue
            employers_by_key[key] = {
                "nombre": str(employer.get("nombre") or ""),
                "cuit": str(employer.get("cuit") or ""),
                "actividad": str(employer.get("actividad") or ""),
                "domicilio": str(employer.get("domicilio") or ""),
                "periodos": [],
            }
    return list(employers_by_key.values())


def process_output(output: dict[str, Any], *, source: str, checked_at: str = "") -> ProcessedCredixResult:
    employers = extract_employers(output)
    effective_checked_at = checked_at or str(output.get("cached_at") or "")
    if not effective_checked_at:
        effective_checked_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    return ProcessedCredixResult(
        status=str(output.get("status") or ""),
        ok=bool(output.get("ok", False)),
        checked_at=effective_checked_at,
        source=source,
        employers=employers,
        qualifies_issn=any(is_issn_employer(item.get("nombre")) for item in employers),
        output=output,
    )


def load_shared_cache(db_path: str, cuit: str, max_age_days: int) -> dict[str, Any] | None:
    try:
        with closing(sqlite3.connect(db_path, timeout=30)) as connection:
            row = connection.execute(
                "SELECT payload_json FROM credixsa_cache WHERE lookup_key = ?",
                (f"credixsa.cuil.{cuit}",),
            ).fetchone()
    except sqlite3.Error:
        return None
    if not row:
        return None
    try:
        payload = json.loads(str(row[0]))
    except json.JSONDecodeError:
        return None
    result = cached_result_if_fresh(payload, max_age_days)
    if result is None:
        return None
    result["cache_hit"] = True
    result["cache_source"] = "cuil"
    result["cached_at"] = str(payload.get("cached_at") or "")
    return build_output_payload(result)


def query_online(cuit: str, config: CredixConfig, shared_cache_db_path: str) -> dict[str, Any]:
    raw_result = consultar_tabla(SearchRequest(cuit=cuit, nombre=""), config)
    output = build_output_payload(raw_result)
    if output.get("cache_should_persist"):
        entries = []
        for key in (output.get("cuil_cache_key"), output.get("name_cache_key")):
            if key:
                entries.append({"key": str(key), "value": str(output["cache_value_json"])})
        if entries:
            write_cache_entries(shared_cache_db_path, entries)
    return output
