#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys

from .form_processor.lead_prefill_service import select_next_new_lead_for_prefill

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover
    Kestra = None


def main() -> int:
    try:
        result = select_next_new_lead_for_prefill(
            date_from=os.getenv("BACKFILL_DATE_FROM", "").strip() or None,
        )
    except Exception as exc:
        result = {
            "ok": False,
            "action": "error",
            "has_pending": False,
            "lead_id": "",
            "cuil": "",
            "attempts": 0,
            "message": str(exc),
        }

    if Kestra is not None:
        Kestra.outputs(result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
