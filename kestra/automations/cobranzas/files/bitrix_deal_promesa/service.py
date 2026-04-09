from __future__ import annotations

import json
import os
import time
from datetime import datetime, time as dtime, timedelta
from typing import Any, Dict, Tuple
from urllib.parse import parse_qs
from zoneinfo import ZoneInfo

import requests


def get_env(name: str, default: str = "") -> str:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value


def get_env_int(name: str, default: int) -> int:
    raw = get_env(name, "")
    if raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def get_local_tz() -> ZoneInfo:
    tz_name = get_env("LOCAL_TZ", "America/Argentina/Buenos_Aires")
    try:
        return ZoneInfo(tz_name)
    except Exception:
        return ZoneInfo("UTC")


def parse_trigger_body() -> Dict[str, Any]:
    raw_json = get_env("TRIGGER_BODY_JSON", "").strip()
    raw = get_env("TRIGGER_BODY_RAW", "").strip()

    payload: Any = None
    if raw_json:
        try:
            payload = json.loads(raw_json)
        except Exception:
            payload = None

    if isinstance(payload, str):
        raw = payload
        payload = None

    if isinstance(payload, dict):
        return payload

    if raw:
        parsed = parse_qs(raw, keep_blank_values=True)
        return {key: values[0] if len(values) == 1 else values for key, values in parsed.items()}

    return {}


def get_value(payload: Dict[str, Any], flat_key: str, nested_path: Tuple[str, ...]) -> Any:
    if flat_key in payload:
        return payload.get(flat_key)
    current: Any = payload
    for key in nested_path:
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    return current


def _build_bitrix_url(method: str) -> str:
    webhook_url = get_env("BITRIX24_WEBHOOK_URL", "").strip()
    if webhook_url:
        return f"{webhook_url.rstrip('/')}/{method}"

    base_url = get_env("BITRIX24_BASE_URL", "").strip()
    webhook_path = get_env("BITRIX24_WEBHOOK_PATH", "").strip().strip("/")
    if not base_url or not webhook_path:
        raise ValueError("Missing BITRIX24_BASE_URL or BITRIX24_WEBHOOK_PATH.")

    return f"{base_url.rstrip('/')}/{webhook_path}/{method}.json"


def bitrix_call(method: str, params: Dict[str, Any]) -> Dict[str, Any]:
    url = _build_bitrix_url(method)
    timeout = max(float(get_env_int("BITRIX24_TIMEOUT_SECONDS", 10)), 1.0)
    response = requests.post(url, json=params, timeout=timeout)
    response.raise_for_status()
    data = response.json()

    if "error" in data:
        description = data.get("error_description") or f"Bitrix24 error on {method}."
        raise RuntimeError(description)

    return data.get("result", {})


def fetch_deal_with_contact(deal_id: str) -> Tuple[Dict[str, Any], Dict[str, Any] | None]:
    deal = bitrix_call("crm.deal.get", {"ID": deal_id})
    contact_data = None
    contact_id = deal.get("CONTACT_ID")
    if contact_id and str(contact_id) != "0":
        try:
            contact_data = bitrix_call("crm.contact.get", {"ID": contact_id})
        except Exception:
            contact_data = None
    return deal, contact_data


def parse_promise_datetime(value: str | None) -> datetime | None:
    if not value:
        return None

    local_tz = get_local_tz()
    send_hour = get_env_int("PROMISE_SEND_HOUR", 9)
    send_minute = get_env_int("PROMISE_SEND_MINUTE", 0)

    formats = [
        "%Y-%m-%d",
        "%d.%m.%Y",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S%z",
    ]

    for fmt in formats:
        try:
            dt = datetime.strptime(value, fmt)
            if dt.tzinfo is not None:
                return dt.astimezone(local_tz)
            if fmt in ("%Y-%m-%d", "%d.%m.%Y"):
                return datetime.combine(
                    dt.date(),
                    dtime(send_hour, send_minute),
                    tzinfo=local_tz,
                )
            return dt.replace(tzinfo=local_tz)
        except ValueError:
            continue

    return None


def adjust_to_business_hours(dt: datetime) -> datetime:
    local_tz = get_local_tz()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=local_tz)

    start = dtime(get_env_int("BUSINESS_START_HOUR", 9), get_env_int("BUSINESS_START_MINUTE", 0))
    end = dtime(get_env_int("BUSINESS_END_HOUR", 17), get_env_int("BUSINESS_END_MINUTE", 0))

    if dt.time() < start:
        return dt.replace(hour=start.hour, minute=start.minute, second=0, microsecond=0)
    if dt.time() > end:
        next_day = dt.date() + timedelta(days=1)
        return datetime.combine(next_day, start, tzinfo=local_tz)
    return dt


def normalize_phone(value: Any) -> str | None:
    if not value:
        return None
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    if not digits:
        return None
    return digits.lstrip("0")


def format_amount(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        amount = float(value)
    else:
        raw = str(value)
        if "|" in raw:
            raw = raw.split("|", 1)[0]
        raw = raw.replace(".", "").replace(",", ".")
        try:
            amount = float(raw)
        except ValueError:
            return raw
    return "$" + f"{amount:,.0f}".replace(",", ".")


def extract_contact_name(contact_data: Dict[str, Any] | None) -> str | None:
    if not contact_data:
        return None
    name = str(contact_data.get("NAME") or "").strip()
    last = str(contact_data.get("LAST_NAME") or "").strip()
    full = f"{name} {last}".strip()
    return full or None


def extract_contact_phone(contact_data: Dict[str, Any] | None) -> str | None:
    if not contact_data:
        return None
    phones = contact_data.get("PHONE") or []
    for phone in phones:
        value = phone.get("VALUE") if isinstance(phone, dict) else None
        normalized = normalize_phone(value)
        if normalized:
            return normalized
    return None


def should_send(deal_data: Dict[str, Any], expected_promise_value: str) -> bool:
    if not deal_data:
        return False

    target_stage_id = get_env("TARGET_STAGE_ID", "C11:PREPARATION")
    target_category_id = get_env("TARGET_CATEGORY_ID", "11")
    promise_field = get_env("PROMISE_DATE_FIELD", "UF_CRM_1724427951")

    if str(deal_data.get("STAGE_ID") or "") != target_stage_id:
        return False
    if str(deal_data.get("CATEGORY_ID") or "") != target_category_id:
        return False

    current_promise = str(deal_data.get(promise_field) or "")
    return current_promise == (expected_promise_value or "")


def send_to_edna(deal: Dict[str, Any], contact_data: Dict[str, Any] | None) -> int:
    contact_name = extract_contact_name(contact_data) or "cliente"
    contact_phone = extract_contact_phone(contact_data)
    if not contact_phone:
        raise ValueError("Missing contact phone.")

    promise_amount_field = get_env("PROMISE_AMOUNT_FIELD", "UF_CRM_1724429048")
    amount_raw = deal.get(promise_amount_field) or deal.get("OPPORTUNITY")
    amount_text = format_amount(amount_raw) or "0"

    payload = {
        "messageId": f"promesa-{deal.get('ID')}-{int(time.time())}",
        "sender": get_env("EDNA_SENDER", "5493513105768_WA"),
        "phone": contact_phone,
        "templateId": int(get_env("EDNA_TEMPLATE_ID", "51764")),
        "textVariables": [contact_name, amount_text],
        "options": {"comment": get_env("EDNA_COMMENT", "promesa cobranzas")},
    }

    headers = {
        "Content-Type": "application/json",
        "X-API-KEY": get_env("EDNA_API_KEY", ""),
    }

    url = get_env("EDNA_URL", "https://app.edna.io/api/v1/out-messages/whatsapp/template")
    timeout = max(float(get_env_int("EDNA_TIMEOUT_SECONDS", 15)), 1.0)
    response = requests.post(url, json=payload, headers=headers, timeout=timeout)
    response.raise_for_status()
    return response.status_code
