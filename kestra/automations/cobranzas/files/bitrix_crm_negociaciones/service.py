from __future__ import annotations

import json
import os
import re
from datetime import datetime, time as dtime, timedelta
from pathlib import Path
from typing import Any, Dict, Tuple
from urllib.parse import parse_qs
from zoneinfo import ZoneInfo

import requests


CONFIG_PATH = Path(__file__).with_name("config.json")


class ActionError(Exception):
    def __init__(self, reason: str, message: str = "") -> None:
        super().__init__(message or reason)
        self.reason = reason
        self.message = message or reason


class RetryableActionError(ActionError):
    pass


class TerminalActionError(ActionError):
    pass


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


def get_now() -> datetime:
    return datetime.now(get_local_tz())


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
        return {
            key: values[0] if len(values) == 1 else values
            for key, values in parsed.items()
        }

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


def load_config() -> Dict[str, Any]:
    with CONFIG_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _build_bitrix_url(method: str) -> str:
    webhook_url = get_env("BITRIX24_WEBHOOK_URL", "").strip()
    if webhook_url:
        return f"{webhook_url.rstrip('/')}/{method}"

    base_url = get_env("BITRIX24_BASE_URL", "").strip()
    webhook_path = get_env("BITRIX24_WEBHOOK_PATH", "").strip().strip("/")
    if not base_url or not webhook_path:
        raise TerminalActionError(
            "missing_bitrix_config",
            "Missing BITRIX24_BASE_URL or BITRIX24_WEBHOOK_PATH.",
        )

    return f"{base_url.rstrip('/')}/{webhook_path}/{method}.json"


def bitrix_call(method: str, params: Dict[str, Any]) -> Dict[str, Any]:
    url = _build_bitrix_url(method)
    timeout = max(float(get_env_int("BITRIX24_TIMEOUT_SECONDS", 10)), 1.0)
    try:
        response = requests.post(url, json=params, timeout=timeout)
        response.raise_for_status()
        data = response.json()
    except (requests.Timeout, requests.ConnectionError) as exc:
        raise RetryableActionError("bitrix_request_failed", str(exc)) from exc
    except requests.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else 0
        reason = "bitrix_http_error"
        if status_code == 429 or status_code >= 500:
            raise RetryableActionError(reason, str(exc)) from exc
        raise TerminalActionError(reason, str(exc)) from exc
    except ValueError as exc:
        raise RetryableActionError("bitrix_invalid_response", str(exc)) from exc

    if "error" in data:
        description = data.get("error_description") or f"Bitrix24 error on {method}."
        raise TerminalActionError("bitrix_api_error", description)

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


def update_deal_stage(deal_id: str, next_stage: str) -> Dict[str, Any]:
    return bitrix_call("crm.deal.update", {"ID": deal_id, "fields": {"STAGE_ID": next_stage}})


def build_action_key(deal_id: str, stage_id: str, order: int) -> str:
    safe_stage = str(stage_id or "").replace(":", "_")
    return f"bitrix_crm_negociaciones.deal.{deal_id}.stage.{safe_stage}.action_{order}"


def build_plan_key(deal_id: str, stage_id: str) -> str:
    safe_stage = str(stage_id or "").replace(":", "_")
    return f"bitrix_crm_negociaciones.deal.{deal_id}.stage.{safe_stage}.plan"


def build_pending_action(
    *,
    deal_id: str,
    expected_stage: str,
    stage_name: str,
    order: int,
    action_kind: str,
    due_at: datetime,
    template_id: str = "",
    next_stage: str = "",
    depends_on_order: int = 0,
) -> Dict[str, Any]:
    now = get_now().isoformat()
    key = build_action_key(deal_id, expected_stage, order)
    return {
        "action_key": key,
        "deal_id": deal_id,
        "expected_stage": expected_stage,
        "stage_name": stage_name,
        "order": order,
        "action_kind": action_kind,
        "template_id": template_id,
        "next_stage": next_stage,
        "depends_on_order": depends_on_order,
        "previous_sent_at": "",
        "due_at": due_at.isoformat(),
        "status": "pending",
        "reason": "",
        "created_at": now,
        "updated_at": now,
        "processed_at": "",
        "edna_status": "",
        "message_id": key,
    }


def build_plan(
    *,
    deal_id: str,
    expected_stage: str,
    stage_name: str,
    plan_kind: str,
    actions: list[Dict[str, Any]],
    status: str = "draft",
) -> Dict[str, Any]:
    now = get_now().isoformat()
    return {
        "key": build_plan_key(deal_id, expected_stage),
        "deal_id": deal_id,
        "expected_stage": expected_stage,
        "stage_name": stage_name,
        "plan_kind": plan_kind,
        "status": status,
        "created_at": now,
        "updated_at": now,
        "actions": actions,
    }


def finalize_plan(plan: Dict[str, Any], *, status: str | None = None, updated_at: str) -> Dict[str, Any]:
    updated = dict(plan)
    updated["updated_at"] = updated_at
    if status:
        updated["status"] = status
    return updated


def replace_plan_action(plan: Dict[str, Any], updated_action: Dict[str, Any], *, updated_at: str) -> Dict[str, Any]:
    updated = dict(plan)
    actions = []
    target_order = int(updated_action.get("order") or 0)
    replaced = False
    for action in plan.get("actions") or []:
        current_order = int(action.get("order") or 0)
        if current_order == target_order:
            actions.append(updated_action)
            replaced = True
        else:
            actions.append(action)
    if not replaced:
        raise TerminalActionError(
            "missing_action_in_plan",
            f"Action order {target_order} not found in plan {plan.get('key')}.",
        )
    updated["actions"] = actions
    updated["updated_at"] = updated_at
    if all(str(action.get("status") or "") in {"completed", "cancelled", "error"} for action in actions):
        updated["status"] = "completed"
    return updated


def get_plan_action(plan: Dict[str, Any], action_order: int) -> Dict[str, Any]:
    for action in plan.get("actions") or []:
        if int(action.get("order") or 0) == int(action_order):
            return dict(action)
    raise TerminalActionError(
        "missing_action_in_plan",
        f"Action order {action_order} not found in plan {plan.get('key')}.",
    )


def finalize_action(
    action: Dict[str, Any],
    *,
    status: str,
    reason: str,
    processed_at: str,
    edna_status: str = "",
) -> Dict[str, Any]:
    updated = dict(action)
    updated["status"] = status
    updated["reason"] = reason
    updated["processed_at"] = processed_at
    updated["updated_at"] = processed_at
    if edna_status:
        updated["edna_status"] = edna_status
    return updated


def parse_bitrix_datetime(value: str | None) -> datetime | None:
    if not value:
        return None

    raw = str(value).strip()
    if not raw:
        return None

    local_tz = get_local_tz()
    formats = (
        "%Y-%m-%d",
        "%d.%m.%Y",
        "%Y-%m-%d %H:%M:%S",
        "%d/%m/%Y %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S",
    )

    try:
        parsed = datetime.fromisoformat(raw)
        if parsed.tzinfo is not None:
            return parsed.astimezone(local_tz)
        return parsed.replace(tzinfo=local_tz)
    except ValueError:
        pass

    for fmt in formats:
        try:
            parsed = datetime.strptime(raw, fmt)
        except ValueError:
            continue

        if parsed.tzinfo is not None:
            return parsed.astimezone(local_tz)
        return parsed.replace(tzinfo=local_tz)

    return None


def _business_hours() -> Dict[str, Any]:
    return {
        "start_hour": get_env_int("BUSINESS_START_HOUR", 9),
        "start_minute": get_env_int("BUSINESS_START_MINUTE", 0),
        "end_hour": get_env_int("BUSINESS_END_HOUR", 17),
        "end_minute": get_env_int("BUSINESS_END_MINUTE", 0),
        "tz": str(get_local_tz().key),
    }


def next_business_start(dt: datetime) -> datetime:
    bh = _business_hours()
    tz = ZoneInfo(bh["tz"])
    dt = dt.astimezone(tz)
    start = dtime(bh["start_hour"], bh["start_minute"])
    end = dtime(bh["end_hour"], bh["end_minute"])

    while dt.weekday() >= 5:
        dt = (dt + timedelta(days=1)).replace(
            hour=bh["start_hour"],
            minute=bh["start_minute"],
            second=0,
            microsecond=0,
        )

    if dt.time() < start:
        return dt.replace(
            hour=bh["start_hour"],
            minute=bh["start_minute"],
            second=0,
            microsecond=0,
        )
    if dt.time() >= end:
        dt = dt + timedelta(days=1)
        while dt.weekday() >= 5:
            dt = dt + timedelta(days=1)
        return dt.replace(
            hour=bh["start_hour"],
            minute=bh["start_minute"],
            second=0,
            microsecond=0,
        )
    return dt


def add_business_hours(start_dt: datetime, hours: float) -> datetime:
    bh = _business_hours()
    tz = ZoneInfo(bh["tz"])
    dt = start_dt.astimezone(tz)
    remaining = float(hours)

    while remaining > 0:
        dt = next_business_start(dt)
        end_dt = dt.replace(
            hour=bh["end_hour"],
            minute=bh["end_minute"],
            second=0,
            microsecond=0,
        )
        available = (end_dt - dt).total_seconds() / 3600.0
        if remaining <= available:
            dt = dt + timedelta(hours=remaining)
            remaining = 0
        else:
            remaining -= available
            dt = end_dt + timedelta(seconds=1)

    return dt.astimezone(tz)


def promise_send_time(raw_value: str | None) -> datetime | None:
    raw = str(raw_value or "").strip()
    if not raw:
        return None

    # Bitrix date custom fields can arrive serialized as midnight with a foreign
    # offset (for example 2026-05-01T03:00:00+03:00) even when the business
    # meaning is "calendar date in local timezone". Preserve the calendar day.
    date_match = re.match(r"^(\d{4}-\d{2}-\d{2})", raw)
    if date_match:
        parsed = parse_bitrix_datetime(date_match.group(1))
    else:
        parsed = parse_bitrix_datetime(raw)

    if not parsed:
        return None

    send_hour = get_env_int("BUSINESS_START_HOUR", 9)
    send_minute = get_env_int("BUSINESS_START_MINUTE", 0)
    run_at = parsed.astimezone(get_local_tz()).replace(
        hour=send_hour,
        minute=send_minute,
        second=0,
        microsecond=0,
    )
    return next_business_start(run_at)


def seconds_between(start_dt: datetime, end_dt: datetime) -> int:
    delta = int((end_dt - start_dt).total_seconds())
    return max(delta, 0)


def normalize_phone(value: Any) -> str | None:
    if not value:
        return None
    digits = re.sub(r"\D+", "", str(value))
    if digits.startswith("00"):
        digits = digits[2:]
    digits = digits.lstrip("0")
    return digits or None


def parse_amount(value: Any) -> str:
    if value is None:
        return ""
    return str(value).split("|", 1)[0].strip()


def format_amount(value: Any) -> str | None:
    raw = parse_amount(value)
    if raw == "":
        return None

    normalized = raw.replace(".", "").replace(",", ".")
    try:
        amount = float(normalized)
    except ValueError:
        return raw

    return "$" + f"{amount:,.0f}".replace(",", ".")


def extract_contact_name(contact_data: Dict[str, Any] | None, deal: Dict[str, Any]) -> str:
    if contact_data:
        name = str(contact_data.get("NAME") or "").strip()
        last_name = str(contact_data.get("LAST_NAME") or "").strip()
        full_name = f"{name} {last_name}".strip()
        if full_name:
            return full_name

    title = str(deal.get("TITLE") or "").strip()
    if title:
        return title

    return "cliente"


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


def has_new_communication_since(deal: Dict[str, Any], sent_at_iso: str | None) -> bool:
    if not sent_at_iso:
        return False

    sent_at = parse_bitrix_datetime(sent_at_iso)
    last_comm = parse_bitrix_datetime(str(deal.get("LAST_COMMUNICATION_TIME") or ""))
    if sent_at is None or last_comm is None:
        return False
    return last_comm > sent_at


def get_template_variables(template_id: int, deal: Dict[str, Any], contact_data: Dict[str, Any] | None) -> list[str]:
    config = load_config()
    template_cfg = (config.get("templates") or {}).get(str(template_id), {})
    variable_names = template_cfg.get("text_variables") or []

    promise_amount_field = get_env("PROMISE_AMOUNT_FIELD", "UF_CRM_1724429048")
    values_by_name = {
        "deal_title": str(deal.get("TITLE") or "").strip(),
        "contact_name": extract_contact_name(contact_data, deal),
        "promise_amount": format_amount(deal.get(promise_amount_field) or deal.get("OPPORTUNITY")) or "",
    }
    return [values_by_name.get(name, "") for name in variable_names if values_by_name.get(name, "") != ""]


def send_to_edna(template_id: int, deal: Dict[str, Any], contact_data: Dict[str, Any] | None) -> Dict[str, Any]:
    return send_to_edna_with_message_id(
        template_id=template_id,
        deal=deal,
        contact_data=contact_data,
        message_id="",
    )


def send_to_edna_with_message_id(
    *,
    template_id: int,
    deal: Dict[str, Any],
    contact_data: Dict[str, Any] | None,
    message_id: str,
) -> Dict[str, Any]:
    contact_phone = extract_contact_phone(contact_data)
    if not contact_phone:
        raise TerminalActionError("missing_contact_phone", "Missing contact phone.")

    resolved_message_id = message_id.strip() or f"negociaciones-{deal.get('ID')}-{template_id}"
    payload = {
        "messageId": resolved_message_id,
        "sender": get_env("EDNA_SENDER", ""),
        "phone": contact_phone,
        "templateId": int(template_id),
    }

    text_variables = get_template_variables(template_id, deal, contact_data)
    if text_variables:
        payload["textVariables"] = text_variables

    headers = {
        "Content-Type": "application/json",
        "X-API-KEY": get_env("EDNA_API_KEY", ""),
    }

    url = get_env("EDNA_URL", "")
    timeout = max(float(get_env_int("EDNA_TIMEOUT_SECONDS", 15)), 1.0)
    if not payload["sender"] or not headers["X-API-KEY"] or not url:
        raise TerminalActionError(
            "missing_edna_config",
            "Missing EDNA_SENDER, EDNA_API_KEY or EDNA_URL.",
        )
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=timeout)
        response.raise_for_status()
    except (requests.Timeout, requests.ConnectionError) as exc:
        raise RetryableActionError("edna_request_failed", str(exc)) from exc
    except requests.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else 0
        reason = "edna_http_error"
        if status_code == 429 or status_code >= 500:
            raise RetryableActionError(reason, str(exc)) from exc
        raise TerminalActionError(reason, str(exc)) from exc

    try:
        body = response.json()
    except ValueError:
        body = {"raw": response.text}

    return {
        "status_code": response.status_code,
        "payload": payload,
        "response": body,
    }
