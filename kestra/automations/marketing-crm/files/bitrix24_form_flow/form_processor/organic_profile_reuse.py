"""A new authenticated inquiry using a dated profile, never a fabricated Flow."""
from __future__ import annotations

import calendar
from datetime import datetime, timedelta, timezone
from html import escape
import json
import os
import re
from uuid import UUID

from edna_incoming.intake import LEGACY_GROUPED_FLOW_IDS, normalize_answer
from .attribution import normalize_attribution
from .bitrix_client import BitrixClient
from .config import load_config
from .intake_bound import _preserve_acquisition, _profile_conflict, _revision
from .intake_context import validate_channel_context
from .intake_crm_client import IntakeCrmClient
from .lead_service import _resolve_enum_id
from .logger import create_logger
from .normalization import normalize_whatsapp
from .whatsapp_assistance import _duplicate_ids, _same_phone
from .whatsapp_intake_crm import (
    GUEST_STATUS, _cuil, _lead_fields, _rows, _test_record, _validate_schema,
)

CONTRACT = "organic-profile-reuse-v1"
SCHEMA = "whatsapp-intake-v3"
SUBFLOW = "organic_profile_reuse"
SOURCE_KINDS = {"edna_intake_request", "web_form", "crm_verified_profile"}


def now_utc():
    return datetime.now(timezone.utc)


def _date(value):
    if not isinstance(value, str):
        raise ValueError("An aware source timestamp is required.")
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("An aware source timestamp is required.")
    return result.astimezone(timezone.utc)


def _id(value):
    return isinstance(value, (str, int)) and not isinstance(value, bool) and re.fullmatch(r"[1-9][0-9]{0,18}", str(value)) is not None


def _unset(value):
    return value is None or value is False or value == "" or value == []


def _cutoff(now, months):
    index = now.year * 12 + now.month - 1 - months
    year, month = divmod(index, 12)
    month += 1
    return now.replace(year=year, month=month, day=min(now.day, calendar.monthrange(year, month)[1]))


def _result(case_id="", action="reused_not_valid", reason="reused_profile_invalid", **fields):
    return {"ok": True, "contract": CONTRACT, "case_id": case_id, "action": action, "reason": reason,
            "lead_id": "", "contact_id": "", "deal_id": "", "seller_id": "", "write_attempted": False, **fields}


def _validate(payload, env):
    case_id = str(UUID(str(payload.get("case_id", ""))))
    if payload.get("contract") != CONTRACT or "flow_id" in payload or payload.get("test_reference") is not None:
        raise ValueError("Organic reuse has no Flow transport.")
    phone = normalize_whatsapp(payload.get("phone"))
    provenance = payload.get("provenance")
    if (not isinstance(provenance, dict) or provenance.get("source_kind") not in SOURCE_KINDS
            or not isinstance(provenance.get("source_id"), str)
            or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", provenance["source_id"])
            or provenance.get("schema") != SCHEMA or provenance.get("v3_equivalent") is not True):
        raise ValueError("A complete and sourced profile is required.")
    months = env.get("EDNA_ORGANIC_PROFILE_MAX_AGE_MONTHS", "6")
    if isinstance(months, bool) or not re.fullmatch(r"[1-9][0-9]?", str(months)) or int(months) > 24:
        raise ValueError("Invalid profile freshness configuration.")
    now = now_utc()
    confirmed, received = _date(provenance.get("confirmed_at")), _date(payload.get("received_at"))
    if not _cutoff(now, int(months)) < confirmed <= now + timedelta(minutes=5) or confirmed > received + timedelta(minutes=5):
        raise ValueError("The original profile confirmation has expired or is in the future.")
    if received > now + timedelta(minutes=5):
        raise ValueError("The new inquiry cannot come from the future.")
    attribution = normalize_attribution(payload.get("attribution"))
    if attribution is None or attribution.get("wa", {}).get("WA_FLOW_ID"):
        raise ValueError("A current inquiry cannot inherit a Flow transport.")
    binding = payload.get("crm_binding")
    if not isinstance(binding, dict):
        raise ValueError("An exact native message proof is required.")
    binding = dict(binding)
    native = binding.get("native_lead_id", binding.get("lead_id"))
    if binding.get("lead_id") is not None and native != binding["lead_id"]:
        raise ValueError("Native lead identifiers disagree.")
    contact = binding.get("contact_id")
    if (native is not None and not _id(native)) or (contact is not None and not _id(contact)) or not (native or contact):
        raise ValueError("A native CRM identity is required.")
    if not _id(binding.get("activity_id")):
        raise ValueError("The original session activity is required.")
    # Reuse the established entry/provenance validation without pretending a
    # contact is a lead. The temporary lead sentinel never reaches the provider.
    channel_binding = dict(binding, lead_id=str(native or contact))
    validate_channel_context({**payload, "crm_binding": channel_binding}, env, attribution)
    binding.update(native_lead_id=str(native) if native else None, contact_id=str(contact) if contact else None)
    answer = normalize_answer(payload.get("answer"), retain_invalid_identity=False, flow_id=SCHEMA)
    if answer["action"] == "review" or not answer["cuil"] or answer["email_status"] == "invalid":
        raise ValueError("The saved profile is not complete under the current V3 schema.")
    return case_id, phone, binding, answer


class Review(Exception):
    def __init__(self, reason):
        self.reason = reason


def _links(dialog):
    parts = str(dialog.get("entity_data_2") or "").split("|")
    if len(parts) % 2:
        raise Review("native_identity_incomplete")
    result = {}
    for key, value in zip(parts[::2], parts[1::2]):
        if key in result and result[key] != value:
            raise Review("native_identity_ambiguous")
        result[key] = value
    return result


def _native(api, payload, binding, phone):
    dialog = api.call("imopenlines.dialog.get", {"CHAT_ID": int(binding["chat_id"])})
    if not isinstance(dialog, dict) or str(dialog.get("id")) != binding["chat_id"] or dialog.get("entity_type") != "LINES":
        raise Review("native_dialog_unverified")
    code = str(dialog.get("entity_id") or "")
    parts = code.split("|")
    if (len(parts) != 4 or parts[:2] != ["whatsappbyedna", "1"] or not _id(parts[3])
            or len(parts[2].split("@")) != 2 or parts[2].split("@")[1] != payload["entry_context"]["subject_id"]
            or normalize_whatsapp(parts[2].split("@")[0]) != phone):
        raise Review("native_channel_unverified")
    links = _links(dialog)
    session = str(dialog.get("entity_data_1") or "").split("|")
    if (len(session) < 6 or session[5] != binding["session_id"]
            or dialog.get("text_field_enabled") not in (True, "Y", 1, "1")):
        raise Review("native_session_changed")
    for key, expected in (("LEAD", binding["native_lead_id"]), ("CONTACT", binding["contact_id"])):
        if expected and links.get(key) != expected or not expected and links.get(key) not in (None, "", "0"):
            raise Review("native_identity_changed")
    activity = api.call("crm.activity.get", {"id": binding["activity_id"]})
    params = activity.get("PROVIDER_PARAMS") if isinstance(activity, dict) else None
    params = json.loads(params) if isinstance(params, str) else params
    if (not isinstance(activity, dict) or str(activity.get("ID")) != str(binding["activity_id"])
            or activity.get("PROVIDER_ID") != "IMOPENLINES_SESSION"
            or str(activity.get("ASSOCIATED_ENTITY_ID")) != binding["session_id"]
            or not isinstance(params, dict) or params.get("USER_CODE") != code
            or not ((str(activity.get("OWNER_TYPE_ID")) == "1" and str(activity.get("OWNER_ID")) == binding["native_lead_id"])
                    or (str(activity.get("OWNER_TYPE_ID")) == "3" and str(activity.get("OWNER_ID")) == binding["contact_id"]))):
        raise Review("native_activity_unverified")
    history = api.call("imopenlines.session.history.get", {"SESSION_ID": int(binding["session_id"])})
    if (not isinstance(history, dict) or str(history.get("sessionId")) != binding["session_id"]
            or str(history.get("chatId")) != binding["chat_id"] or history.get("hasNextPage") is not False
            or not isinstance(history.get("message"), (dict, list)) or not isinstance(history.get("users"), dict)):
        raise Review("native_history_incomplete")
    matches = []
    messages = history["message"].values() if isinstance(history["message"], dict) else history["message"]
    for message in messages:
        if not isinstance(message, dict):
            raise Review("native_history_incomplete")
        params = message.get("params", {})
        params = json.loads(params) if isinstance(params, str) else params
        ids = params.get("connectorMid", params.get("CONNECTOR_MID", [])) if isinstance(params, dict) else []
        ids = ids if isinstance(ids, list) else [ids]
        if binding["entry_message_id"] not in [str(value) for value in ids if isinstance(value, (str, int)) and not isinstance(value, bool)]:
            continue
        user = history["users"].get(str(message.get("senderid")))
        if (str(message.get("id")) != binding["message_id"] or str(message.get("chatid")) != binding["chat_id"]
                or str(message.get("senderid")) != parts[3] or not isinstance(user, dict) or user.get("connector") is not True):
            raise Review("native_message_unverified")
        matches.append(message)
    if len(matches) != 1:
        raise Review("native_message_unverified")
    return dialog


def _record(api, entity, record_id):
    record = api.call("crm." + entity + ".get", {"id": record_id})
    if not isinstance(record, dict) or str(record.get("ID")) != record_id:
        raise Review("crm_identity_unverified")
    return record


def _identity(api, config, binding, phone, answer):
    native = _record(api, "lead", binding["native_lead_id"]) if binding["native_lead_id"] else None
    contact = _record(api, "contact", binding["contact_id"]) if binding["contact_id"] else None
    if native:
        if not _same_phone(native, phone) or _test_record(native):
            raise Review("native_identity_conflict")
        cuil = _cuil(native, config.fields.lead_cuil)
        if cuil and cuil != answer["cuil"]:
            raise Review("native_identity_conflict")
        linked = str(native.get("CONTACT_ID") or "")
        if linked:
            if contact and linked != str(contact["ID"]):
                raise Review("native_contact_conflict")
            contact = contact or _record(api, "contact", linked)
    if contact and (_cuil(contact, config.fields.contact_cuil) != answer["cuil"] or not _same_phone(contact, phone)):
        raise Review("native_contact_conflict")
    if not contact and (not native or _cuil(native, config.fields.lead_cuil) != answer["cuil"]):
        # The dated server profile plus one current CUIL-bearing phone contact
        # may recognize a recurrent client whose new Guest lacks its CRM link.
        # Never infer this from a name or pick one person among phone candidates.
        ids = _duplicate_ids(api.call("crm.duplicate.findbycomm", {"entity_type": "CONTACT", "type": "PHONE", "values": [phone]}), "CONTACT")
        if not ids:
            raise Review("current_person_unproven")
        if len(ids) != 1:
            raise Review("phone_identity_ambiguous")
        found = _record(api, "contact", ids[0])
        if not _same_phone(found, phone) or _cuil(found, config.fields.contact_cuil) != answer["cuil"]:
            raise Review("phone_profile_identity_conflict")
        lead_ids = _duplicate_ids(api.call("crm.duplicate.findbycomm", {"entity_type": "LEAD", "type": "PHONE", "values": [phone]}), "LEAD")
        if len(lead_ids) > 100:
            raise Review("phone_identity_ambiguous")
        phone_leads = []
        for offset in range(0, len(lead_ids), 50):
            batch = lead_ids[offset:offset + 50]
            rows = _rows(api, "crm.lead.list", {"filter": {"@ID": batch}, "select": ["ID", "PHONE", config.fields.lead_cuil]})
            if sorted(str(row["ID"]) for row in rows) != sorted(batch):
                raise Review("phone_identity_lookup_incomplete")
            phone_leads.extend(rows)
        if any(not _same_phone(row, phone) or _cuil(row, config.fields.lead_cuil) not in ("", answer["cuil"]) for row in phone_leads):
            raise Review("phone_identity_ambiguous")
        contact = found
    contacts = _rows(api, "crm.contact.list", {"filter": {"=" + config.fields.contact_cuil: answer["cuil"]}, "select": ["*", "UF_*", "PHONE", "EMAIL"]})
    if any(_cuil(row, config.fields.contact_cuil) != answer["cuil"] for row in contacts) or len(contacts) > 1:
        raise Review("ambiguous_cuil_contact")
    if contact and (len(contacts) != 1 or str(contacts[0]["ID"]) != str(contact["ID"])):
        raise Review("native_contact_conflict")
    if not contact and contacts:
        # A matching CUIL can identify a contact only after this native lead has
        # independently proved that identity; never borrow a CUIL by phone.
        contact = contacts[0]
    if not contact or not _same_phone(contact, phone):
        raise Review("current_person_unproven")
    leads = _rows(api, "crm.lead.list", {"filter": {"=" + config.fields.lead_cuil: answer["cuil"]}, "select": ["*", "UF_*", "PHONE", "EMAIL"]})
    if any(_cuil(row, config.fields.lead_cuil) != answer["cuil"] for row in leads):
        raise Review("ambiguous_cuil_lead")
    leads = [row for row in leads if not _test_record(row)]
    if len(leads) > 100:
        raise Review("identity_history_requires_review")
    if any(row.get("CONTACT_ID") and (not contact or str(row["CONTACT_ID"]) != str(contact["ID"])) for row in leads):
        raise Review("contact_lead_conflict")
    return native, contact, leads


def _management(api, config, contact, leads):
    deals = {}
    for field, records in (("CONTACT_ID", [contact] if contact else []), ("LEAD_ID", leads)):
        ids = [str(record["ID"]) for record in records]
        for offset in range(0, len(ids), 50):
            batch = ids[offset:offset + 50]
            rows = _rows(api, "crm.deal.list", {"filter": {"@" + field: batch, "=STAGE_SEMANTIC_ID": "P", "@CATEGORY_ID": [1, 5]},
                                                 "select": ["ID", "CONTACT_ID", "LEAD_ID", "CATEGORY_ID", "STAGE_ID", "STAGE_SEMANTIC_ID", "ASSIGNED_BY_ID", "UF_CRM_WA_TEST", "UF_CRM_ATTR_JSON"]})
            for deal in rows:
                if str(deal.get(field)) not in batch or deal.get("STAGE_SEMANTIC_ID") != "P" or str(deal.get("CATEGORY_ID")) not in {"1", "5"}:
                    raise Review("management_lookup_incomplete")
                if not _test_record(deal):
                    if str(deal["ID"]) in deals and deals[str(deal["ID"])] != deal:
                        raise Review("management_lookup_incomplete")
                    deals[str(deal["ID"])] = deal
    if not deals:
        return None
    if len(deals) != 1:
        raise Review("ambiguous_existing_management")
    deal = next(iter(deals.values()))
    if (str(deal["CATEGORY_ID"]) != "1" or not _id(deal.get("ASSIGNED_BY_ID"))
            or str(deal.get("ASSIGNED_BY_ID")) in {"57", "71283"}
            or not deal.get("STAGE_ID") or deal["STAGE_ID"] in {
                config.deal.pending_qualification_stage_id, config.deal.manual_review_stage_id,
                config.deal.routing_review_stage_id, config.deal.assignment_queue_stage_id}):
        raise Review("existing_management_requires_review")
    if deal.get("LEAD_ID") and not any(str(row["ID"]) == str(deal["LEAD_ID"])
                                         and str(row.get("ASSIGNED_BY_ID")) == str(deal["ASSIGNED_BY_ID"]) for row in leads):
        raise Review("existing_management_identity_conflict")
    user = api.call("user.get", {"ID": str(deal["ASSIGNED_BY_ID"])})
    if (not isinstance(user, list) or len(user) != 1 or str(user[0].get("ID")) != str(deal["ASSIGNED_BY_ID"])
            or user[0].get("ACTIVE") not in (True, "Y") or user[0].get("USER_TYPE", "employee") != "employee"
            or user[0].get("IS_BOT") in (True, "Y")):
        raise Review("assigned_seller_unverified")
    return deal


def _existing(api, config, payload, phone, answer, contact):
    rows = _rows(api, "crm.lead.list", {"filter": {"=UF_CRM_WA_ASSISTANCE_ID": payload["case_id"]}, "select": ["*", "UF_*", "PHONE", "EMAIL"]})
    if len(rows) > 1:
        raise Review("organic_case_conflict")
    if not rows:
        return None
    lead = rows[0]
    if (lead.get("UF_CRM_WA_ASSISTANCE_ID") != payload["case_id"] or lead.get("UF_CRM_WA_SUBFLOW") != SUBFLOW
            or lead.get("UF_CRM_WA_FLOW") != SUBFLOW or lead.get("UF_CRM_WA_FLOW_ID") not in (None, "")
            or not _same_phone(lead, phone) or _cuil(lead, config.fields.lead_cuil) != answer["cuil"]
            or (contact and str(lead.get("CONTACT_ID") or "") != str(contact["ID"]))
            or _date(lead.get("UF_CRM_WA_TIMESTAMP")) != _date(payload["provenance"]["confirmed_at"])):
        raise Review("organic_case_conflict")
    return lead


def _source_profile(api, config, payload, answer):
    if payload["provenance"]["source_kind"] != "crm_verified_profile":
        return
    source_id = payload["provenance"]["source_id"]
    if not _id(source_id):
        raise Review("source_profile_identity_conflict")
    original = _record(api, "lead", source_id)
    try:
        same_date = _date(original.get("UF_CRM_WA_TIMESTAMP")) == _date(payload["provenance"]["confirmed_at"])
    except (TypeError, ValueError):
        same_date = False
    if (_cuil(original, config.fields.lead_cuil) != answer["cuil"] or not same_date
            or original.get("UF_CRM_WA_FLOW") not in {"whatsapp_intake", "web_whatsapp_intake", SUBFLOW}
            or _profile_conflict(original, answer, config)):
        raise Review("source_profile_identity_conflict")
    retired = payload["answer"].get("situacion_" + answer["province_key"]) in {"jubilado", "pensionado"}
    if retired and str(original.get("UF_CRM_WA_FLOW_ID")) in LEGACY_GROUPED_FLOW_IDS:
        raise Review("source_profile_benefit_requires_confirmation")


def _target(api, config, native, answer):
    if native is None or native.get("STATUS_SEMANTIC_ID") != "P":
        return None
    if native.get("STATUS_ID") not in {GUEST_STATUS, config.lead_statuses.new, config.lead_statuses.preclassification}:
        raise Review("native_management_preserved")
    if not _unset(native.get("UF_CRM_WA_ASSISTANCE_ID")) or _profile_conflict(native, answer, config):
        raise Review("native_management_preserved")
    owner = native.get(config.fields.lead_commercial_owner)
    if not _unset(owner):
        if str(owner) != _resolve_enum_id(api, config.fields.lead_commercial_owner, config.commercial_owner.bitrix):
            raise Review("native_management_preserved")
    if not _unset(native.get(config.fields.lead_processing_policy)):
        raise Review("native_processing_policy_preserved")
    return native


def process(payload, *, env=None, client=None):
    source = dict(os.environ if env is None else env)
    case_id = ""
    try:
        case_id, phone, binding, answer = _validate(payload, source)
    except (ValueError, TypeError, AttributeError, OverflowError):
        try:
            case_id = str(UUID(str(payload.get("case_id", ""))))
        except (ValueError, TypeError, AttributeError):
            case_id = ""
        return _result(case_id)
    result = _result(case_id)
    payload = {**payload, "case_id": case_id}
    if payload.get("dry_run") is not False:
        return {**result, "action": "dry_run", "reason": "validated_reused_profile"}
    recipients = [value.strip() for value in source.get("EDNA_INTAKE_RECIPIENTS", "").split(",") if value.strip()]
    if source.get("EDNA_INTAKE_CRM_ENABLED", "").lower() not in {"true", "1"} or recipients and phone.lstrip("+") not in recipients:
        return {**result, "action": "disabled", "reason": "disabled_or_outside_pilot"}
    config = load_config(source)
    api = IntakeCrmClient(client or BitrixClient(config, create_logger(), cache_lead_fields=True, min_request_interval_seconds=1.0))
    try:
        _native(api, payload, binding, phone)
        native, contact, leads = _identity(api, config, binding, phone, answer)
        existing = _existing(api, config, payload, phone, answer, contact)
        if existing:
            return {**result, "action": "already_processed", "reason": "case_exists", "lead_id": str(existing["ID"]), "contact_id": str(existing.get("CONTACT_ID") or "")}
        _source_profile(api, config, payload, answer)
        deal = _management(api, config, contact, leads)
        if deal:
            return {**result, "action": "assigned_case", "reason": "existing_assigned_case", "deal_id": str(deal["ID"]),
                    "seller_id": str(deal["ASSIGNED_BY_ID"]), "lead_id": str(deal.get("LEAD_ID") or ""),
                    "contact_id": str((contact or {}).get("ID") or deal.get("CONTACT_ID") or "")}
        target = _target(api, config, native, answer)
        if any(row.get("STATUS_SEMANTIC_ID") == "P" and (not target or str(row["ID"]) != str(target["ID"])) for row in leads):
            raise Review("existing_inquiry_requires_review")
        _validate_schema(api, config, source.get("BITRIX24_LEAD_STATUS_ASSISTANCE_REVIEW", "").strip())
        rejected = bool(answer["rejection_reason"])
        reason = answer["rejection_reason"] or None
        status = config.lead_statuses.rejected if rejected else config.lead_statuses.new
        # The shared field builder encodes current catalogs and attribution. An
        # empty internal schema slot is removed, never presented as a sent Flow.
        fields = _lead_fields(api, config, {**payload, "flow_id": ""}, answer, source, case_id, phone,
                              contact, target, status, reason or "ready", reason,
                              {"contact_ids": [], "lead_ids": [], "deal_ids": []})
        fields.update(UF_CRM_WA_FLOW=SUBFLOW, UF_CRM_WA_SUBFLOW=SUBFLOW,
                      UF_CRM_WA_FLOW_ID="", UF_CRM_WA_SUBFLOW_ID="", UF_CRM_WA_TIMESTAMP=payload["provenance"]["confirmed_at"])
        if target and not _preserve_acquisition(target, fields, payload, config):
            raise Review("native_attribution_conflict")
        evidence = payload["provenance"]
        audit = "Perfil reutilizado: " + evidence["source_kind"] + ":" + evidence["source_id"] + ". Confirmación original: " + evidence["confirmed_at"]
        fields["COMMENTS"] = str((target or {}).get("COMMENTS") or "") + "<br>" + escape(audit)
        if target:
            fields.pop("ASSIGNED_BY_ID", None)
            for name in ("NAME", "LAST_NAME", "TITLE"):
                if target.get(name):
                    fields.pop(name, None)
            if not rejected and target.get("STATUS_ID") != GUEST_STATUS:
                fields.pop("STATUS_ID", None)
        # Re-read native ownership/profile and open management immediately before
        # writes. External Bitrix writers still cannot be locked by this process.
        _native(api, payload, binding, phone)
        fresh_native, fresh_contact, fresh_leads = _identity(api, config, binding, phone, answer)
        if native and _revision(native, config) != _revision(fresh_native, config):
            raise Review("native_inquiry_changed")
        if fresh_contact != contact:
            raise Review("contact_changed_before_write")
        if any(row.get("STATUS_SEMANTIC_ID") == "P" and (not target or str(row["ID"]) != str(target["ID"])) for row in fresh_leads):
            raise Review("inquiry_changed_before_write")
        if _existing(api, config, payload, phone, answer, contact) or _management(api, config, contact, fresh_leads):
            raise Review("inquiry_changed_before_write")
        _source_profile(api, config, payload, answer)
        lead_id = str(target["ID"]) if target else str(api.call("crm.lead.add", {"fields": fields}))
        if target:
            api.call("crm.lead.update", {"id": lead_id, "fields": fields})
        written = _record(api, "lead", lead_id)
        if (written.get("UF_CRM_WA_ASSISTANCE_ID") != case_id or written.get("UF_CRM_WA_SUBFLOW") != SUBFLOW
                or _cuil(written, config.fields.lead_cuil) != answer["cuil"] or not _same_phone(written, phone)
                or str(written.get("CONTACT_ID") or "") != str(fields.get("CONTACT_ID") or "")
                or _date(written.get("UF_CRM_WA_TIMESTAMP")) != _date(evidence["confirmed_at"])
                or target and written.get("ASSIGNED_BY_ID") != target.get("ASSIGNED_BY_ID")):
            raise RuntimeError("Organic inquiry write requires reconciliation.")
        return {**result, "action": "rejected" if rejected else "queued", "reason": reason or "ready",
                "lead_id": lead_id, "contact_id": str(written.get("CONTACT_ID") or ""), "write_attempted": True}
    except Review as error:
        action = "reused_not_valid" if error.reason == "current_person_unproven" and not api.write_attempted else "manual_review"
        return {**result, "action": action, "reason": error.reason, "write_attempted": api.write_attempted}
