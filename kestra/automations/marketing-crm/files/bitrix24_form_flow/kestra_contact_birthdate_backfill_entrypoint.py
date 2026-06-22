#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys

from .form_processor.contact_birthdate_service import backfill_contact_birthdate_to_leads

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None


def main() -> int:
    try:
        result = backfill_contact_birthdate_to_leads(
            date_from=_load_string("BACKFILL_DATE_FROM"),
            date_to=_load_string("BACKFILL_DATE_TO"),
            max_leads=_load_int("BACKFILL_MAX_LEADS", default=500),
            dry_run=_load_bool("BACKFILL_DRY_RUN", default=True),
        )
    except Exception as exc:
        result = {
            "ok": False,
            "action": "error",
            "dry_run": True,
            "checked_count": 0,
            "updated_count": 0,
            "already_synced_count": 0,
            "skipped_missing_contact_count": 0,
            "skipped_missing_birthdate_count": 0,
            "message": str(exc),
        }

    _emit_outputs_if_available(result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0


def _load_string(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


def _load_int(name: str, *, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    value = int(raw)
    if value <= 0:
        raise ValueError(f"{name} debe ser mayor a cero.")
    return value


def _load_bool(name: str, *, default: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "y", "yes", "si", "s"}


def _emit_outputs_if_available(result: dict[str, object]) -> None:
    if Kestra is None:
        return

    Kestra.outputs(
        {
            "ok": bool(result.get("ok", False)),
            "action": str(result.get("action") or ""),
            "dry_run": bool(result.get("dry_run", True)),
            "checked_count": int(result.get("checked_count", 0) or 0),
            "updated_count": int(result.get("updated_count", 0) or 0),
            "already_synced_count": int(result.get("already_synced_count", 0) or 0),
            "skipped_missing_contact_count": int(
                result.get("skipped_missing_contact_count", 0) or 0
            ),
            "skipped_missing_birthdate_count": int(
                result.get("skipped_missing_birthdate_count", 0) or 0
            ),
            "message": str(result.get("message") or ""),
        }
    )


if __name__ == "__main__":
    raise SystemExit(main())
