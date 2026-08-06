#!/usr/bin/env python3

from __future__ import annotations

import json
import sys

from .form_processor.catamarca_deal_qualification import (
    select_next_pending_catamarca_deal,
)

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover
    Kestra = None


def main() -> int:
    try:
        result = select_next_pending_catamarca_deal()
    except Exception as exc:
        result = {
            "ok": False,
            "action": "error",
            "has_pending": False,
            "deal_id": "",
            "lead_id": "",
            "message": str(exc),
        }

    outputs = _kestra_outputs(result)
    if Kestra is not None:
        Kestra.outputs(outputs)
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0


def _kestra_outputs(result: dict[str, object]) -> dict[str, object]:
    return {
        **result,
        "deal_id": "" if result.get("deal_id") is None else str(result["deal_id"]),
        "lead_id": "" if result.get("lead_id") is None else str(result["lead_id"]),
        "stage_id": str(result.get("stage_id") or ""),
        "reason": str(result.get("reason") or ""),
    }


if __name__ == "__main__":
    raise SystemExit(main())
