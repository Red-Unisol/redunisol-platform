#!/usr/bin/env python3
"""Select one bounded batch; selection errors must fail the execution."""
from __future__ import annotations

import json
import os

from kestra import Kestra

from .form_processor.lead_prefill_service import select_new_leads_for_prefill


def main() -> int:
    leads = select_new_leads_for_prefill(
        date_from=os.getenv("BACKFILL_DATE_FROM", "").strip() or None,
    )
    result = {"ok": True, "leads": leads, "count": len(leads),
              "lead_ids": [lead["lead_id"] for lead in leads]}
    Kestra.outputs(result)
    # Selection logs need IDs, not identity documents.
    print(json.dumps({"action": "batch_selected", "lead_ids": result["lead_ids"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
