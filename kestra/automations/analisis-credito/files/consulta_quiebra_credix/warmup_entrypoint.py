#!/usr/bin/env python3

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from datetime import timedelta
import json
import os
import sys
import time
from typing import Any
from zoneinfo import ZoneInfo

import requests
import urllib3

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None

from .service import (
    CredixConfig,
    SearchRequest,
    build_output_payload,
    cache_key_for_cuil,
    cache_key_for_name,
    consultar_tabla,
    normalize_cuit,
    normalize_name,
)
from .sqlite_cache import write_cache_entries


DEFAULT_MAX_PER_RUN = 5
DEFAULT_CORE_TIMEOUT_SECONDS = 60
DEFAULT_CREDIX_TIMEOUT_SECONDS = 90
DEFAULT_LOCAL_TZ = "America/Argentina/Buenos_Aires"
MAX_CACHE_ENTRIES = 10


@dataclass(frozen=True)
class CoreConfig:
    base_url: str
    timeout_seconds: int
    verify_tls: bool


@dataclass(frozen=True)
class CoreSolicitud:
    oid: str
    fecha: str
    estado: str
    cuil: str
    documento: str
    nombre: str


def main() -> int:
    try:
        output_payload = run_warmup()
    except Exception as exc:
        output_payload = build_error_output(str(exc))

    _emit_outputs_if_available(output_payload)
    sys.stdout.write(json.dumps(_summary_for_stdout(output_payload), ensure_ascii=True, separators=(",", ":")) + "\n")
    return 0


def run_warmup() -> dict[str, Any]:
    core_config = load_core_config()
    credix_config = load_credix_config()
    local_tz = ZoneInfo(os.getenv("LOCAL_TZ", DEFAULT_LOCAL_TZ).strip() or DEFAULT_LOCAL_TZ)
    today = datetime.now(local_tz).date()
    daily_index = decode_daily_index(os.getenv("CREDIX_DAILY_INDEX_JSON", ""), today.isoformat())
    max_per_run = parse_int_env("CREDIX_WARMUP_MAX_PER_RUN", DEFAULT_MAX_PER_RUN)

    solicitudes = fetch_today_solicitudes(core_config, today)
    solicitudes = complete_missing_cuils(core_config, solicitudes)
    candidates = select_candidates(solicitudes, daily_index, max_per_run)

    cache_entries: list[dict[str, str]] = []
    processed_count = 0
    error_count = 0
    skipped_count = max(0, len(solicitudes) - len(candidates))
    errors: list[str] = []

    for solicitud in candidates:
        try:
            result = consultar_with_retry(solicitud, credix_config)
            processed_count += 1
        except Exception as exc:
            error_count += 1
            errors.append(f"{solicitud.oid}:{type(exc).__name__}:{str(exc)[:160]}")
            continue

        output = build_output_payload(result)
        if output.get("cache_should_persist"):
            register_cache_entry(cache_entries, str(output.get("cuil_cache_key") or ""), str(output.get("cache_value_json") or ""))
            register_cache_entry(cache_entries, str(output.get("name_cache_key") or ""), str(output.get("cache_value_json") or ""))

        mark_daily_index(daily_index, solicitud, output)

    sqlite_path = os.getenv("CREDIX_CACHE_SQLITE_PATH", "").strip()
    if sqlite_path and cache_entries:
        try:
            write_cache_entries(sqlite_path, cache_entries)
        except Exception as exc:
            error_count += 1
            errors.append(f"sqlite_cache:{type(exc).__name__}:{str(exc)[:160]}")

    output_payload = build_success_output(
        daily_index=daily_index,
        cache_entries=cache_entries,
        solicitudes_count=len(solicitudes),
        candidate_count=len(candidates),
        processed_count=processed_count,
        skipped_count=skipped_count,
        error_count=error_count,
        errors=errors,
    )
    return output_payload


def load_core_config() -> CoreConfig:
    base_url = os.getenv("VIMARX_EVAL_BASE_URL", "").strip().rstrip("/")
    if not base_url:
        raise ValueError("Missing VIMARX_EVAL_BASE_URL.")
    verify_tls = os.getenv("VIMARX_VERIFY_TLS", "false").strip().lower() in {"1", "true", "yes"}
    if not verify_tls:
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    return CoreConfig(
        base_url=base_url,
        timeout_seconds=parse_int_env("VIMARX_TIMEOUT_SECONDS", DEFAULT_CORE_TIMEOUT_SECONDS),
        verify_tls=verify_tls,
    )


def load_credix_config() -> CredixConfig:
    cliente = os.getenv("CREDIX_CLIENTE", "").strip()
    usuario = os.getenv("CREDIX_USER", "").strip()
    password = os.getenv("CREDIX_PASS", "").strip()
    if not cliente or not usuario or not password:
        raise ValueError("Missing CREDIX_CLIENTE, CREDIX_USER or CREDIX_PASS.")
    timeout_seconds = parse_int_env("CREDIX_TIMEOUT_SECONDS", DEFAULT_CREDIX_TIMEOUT_SECONDS)
    return CredixConfig(
        cliente=cliente,
        usuario=usuario,
        password=password,
        login_url=os.getenv("CREDIX_LOGIN_URL", "https://www.credixsa.com/nuevo/login.php").strip(),
        timeout_ms=timeout_seconds * 1000,
        debug_enabled=os.getenv("CREDIX_DEBUG", "").strip().lower() in {"1", "true", "yes"},
        debug_dir=os.getenv("CREDIX_DEBUG_DIR", "").strip(),
    )


def fetch_today_solicitudes(config: CoreConfig, today: Any) -> list[CoreSolicitud]:
    tomorrow = today + timedelta(days=1)
    payload = {
        "cmd": f"[Fecha] >= #{today:%Y-%m-%d}# AND [Fecha] < #{tomorrow:%Y-%m-%d}#",
        "tipo": "PreSolicitud.Module.Solicitud",
        "campos": "Oid;Fecha;Estado.Descripcion;CUIT;NroDocumento;NombreCompleto",
        "max": parse_int_env("CREDIX_WARMUP_CORE_MAX_ROWS", 1000),
    }
    rows = evaluate_list(config, payload)
    solicitudes: list[CoreSolicitud] = []
    for row in rows:
        if not isinstance(row, list):
            continue
        solicitud = CoreSolicitud(
            oid=value_at(row, 0),
            fecha=value_at(row, 1),
            estado=value_at(row, 2),
            cuil=normalize_cuit(value_at(row, 3)),
            documento=normalize_cuit(value_at(row, 4)),
            nombre=normalize_name(value_at(row, 5)),
        )
        if solicitud.oid and (solicitud.cuil or solicitud.documento or solicitud.nombre):
            solicitudes.append(solicitud)
    return solicitudes


def complete_missing_cuils(config: CoreConfig, solicitudes: list[CoreSolicitud]) -> list[CoreSolicitud]:
    docs = sorted({item.documento for item in solicitudes if not item.cuil and item.documento})
    if not docs:
        return solicitudes

    cuil_by_doc: dict[str, str] = {}
    for chunk in chunks(docs, 100):
        terms = [f"[NroDoc]={doc}" for doc in chunk if doc.isdigit()]
        if not terms:
            continue
        rows = evaluate_list(
            config,
            {
                "cmd": " OR ".join(terms),
                "tipo": "F.Module.SocioMutual",
                "campos": "NroDoc;CUIT",
                "max": len(terms),
            },
        )
        for row in rows:
            if not isinstance(row, list):
                continue
            doc = normalize_cuit(value_at(row, 0))
            cuil = normalize_cuit(value_at(row, 1))
            if doc and len(cuil) == 11:
                cuil_by_doc[doc] = cuil

    completed: list[CoreSolicitud] = []
    for item in solicitudes:
        if item.cuil or not item.documento:
            completed.append(item)
            continue
        completed.append(
            CoreSolicitud(
                oid=item.oid,
                fecha=item.fecha,
                estado=item.estado,
                cuil=cuil_by_doc.get(item.documento, ""),
                documento=item.documento,
                nombre=item.nombre,
            )
        )
    return completed


def select_candidates(
    solicitudes: list[CoreSolicitud],
    daily_index: dict[str, Any],
    max_per_run: int,
) -> list[CoreSolicitud]:
    processed_oids = set(str(value) for value in daily_index.get("processed_oids", []))
    processed_cuils = set(str(value) for value in daily_index.get("cuils", []))
    processed_names = set(str(value) for value in daily_index.get("name_keys", []))
    selected: list[CoreSolicitud] = []
    seen_lookup_keys: set[str] = set()

    for solicitud in sorted(solicitudes, key=lambda item: item.oid):
        cuil_key = cache_key_for_cuil(solicitud.cuil)
        name_key = cache_key_for_name(solicitud.nombre)
        lookup_key = cuil_key or name_key
        if not lookup_key:
            continue
        if solicitud.oid in processed_oids:
            continue
        if solicitud.cuil and solicitud.cuil in processed_cuils:
            continue
        if name_key and name_key in processed_names:
            continue
        if lookup_key in seen_lookup_keys:
            continue
        seen_lookup_keys.add(lookup_key)
        selected.append(solicitud)
        if len(selected) >= max_per_run:
            break

    return selected


def consultar_with_retry(solicitud: CoreSolicitud, config: CredixConfig) -> dict[str, Any]:
    request = SearchRequest(cuit=solicitud.cuil, nombre="" if solicitud.cuil else solicitud.nombre)
    attempts = parse_int_env("CREDIX_WARMUP_RETRY_ATTEMPTS", 2)
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            return consultar_tabla(request, config)
        except Exception as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(5)
    if last_error is None:
        raise RuntimeError("CredixSA failed without exception.")
    raise last_error


def mark_daily_index(daily_index: dict[str, Any], solicitud: CoreSolicitud, output: dict[str, Any]) -> None:
    append_unique(daily_index.setdefault("processed_oids", []), solicitud.oid)
    if solicitud.cuil:
        append_unique(daily_index.setdefault("cuils", []), solicitud.cuil)
    name_key = cache_key_for_name(output.get("nombre") or solicitud.nombre)
    if name_key:
        append_unique(daily_index.setdefault("name_keys", []), name_key)


def register_cache_entry(cache_entries: list[dict[str, str]], key: str, value: str) -> None:
    if not key or not value:
        return
    if any(entry["key"] == key for entry in cache_entries):
        return
    if len(cache_entries) >= MAX_CACHE_ENTRIES:
        return
    cache_entries.append({"key": key, "value": value})


def build_success_output(
    *,
    daily_index: dict[str, Any],
    cache_entries: list[dict[str, str]],
    solicitudes_count: int,
    candidate_count: int,
    processed_count: int,
    skipped_count: int,
    error_count: int,
    errors: list[str],
) -> dict[str, Any]:
    output: dict[str, Any] = {
        "ok": error_count == 0,
        "solicitudes_count": str(solicitudes_count),
        "candidate_count": str(candidate_count),
        "processed_count": str(processed_count),
        "skipped_count": str(skipped_count),
        "error_count": str(error_count),
        "cache_entry_count": str(len(cache_entries)),
        "daily_index_json": json.dumps(daily_index, ensure_ascii=True, separators=(",", ":")),
        "daily_index_ttl": "P2D",
        "error": "; ".join(errors[:5]),
    }
    for index in range(1, MAX_CACHE_ENTRIES + 1):
        entry = cache_entries[index - 1] if index <= len(cache_entries) else None
        output[f"cache_entry_{index}_enabled"] = entry is not None
        output[f"cache_entry_{index}_key"] = entry["key"] if entry else ""
        output[f"cache_entry_{index}_value"] = entry["value"] if entry else ""
        output[f"cache_entry_{index}_ttl"] = "P8D" if entry else ""
    return output


def build_error_output(error: str) -> dict[str, Any]:
    output = build_success_output(
        daily_index={"date": ""},
        cache_entries=[],
        solicitudes_count=0,
        candidate_count=0,
        processed_count=0,
        skipped_count=0,
        error_count=1,
        errors=[error],
    )
    output["ok"] = False
    output["error"] = error
    return output


def decode_daily_index(raw_value: str, today: str) -> dict[str, Any]:
    base = {
        "date": today,
        "processed_oids": [],
        "cuils": [],
        "name_keys": [],
        "updated_at": datetime.now(ZoneInfo("UTC")).replace(microsecond=0).isoformat(),
    }
    raw_value = (raw_value or "").strip()
    if not raw_value or raw_value == "null":
        return base
    try:
        payload = json.loads(raw_value)
    except json.JSONDecodeError:
        return base
    if not isinstance(payload, dict) or payload.get("date") != today:
        return base
    payload.setdefault("processed_oids", [])
    payload.setdefault("cuils", [])
    payload.setdefault("name_keys", [])
    payload["updated_at"] = base["updated_at"]
    return payload


def evaluate_list(config: CoreConfig, payload: dict[str, Any]) -> list[Any]:
    url = f"{config.base_url}/api/Empresa/EvaluateList"
    session = requests.Session()
    session.trust_env = False
    response = session.post(
        url,
        json=payload,
        timeout=config.timeout_seconds,
        verify=config.verify_tls,
    )
    response.raise_for_status()
    body = response.json()
    if not isinstance(body, list):
        raise RuntimeError("EvaluateList returned a non-list response.")
    return body


def value_at(row: list[Any], index: int) -> str:
    if index >= len(row):
        return ""
    value = row[index]
    return "" if value is None else str(value).strip()


def chunks(values: list[str], size: int) -> list[list[str]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def append_unique(values: list[Any], value: Any) -> None:
    if value and value not in values:
        values.append(value)


def parse_int_env(name: str, default: int) -> int:
    raw_value = os.getenv(name, str(default)).strip()
    try:
        return int(raw_value)
    except ValueError:
        return default


def _summary_for_stdout(output_payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": output_payload.get("ok"),
        "solicitudes_count": output_payload.get("solicitudes_count"),
        "candidate_count": output_payload.get("candidate_count"),
        "processed_count": output_payload.get("processed_count"),
        "cache_entry_count": output_payload.get("cache_entry_count"),
        "error_count": output_payload.get("error_count"),
        "error": output_payload.get("error"),
    }


def _emit_outputs_if_available(output_payload: dict[str, Any]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(output_payload)


if __name__ == "__main__":
    raise SystemExit(main())
