#!/usr/bin/env python3

from __future__ import annotations

import json
import sys
from datetime import datetime
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
        result["payload_preview"] = _payload_preview(payload)
    except Exception as exc:
        result = _result(
            ok=False,
            action="error",
            reason="exception",
            message=str(exc),
        )

    _emit_outputs_if_available(result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0


def process_webhook(payload: Any) -> Dict[str, Any]:
    form = payload if isinstance(payload, dict) else {}

    app_token = service.get_value(
        form,
        "auth[application_token]",
        ("auth", "application_token"),
    )
    expected_token = service.get_env("BITRIX24_APP_TOKEN", "").strip()
    if expected_token and (not app_token or app_token != expected_token):
        return _result(ok=False, action="invalid_token", reason="invalid_token")

    event = service.get_value(form, "event", ("event",))
    if event and event != "ONCRMDEALUPDATE":
        return _result(ok=True, action="ignored", reason="event_not_deal_update")

    deal_id = service.get_value(form, "data[FIELDS][ID]", ("data", "FIELDS", "ID"))
    if not deal_id:
        return _result(ok=False, action="error", reason="missing_deal_id")

    deal_data, _ = service.fetch_deal_with_contact(str(deal_id))
    stage_id = str(deal_data.get("STAGE_ID") or "")
    prev_stage_id = str(
        service.get_value(form, "data[PREVIOUS][STAGE_ID]", ("data", "PREVIOUS", "STAGE_ID"))
        or ""
    )

    if not stage_id.startswith("C11:"):
        return _result(ok=True, action="ignored", reason="not_c11", deal_id=str(deal_id))
    if prev_stage_id and prev_stage_id == stage_id:
        return _result(
            ok=True,
            action="ignored",
            reason="stage_not_changed",
            deal_id=str(deal_id),
            stage_id=stage_id,
        )

    config = service.load_config()
    stage_cfg = (config.get("stages") or {}).get(stage_id)
    if not stage_cfg:
        return _result(
            ok=True,
            action="ignored",
            reason="stage_not_tracked",
            deal_id=str(deal_id),
            stage_id=stage_id,
        )

    plan = build_stage_plan(deal_data, stage_id, stage_cfg)
    return _result(
        ok=True,
        action="planned",
        reason=plan["plan_kind"],
        deal_id=str(deal_id),
        stage_id=stage_id,
        stage_name=str(stage_cfg.get("name") or ""),
        planned_action_count=str(len(plan["actions"])),
        plan_key=plan["plan"]["key"],
        plan_json_draft=json.dumps(plan["plan"], ensure_ascii=True),
        plan_json_ready=json.dumps(plan["plan_ready"], ensure_ascii=True),
        action_1_enabled=bool(len(plan["actions"]) >= 1),
        action_1_order=str(plan["actions"][0]["order"]) if len(plan["actions"]) >= 1 else "",
        action_1_due_at=plan["actions"][0]["due_at"] if len(plan["actions"]) >= 1 else "",
        action_2_enabled=bool(len(plan["actions"]) >= 2),
        action_2_order=str(plan["actions"][1]["order"]) if len(plan["actions"]) >= 2 else "",
        action_2_due_at=plan["actions"][1]["due_at"] if len(plan["actions"]) >= 2 else "",
        action_3_enabled=bool(len(plan["actions"]) >= 3),
        action_3_order=str(plan["actions"][2]["order"]) if len(plan["actions"]) >= 3 else "",
        action_3_due_at=plan["actions"][2]["due_at"] if len(plan["actions"]) >= 3 else "",
        planned_first_action_at=plan["planned_first_action_at"],
        planned_second_action_at=plan["planned_second_action_at"],
        planned_move_at=plan["planned_move_at"],
    )


def build_stage_plan(deal_data: Dict[str, Any], stage_id: str, stage_cfg: Dict[str, Any]) -> Dict[str, Any]:
    now = service.get_now()
    template_id = int(stage_cfg.get("template_id") or 0)
    second_template_id = int(stage_cfg.get("second_template_id") or 0)
    wait_hours = float(stage_cfg.get("wait_hours_no_response") or 0)
    second_wait_hours = float(stage_cfg.get("second_wait_hours") or 0)
    final_wait_hours = float(stage_cfg.get("final_wait_hours") or 0)
    next_stage = str(stage_cfg.get("next_stage_if_no_response") or "")
    send_on_promise_date = bool(stage_cfg.get("send_on_promise_date"))

    first_action_at: datetime | None = None
    second_action_at: datetime | None = None
    move_at: datetime | None = None
    plan_kind = "move_only"

    if send_on_promise_date and template_id:
        promise_field = service.get_env("PROMISE_DATE_FIELD", "UF_CRM_1724427951")
        promise_value = str(deal_data.get(promise_field) or "").strip()
        first_action_at = service.promise_send_time(promise_value)
        if first_action_at is None:
            raise ValueError(f"Missing or invalid promise date for deal {deal_data.get('ID')}.")

        if first_action_at <= now:
            first_action_at = now

        if wait_hours and next_stage:
            move_at = service.add_business_hours(first_action_at, wait_hours)

        plan_kind = "promise_date"

    elif second_template_id and second_wait_hours and final_wait_hours and next_stage:
        first_action_at = now if template_id else None
        second_action_at = service.add_business_hours(now, second_wait_hours)
        move_at = service.add_business_hours(now, second_wait_hours + final_wait_hours)
        plan_kind = "double_send_then_move"

    elif template_id and wait_hours and next_stage:
        first_action_at = now
        move_at = service.add_business_hours(now, wait_hours)
        plan_kind = "send_then_move"

    elif wait_hours and next_stage:
        move_at = service.add_business_hours(now, wait_hours)
        plan_kind = "move_only"

    else:
        raise ValueError(f"Unsupported stage config for {stage_id}.")

    actions: list[Dict[str, Any]] = []
    previous_order = 0

    if template_id and first_action_at:
        action = service.build_pending_action(
            deal_id=str(deal_data.get("ID") or ""),
            expected_stage=stage_id,
            stage_name=str(stage_cfg.get("name") or ""),
            order=1,
            action_kind="send_or_noop",
            due_at=first_action_at,
            template_id=str(template_id),
            depends_on_order=0,
        )
        actions.append(action)
        previous_order = int(action["order"])

    if second_template_id and second_action_at:
        action = service.build_pending_action(
            deal_id=str(deal_data.get("ID") or ""),
            expected_stage=stage_id,
            stage_name=str(stage_cfg.get("name") or ""),
            order=2,
            action_kind="send_or_noop",
            due_at=second_action_at,
            template_id=str(second_template_id),
            depends_on_order=previous_order,
        )
        actions.append(action)
        previous_order = int(action["order"])

    if next_stage and move_at:
        action = service.build_pending_action(
            deal_id=str(deal_data.get("ID") or ""),
            expected_stage=stage_id,
            stage_name=str(stage_cfg.get("name") or ""),
            order=3,
            action_kind="move_or_noop",
            due_at=move_at,
            next_stage=next_stage,
            depends_on_order=previous_order,
        )
        actions.append(action)

    plan = service.build_plan(
        deal_id=str(deal_data.get("ID") or ""),
        expected_stage=stage_id,
        stage_name=str(stage_cfg.get("name") or ""),
        plan_kind=plan_kind,
        actions=actions,
        status="draft",
    )
    plan_ready = service.finalize_plan(plan, status="ready", updated_at=service.get_now().isoformat())

    return {
        "plan_kind": plan_kind,
        "plan": plan,
        "plan_ready": plan_ready,
        "actions": actions,
        "planned_first_action_at": first_action_at.isoformat() if first_action_at else "",
        "planned_second_action_at": second_action_at.isoformat() if second_action_at else "",
        "planned_move_at": move_at.isoformat() if move_at else "",
    }


def _result(
    *,
    ok: bool,
    action: str,
    reason: str,
    message: str = "",
    deal_id: str = "",
    stage_id: str = "",
    stage_name: str = "",
    planned_action_count: str = "0",
    plan_key: str = "",
    plan_json_draft: str = "",
    plan_json_ready: str = "",
    action_1_enabled: bool = False,
    action_1_order: str = "",
    action_1_due_at: str = "",
    action_2_enabled: bool = False,
    action_2_order: str = "",
    action_2_due_at: str = "",
    action_3_enabled: bool = False,
    action_3_order: str = "",
    action_3_due_at: str = "",
    planned_first_action_at: str = "",
    planned_second_action_at: str = "",
    planned_move_at: str = "",
) -> Dict[str, Any]:
    return {
        "ok": ok,
        "action": action,
        "reason": reason,
        "message": message,
        "deal_id": deal_id,
        "stage_id": stage_id,
        "stage_name": stage_name,
        "planned_action_count": planned_action_count,
        "plan_key": plan_key,
        "plan_json_draft": plan_json_draft,
        "plan_json_ready": plan_json_ready,
        "action_1_enabled": action_1_enabled,
        "action_1_order": action_1_order,
        "action_1_due_at": action_1_due_at,
        "action_2_enabled": action_2_enabled,
        "action_2_order": action_2_order,
        "action_2_due_at": action_2_due_at,
        "action_3_enabled": action_3_enabled,
        "action_3_order": action_3_order,
        "action_3_due_at": action_3_due_at,
        "planned_first_action_at": planned_first_action_at,
        "planned_second_action_at": planned_second_action_at,
        "planned_move_at": planned_move_at,
        "payload_preview": "",
    }


def _payload_preview(payload: Any) -> str:
    if payload is None:
        return ""
    try:
        raw = json.dumps(payload, ensure_ascii=True)
    except Exception:
        raw = str(payload)
    return raw[:2000]


def _emit_outputs_if_available(result: Dict[str, Any]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(result)


if __name__ == "__main__":
    raise SystemExit(main())
