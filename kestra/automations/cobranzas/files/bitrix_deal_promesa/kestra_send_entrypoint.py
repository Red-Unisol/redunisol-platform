#!/usr/bin/env python3

from __future__ import annotations

import json
import sys
import time
from typing import Any, Dict

from . import service

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None


def main() -> int:
    try:
        result = _handle_send()
    except Exception as exc:
        result = {
            "ok": False,
            "action": "error",
            "reason": "exception",
            "message": str(exc),
            "deal_id": "",
            "edna_status": "",
        }

    _emit_outputs_if_available(result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0


def _handle_send() -> Dict[str, Any]:
    deal_id = service.get_env("DEAL_ID", "").strip()
    expected_promise_value = service.get_env("EXPECTED_PROMISE_VALUE", "")
    delay_seconds = service.get_env_int("DELAY_SECONDS", 0)

    if not deal_id:
        return _result(ok=False, action="error", reason="missing_deal_id")

    if delay_seconds > 0:
        time.sleep(delay_seconds)

    deal_data, contact_data = service.fetch_deal_with_contact(deal_id)
    if not service.should_send(deal_data, expected_promise_value):
        return _result(ok=True, action="skipped", reason="stale_deal", deal_id=deal_id)

    status = service.send_to_edna(deal_data, contact_data)
    return _result(ok=True, action="sent", reason="sent", deal_id=deal_id, edna_status=str(status))


def _result(
    *,
    ok: bool,
    action: str,
    reason: str,
    deal_id: str = "",
    edna_status: str = "",
) -> Dict[str, Any]:
    return {
        "ok": ok,
        "action": action,
        "reason": reason,
        "deal_id": deal_id,
        "edna_status": edna_status,
    }


def _emit_outputs_if_available(result: Dict[str, Any]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(
        {
            "ok": bool(result.get("ok", False)),
            "action": str(result.get("action") or ""),
            "reason": str(result.get("reason") or ""),
            "deal_id": str(result.get("deal_id") or ""),
            "edna_status": str(result.get("edna_status") or ""),
        }
    )


if __name__ == "__main__":
    raise SystemExit(main())
