#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys
from typing import Any

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None

from .service import (
    build_error_result,
    build_output_payload,
    consultar_contacto,
    load_config_from_env,
    parse_search_request,
)


def main() -> int:
    request = None
    try:
        payload = _load_trigger_body()
        request = parse_search_request(payload)
        config = load_config_from_env()
        result = consultar_contacto(request, config)
    except Exception as exc:
        result = build_error_result(request, str(exc))

    output_payload = build_output_payload(result)
    _emit_outputs_if_available(output_payload)
    sys.stdout.write(output_payload["response_json"] + "\n")
    return 0


def _load_trigger_body() -> Any:
    raw = os.environ.get("TRIGGER_BODY_JSON", "").strip()
    if not raw:
        raise ValueError("Missing TRIGGER_BODY_JSON.")
    return json.loads(raw)


def _emit_outputs_if_available(output_payload: dict[str, Any]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(output_payload)


if __name__ == "__main__":
    raise SystemExit(main())