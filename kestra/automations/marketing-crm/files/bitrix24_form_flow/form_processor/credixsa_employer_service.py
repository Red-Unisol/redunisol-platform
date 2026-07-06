from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import re
from typing import Any

from .bitrix_client import BitrixClient
from .config import AppConfig, load_config
from .lead_service import list_leads_created_between, update_lead_fields
from .logger import Logger, create_logger


ARGENTINA_TIMEZONE = timezone(timedelta(hours=-3))
STATUS_OK = "ok"
STATUS_NO_EMPLOYER = "no_employer"
STATUS_NONE = "none"
STATUS_MULTIPLE = "multiple"
STATUS_TEMPORARY_ERROR = "temporary_error"
STATUS_INVALID_CUIL = "invalid_cuil"


def select_next_lead_for_credixsa_employer_backfill(
    *,
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    logger: Logger | None = None,
    now: datetime | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    max_scan: int = 300,
) -> dict[str, object]:
    active_logger = logger or create_logger()
    config = load_config(env)
    if not config.fields.has_credixsa_employer_fields():
        return _selection_result(
            ok=True,
            action="skipped",
            message="Backfill CredixSA omitido: faltan campos Bitrix de empleador.",
        )

    client = bitrix_client or BitrixClient(config, active_logger)
    current_time = now or datetime.now(ARGENTINA_TIMEZONE)
    start = date_from or current_time.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    end = date_to or current_time.replace(microsecond=0).isoformat()

    active_logger.info(f"Buscando lead pendiente de CredixSA entre {start} y {end}.")
    leads = list_leads_created_between(
        client,
        date_from=start,
        date_to=end,
        field_names=[
            "ID",
            config.fields.lead_cuil,
            config.fields.lead_credixsa_checked_at or "",
            config.fields.lead_credixsa_status or "",
        ],
        logger=active_logger,
    )[:max_scan]

    result = _selection_result(
        ok=True,
        action="no_pending",
        checked_count=len(leads),
        message="No hay leads pendientes para enriquecer con CredixSA.",
    )

    for lead in leads:
        lead_id = _optional_int(lead.get("ID"))
        if lead_id is None:
            continue

        checked_at = _optional_str(lead.get(config.fields.lead_credixsa_checked_at or ""))
        if checked_at is not None:
            result["skipped_populated_count"] = int(result["skipped_populated_count"]) + 1
            continue

        current_status = _optional_str(lead.get(config.fields.lead_credixsa_status or ""))
        if current_status == STATUS_TEMPORARY_ERROR:
            result["skipped_temporary_error_count"] = (
                int(result["skipped_temporary_error_count"]) + 1
            )
            continue

        cuil = _normalize_cuil(lead.get(config.fields.lead_cuil))
        if not cuil:
            active_logger.info(f"Lead {lead_id} omitido: no tiene CUIL para CredixSA.")
            result["skipped_missing_cuil_count"] = int(result["skipped_missing_cuil_count"]) + 1
            continue

        result.update(
            {
                "action": "selected",
                "has_pending": True,
                "lead_id": str(lead_id),
                "cuil": cuil,
                "message": f"Lead {lead_id} seleccionado para CredixSA.",
            }
        )
        return result

    return result


def update_lead_with_credixsa_output(
    *,
    lead_id: int | str,
    credixsa_output: dict[str, Any],
    env: dict[str, str] | None = None,
    bitrix_client: Any | None = None,
    logger: Logger | None = None,
    now: datetime | None = None,
    dry_run: bool = False,
) -> dict[str, object]:
    active_logger = logger or create_logger()
    config = load_config(env)
    if not config.fields.has_credixsa_employer_fields():
        return {
            "ok": True,
            "action": "skipped",
            "lead_id": str(lead_id),
            "status": "",
            "updated": False,
            "dry_run": dry_run,
            "message": "Backfill CredixSA omitido: faltan campos Bitrix de empleador.",
        }

    lead_id_int = int(str(lead_id))
    fields, status, message = build_credixsa_employer_fields(
        config,
        credixsa_output,
        now=now,
    )
    active_logger.info(f"Actualizando campos CredixSA del lead {lead_id_int}: {status}.")

    if not dry_run:
        client = bitrix_client or BitrixClient(config, active_logger)
        update_lead_fields(client, lead_id_int, fields)

    return {
        "ok": True,
        "action": "updated" if not dry_run else "dry_run",
        "lead_id": str(lead_id_int),
        "status": status,
        "updated": not dry_run,
        "dry_run": dry_run,
        "message": message,
    }


def build_credixsa_employer_fields(
    config: AppConfig,
    credixsa_output: dict[str, Any],
    *,
    now: datetime | None = None,
) -> tuple[dict[str, Any], str, str]:
    fields = config.fields
    if not fields.has_credixsa_employer_fields():
        raise RuntimeError("La configuracion no incluye los campos CredixSA de empleador.")

    ok = _as_bool(credixsa_output.get("ok"))
    status = _optional_str(credixsa_output.get("status")) or STATUS_TEMPORARY_ERROR
    error = _optional_str(credixsa_output.get("error"))

    if not ok or status == "error":
        return (
            {
                fields.lead_credixsa_status: STATUS_TEMPORARY_ERROR,
                fields.lead_credixsa_alerts: _truncate(error or "CredixSA no devolvio una respuesta procesable."),
            },
            STATUS_TEMPORARY_ERROR,
            error or "CredixSA no devolvio una respuesta procesable.",
        )

    checked_at = _resolve_checked_at(credixsa_output, now=now)
    alert_summary = _summarize_alerts(_decode_json_object(credixsa_output.get("normalized_json")))

    if status in {STATUS_NONE, STATUS_MULTIPLE}:
        return (
            {
                fields.lead_credixsa_status: status,
                fields.lead_credixsa_checked_at: checked_at,
                fields.lead_credixsa_employer_name: "",
                fields.lead_credixsa_employer_cuit: "",
                fields.lead_credixsa_employer_count: 0,
                fields.lead_credixsa_employer_periods: "",
                fields.lead_credixsa_alerts: alert_summary,
            },
            status,
            f"CredixSA devolvio status {status}.",
        )

    if status != "single":
        return (
            {
                fields.lead_credixsa_status: status,
                fields.lead_credixsa_checked_at: checked_at,
                fields.lead_credixsa_alerts: alert_summary,
            },
            status,
            f"CredixSA devolvio status {status}.",
        )

    normalized = _decode_json_object(credixsa_output.get("normalized_json"))
    employers, situations = _extract_employers(normalized)
    if not employers:
        return (
            {
                fields.lead_credixsa_status: STATUS_NO_EMPLOYER,
                fields.lead_credixsa_checked_at: checked_at,
                fields.lead_credixsa_employer_name: "",
                fields.lead_credixsa_employer_cuit: "",
                fields.lead_credixsa_employer_count: 0,
                fields.lead_credixsa_employer_periods: "",
                fields.lead_credixsa_alerts: alert_summary,
            },
            STATUS_NO_EMPLOYER,
            "CredixSA no informo empleador.",
        )

    primary = employers[0]
    summary = _summarize_employers(employers, situations)
    return (
        {
            fields.lead_credixsa_status: STATUS_OK,
            fields.lead_credixsa_checked_at: checked_at,
            fields.lead_credixsa_employer_name: _string_value(primary.get("nombre")),
            fields.lead_credixsa_employer_cuit: _normalize_cuil(primary.get("cuit")),
            fields.lead_credixsa_employer_count: len(employers),
            fields.lead_credixsa_employer_periods: summary,
            fields.lead_credixsa_alerts: alert_summary,
        },
        STATUS_OK,
        f"CredixSA informo {len(employers)} empleador(es).",
    )


def _selection_result(**overrides: object) -> dict[str, object]:
    result: dict[str, object] = {
        "ok": True,
        "action": "",
        "has_pending": False,
        "lead_id": "",
        "cuil": "",
        "checked_count": 0,
        "skipped_populated_count": 0,
        "skipped_missing_cuil_count": 0,
        "skipped_temporary_error_count": 0,
        "message": "",
    }
    result.update(overrides)
    return result


def _extract_employers(normalized: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    previsional = normalized.get("previsional")
    if not isinstance(previsional, dict):
        return [], []

    employers = previsional.get("empleadores")
    situations = previsional.get("situaciones_por_empleador")
    return (
        [item for item in employers if isinstance(item, dict)] if isinstance(employers, list) else [],
        [item for item in situations if isinstance(item, dict)] if isinstance(situations, list) else [],
    )


def _summarize_employers(
    employers: list[dict[str, Any]],
    situations: list[dict[str, Any]],
) -> str:
    if not employers:
        return ""

    primary = employers[0]
    primary_summary = _summarize_single_employer(primary, situations)
    if len(employers) == 1:
        return _truncate(f"1 empleador: {primary_summary}")

    others = []
    for employer in employers[1:4]:
        name = _string_value(employer.get("nombre"))
        cuit = _normalize_cuil(employer.get("cuit"))
        others.append(f"{name} (CUIT {cuit})" if cuit else name)

    suffix = f" Tambien: {'; '.join(item for item in others if item)}." if others else ""
    return _truncate(f"{len(employers)} empleadores. Principal: {primary_summary}{suffix}")


def _summarize_single_employer(
    employer: dict[str, Any],
    situations: list[dict[str, Any]],
) -> str:
    name = _string_value(employer.get("nombre"))
    cuit = _normalize_cuil(employer.get("cuit"))
    header = f"{name} (CUIT {cuit})" if cuit else name
    situation = _find_situation_for_employer(employer, situations)
    periods = situation.get("periodos") if isinstance(situation, dict) else []
    if not isinstance(periods, list) or not periods:
        return f"{header}."

    useful_periods = [item for item in periods if isinstance(item, dict)]
    ddjj_si = sum(
        1
        for period in useful_periods
        if _string_value(period.get("incluido_declaracion_jurada")).upper() == "SI"
    )
    last = useful_periods[-1] if useful_periods else {}
    last_text = ""
    if last:
        last_text = (
            f" Ultimo periodo {last.get('periodo', '')}: "
            f"seg.social {_string_value(last.get('aportes_seguridad_social')) or '-'}, "
            f"obra social {_string_value(last.get('aportes_obra_social')) or '-'}, "
            f"contrib. OS {_string_value(last.get('contribucion_patronal_obra_social')) or '-'}."
        )
    return f"{header}. DDJJ SI {ddjj_si}/{len(useful_periods)}.{last_text}"


def _find_situation_for_employer(
    employer: dict[str, Any],
    situations: list[dict[str, Any]],
) -> dict[str, Any]:
    index = _string_value(employer.get("indice"))
    cuit = _normalize_cuil(employer.get("cuit"))
    for situation in situations:
        situation_employer = situation.get("empleador")
        if not isinstance(situation_employer, dict):
            continue
        if index and _string_value(situation_employer.get("indice")) == index:
            return situation
        if cuit and _normalize_cuil(situation_employer.get("cuit")) == cuit:
            return situation
    return {}


def _summarize_alerts(normalized: dict[str, Any]) -> str:
    alerts = normalized.get("alertas")
    if not isinstance(alerts, list):
        return ""

    rendered = []
    for alert in alerts[:5]:
        if not isinstance(alert, dict):
            continue
        code = _string_value(alert.get("codigo"))
        message = _string_value(alert.get("mensaje"))
        if code and message:
            rendered.append(f"{code}: {message}")
        elif message:
            rendered.append(message)
    return _truncate("; ".join(rendered), limit=900)


def _decode_json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    raw = str(value or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _resolve_checked_at(
    credixsa_output: dict[str, Any],
    *,
    now: datetime | None = None,
) -> str:
    cached_at = _optional_str(credixsa_output.get("cached_at"))
    if cached_at is not None:
        return cached_at
    current_time = now or datetime.now(ARGENTINA_TIMEZONE)
    return current_time.astimezone(ARGENTINA_TIMEZONE).replace(microsecond=0).isoformat()


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "si", "s"}


def _optional_int(raw_value: object) -> int | None:
    if raw_value is None or str(raw_value).strip() == "":
        return None
    return int(str(raw_value))


def _optional_str(raw_value: object) -> str | None:
    value = _string_value(raw_value)
    return value or None


def _string_value(raw_value: object) -> str:
    return str(raw_value or "").strip()


def _normalize_cuil(raw_value: object) -> str:
    digits = re.sub(r"\D+", "", str(raw_value or ""))
    return digits if len(digits) == 11 else ""


def _truncate(value: str, *, limit: int = 1000) -> str:
    text = _string_value(value)
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."
