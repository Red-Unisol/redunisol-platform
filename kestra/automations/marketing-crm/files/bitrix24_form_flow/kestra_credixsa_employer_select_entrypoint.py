#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys

from .form_processor.credixsa_employer_service import (
    select_next_lead_for_credixsa_employer_backfill,
)

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None


def main() -> int:
    try:
        result = select_next_lead_for_credixsa_employer_backfill(
            date_from=_optional_env("BACKFILL_DATE_FROM"),
            date_to=_optional_env("BACKFILL_DATE_TO"),
            max_scan=_optional_int("BACKFILL_MAX_SCAN", default=300),
        )
    except Exception as exc:
        result = {
            "ok": False,
            "action": "error",
            "has_pending": False,
            "lead_id": "",
            "cuil": "",
            "checked_count": 0,
            "skipped_populated_count": 0,
            "skipped_missing_cuil_count": 0,
            "skipped_temporary_error_count": 0,
            "message": str(exc),
        }

    _emit_outputs_if_available(result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True, separators=(",", ":")) + "\n")
    return 0


def _optional_env(name: str) -> str | None:
    value = os.getenv(name, "").strip()
    return value or None


def _optional_int(name: str, *, default: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw or default)
    except ValueError:
        return default
    return value if value > 0 else default


def _emit_outputs_if_available(result: dict[str, object]) -> None:
    if Kestra is None:
        return
    Kestra.outputs(result)


if __name__ == "__main__":
    raise SystemExit(main())
