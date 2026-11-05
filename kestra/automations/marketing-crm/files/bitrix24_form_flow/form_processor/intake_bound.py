"""Enrich the proven channel lead; never create a fallback lead for V2."""
import json

from .catalogs import BANCOS, PROVINCIAS, SITUACIONES_LABORALES
from .lead_service import _resolve_enum_id
from .whatsapp_assistance import _merge, _same_phone
from .attribution import CRM_FIELDS
from .whatsapp_intake_crm import (
    CUIL_REVIEW_STATUS, GUEST_STATUS, INVALID_CUIL_FIELD, REVIEW_REASON_FIELD,
    _cuil, _lead_fields, _resolve, _rows,
)
from edna_incoming.intake import REJECTION_LABELS


def _review(result, lead, reason):
    return dict(result, action="manual_review", reason=reason, lead_id=str(lead["ID"]),
                contact_id=str(lead.get("CONTACT_ID") or ""))


def _read_lead(api, lead_id):
    lead = api.call("crm.lead.get", {"id": lead_id})
    if not isinstance(lead, dict) or str(lead.get("ID")) != lead_id:
        raise ValueError("The bound CRM record requires reconciliation.")
    return lead


def _channel_matches(api, binding, lead, case_id):
    dialog = api.call("imopenlines.dialog.get", {"CHAT_ID": int(binding["chat_id"])})
    if (not isinstance(dialog, dict) or str(dialog.get("id")) != binding["chat_id"]
            or dialog.get("entity_type") != "LINES"
            or str(dialog.get("entity_id") or "").split("|")[:2] != ["whatsappbyedna", "1"]):
        return False
    parts = str(dialog.get("entity_data_2") or "").split("|")
    if len(parts) % 2:
        return False
    entities = dict(zip(parts[::2], parts[1::2]))
    linked_lead = entities.get("LEAD")
    # A completed conversion may remove the lead from the live chat metadata.
    # The stored entry proof remains valid; never compare a current (possibly
    # closed/renewed) session ID with the historical session captured by Web.
    return linked_lead == binding["lead_id"] or (
        linked_lead == "0" and lead.get("UF_CRM_WA_ASSISTANCE_ID") == case_id)


def _revision(lead, config):
    fields = {"STATUS_ID", "STATUS_SEMANTIC_ID", "ASSIGNED_BY_ID", "CONTACT_ID", "NAME", "LAST_NAME", "TITLE", "PHONE", "EMAIL", "COMMENTS",
              "DATE_MODIFY", "UF_CRM_WA_ASSISTANCE_ID", config.fields.lead_cuil,
              config.fields.lead_commercial_owner, config.fields.lead_province,
              config.fields.lead_employment_status, config.fields.lead_payment_bank,
              config.fields.lead_source, config.fields.lead_processing_policy, config.fields.lead_rejection_reason,
              "UTM_SOURCE", "UTM_MEDIUM", "UTM_CAMPAIGN", "UTM_CONTENT", "UTM_TERM", *CRM_FIELDS}
    return {field: lead.get(field) for field in fields}


def _same_revision_or_forward_stage(before, after, config):
    old, new = _revision(before, config), _revision(after, config)
    if old == new:
        return True
    stages = {GUEST_STATUS: 0, config.lead_statuses.new: 1, config.lead_statuses.preclassification: 2}
    old_stage, new_stage = before.get("STATUS_ID"), after.get("STATUS_ID")
    if old_stage not in stages or new_stage not in stages or stages[new_stage] <= stages[old_stage]:
        return False
    # The existing prefill can advance an empty original while intake reads its
    # identity. Permit only that forward stage change, never another edit.
    return all(old[field] == new[field] for field in old if field not in {"STATUS_ID", "DATE_MODIFY"})


def _profile_conflict(lead, answer, config):
    expected = {
        config.fields.lead_province: PROVINCIAS.resolve(answer["province"], "province").bitrix_id,
        config.fields.lead_employment_status: SITUACIONES_LABORALES.resolve(answer["employment_status"], "employment").bitrix_id if answer["employment_status"] else "",
        config.fields.lead_payment_bank: BANCOS.resolve(answer["payment_bank"], "bank").bitrix_id if answer["payment_bank"] else "",
    }
    for field, value in expected.items():
        actual = lead.get(field)
        # Bitrix returns false for an unset catalog field, including bank.
        # Use identity for the boolean sentinel so numeric 0 remains a conflict.
        if actual is None or actual is False or actual == "" or actual == []:
            continue
        values = actual if isinstance(actual, list) else [actual]
        if [str(item) for item in values] != [str(value)]:
            return True
    return False


def _preserve_acquisition(lead, fields, payload, config):
    """The current case snapshot does not erase native acquisition history."""
    website = payload["entry_context"]["origin"] == "website"
    protected = ["UTM_SOURCE", "UTM_MEDIUM", "UTM_CAMPAIGN", "UTM_CONTENT", "UTM_TERM",
                 "UF_CRM_GCLID", "UF_CRM_GBRAID", "UF_CRM_WBRAID", "UF_CRM_FBCLID",
                 "UF_CRM_LANDING_ORIGEN", "UF_CRM_FECHA_ORIGEN", config.fields.lead_source]
    if website:
        protected.append("UF_CRM_JOURNEY_ID")
        try:
            previous = json.loads(lead.get("UF_CRM_ATTR_JSON") or "{}")
        except (ValueError, TypeError):
            return False
        if not isinstance(previous, dict):
            return False
        for stage in ("first", "last"):
            old = previous.get(stage) or {}
            new = payload["attribution"].get(stage) or {}
            if not isinstance(old, dict) or any(value and new.get(key) and value != new[key] for key, value in old.items()):
                return False
    for field in protected:
        old, new = lead.get(field), fields.get(field)
        if old in (None, "", []):
            continue
        if website and new not in (None, "", []) and str(old) != str(new):
            return False
        fields.pop(field, None)
    # ATTR_JSON/STATUS and WA provenance describe this authenticated case.
    # For a direct entry they remain unknown, even with historic raw UTMs.
    return True


def persist_bound(payload, answer, *, env, api, config, review_status, result, phone, case_id):
    binding = payload["crm_binding"]
    lead_id = binding["lead_id"]
    lead = _read_lead(api, lead_id)
    if not _same_phone(lead, phone) or not _channel_matches(api, binding, lead, case_id):
        return _review(result, lead, "bound_channel_conflict")

    existing = _rows(api, "crm.lead.list", {"filter": {"=UF_CRM_WA_ASSISTANCE_ID": case_id}, "select": ["ID", "UF_CRM_WA_ASSISTANCE_ID"]})
    if any(row.get("UF_CRM_WA_ASSISTANCE_ID") != case_id or str(row["ID"]) != lead_id for row in existing) or len(existing) > 1:
        return _review(result, lead, "bound_case_conflict")
    if lead.get("UF_CRM_WA_ASSISTANCE_ID") == case_id:
        if (not existing or str(lead.get("UF_CRM_WA_FLOW_ID")) != str(payload["flow_id"])
                or _cuil(lead, config.fields.lead_cuil) != (answer["cuil"] or "")
                or (lead.get(INVALID_CUIL_FIELD) or "") != answer["reported_cuil"]
                or lead.get("UF_CRM_WA_TEST")):
            return _review(result, lead, "bound_case_conflict")
        state = lead.get("UF_CRM_WA_ASSISTANCE_STATE")
        if state in REJECTION_LABELS:
            return dict(result, action="rejected", reason=state, lead_id=lead_id,
                        contact_id=str(lead.get("CONTACT_ID") or ""))
        if state != "ready":
            return _review(result, lead, lead.get(REVIEW_REASON_FIELD) or state or "pending_data")
        return dict(result, action="already_processed", reason="case_exists", lead_id=lead_id,
                    contact_id=str(lead.get("CONTACT_ID") or ""))
    if existing or lead.get("UF_CRM_WA_ASSISTANCE_ID") or lead.get("UF_CRM_WA_TEST"):
        return _review(result, lead, "bound_case_conflict")
    if (lead.get("STATUS_SEMANTIC_ID") != "P"
            or lead.get("STATUS_ID") not in {GUEST_STATUS, config.lead_statuses.new, config.lead_statuses.preclassification}):
        return _review(result, lead, "bound_management_requires_review")
    if _cuil(lead, config.fields.lead_cuil) and _cuil(lead, config.fields.lead_cuil) != answer["cuil"]:
        return _review(result, lead, "bound_identity_conflict")
    if _profile_conflict(lead, answer, config):
        return _review(result, lead, "bound_profile_conflict")
    owner = lead.get(config.fields.lead_commercial_owner)
    if owner and str(owner) != _resolve_enum_id(api, config.fields.lead_commercial_owner, config.commercial_owner.kestra):
        policy = lead.get(config.fields.lead_processing_policy)
        # Native channel records start under Bitrix before their first intake.
        # Handoff is limited to this proven, preliminary and unprocessed lead;
        # manual ownership and an explicit processing policy remain protected.
        native_unprocessed = (
            str(owner) == _resolve_enum_id(api, config.fields.lead_commercial_owner, config.commercial_owner.bitrix)
            and (policy is None or policy is False or policy == "" or policy == [])
        )
        if not native_unprocessed:
            return _review(result, lead, "bound_management_requires_review")
    if lead.get("CONTACT_ID"):
        linked = api.call("crm.contact.get", {"id": str(lead["CONTACT_ID"])})
        if (not isinstance(linked, dict) or str(linked.get("ID")) != str(lead["CONTACT_ID"])
                or not answer["cuil"] or _cuil(linked, config.fields.contact_cuil) != answer["cuil"]):
            return _review(result, lead, "bound_contact_identity_conflict")

    contact, _, reason, related = _resolve(api, config, answer, phone, bound_lead=lead)
    if lead.get("CONTACT_ID") and (not contact or str(contact["ID"]) != str(lead["CONTACT_ID"])):
        return _review(result, lead, "bound_contact_identity_conflict")
    rejected = bool(answer["rejection_reason"])
    if rejected:
        reason = answer["rejection_reason"]
    elif answer["cuil_status"] != "valid":
        reason = "pending_cuil"
    elif answer["email_status"] == "invalid" and not reason:
        reason = "invalid_email"
    elif answer["action"] != "intake" and not reason:
        reason = "pending_data"
    automatic = not reason
    state = "ready" if automatic else reason
    status = config.lead_statuses.rejected if rejected else (
        lead["STATUS_ID"] if automatic else CUIL_REVIEW_STATUS if reason == "pending_cuil" else review_status)
    fields = _lead_fields(api, config, payload, answer, env, case_id, phone, contact, lead, status, state, reason, related)
    if not _preserve_acquisition(lead, fields, payload, config):
        return _review(result, lead, "bound_attribution_conflict")
    # An intake is enrichment of this record, not a second assignment/cutover.
    fields.pop("ASSIGNED_BY_ID", None)
    if automatic:
        if lead["STATUS_ID"] == GUEST_STATUS:
            fields["STATUS_ID"] = config.lead_statuses.new
        else:
            fields.pop("STATUS_ID", None)
    for field in ("TITLE", "NAME", "LAST_NAME"):
        if lead.get(field):
            fields.pop(field, None)
    fresh = _read_lead(api, lead_id)
    if not _same_revision_or_forward_stage(lead, fresh, config):
        return _review(result, fresh, "bound_lead_changed")
    lead = fresh
    if automatic and lead["STATUS_ID"] != GUEST_STATUS:
        fields.pop("STATUS_ID", None)

    create_contact = not rejected and answer["cuil"] and not contact and reason not in {
        "ambiguous_cuil_contact", "ambiguous_cuil_lead", "contact_lead_conflict", "identity_search_too_large"}
    if create_contact:
        new = {"PHONE": [{"VALUE": phone, "VALUE_TYPE": "WORK"}], config.fields.contact_cuil: answer["cuil"]}
        if answer["email"]:
            new["EMAIL"] = [{"VALUE": answer["email"], "VALUE_TYPE": "WORK"}]
        contact_id = str(api.call("crm.contact.add", {"fields": new}))
        contact = api.call("crm.contact.get", {"id": contact_id})
        if (not isinstance(contact, dict) or str(contact.get("ID")) != contact_id or not _same_phone(contact, phone)
                or _cuil(contact, config.fields.contact_cuil) != answer["cuil"]):
            raise RuntimeError("Bound intake contact creation requires reconciliation.")
        fields["CONTACT_ID"] = contact_id
    elif contact and automatic:
        current = api.call("crm.contact.get", {"id": str(contact["ID"])})
        if not isinstance(current, dict) or str(current.get("ID")) != str(contact["ID"]) or _cuil(current, config.fields.contact_cuil) != answer["cuil"]:
            return _review(result, lead, "bound_contact_identity_conflict")
        update = {"PHONE": _merge(current.get("PHONE"), phone)}
        if answer["email"]:
            update["EMAIL"] = _merge(current.get("EMAIL"), answer["email"])
        api.call("crm.contact.update", {"id": str(contact["ID"]), "fields": update})
    fresh = _read_lead(api, lead_id)
    if not _same_revision_or_forward_stage(lead, fresh, config):
        return _review(result, fresh, "bound_lead_changed")
    if automatic and fresh["STATUS_ID"] != GUEST_STATUS:
        fields.pop("STATUS_ID", None)
    if _rows(api, "crm.lead.list", {"filter": {"=UF_CRM_WA_ASSISTANCE_ID": case_id},
                                    "select": ["ID", "UF_CRM_WA_ASSISTANCE_ID"]}):
        return _review(result, fresh, "bound_case_conflict")
    api.call("crm.lead.update", {"id": lead_id, "fields": fields})
    verified = _read_lead(api, lead_id)
    if (verified.get("UF_CRM_WA_ASSISTANCE_ID") != case_id or not _same_phone(verified, phone)
            or str(verified.get("UF_CRM_WA_FLOW_ID")) != str(payload["flow_id"])
            or verified.get("UF_CRM_WA_ASSISTANCE_STATE") != state
            or str(verified.get("CONTACT_ID") or "") != str(fields.get("CONTACT_ID") or "")
            or (verified.get(REVIEW_REASON_FIELD) or "") != fields[REVIEW_REASON_FIELD]
            or (verified.get(INVALID_CUIL_FIELD) or "") != answer["reported_cuil"]
            or (not automatic and verified.get("STATUS_ID") != status)
            or _cuil(verified, config.fields.lead_cuil) != (answer["cuil"] or "")):
        raise RuntimeError("Bound intake lead update requires reconciliation.")
    if rejected and str(verified.get(config.fields.lead_rejection_reason)) != str(fields[config.fields.lead_rejection_reason]):
        raise RuntimeError("Bound intake rejection requires reconciliation.")
    return dict(result, action="rejected" if rejected else "queued" if automatic else "manual_review", reason=state,
                lead_id=lead_id, contact_id=str((contact or {}).get("ID") or ""))
