#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys

from .form_processor.prequalification_cutover import centralize_active_prequalification_ownership

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover
    Kestra = None


def main() -> int:
    try:
        result = centralize_active_prequalification_ownership(
            dry_run=_load_bool("DRY_RUN", default=True),
            date_from=os.environ.get("DATE_FROM", "").strip() or None,
        )
    except Exception as exc:
        result = {
            "ok": False,
            "action": "error",
            "dry_run": True,
            "scanned_count": 0,
            "already_kestra_count": 0,
            "candidate_count": 0,
            "changed_count": 0,
            "candidate_ids": [],
            "message": str(exc),
        }

    if Kestra is not None:
        Kestra.outputs(result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0


def _load_bool(name: str, *, default: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "y", "si", "s"}


if __name__ == "__main__":
    raise SystemExit(main())
