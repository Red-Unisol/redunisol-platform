#!/usr/bin/env python3

from __future__ import annotations

import json
import sys
from datetime import datetime, time as dtime
from typing import Any, Dict

from . import service

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None


def main() -> int:
    try:
        payload = service.parse_trigger_body()
        result = process_webhook(payload)
    except Exception as exc:
        result = {
            "ok": False,
            "action": "error",
            "reason": "exception",
            "message": str(exc),
            "scheduled_for": "",
            "deal_id": "",
            "edna_status": "",
            "delay_seconds": "",
            "expected_promise_value": "",
            "should_send": False,
        }

    _emit_outputs_if_available(result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0


def process_webhook(payload: Any) -> Dict[str, Any]:
    form = payload if isinstance(payload, dict) else {}
    app_token = service.get_value(form, "auth[application_token]", ("auth", "application_token"))
    expected_token = _require_env("BITRIX24_APP_TOKEN")

    if app_token != expected_token:
        return _result(ok=False, action="invalid_token", reason="invalid_token")

    event = service.get_value(form, "event", ("event",))
    if event != "ONCRMDEALUPDATE":
        return _result(ok=True, action="ignored", reason="event_not_deal_update")

    deal_id = service.get_value(form, "data[FIELDS][ID]", ("data", "FIELDS", "ID"))
    if not deal_id:
        return _result(ok=False, action="error", reason="missing_deal_id")

    deal_data, _ = service.fetch_deal_with_contact(str(deal_id))

    stage_id = str(deal_data.get("STAGE_ID") or "")
    category_id = str(deal_data.get("CATEGORY_ID") or "")
    prev_stage_id = (
        service.get_value(form, "data[PREVIOUS][STAGE_ID]", ("data", "PREVIOUS", "STAGE_ID"))
        or str(deal_data.get("PREVIOUS_STAGE_ID") or "")
    )

    if not _is_entering_target_stage(stage_id, category_id, prev_stage_id):
        return _result(ok=True, action="ignored", reason="stage_not_target")

    promise_field = service.get_env("PROMISE_DATE_FIELD", "UF_CRM_1724427951")
    promise_value = str(deal_data.get(promise_field) or "")
    target_dt = service.parse_promise_datetime(promise_value)
    if not target_dt:
        return _result(ok=True, action="ignored", reason="invalid_promise_date")

    target_dt = service.adjust_to_business_hours(target_dt)
    schedule = _compute_schedule(target_dt)
    return _result(
        ok=True,
        action="scheduled",
        reason="scheduled",
        scheduled_for=schedule["scheduled_for"],
        deal_id=str(deal_id),
        edna_status="",
        delay_seconds=str(schedule["delay_seconds"]),
        expected_promise_value=promise_value,
        should_send=True,
    )


def _compute_schedule(target_dt: datetime) -> Dict[str, str]:
    now = datetime.now(service.get_local_tz())
    scheduled_for = target_dt
    delay_seconds = (scheduled_for - now).total_seconds()

    start = dtime(service.get_env_int("BUSINESS_START_HOUR", 9), service.get_env_int("BUSINESS_START_MINUTE", 0))
    end = dtime(service.get_env_int("BUSINESS_END_HOUR", 17), service.get_env_int("BUSINESS_END_MINUTE", 0))

    if delay_seconds <= 0:
        if start <= now.time() <= end:
            delay_seconds = 0
            scheduled_for = now
        else:
            scheduled_for = service.adjust_to_business_hours(now)
            delay_seconds = (scheduled_for - now).total_seconds()

    return {
        "scheduled_for": scheduled_for.isoformat(),
        "delay_seconds": str(int(max(delay_seconds, 0))),
    }


def _is_entering_target_stage(stage_id: str, category_id: str, prev_stage_id: str) -> bool:
    target_stage_id = service.get_env("TARGET_STAGE_ID", "C11:PREPARATION")
    target_category_id = service.get_env("TARGET_CATEGORY_ID", "11")

    if stage_id != target_stage_id:
        return False
    if category_id != target_category_id:
        return False
    if prev_stage_id == target_stage_id:
        return False
    return True
def _require_env(name: str) -> str:
    value = service.get_env(name, "")
    if not value:
        raise ValueError(f"Missing environment variable {name}.")
    return value


def _result(
    *,
    ok: bool,
    action: str,
    reason: str,
    scheduled_for: str = "",
    deal_id: str = "",
    edna_status: str = "",
    delay_seconds: str = "",
    expected_promise_value: str = "",
    should_send: bool = False,
) -> Dict[str, Any]:
    return {
        "ok": ok,
        "action": action,
        "reason": reason,
        "scheduled_for": scheduled_for,
        "deal_id": deal_id,
        "edna_status": edna_status,
        "delay_seconds": delay_seconds,
        "expected_promise_value": expected_promise_value,
        "should_send": should_send,
    }


def _emit_outputs_if_available(result: Dict[str, Any]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(
        {
            "ok": bool(result.get("ok", False)),
            "action": str(result.get("action") or ""),
            "reason": str(result.get("reason") or ""),
            "scheduled_for": str(result.get("scheduled_for") or ""),
            "deal_id": str(result.get("deal_id") or ""),
            "edna_status": str(result.get("edna_status") or ""),
            "delay_seconds": str(result.get("delay_seconds") or ""),
            "expected_promise_value": str(result.get("expected_promise_value") or ""),
            "should_send": bool(result.get("should_send", False)),
        }
    )


if __name__ == "__main__":
    raise SystemExit(main())
