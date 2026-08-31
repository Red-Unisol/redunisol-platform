from __future__ import annotations


def intake_success_result(
    *,
    contact_id: int,
    lead_id: int,
    message: str,
    deal_id: int | None = None,
    action: str = "ingested",
    reason: str = "ingested",
) -> dict[str, object]:
    return {
        "ok": True,
        "qualified": False,
        "contact_id": contact_id,
        "lead_id": lead_id,
        "lead_status": None,
        "deal_id": deal_id,
        "application_resolution": "reused" if action == "reused" else "created",
        "action": action,
        "reason": reason,
        "message": message,
    }


def success_result(
    *,
    qualified: bool,
    contact_id: int,
    lead_id: int,
    lead_status: str,
    message: str,
    reason: str,
    deal_id: int | None = None,
    action: str | None = None,
) -> dict[str, object]:
    return {
        "ok": True,
        "qualified": qualified,
        "contact_id": contact_id,
        "lead_id": lead_id,
        "lead_status": lead_status,
        "deal_id": deal_id,
        "action": action or ("qualified" if qualified else "rejected"),
        "reason": reason,
        "message": message,
    }


def failure_result(
    *,
    message: str,
    qualified: bool = False,
    contact_id: int | None = None,
    lead_id: int | None = None,
    lead_status: str | None = None,
    reason: str = "error",
) -> dict[str, object]:
    return {
        "ok": False,
        "qualified": qualified,
        "contact_id": contact_id,
        "lead_id": lead_id,
        "lead_status": lead_status,
        "action": "error",
        "reason": reason,
        "message": message,
    }


def skipped_result(
    *,
    contact_id: int | None,
    lead_id: int,
    lead_status: str | None,
    message: str,
    reason: str = "processing_disabled",
) -> dict[str, object]:
    return {
        "ok": True,
        "qualified": False,
        "contact_id": contact_id,
        "lead_id": lead_id,
        "lead_status": lead_status,
        "action": "skipped",
        "reason": reason,
        "message": message,
    }
