"""A completed, correlated Edna Flow is the declaration for this application."""
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import os
import re
from uuid import UUID

from edna_incoming.intake import LEGACY_GROUPED_FLOW_IDS, normalize_answer
from .attribution import normalize_attribution
from .bitrix_client import BitrixClient
from .config import load_config
from .deal_service import _unattended_sales_session
from .intake_bound import _revision, _unattended_initial_receiver
from .intake_context import CHANNEL_CONTRACT, CHANNEL_SUBFLOW, validate_channel_context
from .intake_crm_client import IntakeCrmClient
from .lead_service import FRESH_V3_ORIGINATOR
from ._chat_ownership import V3_DESCRIPTION
from .logger import create_logger
from .normalization import normalize_whatsapp
from .organic_profile_reuse import Review, _date, _id, _native, _record
from .whatsapp_assistance import _same_phone
from .whatsapp_intake_crm import CUIL_REVIEW_STATUS, _cuil, _empty_guest, _lead_fields, _rows, _test_record, _validate_schema

CONTRACT = "fresh-v3-declaration-v1"


def _receipt(payload):
    fields = {key: payload[key] for key in ("case_id", "answer", "response", "received_at", "flow_id", "entry_context", "crm_binding")}
    digest = sha256(json.dumps(fields, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return "Recibo de declaración v3: " + digest


def _validate(payload, env):
    case = str(UUID(payload["case_id"]))
    if "chat_ownership_request_id" in payload and payload["chat_ownership_request_id"] != case:
        raise ValueError("Request ownership binding mismatch.")
    response = payload["response"]
    flow = payload["flow_id"]
    allowed = {env.get("EDNA_INTAKE_FLOW_ID", ""), *env.get("EDNA_INTAKE_ACCEPTED_FLOW_IDS", "").split(",")}
    if (case != payload["case_id"] or not isinstance(response, dict) or response.get("case_id") != case
            or str(UUID(response["transport_id"])) != response["transport_id"]
            or not _id(response.get("request_id")) or not _id(response.get("message_id")) or not _id(response.get("outgoing_message_id"))
            or not _id(response.get("event_id")) or response["event_id"] == payload["entry_context"]["event_id"]
            or response["message_id"] == payload["entry_context"]["message_id"]
            or not isinstance(flow, str) or not re.fullmatch(r"[0-9]{1,18}", flow)
            or flow not in {value.strip() for value in allowed}
            or flow in LEGACY_GROUPED_FLOW_IDS | {"1850162769693486", "1993586314642842"}
            or "provenance" in payload or payload.get("test_mode", False) is not False):
        raise ValueError("Invalid completed Flow.")
    attribution = normalize_attribution(payload.get("attribution"))
    if not attribution or attribution.get("wa", {}).get("WA_FLOW_ID") != flow:
        raise ValueError("Intake transport does not match attribution.")
    binding = dict(payload["crm_binding"])
    lead, contact = binding.get("native_lead_id", binding.get("lead_id")), binding.get("contact_id")
    if (binding.get("lead_id") not in (None, lead) or lead is not None and not _id(lead)
            or contact is not None and not _id(contact) or not (lead or contact) or not _id(binding.get("activity_id"))):
        raise ValueError("Invalid native intake receipt.")
    validate_channel_context({**payload, "crm_binding": dict(binding, lead_id=str(lead or contact))}, env, attribution)
    received = _date(payload["received_at"])
    if not _date(payload["entry_context"]["received_at"]) <= received <= datetime.now(timezone.utc) + timedelta(minutes=5):
        raise ValueError("Invalid declaration time.")
    binding.update(native_lead_id=str(lead) if lead else None, contact_id=str(contact) if contact else None)
    return binding, normalize_whatsapp(payload["phone"]), normalize_answer(payload["answer"], retain_invalid_identity=True, flow_id=flow)


def _find_case(api, case):
    rows = _rows(api, "crm.lead.list", {"filter": {"=UF_CRM_WA_ASSISTANCE_ID": case},
                                       "select": ["*", "UF_*", "PHONE", "EMAIL"]})
    if len(rows) > 1 or rows and rows[0].get("UF_CRM_WA_ASSISTANCE_ID") != case:
        raise Review("fresh_case_id_conflict")
    return rows[0] if rows else None


def _replay(lead, payload, answer, phone, config):
    if (_test_record(lead) or lead.get("ORIGINATOR_ID") != FRESH_V3_ORIGINATOR or lead.get("ORIGIN_ID") != payload["case_id"]
            or _receipt(payload) not in str(lead.get("COMMENTS") or "")
            or not _same_phone(lead, phone) or _cuil(lead, config.fields.lead_cuil) != (answer["cuil"] or "")
            or lead.get("UF_CRM_WA_FLOW_ID") != payload["flow_id"] or lead.get("UF_CRM_WA_SUBFLOW") != CHANNEL_SUBFLOW
            or _date(lead.get("UF_CRM_WA_TIMESTAMP")) != _date(payload["received_at"])):
        raise Review("fresh_case_id_conflict")
    return str(lead["ID"])


def process(payload, *, env=None, client=None):
    source = dict(os.environ if env is None else env)
    result = {"ok": True, "contract": CONTRACT, "case_id": "", "action": "manual_review", "reason": "invalid_fresh_declaration",
              "lead_id": "", "contact_id": "", "deal_id": "", "seller_id": "", "write_attempted": False}
    try:
        binding, phone, answer = _validate(payload, source)
    except (KeyError, ValueError, TypeError, AttributeError, OverflowError):
        return result
    case = result["case_id"] = payload["case_id"]
    if payload.get("dry_run") is not False:
        return dict(result, action="dry_run", reason="validated_fresh_declaration")
    recipients = [x.strip() for x in source.get("EDNA_INTAKE_RECIPIENTS", "").split(",") if x.strip()]
    if source.get("EDNA_INTAKE_CRM_ENABLED", "").lower() not in {"1", "true"} or recipients and phone.lstrip("+") not in recipients:
        return dict(result, action="disabled", reason="disabled_or_outside_pilot")
    pending_cuil = not answer["cuil"] and not answer["rejection_reason"]
    if answer["action"] == "review" and not pending_cuil:
        return dict(result, reason="invalid_email" if answer["email_status"] == "invalid" else "pending_data")
    config = load_config(source)
    api = IntakeCrmClient(client or BitrixClient(config, create_logger(), cache_lead_fields=True, min_request_interval_seconds=1.0))
    try:
        _native(api, payload, binding, phone, independent=True)
        existing = _find_case(api, case)
        rejected = answer["rejection_reason"]
        if existing:
            lead_id = _replay(existing, payload, answer, phone, config)
            if pending_cuil:
                return dict(result, reason="pending_cuil", lead_id=lead_id)
            return dict(result, action="rejected" if rejected else "already_processed", reason=rejected or "case_exists", lead_id=lead_id)
        _validate_schema(api, config, source.get("BITRIX24_LEAD_STATUS_ASSISTANCE_REVIEW", "").strip())
        # Only an empty Guest created by Bitrix for this very session is safe
        # to enrich. The old contact and deals have no role in a fresh declaration.
        lead = _record(api, "lead", binding["native_lead_id"]) if binding["native_lead_id"] else None
        target = None
        if (lead and not binding["contact_id"] and _empty_guest(lead, config) and not _test_record(lead)
                and not lead.get("ORIGINATOR_ID") and not lead.get("ORIGIN_ID")):
            dialog = api.call("imopenlines.dialog.get", {"CHAT_ID": int(binding["chat_id"])})
            session = str(dialog.get("entity_data_1") or "").split("|")
            if len(session) < 7 or session[5] != binding["session_id"] or not _id(session[6]) or not lead.get("DATE_CREATE"):
                raise Review("original_guest_ownership_unverified")
            if _date(lead["DATE_CREATE"]).timestamp() >= int(session[6]) - 60:
                if not _unattended_initial_receiver(api, payload, lead, phone, source.get("INITIAL_RECEIVER_REVISION")):
                    raise Review("original_guest_ownership_unverified")
                target = lead
        status = config.lead_statuses.rejected if rejected else config.lead_statuses.new
        reason = "pending_cuil" if pending_cuil else rejected or None
        if pending_cuil:
            status = CUIL_REVIEW_STATUS
        fields = _lead_fields(api, config, dict(payload, contract=CHANNEL_CONTRACT), answer, source, case, phone,
                              None, None, status, reason or "ready", reason,
                              {"contact_ids": [], "lead_ids": [], "deal_ids": []})
        fields.update(ORIGINATOR_ID=FRESH_V3_ORIGINATOR, ORIGIN_ID=case, ASSIGNED_BY_ID=config.deal.provisional_user_id)
        if payload.get("chat_ownership_request_id") == case:
            fields["SOURCE_DESCRIPTION"] = V3_DESCRIPTION
        fields["COMMENTS"] = (fields.get("COMMENTS", "") + "<br>" if fields.get("COMMENTS") else "") + _receipt(payload)
        _native(api, payload, binding, phone, independent=True)
        if target and _revision(_record(api, "lead", str(target["ID"])), config) != _revision(target, config):
            raise Review("native_inquiry_changed")
        dialog = api.call("imopenlines.dialog.get", {"CHAT_ID": int(binding["chat_id"])})
        ready, reason = _unattended_sales_session(api, int(binding["chat_id"]), dialog, entry_binding=binding)
        if not ready:
            raise Review(reason)
        # The webhook is serialized by Kestra and the Laravel POST is reserved
        # once per response. Lost acknowledgements never authorize a second send.
        if target:
            lead_id = str(target["ID"])
            api.call("crm.lead.update", {"id": lead_id, "fields": fields})
        else:
            lead_id = str(api.call("crm.lead.add", {"fields": fields}))
        written = _record(api, "lead", lead_id)
        if (written.get("CONTACT_ID") not in (None, "", 0, "0") or _replay(written, payload, answer, phone, config) != lead_id):
            raise RuntimeError("Fresh declaration write requires reconciliation.")
        if pending_cuil:
            return dict(result, reason="pending_cuil", lead_id=lead_id, write_attempted=True)
        return dict(result, action="rejected" if rejected else "queued", reason=rejected or "ready", lead_id=lead_id, write_attempted=True)
    except Review as exc:
        return dict(result, reason=exc.reason, write_attempted=api.write_attempted)
