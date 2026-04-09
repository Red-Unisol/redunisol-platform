#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import json
import os
import sys
from typing import Any, Dict

import requests

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None

CONTROL_FORWARD_URL_KEY = "_bridge_forward_url"
CONTROL_TIMEOUT_KEY = "_bridge_timeout_seconds"
PAYLOAD_PREVIEW_LIMIT = 2000
DEFAULT_TIMEOUT_SECONDS = 10.0


def main() -> int:
    try:
        payload = _load_trigger_body()
        result = process_payload(payload)
    except Exception as exc:
        result = {
            "ok": False,
            "forward_attempted": False,
            "forward_connected": False,
            "forward_target": "",
            "forward_status_code": "",
            "forward_error": str(exc),
            "payload_sha256": "",
            "payload_preview": "",
        }

    _emit_outputs_if_available(result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0


def process_payload(payload: Any, *, session: requests.Session | None = None) -> Dict[str, Any]:
    serialized_payload = _serialize_payload(payload)
    payload_sha256 = hashlib.sha256(serialized_payload.encode("utf-8")).hexdigest()
    payload_preview = _build_preview(serialized_payload)
    forward_url = _resolve_forward_url(payload)
    timeout_seconds = _resolve_timeout_seconds(payload)
    forwarded_payload = _strip_control_fields(payload)

    _log_event(
        "incoming_payload",
        payload_sha256=payload_sha256,
        payload_preview=payload_preview,
        forward_target=forward_url,
        timeout_seconds=timeout_seconds,
    )

    result: Dict[str, Any] = {
        "ok": True,
        "forward_attempted": bool(forward_url),
        "forward_connected": False,
        "forward_target": forward_url,
        "forward_status_code": "",
        "forward_error": "",
        "payload_sha256": payload_sha256,
        "payload_preview": payload_preview,
    }

    if not forward_url:
        result["forward_error"] = "No forward target configured. Use _bridge_forward_url in the payload."
        _log_event("forward_skipped", reason=result["forward_error"])
        return result

    http = session or requests.Session()
    try:
        response = http.post(
            forward_url,
            json=forwarded_payload,
            timeout=timeout_seconds,
            headers={"Content-Type": "application/json"},
        )
        result["forward_connected"] = True
        result["forward_status_code"] = str(response.status_code)
        _log_event(
            "forward_response",
            forward_target=forward_url,
            status_code=response.status_code,
            response_preview=_build_preview(response.text or ""),
        )
    except requests.RequestException as exc:
        result["forward_error"] = str(exc)
        _log_event("forward_unavailable", forward_target=forward_url, error=str(exc))

    return result


def _load_trigger_body() -> Any:
    raw = os.environ.get("TRIGGER_BODY_JSON", "").strip()
    if not raw:
        raise ValueError("Missing TRIGGER_BODY_JSON.")
    return json.loads(raw)


def _serialize_payload(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def _build_preview(text: str) -> str:
    if len(text) <= PAYLOAD_PREVIEW_LIMIT:
        return text
    return text[: PAYLOAD_PREVIEW_LIMIT - 3] + "..."


def _resolve_forward_url(payload: Any) -> str:
    if not isinstance(payload, dict):
        return ""
    value = payload.get(CONTROL_FORWARD_URL_KEY)
    if value is None:
        return ""
    return str(value).strip()


def _resolve_timeout_seconds(payload: Any) -> float:
    if not isinstance(payload, dict):
        return DEFAULT_TIMEOUT_SECONDS
    value = payload.get(CONTROL_TIMEOUT_KEY)
    if value in (None, ""):
        return DEFAULT_TIMEOUT_SECONDS

    timeout_seconds = float(value)
    if timeout_seconds <= 0:
        raise ValueError("_bridge_timeout_seconds must be greater than 0.")
    return timeout_seconds


def _strip_control_fields(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload

    return {
        key: value
        for key, value in payload.items()
        if key not in {CONTROL_FORWARD_URL_KEY, CONTROL_TIMEOUT_KEY}
    }


def _log_event(event: str, **fields: Any) -> None:
    log_line = {"event": event, **fields}
    sys.stdout.write(json.dumps(log_line, ensure_ascii=True) + "\n")


def _emit_outputs_if_available(result: Dict[str, Any]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(
        {
            "ok": bool(result.get("ok", False)),
            "forward_attempted": bool(result.get("forward_attempted", False)),
            "forward_connected": bool(result.get("forward_connected", False)),
            "forward_target": str(result.get("forward_target") or ""),
            "forward_status_code": str(result.get("forward_status_code") or ""),
            "forward_error": str(result.get("forward_error") or ""),
            "payload_sha256": str(result.get("payload_sha256") or ""),
            "payload_preview": str(result.get("payload_preview") or ""),
        }
    )


if __name__ == "__main__":
    raise SystemExit(main())