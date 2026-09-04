#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys

from .form_processor.catamarca_deal_qualification import (
    qualify_catamarca_deal,
    technical_deal_trace,
)

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover
    Kestra = None


def main() -> int:
    deal_id = os.getenv("DEAL_ID", "").strip()
    try:
        if not deal_id:
            raise ValueError("Falta DEAL_ID.")
        result = qualify_catamarca_deal(deal_id)
    except Exception as exc:
        result = technical_deal_trace(deal_id, exc)

    if Kestra is not None:
        Kestra.outputs(result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
