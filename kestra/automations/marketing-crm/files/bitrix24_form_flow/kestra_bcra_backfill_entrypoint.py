#!/usr/bin/env python3

from __future__ import annotations

import json
import sys

from .form_processor.bcra_service import backfill_bcra_for_today

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None


def main() -> int:
    try:
        result = backfill_bcra_for_today()
    except Exception as exc:
        result = {
            "ok": False,
            "action": "error",
            "processed_count": 0,
            "populated_count": 0,
            "rejected_count": 0,
            "skipped_populated_count": 0,
            "skipped_missing_cuil_count": 0,
            "temporary_error_count": 0,
            "rate_limited": False,
            "message": str(exc),
        }

    _emit_outputs_if_available(result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0


def _emit_outputs_if_available(result: dict[str, object]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(
        {
            "ok": bool(result.get("ok", False)),
            "action": str(result.get("action") or ""),
            "processed_count": int(result.get("processed_count", 0) or 0),
            "populated_count": int(result.get("populated_count", 0) or 0),
            "rejected_count": int(result.get("rejected_count", 0) or 0),
            "skipped_populated_count": int(result.get("skipped_populated_count", 0) or 0),
            "skipped_missing_cuil_count": int(result.get("skipped_missing_cuil_count", 0) or 0),
            "temporary_error_count": int(result.get("temporary_error_count", 0) or 0),
            "rate_limited": bool(result.get("rate_limited", False)),
            "message": str(result.get("message") or ""),
        }
    )


if __name__ == "__main__":
    raise SystemExit(main())