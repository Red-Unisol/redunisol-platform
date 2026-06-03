from __future__ import annotations

from datetime import datetime
from datetime import timedelta
from datetime import timezone
import hashlib
import json
import os
import re
import sqlite3
import unicodedata
from typing import Any

from fastapi import FastAPI
from fastapi import Header
from fastapi import HTTPException
from pydantic import BaseModel


CACHE_VERSION = 1
DEFAULT_DB_PATH = "/data/credixsa-cache/credixsa.sqlite"
DEFAULT_MAX_AGE_DAYS = 7

app = FastAPI(title="CredixSA Cache API")


class CacheRequest(BaseModel):
    cuit: str | None = None
    nombre: str | None = None


@app.get("/health")
def health() -> dict[str, Any]:
    db_path = _db_path()
    return {
        "ok": True,
        "db_path": db_path,
        "db_exists": os.path.exists(db_path),
    }


@app.post("/credixsa/cache")
def get_cached_report(
    request: CacheRequest,
    authorization: str | None = Header(default=None),
    x_api_token: str | None = Header(default=None),
) -> dict[str, Any]:
    _require_token(authorization, x_api_token)
    cuit = normalize_cuit(request.cuit)
    nombre = normalize_name(request.nombre)
    if not cuit and not nombre:
        raise HTTPException(status_code=422, detail="At least one of cuit or nombre is required.")

    for key, source in _lookup_keys(cuit, nombre):
        cache_payload = _load_cache_payload(key)
        result = cached_result_if_fresh(cache_payload, _max_age_days())
        if result is None:
            continue
        if source == "name" and cuit:
            cached_cuit = normalize_cuit(result.get("cuit"))
            if cached_cuit and cached_cuit != cuit:
                continue
        result["cache_hit"] = True
        result["cache_source"] = source
        result["cached_at"] = str(cache_payload.get("cached_at") or "")
        return build_output_payload(result)

    raise HTTPException(
        status_code=404,
        detail={
            "ok": False,
            "status": "cache_miss",
            "cache_hit": False,
            "error": "cache_miss",
        },
    )


def _require_token(authorization: str | None, x_api_token: str | None) -> None:
    expected = os.getenv("CREDIXSA_CACHE_API_TOKEN", "").strip()
    if not expected:
        return
    bearer = ""
    if authorization and authorization.lower().startswith("bearer "):
        bearer = authorization[7:].strip()
    if expected not in {bearer, (x_api_token or "").strip()}:
        raise HTTPException(status_code=401, detail="Unauthorized.")


def _lookup_keys(cuit: str, nombre: str) -> list[tuple[str, str]]:
    keys: list[tuple[str, str]] = []
    cuil_key = cache_key_for_cuil(cuit)
    if cuil_key:
        keys.append((cuil_key, "cuil"))
    name_key = cache_key_for_name(nombre)
    if name_key:
        keys.append((name_key, "name"))
    return keys


def _load_cache_payload(key: str) -> dict[str, Any] | None:
    db_path = _db_path()
    if not os.path.exists(db_path):
        return None
    with sqlite3.connect(db_path, timeout=5) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            "SELECT payload_json FROM credixsa_cache WHERE lookup_key = ?",
            (key,),
        ).fetchone()
    if row is None:
        return None
    try:
        payload = json.loads(str(row["payload_json"] or ""))
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def cached_result_if_fresh(
    cache_payload: dict[str, Any] | None,
    max_age_days: int = DEFAULT_MAX_AGE_DAYS,
) -> dict[str, Any] | None:
    if not isinstance(cache_payload, dict):
        return None
    if int(cache_payload.get("version") or 0) != CACHE_VERSION:
        return None
    cached_at = parse_datetime(cache_payload.get("cached_at"))
    if cached_at is None:
        return None
    if datetime.now(timezone.utc) - cached_at > timedelta(days=max_age_days):
        return None
    result = cache_payload.get("result")
    if not isinstance(result, dict):
        return None
    return dict(result)


def build_output_payload(result: dict[str, Any]) -> dict[str, Any]:
    normalized_payload = build_normalized_payload(result)
    response_payload = build_legacy_response(result)
    return {
        "ok": bool(result.get("ok", False)),
        "status": str(result.get("status") or ""),
        "cuit": str(result.get("cuit") or ""),
        "nombre": str(result.get("nombre") or ""),
        "rows_json": json.dumps(result.get("rows") or [], ensure_ascii=True, separators=(",", ":")),
        "data_json": json.dumps(result.get("data") or [], ensure_ascii=True, separators=(",", ":")),
        "normalized_json": json.dumps(normalized_payload, ensure_ascii=True, separators=(",", ":")),
        "response_json": json.dumps(response_payload, ensure_ascii=True, separators=(",", ":")),
        "error": str(result.get("error") or ""),
        "cache_hit": bool(result.get("cache_hit", False)),
        "cached_at": str(result.get("cached_at") or ""),
    }


def build_legacy_response(result: dict[str, Any]) -> dict[str, Any]:
    status = str(result.get("status") or "")
    if status == "single":
        return {"status": "single", "data": result.get("data") or []}
    if status in {"none", "multiple"}:
        return {"status": status, "rows": result.get("rows") or []}
    return {"status": "error", "error": str(result.get("error") or "Unknown error")}


def build_normalized_payload(result: dict[str, Any]) -> dict[str, Any]:
    normalized = result.get("normalized")
    if isinstance(normalized, dict):
        _ensure_bcra_24_months_payload(normalized, result.get("data") or [])
        _ensure_bcra_entity_evolution_payload(normalized, result.get("data") or [])
        _ensure_previsional_employer_tables_payload(normalized, result.get("data") or [])
        return normalized

    payload = {
        "persona": {
            "cuit": str(result.get("cuit") or ""),
            "documento": "",
            "nombre_completo": str(result.get("nombre") or ""),
            "genero": "",
            "edad": "",
            "fecha_nacimiento": "",
            "domicilio": "",
            "localidad": "",
            "provincia": "",
        },
        "bcra": {
            "resumen": {"color": "", "detalle": ""},
            "deuda_vigente_total": "",
            "deudas_vigentes": [],
            "deudas_24_meses": {},
            "evolucion_deuda_por_entidad": {},
            "historial_por_entidad": [],
            "entidades": [],
        },
        "previsional": {
            "mensaje": "",
            "registraciones": [],
            "empleadores": [],
            "situaciones_por_empleador": [],
            "obra_sociales": [],
        },
        "aportes": {
            "mensaje": "",
            "registraciones": [],
            "empleadores": [],
            "obra_sociales": [],
        },
        "quiebras": {
            "edictos": [],
            "mensaje": "",
        },
    }

    sections = result.get("data") or []
    if not isinstance(sections, list):
        return payload

    for section in sections:
        if not isinstance(section, dict):
            continue

        title = normalize_name(section.get("title"))
        normalized_title = _normalized_label(title)
        match_title = normalize_name(normalized_title.replace("-", " "))
        key_values = _section_key_values(section)
        rows = _section_rows(section)

        if match_title.startswith("datos filiatorios"):
            payload["persona"].update(_normalize_persona_block(key_values))
            continue

        if match_title.startswith("resumen"):
            payload["bcra"]["resumen"].update(_normalize_bcra_summary(key_values))
            continue

        if match_title.startswith("deudas en el sistema financiero"):
            payload["bcra"]["deudas_24_meses"] = _normalize_bcra_24_months(section)
            continue

        if match_title.startswith("deudas vigentes sistema financiero"):
            deuda_vigente = _normalize_bcra_vigentes(rows)
            if deuda_vigente["deudas_vigentes"]:
                payload["bcra"]["deudas_vigentes"] = deuda_vigente["deudas_vigentes"]
            if deuda_vigente["deuda_vigente_total"]:
                payload["bcra"]["deuda_vigente_total"] = deuda_vigente["deuda_vigente_total"]
            continue

        if match_title.startswith("evolucion deuda sistema financiero por entidad"):
            payload["bcra"]["historial_por_entidad"] = _normalize_bcra_history(section)
            continue

        if match_title.startswith("datos entidades fuente"):
            payload["bcra"]["entidades"] = _normalize_bcra_entities(section)
            continue

        if match_title.startswith("situacion previsional empleador"):
            employer = _normalize_previsional_employer(title, key_values)
            if employer:
                payload["previsional"]["empleadores"].append(employer)
                payload["aportes"]["empleadores"].append(employer)
            continue

        if match_title.startswith("situacion previsional fuente") or match_title == "situacion previsional":
            previsional_payload = _normalize_previsional_message(rows)
            if previsional_payload:
                payload["previsional"]["mensaje"] = previsional_payload
                payload["aportes"]["mensaje"] = previsional_payload
            continue

        if match_title.startswith("registraciones"):
            registration = _normalize_registration(title, rows)
            if registration:
                payload["previsional"]["registraciones"].append(registration)
                payload["aportes"]["registraciones"].append(registration)
            continue

        if match_title.startswith("datos obra social"):
            obra_social = _normalize_obra_social(title, key_values, rows)
            if obra_social:
                payload["previsional"]["obra_sociales"].append(obra_social)
                payload["aportes"]["obra_sociales"].append(obra_social)
            continue

        if "edictos judiciales" in normalized_title:
            edicts = _normalize_edicts(rows)
            if edicts:
                payload["quiebras"]["edictos"].extend(edicts)
            elif not payload["quiebras"]["mensaje"]:
                payload["quiebras"]["mensaje"] = _single_value_row(rows)

    _mark_active_bcra_24_month_rows(
        payload["bcra"].get("deudas_24_meses"),
        payload["bcra"].get("deudas_vigentes") or [],
    )
    _ensure_bcra_entity_evolution_payload(payload, sections)
    _ensure_previsional_employer_tables_payload(payload, sections)
    result["normalized"] = payload
    return payload


def normalize_cuit(value: Any) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def normalize_name(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def cache_key_for_cuil(value: Any) -> str:
    digits = normalize_cuit(value)
    if len(digits) != 11:
        return ""
    return f"credixsa.cuil.{digits}"


def normalize_name_for_cache(value: Any) -> str:
    normalized = normalize_name(value).lower()
    normalized = "".join(
        char
        for char in unicodedata.normalize("NFD", normalized)
        if unicodedata.category(char) != "Mn"
    )
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return normalize_name(normalized)


def cache_key_for_name(value: Any) -> str:
    normalized = normalize_name_for_cache(value)
    if not normalized:
        return ""
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:32]
    return f"credixsa.name.{digest}"


def _section_rows(section: dict[str, Any]) -> list[list[str]]:
    rows = section.get("rows")
    if not isinstance(rows, list):
        return []
    return [
        [normalize_name(cell) for cell in row if normalize_name(cell)]
        for row in rows
        if isinstance(row, list)
    ]


def _section_key_values(section: dict[str, Any]) -> dict[str, str]:
    values: dict[str, str] = {}

    records = section.get("records")
    if isinstance(records, list):
        for record in records:
            if not isinstance(record, dict):
                continue
            for key, value in record.items():
                clean_key = normalize_name(key)
                clean_value = normalize_name(value)
                if clean_key and clean_value:
                    values[clean_key] = clean_value

    for row in _section_rows(section):
        if len(row) == 2 and row[0].lower() != normalize_name(section.get("title")).lower():
            values.setdefault(row[0], row[1])

    return values


def _normalized_label(value: Any) -> str:
    normalized = normalize_name(value).lower()
    normalized = "".join(
        char
        for char in unicodedata.normalize("NFD", normalized)
        if unicodedata.category(char) != "Mn"
    )
    normalized = normalized.replace("(*)", "").replace("*", "")
    normalized = normalized.replace("fuente:", "fuente ")
    normalized = re.sub(r"\s+", " ", normalized)
    normalized = re.sub(r"[^a-z0-9:./\\ -]+", " ", normalized)
    return normalize_name(normalized)


def _normalize_persona_block(values: dict[str, str]) -> dict[str, str]:
    persona = {
        "documento": values.get("Documento", ""),
        "genero": values.get("Sexo", ""),
        "nombre_completo": values.get("Nombre", ""),
        "domicilio": values.get("Domicilio", ""),
    }
    persona.update(_parse_age_and_birthdate(values.get("Edad", "")))
    persona.update(_extract_locality(values.get("Domicilio", "")))
    return {key: value for key, value in persona.items() if value}


def _parse_age_and_birthdate(value: str) -> dict[str, str]:
    match = re.search(r"(?P<age>\\d+)\\s*\\((?P<birthdate>[^)]+)\\)", normalize_name(value))
    if match:
        return {
            "edad": match.group("age"),
            "fecha_nacimiento": match.group("birthdate"),
        }
    if value:
        return {"edad": normalize_name(value)}
    return {}


def _extract_locality(value: str) -> dict[str, str]:
    parts = [normalize_name(part) for part in str(value or "").split(" - ") if normalize_name(part)]
    if len(parts) < 2:
        return {}

    province = parts[-1]
    locality = ""
    if len(parts) >= 4:
        locality = parts[-3]
    elif len(parts) >= 3:
        locality = parts[-2]

    locality = re.sub(r"^\\(\\d+\\)\\s*", "", locality).strip()
    return {
        "localidad": locality,
        "provincia": province,
    }


def _normalize_bcra_summary(values: dict[str, str]) -> dict[str, str]:
    summary = {
        "color": values.get("Resumen (*)", ""),
        "detalle": "",
    }
    for key, value in values.items():
        if "detalle" in _normalized_label(key):
            summary["detalle"] = value
            break
    return {key: value for key, value in summary.items() if value}


def _normalize_bcra_vigentes(rows: list[list[str]]) -> dict[str, Any]:
    entities: list[dict[str, Any]] = []
    total = ""
    for row in rows[2:]:
        if not row:
            continue
        if row[0].upper().startswith("TOTAL"):
            total = row[-1]
            continue

        period_index = next((index for index, cell in enumerate(row) if re.fullmatch(r"\\d{2}\\s*/\\s*\\d{4}", cell) or re.fullmatch(r"\\d{2}/\\d{4}", cell)), None)
        share = row[-1] if row and row[-1].endswith("%") else ""
        amount_index = None
        for index in range(len(row) - 1, -1, -1):
            cell = row[index]
            if cell.endswith("%"):
                continue
            if period_index is not None and index == period_index:
                continue
            if cell.startswith("$") or re.fullmatch(r"[\\d.]+", cell):
                amount_index = index
                break

        if period_index is None or amount_index is None:
            continue

        entity_start = 0
        situacion = ""
        participacion = ""
        if period_index >= 2 and re.fullmatch(r"\\d+", row[0]):
            situacion = row[0]
            if row[1].endswith("%"):
                participacion = row[1]
                entity_start = 2
            else:
                entity_start = 1

        entity_end = min(period_index, amount_index)
        entidad = " ".join(row[entity_start:entity_end]).strip()
        entities.append(
            {
                "situacion": situacion,
                "participacion": participacion,
                "entidad": entidad,
                "periodo": row[period_index],
                "monto": row[amount_index],
                "porcentaje": share if share != participacion else "",
                "raw": row,
            }
        )

    return {
        "deudas_vigentes": entities,
        "deuda_vigente_total": total,
    }


def _ensure_bcra_24_months_payload(payload: dict[str, Any], sections: Any) -> None:
    bcra = payload.get("bcra")
    if not isinstance(bcra, dict):
        return
    if isinstance(bcra.get("deudas_24_meses"), dict) and bcra["deudas_24_meses"]:
        _mark_active_bcra_24_month_rows(
            bcra.get("deudas_24_meses"),
            bcra.get("deudas_vigentes") or [],
        )
        return
    if not isinstance(sections, list):
        return

    for section in sections:
        if not isinstance(section, dict):
            continue
        title = normalize_name(section.get("title"))
        match_title = normalize_name(_normalized_label(title).replace("-", " "))
        if not match_title.startswith("deudas en el sistema financiero"):
            continue
        matrix = _normalize_bcra_24_months(section)
        if matrix:
            bcra["deudas_24_meses"] = matrix
            _mark_active_bcra_24_month_rows(matrix, bcra.get("deudas_vigentes") or [])
        return


def _ensure_previsional_employer_tables_payload(payload: dict[str, Any], sections: Any) -> None:
    previsional = payload.get("previsional")
    if not isinstance(previsional, dict):
        return
    if isinstance(previsional.get("situaciones_por_empleador"), list) and previsional["situaciones_por_empleador"]:
        return
    if not isinstance(sections, list):
        return

    situations: list[dict[str, Any]] = []
    for index, section in enumerate(sections):
        if not isinstance(section, dict):
            continue

        title = normalize_name(section.get("title"))
        match_title = normalize_name(_normalized_label(title).replace("-", " "))
        if not match_title.startswith("situacion previsional empleador"):
            continue

        employer = _normalize_previsional_employer(title, _section_key_values(section))
        employer = _existing_previsional_employer(
            previsional.get("empleadores"),
            employer.get("indice", ""),
        ) or employer
        next_section = sections[index + 1] if index + 1 < len(sections) else None
        periods = _normalize_previsional_period_table(next_section) if isinstance(next_section, dict) else []
        if not employer or not periods:
            continue

        situations.append(
            {
                "indice": employer.get("indice", ""),
                "fuente": normalize_name(section.get("source")),
                "empleador": employer,
                "periodos": periods,
            }
        )

    previsional["situaciones_por_empleador"] = situations


def _ensure_bcra_entity_evolution_payload(payload: dict[str, Any], sections: Any) -> None:
    bcra = payload.get("bcra")
    if not isinstance(bcra, dict):
        return
    if isinstance(bcra.get("evolucion_deuda_por_entidad"), dict) and bcra["evolucion_deuda_por_entidad"]:
        return
    if not isinstance(sections, list):
        return

    for section in sections:
        if not isinstance(section, dict):
            continue
        title = normalize_name(section.get("title"))
        match_title = normalize_name(_normalized_label(title).replace("-", " "))
        if not match_title.startswith("evolucion deuda sistema financiero por entidad"):
            continue
        matrix = _normalize_bcra_entity_evolution(section, bcra.get("deudas_24_meses"))
        if matrix:
            bcra["evolucion_deuda_por_entidad"] = matrix
        return


def _normalize_bcra_24_months(section: dict[str, Any]) -> dict[str, Any]:
    rows = _section_rows(section)
    if len(rows) < 4:
        return {}

    year_labels = [
        value
        for value in rows[1]
        if re.fullmatch(r"\d{4}", value)
    ]
    months = rows[2]
    if not year_labels or not months:
        return {}

    years = _build_bcra_year_groups(year_labels, months)
    entities = []
    for row in rows[3:]:
        if len(row) < len(months) + 2:
            continue
        entity = row[0]
        situations = row[1 : 1 + len(months)]
        amount_index = 1 + len(months)
        entities.append(
            {
                "entidad": entity,
                "situaciones": situations,
                "ultimo_monto_informado": row[amount_index] if amount_index < len(row) else "",
                "observacion": row[amount_index + 1] if amount_index + 1 < len(row) else "",
                "activa": False,
            }
        )

    if not entities:
        return {}

    return {
        "titulo": normalize_name(section.get("title")),
        "fuente": normalize_name(section.get("source")),
        "anios": years,
        "meses": months,
        "filas": entities,
    }


def _build_bcra_year_groups(year_labels: list[str], months: list[str]) -> list[dict[str, Any]]:
    if not months:
        return []

    groups: list[dict[str, Any]] = []
    label_index = 0
    span = 1
    previous_month = _month_number(months[0])

    for month in months[1:]:
        current_month = _month_number(month)
        is_new_year = current_month > previous_month if current_month and previous_month else False
        if is_new_year and label_index < len(year_labels):
            groups.append({"anio": year_labels[label_index], "span": span})
            label_index += 1
            span = 1
        else:
            span += 1
        previous_month = current_month

    label = year_labels[min(label_index, len(year_labels) - 1)]
    groups.append({"anio": label, "span": span})
    return groups


def _month_number(value: str) -> int:
    return {
        "ene": 1,
        "feb": 2,
        "mar": 3,
        "abr": 4,
        "may": 5,
        "jun": 6,
        "jul": 7,
        "ago": 8,
        "set": 9,
        "sep": 9,
        "oct": 10,
        "nov": 11,
        "dic": 12,
    }.get(normalize_name(value).lower(), 0)


def _mark_active_bcra_24_month_rows(matrix: Any, active_debts: Any) -> None:
    if not isinstance(matrix, dict):
        return
    rows = matrix.get("filas")
    if not isinstance(rows, list):
        return
    active_entities = {
        _normalized_label(debt.get("entidad"))
        for debt in active_debts
        if isinstance(debt, dict) and normalize_name(debt.get("entidad"))
    }
    for row in rows:
        if not isinstance(row, dict):
            continue
        row["activa"] = _normalized_label(row.get("entidad")) in active_entities


def _normalize_bcra_history(section: dict[str, Any]) -> list[dict[str, Any]]:
    history: list[dict[str, Any]] = []
    records = section.get("records")
    if not isinstance(records, list):
        return history

    for record in records:
        if not isinstance(record, dict):
            continue
        period = normalize_name(record.get("Período"))
        if not period:
            continue
        entities = {
            normalize_name(key): normalize_name(value)
            for key, value in record.items()
            if normalize_name(key) and normalize_name(key) != "Período" and normalize_name(value)
        }
        history.append({"periodo": period, "entidades": entities})
    return history


def _normalize_bcra_entity_evolution(section: dict[str, Any], monthly_matrix: Any) -> dict[str, Any]:
    rows = _section_rows(section)
    if len(rows) < 3 or len(rows[1]) < 2:
        return {}

    entities = rows[1][1:]
    if not entities:
        return {}

    matrix_rows = monthly_matrix.get("filas") if isinstance(monthly_matrix, dict) else []
    period_situations = _build_bcra_period_situations(monthly_matrix)
    matched_rows = {
        entity: _match_bcra_entity_row(entity, matrix_rows)
        for entity in entities
    }

    history_rows: list[dict[str, Any]] = []
    for row in rows[2:]:
        if len(row) < 2 or not re.fullmatch(r"\d{2}/\d{4}", row[0]):
            continue

        period = row[0]
        amounts = row[1:]
        active_entities = [
            entity
            for entity in entities
            if period_situations.get(period, {}).get(_normalized_label(matched_rows.get(entity, {}).get("entidad")))
            not in {"", "-"}
        ]

        amount_by_entity: dict[str, str] = {}
        if len(amounts) == len(entities):
            amount_by_entity = dict(zip(entities, amounts))
        elif len(active_entities) == len(amounts):
            amount_by_entity = dict(zip(active_entities, amounts))
        else:
            amount_by_entity = dict(zip(active_entities or entities, amounts))

        cells = []
        for entity in entities:
            matched_entity = _normalized_label(matched_rows.get(entity, {}).get("entidad"))
            situation = period_situations.get(period, {}).get(matched_entity, "")
            cells.append(
                {
                    "entidad": entity,
                    "monto": amount_by_entity.get(entity, ""),
                    "situacion": situation,
                }
            )
        history_rows.append({"periodo": period, "celdas": cells})

    if not history_rows:
        return {}

    return {
        "titulo": normalize_name(section.get("title")),
        "fuente": normalize_name(section.get("source")),
        "entidades": entities,
        "filas": history_rows,
    }


def _build_bcra_period_situations(matrix: Any) -> dict[str, dict[str, str]]:
    if not isinstance(matrix, dict):
        return {}

    months = matrix.get("meses")
    years = matrix.get("anios")
    rows = matrix.get("filas")
    if not isinstance(months, list) or not isinstance(years, list) or not isinstance(rows, list):
        return {}

    period_labels: list[str] = []
    month_index = 0
    for year in years:
        if not isinstance(year, dict):
            continue
        label = normalize_name(year.get("anio"))
        span = int(year.get("span") or 0)
        for month in months[month_index : month_index + span]:
            month_number = _month_number(month)
            if label and month_number:
                period_labels.append(f"{month_number:02d}/{label}")
            month_index += 1

    situations: dict[str, dict[str, str]] = {period: {} for period in period_labels}
    for row in rows:
        if not isinstance(row, dict):
            continue
        entity = _normalized_label(row.get("entidad"))
        row_situations = row.get("situaciones")
        if not entity or not isinstance(row_situations, list):
            continue
        for index, period in enumerate(period_labels):
            if index < len(row_situations):
                situations[period][entity] = normalize_name(row_situations[index])
    return situations


def _match_bcra_entity_row(entity: str, rows: Any) -> dict[str, Any]:
    if not isinstance(rows, list):
        return {}

    normalized_entity = _normalized_label(entity)
    best_row: dict[str, Any] = {}
    best_score = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        normalized_candidate = _normalized_label(row.get("entidad"))
        if not normalized_candidate:
            continue
        if normalized_entity == normalized_candidate:
            return row
        if normalized_entity in normalized_candidate or normalized_candidate in normalized_entity:
            score = max(len(normalized_entity.split()), len(normalized_candidate.split()))
        else:
            score = len(set(normalized_entity.split()) & set(normalized_candidate.split()))
        if score > best_score:
            best_row = row
            best_score = score
    return best_row if best_score > 0 else {}


def _normalize_bcra_entities(section: dict[str, Any]) -> list[dict[str, str]]:
    entities: list[dict[str, str]] = []
    records = section.get("records")
    if not isinstance(records, list):
        return entities

    for record in records:
        if not isinstance(record, dict):
            continue
        entity = {
            "entidad": normalize_name(record.get("Entidad")),
            "cuit": normalize_name(record.get("Cuit")),
            "marca": normalize_name(record.get("Marca")),
            "domicilio": normalize_name(record.get("Domicilio")),
            "contacto": normalize_name(record.get("Contacto")),
        }
        if any(entity.values()):
            entities.append(entity)
    return entities


def _normalize_previsional_message(rows: list[list[str]]) -> str:
    return _single_value_row(rows)


def _normalize_previsional_employer(title: str, values: dict[str, str]) -> dict[str, str]:
    employer_value = values.get("Empleador", "")
    cuit = ""
    employer_name = employer_value
    match = re.match(r"(?P<cuit>\d{2}-\d{8}-\d)\s*-\s*(?P<name>.+)$", employer_value)
    if match:
        cuit = normalize_cuit(match.group("cuit"))
        employer_name = normalize_name(match.group("name"))

    employer_index_match = re.search(r"Empleador\\s+(\\d+)", title)
    employer_index = employer_index_match.group(1) if employer_index_match else ""

    employer = {
        "indice": employer_index,
        "cuit": cuit,
        "nombre": employer_name,
        "actividad": values.get("Actividad", ""),
        "domicilio": values.get("Domicilio", ""),
    }
    return {key: value for key, value in employer.items() if value}


def _existing_previsional_employer(employers: Any, employer_index: str) -> dict[str, str]:
    if not isinstance(employers, list) or not employer_index:
        return {}
    for employer in employers:
        if not isinstance(employer, dict):
            continue
        if str(employer.get("indice") or "") == employer_index:
            return employer
    return {}


def _normalize_previsional_period_table(section: dict[str, Any] | None) -> list[dict[str, str]]:
    if not isinstance(section, dict):
        return []

    rows = _section_rows(section)
    header_index = next(
        (
            index
            for index, row in enumerate(rows)
            if len(row) >= 5 and row and _normalized_label(row[0]) == "periodo"
        ),
        None,
    )
    if header_index is None:
        return []

    periods: list[dict[str, str]] = []
    for row in rows[header_index + 1 :]:
        if len(row) < 5 or not re.fullmatch(r"\d{2}/\d{4}", row[0]):
            continue
        periods.append(
            {
                "periodo": row[0],
                "incluido_declaracion_jurada": row[1],
                "aportes_seguridad_social": row[2],
                "aportes_obra_social": row[3],
                "contribucion_patronal_obra_social": row[4],
            }
        )
    return periods


def _normalize_registration(title: str, rows: list[list[str]]) -> dict[str, str]:
    period_match = re.search(r"Per[ií]odo:\\s*(.+?)\\s+Fuente:", title)
    period = normalize_name(period_match.group(1)) if period_match else ""
    message = _single_value_row(rows)
    registration = {
        "periodo": period,
        "mensaje": message,
    }
    return {key: value for key, value in registration.items() if value}


def _normalize_obra_social(title: str, values: dict[str, str], rows: list[list[str]]) -> dict[str, str]:
    updated_at_match = re.search(r"Actualizados? al\\s+(.+?)\\s*(?:\\(\\*\\))?\\s*Fuente:", title)
    obra_social = {
        "fecha_actualizacion": normalize_name(updated_at_match.group(1)) if updated_at_match else "",
        "obra_social": values.get("Obra Social", ""),
        "situacion_laboral": values.get("Situacion Laboral", ""),
        "empleador": values.get("Empleador", ""),
        "actividad_empleador": values.get("Actividad Empleador", ""),
        "domicilio_empleador": values.get("Domicilio Empleador", ""),
        "mensaje": "",
    }
    if not any(value for key, value in obra_social.items() if key != "fecha_actualizacion"):
        obra_social["mensaje"] = _single_value_row(rows)
    return {key: value for key, value in obra_social.items() if value}


def _normalize_edicts(rows: list[list[str]]) -> list[dict[str, str]]:
    edicts: list[dict[str, str]] = []
    for row in rows[1:]:
        if len(row) == 1 or len(row) < 3:
            continue
        if not re.search(r"\\d{2}/\\d{2}/\\d{4}", row[0]):
            continue
        if len(row) >= 4:
            edict_id = row[2]
            summary = row[3]
        else:
            edict_id = ""
            summary = row[2]
        edicts.append(
            {
                "fecha": row[0],
                "fuente": row[1],
                "id": edict_id,
                "resumen": summary,
            }
        )
    return edicts


def _single_value_row(rows: list[list[str]]) -> str:
    for row in rows[1:]:
        if len(row) == 1:
            return row[0]
    return ""


def parse_datetime(value: Any) -> datetime | None:
    raw_value = str(value or "").strip()
    if not raw_value:
        return None
    if raw_value.endswith("Z"):
        raw_value = f"{raw_value[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(raw_value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _db_path() -> str:
    return os.getenv("CREDIXSA_CACHE_DB_PATH", DEFAULT_DB_PATH).strip() or DEFAULT_DB_PATH


def _max_age_days() -> int:
    raw = os.getenv("CREDIXSA_CACHE_MAX_AGE_DAYS", str(DEFAULT_MAX_AGE_DAYS)).strip()
    try:
        return int(raw or DEFAULT_MAX_AGE_DAYS)
    except ValueError:
        return DEFAULT_MAX_AGE_DAYS
