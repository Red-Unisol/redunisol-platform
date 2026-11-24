#!/usr/bin/env python3
"""Select one bounded batch; selection errors must fail the execution."""
from __future__ import annotations

import json
import os

from .form_processor.lead_prefill_service import select_new_leads_for_prefill


def select_batch():
    return select_new_leads_for_prefill(
        date_from=os.getenv("BACKFILL_DATE_FROM", "").strip() or None,
    )


def emit_batch(leads, *, action="batch_selected"):
    from kestra import Kestra

    result = {"ok": True, "leads": leads, "count": len(leads),
              "lead_ids": [lead["lead_id"] for lead in leads]}
    Kestra.outputs(result)
    # Selection logs need IDs, not identity documents.
    print(json.dumps({"action": action, "lead_ids": result["lead_ids"],
                      "queue_lanes": [lead["queue_lane"] for lead in leads]}))


def main() -> int:
    emit_batch(select_batch())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
