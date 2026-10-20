"""Separate optional-identity intake; the existing web form contract stays strict."""
from __future__ import annotations

import os
import re
from uuid import UUID

from edna_incoming.assistance import FLOW_ID, normalize_answer, valid_cuil
from .attribution import CRM_FIELDS, lead_fields as attribution_fields, normalize_attribution
from .bitrix_client import BitrixClient
from .catalogs import BANCOS, ORIGENES_LEAD, PROVINCIAS, SITUACIONES_LABORALES
from .config import load_config
from .lead_service import _resolve_enum_id, resolve_commercial_owner_enum_id, resolve_processing_policy_enum_id
from .logger import create_logger
from .normalization import normalize_whatsapp

EXTRA_FIELDS = ("WA_ASSISTANCE_ID", "WA_ASSISTANCE_STATE", "WA_SUBFLOW", "WA_SUBFLOW_ID",
                "WA_ORGANISMO", "WA_BANCO", "WA_CONTINUIDAD")


def process(payload, *, env=None, client=None):
    source = dict(os.environ if env is None else env)
    if not isinstance(payload, dict):
        raise ValueError("Invalid assisted intake.")
    case_id = str(UUID(str(payload.get("case_id", ""))))
    phone = normalize_whatsapp(payload.get("phone"))
    answer = normalize_answer(payload.get("answer"))
    result = {"ok": True, "case_id": case_id, "lead_id": "", "contact_id": "",
              "action": "dry_run", "reason": answer["action"],
              "has_cuil": bool(answer["cuil"]), "has_email": bool(answer["email"])}
    if payload.get("dry_run") is not False:
        return result
    pilot = [p.strip() for p in source.get("EDNA_ASSISTANCE_RECIPIENTS", "").split(",") if p.strip()]
    if source.get("EDNA_ASSISTANCE_CRM_ENABLED", "").lower() not in {"true", "1"} or phone.lstrip("+") not in pilot:
        return dict(result, action="disabled", reason="disabled_or_outside_pilot")
    if answer["action"] == "landing":
        return dict(result, action="not_applicable", reason="landing_sent_by_bridge")
    review_status = source.get("BITRIX24_LEAD_STATUS_ASSISTANCE_REVIEW", "").strip()
    if not review_status:
        raise ValueError("Configure the assisted review destination before enabling CRM writes.")
    config = load_config(source)
    logger = create_logger()
    api = client or BitrixClient(config, logger)
    statuses = api.call("crm.status.list", {"filter": {"ENTITY_ID": "STATUS"}})
    if (review_status in {config.lead_statuses.new, config.lead_statuses.preclassification,
                         config.lead_statuses.qualified, config.lead_statuses.rejected,
                         config.lead_statuses.converted, config.lead_statuses.external_referral}
            or not any(str(s.get("STATUS_ID")) == review_status and s.get("SEMANTICS", "P") not in {"S", "F"} for s in statuses)):
        raise ValueError("The assisted review destination must be an existing non-automatic lead stage.")
    schema = api.call("crm.lead.fields", {})
    if any(schema.get("UF_CRM_" + name, {}).get("type") != "string"
           or schema["UF_CRM_" + name].get("isMultiple") for name in EXTRA_FIELDS):
        raise ValueError("Provision the assisted CRM fields first.")
    existing = api.call("crm.lead.list", {"filter": {"=UF_CRM_WA_ASSISTANCE_ID": case_id}, "select": ["*", "UF_*", "PHONE", "EMAIL"]})
    existing = [row for row in existing if row.get("UF_CRM_WA_ASSISTANCE_ID") == case_id]
    if len(existing) > 1:
        return dict(result, action="review", reason="duplicate_case_identity")
    if existing:
        if not _same_phone(existing[0], phone):
            return dict(result, action="review", reason="case_identity_mismatch")
        return dict(result, action="already_processed", reason="case_exists", lead_id=str(existing[0]["ID"]),
                    contact_id=str(existing[0].get("CONTACT_ID") or ""))

    records = {}
    for entity in ("contact", "lead"):
        matches = api.call("crm.duplicate.findbycomm", {"entity_type": entity.upper(), "type": "PHONE", "values": [phone]})
        ids = list(dict.fromkeys(str(i) for i in matches.get(entity.upper(), [])))
        if len(ids) > 50:
            return dict(result, action="review", reason="identity_search_too_large")
        rows = [api.call("crm." + entity + ".get", {"id": i}) for i in ids]
        if any(not _same_phone(row, phone) for row in rows):
            return dict(result, action="review", reason="phone_identity_mismatch")
        if entity == "lead":
            rows = [r for r in rows if r.get("STATUS_SEMANTIC_ID") == "P"]
        if len(rows) > 1:
            return dict(result, action="review", reason="ambiguous_" + entity)
        records[entity] = rows[0] if rows else None
    contact, lead = records["contact"], records["lead"]
    if lead and contact and lead.get("CONTACT_ID") and str(lead["CONTACT_ID"]) != str(contact["ID"]):
        return dict(result, action="review", reason="contact_lead_conflict")
    cuil = answer["cuil"]
    for row, field in ((contact, config.fields.contact_cuil), (lead, config.fields.lead_cuil)):
        known = re.sub(r"\D", "", str((row or {}).get(field) or ""))
        if valid_cuil(known):
            if cuil and known != cuil:
                return dict(result, action="review", reason="cuil_phone_conflict")
            cuil = known
    if cuil:
        matches = api.call("crm.contact.list", {"filter": {"=" + config.fields.contact_cuil: cuil}, "select": ["*", "UF_*", "PHONE", "EMAIL"]})
        matches = [r for r in matches if re.sub(r"\D", "", str(r.get(config.fields.contact_cuil) or "")) == cuil]
        if len(matches) > 1 or (contact and matches and str(contact["ID"]) != str(matches[0]["ID"])):
            return dict(result, action="review", reason="ambiguous_cuil_contact")
        contact = contact or (matches[0] if matches else None)
        matches = api.call("crm.lead.list", {"filter": {"=" + config.fields.lead_cuil: cuil, "STATUS_SEMANTIC_ID": "P"},
                                            "select": ["*", "UF_*", "PHONE", "EMAIL"]})
        matches = [r for r in matches if r.get("STATUS_SEMANTIC_ID") == "P"
                   and re.sub(r"\D", "", str(r.get(config.fields.lead_cuil) or "")) == cuil]
        if len(matches) > 1 or (lead and matches and str(lead["ID"]) != str(matches[0]["ID"])):
            return dict(result, action="review", reason="ambiguous_cuil_lead")
        lead = lead or (matches[0] if matches else None)
    if lead and lead.get("UF_CRM_WA_ASSISTANCE_ID") and lead["UF_CRM_WA_ASSISTANCE_ID"] != case_id:
        return dict(result, action="review", reason="existing_assisted_case")
    if lead and contact and lead.get("CONTACT_ID") and str(lead["CONTACT_ID"]) != str(contact["ID"]):
        return dict(result, action="review", reason="contact_lead_conflict")
    if lead and all(lead.get(k) for k in (config.fields.lead_commercial_owner, config.fields.lead_cuil,
                                         config.fields.lead_province, config.fields.lead_employment_status)):
        return dict(result, action="review", reason="existing_form_requires_review")

    automatic = bool(cuil) and answer["action"] == "intake"
    state = "ready" if automatic else "pending_identity" if not cuil else "pending_organism"
    if answer["action"] == "bank_rejected":
        state = "bank_rejected"
    status = config.lead_statuses.new if automatic else review_status
    if state == "bank_rejected":
        status = config.lead_statuses.rejected
    attribution = normalize_attribution(payload.get("attribution")) or {
        "version": 1, "first": {}, "last": {}, "status": "unknown", "wa_assisted": True, "wa": {}}
    last = attribution["last"]
    source_name = {"google": "Google", "facebook": "Facebook", "meta": "Facebook", "instagram": "Instagram"}.get(
        str(last.get("utm_source") or "").strip().lower(), "Sin origen")
    source_item = ORIGENES_LEAD.resolve(source_name, "lead_source")
    source_id = (_resolve_enum_id(api, config.fields.lead_source, "Sin origen")
                 if source_name == "Sin origen" else source_item.bitrix_id)
    fields = {
        "STATUS_ID": status, "ASSIGNED_BY_ID": int(source.get("BITRIX24_ASSISTANCE_REVIEW_USER_ID", "57")),
        "UF_CRM_WA_ASSISTANCE_ID": case_id, "UF_CRM_WA_ASSISTANCE_STATE": state,
        "UF_CRM_WA_SUBFLOW": "jubilados_cordoba_continuidad", "UF_CRM_WA_SUBFLOW_ID": FLOW_ID,
        "UF_CRM_WA_ORGANISMO": answer["organism"], "UF_CRM_WA_BANCO": answer["bank"],
        "UF_CRM_WA_CONTINUIDAD": answer["continuity"],
        config.fields.lead_province: PROVINCIAS.resolve("Cordoba", "province").bitrix_id,
        config.fields.lead_source: source_id,
        config.fields.lead_commercial_owner: resolve_commercial_owner_enum_id(api, config, "kestra" if automatic else "manual"),
        config.fields.lead_processing_policy: resolve_processing_policy_enum_id(api, config, "skip"),
    }
    fields.update(attribution_fields(api, attribution, source_label=source_item.label, source_id=source_id))
    # A new un-attributed inquiry must not retain campaign/click IDs from an older Guest.
    for name in CRM_FIELDS:
        fields.setdefault(name, "")
    fields.update(UF_CRM_WA_ASSISTED="SI", UF_CRM_WA_FLOW="web_whatsapp_router", UF_CRM_WA_FLOW_ID="1850162769693486",
                  UF_CRM_WA_PROVINCE="cordoba", UF_CRM_WA_SEGMENT="cordoba_jubilado")
    if (lead or {}).get("UF_CRM_WA_ENTRY") in {"website", "google_ads", "whatsapp_directo"}:
        fields["UF_CRM_WA_ENTRY"] = lead["UF_CRM_WA_ENTRY"]
    for key in ("utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"):
        fields[key.upper()] = str(last.get(key) or "")
    if cuil:
        fields[config.fields.lead_cuil] = cuil
    if answer["employment_status"]:
        fields[config.fields.lead_employment_status] = SITUACIONES_LABORALES.resolve(answer["employment_status"], "employment_status").bitrix_id
    if answer["bank"] == "bancor":
        fields[config.fields.lead_payment_bank] = [BANCOS.resolve("Banco de la Provincia de Cordoba S.A.", "bank").bitrix_id]
    if state == "bank_rejected":
        fields[config.fields.lead_rejection_reason] = _resolve_enum_id(api, config.fields.lead_rejection_reason, "OTRO BANCO")
    if contact:
        fields["CONTACT_ID"] = str(contact["ID"])
    name = " ".join(str((contact or lead or {}).get(k) or "").strip() for k in ("NAME", "LAST_NAME")).strip()
    fields["TITLE"] = (name or "Consulta asistida") + " - Cordoba"
    if name:
        fields["NAME"] = name
    fields["PHONE"] = _merge((lead or {}).get("PHONE"), phone)
    if answer["email"]:
        fields["EMAIL"] = _merge((lead or {}).get("EMAIL"), answer["email"])
    if not contact and cuil:
        contact_fields = {"PHONE": [{"VALUE": phone, "VALUE_TYPE": "WORK"}], config.fields.contact_cuil: cuil}
        if name:
            contact_fields["NAME"] = name
        if answer["email"]:
            contact_fields["EMAIL"] = [{"VALUE": answer["email"], "VALUE_TYPE": "WORK"}]
        contact_id = str(api.call("crm.contact.add", {"fields": contact_fields}))
        contact = api.call("crm.contact.get", {"id": contact_id})
        if str(contact.get("ID")) != contact_id or not _same_phone(contact, phone):
            raise RuntimeError("Assisted contact requires reconciliation.")
        fields["CONTACT_ID"] = contact_id
    if contact:
        update = {}
        update["PHONE"] = _merge(contact.get("PHONE"), phone)
        if answer["email"]:
            update["EMAIL"] = _merge(contact.get("EMAIL"), answer["email"])
        if cuil and not contact.get(config.fields.contact_cuil):
            update[config.fields.contact_cuil] = cuil
        if update:
            api.call("crm.contact.update", {"id": contact["ID"], "fields": update})
    if lead:
        # A bound active Guest is upgraded rather than creating a parallel lead.
        api.call("crm.lead.update", {"id": lead["ID"], "fields": fields})
        lead_id = str(lead["ID"])
    else:
        lead_id = str(api.call("crm.lead.add", {"fields": fields}))
    verified = api.call("crm.lead.get", {"id": lead_id})
    if str(verified.get("UF_CRM_WA_ASSISTANCE_ID")) != case_id or not _same_phone(verified, phone):
        raise RuntimeError("Assisted lead write requires reconciliation.")
    return dict(result, action="queued" if automatic else "manual_review" if state != "bank_rejected" else "rejected",
                reason=state, lead_id=lead_id, contact_id=str((contact or {}).get("ID") or ""))


def _merge(existing, value):
    items = list(existing or [])
    if not any(str(item.get("VALUE") or "").lower() == value.lower() for item in items):
        items.append({"VALUE": value, "VALUE_TYPE": "WORK"})
    return items


def _same_phone(record, phone):
    for item in record.get("PHONE") or []:
        try:
            if normalize_whatsapp(item.get("VALUE")) == phone:
                return True
        except ValueError:
            pass
    return False
