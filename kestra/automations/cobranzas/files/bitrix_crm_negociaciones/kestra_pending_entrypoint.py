#!/usr/bin/env python3

from __future__ import annotations

import json
import sys
from typing import Any, Dict

from . import service

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None


def main() -> int:
    result = handle_pending_action()
    _emit_outputs_if_available(result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0


def handle_pending_action() -> Dict[str, Any]:
    plan = _load_json_env("PLAN_JSON")
    action_order = int(service.get_env("ACTION_ORDER", "0") or 0)

    if not isinstance(plan, dict) or not plan:
        return _result(ok=True, action="ignored", reason="missing_plan", should_update=False)
    if action_order <= 0:
        return _result(ok=False, action="error", reason="missing_action_order", should_update=False)

    now = service.get_now()
    plan_key = str(plan.get("key") or "")
    plan_status = str(plan.get("status") or "")
    if plan_status == "draft":
        raise service.RetryableActionError(
            "plan_not_ready",
            f"Plan {plan_key} is still draft.",
        )
    if plan_status in {"cancelled", "completed"}:
        return _result(
            ok=True,
            action="ignored",
            reason="plan_finalized",
            should_update=False,
            plan_key=plan_key,
        )

    try:
        action = service.get_plan_action(plan, action_order)
        status = str(action.get("status") or "pending")
        action_key = str(action.get("action_key") or "")

        if status != "pending":
            return _result(
                ok=True,
                action="ignored",
                reason="already_finalized",
                should_update=False,
                action_key=action_key,
                plan_key=plan_key,
            )

        due_at = service.parse_bitrix_datetime(str(action.get("due_at") or ""))
        if due_at is None:
            updated = service.finalize_action(
                action,
                status="error",
                reason="invalid_due_at",
                processed_at=now.isoformat(),
            )
            return _result(
                ok=False,
                action="error",
                reason="invalid_due_at",
                should_update=True,
                action_key=action_key,
                plan_key=plan_key,
                updated_plan_json=json.dumps(
                    service.replace_plan_action(plan, updated, updated_at=now.isoformat()),
                    ensure_ascii=True,
                ),
            )

        if due_at > now:
            return _result(
                ok=True,
                action="pending",
                reason="not_due",
                should_update=False,
                action_key=action_key,
                plan_key=plan_key,
            )

        dependency_check = _validate_dependency(plan, action)
        if dependency_check is not None:
            return dependency_check

        deal_id = str(action.get("deal_id") or "")
        expected_stage = str(action.get("expected_stage") or "")
        previous_sent_at = str(action.get("previous_sent_at") or "")

        deal_data, contact_data = service.fetch_deal_with_contact(deal_id)
        current_stage = str(deal_data.get("STAGE_ID") or "")
        if expected_stage and current_stage != expected_stage:
            updated = service.finalize_action(
                action,
                status="cancelled",
                reason="stage_mismatch",
                processed_at=now.isoformat(),
            )
            return _result(
                ok=True,
                action="cancelled",
                reason="stage_mismatch",
                should_update=True,
                action_key=action_key,
                plan_key=plan_key,
                updated_plan_json=json.dumps(
                    service.replace_plan_action(plan, updated, updated_at=now.isoformat()),
                    ensure_ascii=True,
                ),
            )

        if previous_sent_at and service.has_new_communication_since(deal_data, previous_sent_at):
            updated = service.finalize_action(
                action,
                status="cancelled",
                reason="new_communication",
                processed_at=now.isoformat(),
            )
            return _result(
                ok=True,
                action="cancelled",
                reason="new_communication",
                should_update=True,
                action_key=action_key,
                plan_key=plan_key,
                updated_plan_json=json.dumps(
                    service.replace_plan_action(plan, updated, updated_at=now.isoformat()),
                    ensure_ascii=True,
                ),
            )

        action_kind = str(action.get("action_kind") or "")
        if action_kind == "send_or_noop":
            template_id = str(action.get("template_id") or "")
            if not template_id:
                updated = service.finalize_action(
                    action,
                    status="cancelled",
                    reason="missing_template_id",
                    processed_at=now.isoformat(),
                )
                return _result(
                    ok=True,
                    action="cancelled",
                    reason="missing_template_id",
                    should_update=True,
                    action_key=action_key,
                    plan_key=plan_key,
                    updated_plan_json=json.dumps(
                        service.replace_plan_action(plan, updated, updated_at=now.isoformat()),
                        ensure_ascii=True,
                    ),
                )

            edna_result = service.send_to_edna_with_message_id(
                template_id=int(template_id),
                deal=deal_data,
                contact_data=contact_data,
                message_id=str(action.get("message_id") or ""),
            )
            updated = service.finalize_action(
                action,
                status="completed",
                reason="sent",
                processed_at=now.isoformat(),
                edna_status=str(edna_result.get("status_code") or ""),
            )
            return _result(
                ok=True,
                action="completed",
                reason="sent",
                should_update=True,
                action_key=action_key,
                plan_key=plan_key,
                updated_plan_json=json.dumps(
                    service.replace_plan_action(plan, updated, updated_at=now.isoformat()),
                    ensure_ascii=True,
                ),
                edna_status=str(edna_result.get("status_code") or ""),
            )

        if action_kind == "move_or_noop":
            next_stage = str(action.get("next_stage") or "")
            if not next_stage:
                updated = service.finalize_action(
                    action,
                    status="cancelled",
                    reason="missing_next_stage",
                    processed_at=now.isoformat(),
                )
                return _result(
                    ok=True,
                    action="cancelled",
                    reason="missing_next_stage",
                    should_update=True,
                    action_key=action_key,
                    plan_key=plan_key,
                    updated_plan_json=json.dumps(
                        service.replace_plan_action(plan, updated, updated_at=now.isoformat()),
                        ensure_ascii=True,
                    ),
                )

            service.update_deal_stage(deal_id, next_stage)
            updated = service.finalize_action(
                action,
                status="completed",
                reason="moved",
                processed_at=now.isoformat(),
            )
            return _result(
                ok=True,
                action="completed",
                reason="moved",
                should_update=True,
                action_key=action_key,
                plan_key=plan_key,
                updated_plan_json=json.dumps(
                    service.replace_plan_action(plan, updated, updated_at=now.isoformat()),
                    ensure_ascii=True,
                ),
            )

        updated = service.finalize_action(
            action,
            status="error",
            reason="unknown_action_kind",
            processed_at=now.isoformat(),
        )
        return _result(
            ok=False,
            action="error",
            reason="unknown_action_kind",
            should_update=True,
            action_key=action_key,
            plan_key=plan_key,
            updated_plan_json=json.dumps(
                service.replace_plan_action(plan, updated, updated_at=now.isoformat()),
                ensure_ascii=True,
            ),
        )
    except service.TerminalActionError as exc:
        updated = service.finalize_action(
            action,
            status="error",
            reason=exc.reason,
            processed_at=now.isoformat(),
        )
        return _result(
            ok=False,
            action="error",
            reason=exc.reason,
            message=exc.message,
            should_update=True,
            action_key=action_key,
            plan_key=plan_key,
            updated_plan_json=json.dumps(
                service.replace_plan_action(plan, updated, updated_at=now.isoformat()),
                ensure_ascii=True,
            ),
        )


def _validate_dependency(plan: Dict[str, Any], action: Dict[str, Any]) -> Dict[str, Any] | None:
    depends_on_order = int(action.get("depends_on_order") or 0)
    if depends_on_order <= 0:
        return None

    action_key = str(action.get("action_key") or "")
    dependency = None
    for candidate in plan.get("actions") or []:
        if int(candidate.get("order") or 0) == depends_on_order:
            dependency = candidate
            break

    if not isinstance(dependency, dict) or not dependency:
        raise service.RetryableActionError(
            "waiting_dependency",
            f"Dependency order {depends_on_order} is not available yet for {action_key}.",
        )

    dependency_status = str(dependency.get("status") or "pending")
    if dependency_status == "pending":
        raise service.RetryableActionError(
            "waiting_dependency",
            f"Dependency order {depends_on_order} is still pending for {action_key}.",
        )

    if dependency_status != "completed":
        updated = service.finalize_action(
            action,
            status="cancelled",
            reason="dependency_not_completed",
            processed_at=service.get_now().isoformat(),
        )
        return _result(
            ok=True,
            action="cancelled",
            reason="dependency_not_completed",
            should_update=True,
            action_key=action_key,
            plan_key=str(plan.get("key") or ""),
            updated_plan_json=json.dumps(
                service.replace_plan_action(plan, updated, updated_at=service.get_now().isoformat()),
                ensure_ascii=True,
            ),
        )

    processed_at = str(dependency.get("processed_at") or "")
    if processed_at and not action.get("previous_sent_at"):
        action["previous_sent_at"] = processed_at
    return None


def _load_json_env(name: str) -> Any:
    raw = service.get_env(name, "").strip()
    if not raw:
        return None
    return json.loads(raw)


def _result(
    *,
    ok: bool,
    action: str,
    reason: str,
    message: str = "",
    should_update: bool,
    action_key: str = "",
    plan_key: str = "",
    updated_plan_json: str = "",
    action_ttl: str = "P45D",
    edna_status: str = "",
) -> Dict[str, Any]:
    return {
        "ok": ok,
        "action": action,
        "reason": reason,
        "message": message,
        "should_update": should_update,
        "action_key": action_key,
        "plan_key": plan_key,
        "updated_plan_json": updated_plan_json,
        "action_ttl": action_ttl,
        "edna_status": edna_status,
    }


def _emit_outputs_if_available(result: Dict[str, Any]) -> None:
    if Kestra is None:
        return
    Kestra.outputs(result)


if __name__ == "__main__":
    raise SystemExit(main())
