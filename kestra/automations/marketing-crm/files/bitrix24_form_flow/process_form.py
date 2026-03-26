#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys

from .form_processor.business_logic import process_form_body


def main() -> int:
    try:
        body = sys.stdin.read()
        result = process_form_body(body, content_type=os.environ.get("CONTENT_TYPE"))
    except Exception as exc:
        result = {
            "ok": False,
            "qualified": False,
            "contact_id": None,
            "lead_id": None,
            "lead_status": None,
            "action": "error",
            "reason": "error",
            "message": str(exc),
        }

    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
