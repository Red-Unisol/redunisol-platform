"""The web receipt grants one irrevocable permit before any CRM write."""
from __future__ import annotations

import hashlib
import json
import os
from urllib.request import Request
from uuid import UUID

from .internal_web import internal_web_origin, open_without_redirects
from .input_parser import normalize_business_input
from .result import failure_result, intake_success_result


def _claim(submission_id, digest):
    scope = os.environ.get("WEB_CRM_RECEIVER_SCOPE", "")
    origin = internal_web_origin(scope)
    token = os.environ.get("WEB_CRM_RECEIVER_TOKEN")
    if not origin or not token:
        raise RuntimeError("Web CRM receiver is not configured.")
    request = Request(
        origin + "/api/internal/web-form-receiver/claim",
        data=json.dumps({"scope": scope, "submission_id": submission_id, "digest": digest}).encode(),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json",
                 "Accept": "application/json", "User-Agent": "redunisol-web-crm/1"},
        method="POST",
    )
    with open_without_redirects(request, timeout=8) as response:
        return json.load(response)


def ingest_guarded(payload, ingest, claim=None):
    if not isinstance(payload, str):
        return failure_result(message="Invalid web CRM envelope.")
    form = json.loads(payload)
    if not isinstance(form, dict) or form.get("submission_channel") != "redunisol-web":
        return failure_result(message="Invalid web CRM envelope.")
    submission_id = str(UUID(str(form.get("web_submission_id"))))
    normalize_business_input(form)
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    # No contact lookup/upsert, lead insertion, or provider work before permission.
    permission = (claim or _claim)(submission_id, digest)
    state = permission.get("state")
    if state == "synced":
        lead_id = int(permission.get("lead_id") or 0)
        contact_id = int(permission.get("contact_id") or 0)
        if min(contact_id, lead_id) < 1:
            return failure_result(message="Invalid stored web CRM acknowledgement.")
        return intake_success_result(contact_id=contact_id, lead_id=lead_id, message="Existing web submission.")
    if state != "granted":
        return failure_result(message="Web CRM write has not been granted.")
    return ingest(form)
