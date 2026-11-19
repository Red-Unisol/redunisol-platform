"""Small, standard-library-only gate for the MUDON resume scheduler."""
from __future__ import annotations

import json
import os
from typing import Any


TERMINAL_STATUSES = frozenset({"idle", "completed", "completed_with_errors"})


def parse_trigger_body(raw: str) -> dict[str, Any]:
    if not raw.strip():
        return {}
    value: Any = json.loads(raw)
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict):
        raise ValueError("El body del webhook debe ser un objeto JSON.")
    return value


def should_process(run_mode: str, resume_state: str, raw_body: str = "{}") -> bool:
    # New monthly/manual requests always reach the authoritative SQLite state.
    if run_mode.strip().lower() != "resume" or resume_state != "idle":
        return True
    try:
        payload = parse_trigger_body(raw_body)
    except (ValueError, TypeError):
        # The existing entrypoint reports malformed requests instead of silently skipping them.
        return True
    if not isinstance(payload, dict):
        return True
    return bool(payload.get("retry_errors")) or str(payload.get("mode", "")).lower() == "status"


def resume_state_for_result(result: dict[str, Any], raw_body: str = "{}") -> str:
    try:
        payload = parse_trigger_body(raw_body)
    except (ValueError, TypeError):
        return "pending"
    # A status-only request observes the latest run; it must not clear the resume marker.
    if not isinstance(payload, dict) or str(payload.get("mode", "")).lower() == "status":
        return "pending"
    if (result.get("ok") is True and result.get("status") in TERMINAL_STATUSES
            and result.get("pending") == 0):
        return "idle"
    return "pending"


def main() -> int:
    result = {"should_run": should_process(os.getenv("RUN_MODE", "manual"),
                                          os.getenv("MUDON_RESUME_STATE", ""),
                                          os.getenv("TRIGGER_BODY_JSON", "{}"))}
    # Kestra's stdout protocol works with the Process runner without the Python SDK.
    print("::" + json.dumps({"outputs": result}, separators=(",", ":")) + "::")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
