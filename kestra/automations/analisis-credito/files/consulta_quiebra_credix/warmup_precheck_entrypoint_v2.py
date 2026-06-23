#!/usr/bin/env python3

from __future__ import annotations

import json
import sys
from typing import Any

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None

from .warmup_entrypoint_v2 import run_precheck


def main() -> int:
    try:
        output_payload = run_precheck()
    except Exception as exc:
        output_payload = {
            "ok": False,
            "has_candidates": False,
            "solicitudes_count": "0",
            "candidate_count": "0",
            "skipped_count": "0",
            "error": str(exc),
        }

    _emit_outputs_if_available(output_payload)
    sys.stdout.write(
        json.dumps(output_payload, ensure_ascii=True, separators=(",", ":")) + "\n"
    )
    return 0


def _emit_outputs_if_available(output_payload: dict[str, Any]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(output_payload)


if __name__ == "__main__":
    raise SystemExit(main())
