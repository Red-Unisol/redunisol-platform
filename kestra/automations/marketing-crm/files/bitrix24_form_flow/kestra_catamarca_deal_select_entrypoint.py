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

    if Kestra is not None:
        Kestra.outputs(result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
