#!/usr/bin/env python3
from __future__ import annotations

import json
import sys

from .form_processor.catamarca_deal_qualification import process_pending_catamarca_deals
from .kestra_catamarca_deal_select_entrypoint import _kestra_outputs

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover
    Kestra = None


def main() -> int:
    # A selection/configuration failure must fail the execution. Per-deal errors
    # are captured as individual traces by the batch processor.
    result = process_pending_catamarca_deals()
    if Kestra is not None:
        Kestra.outputs(_kestra_outputs(result))
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    # Individual failures remain in their own event; marking the whole batch
    # FAILED would mislabel successfully distributed cases in the report.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
