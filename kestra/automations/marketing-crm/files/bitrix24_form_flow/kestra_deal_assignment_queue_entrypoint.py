#!/usr/bin/env python3

from __future__ import annotations

import json
import sys

from .form_processor.catamarca_deal_qualification import process_distribution_queue

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover
    Kestra = None


def main() -> int:
    try:
        result = process_distribution_queue()
    except Exception as exc:
        result = {
            "ok": False,
            "event_count": 0,
            "distributed_count": 0,
            "waiting_count": 0,
            "closed_count": 0,
            "events_json": "[]",
            "message": str(exc),
        }
    if Kestra is not None:
        Kestra.outputs(result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
