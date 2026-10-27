"""Assisted intake with an isolated, explicitly marked test-lead path."""
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
TEST_CONTRACT_VERSION = "isolated-test-v1"


def process(payload, *, env=None, client=None):
    if not isinstance(payload, dict):
        raise ValueError("Invalid assisted intake.")
    return _persist(payload, normalize_answer(payload.get("answer")), env=env, client=client)


def _persist(payload, answer, *, env=None, client=None, intake=False):
    source = dict(os.environ if env is None else env)
    case_id = str(UUID(str(payload.get("case_id", ""))))
    phone = normalize_whatsapp(payload.get("phone"))
    flow_id = source.get("EDNA_INTAKE_FLOW_ID", "") if intake else FLOW_ID
    province = answer["province"] if intake else "Cordoba"
    province_key = answer["province_key"] if intake else "cordoba"
    segment = answer["segment"] if intake else "cordoba_jubilado"
    subflow = "website_single_intake" if intake else "jubilados_cordoba_continuidad"
    result = {"ok": True, "case_id": case_id, "lead_id": "", "contact_id": "",
              "action": "dry_run", "reason": answer["action"],
              "has_cuil": bool(answer["cuil"]), "has_email": bool(answer["email"])}
    if payload.get("dry_run") is not False:
        return result
    prefix = "EDNA_INTAKE" if intake else "EDNA_ASSISTANCE"
    pilot = [p.strip() for p in source.get(prefix + "_RECIPIENTS", "").split(",") if p.strip()]
    if (source.get(prefix + "_CRM_ENABLED", "").lower() not in {"true", "1"}
            or ((not intake or pilot) and phone.lstrip("+") not in pilot)):
        return dict(result, action="disabled", reason="disabled_or_outside_pilot")
    test_mode = not intake and source.get("EDNA_ASSISTANCE_TEST_MODE", "").lower() in {"true", "1"}
    if not isinstance(payload.get("test_mode", False), bool) or payload.get("test_mode", False) != test_mode:
        return dict(result, action="disabled", reason="pilot_mode_mismatch")
    if answer["action"] == "landing":
        return dict(result, action="not_applicable", reason="landing_sent_by_bridge")
    review_key = "BITRIX24_LEAD_STATUS_ASSISTANCE_TEST" if test_mode else "BITRIX24_LEAD_STATUS_ASSISTANCE_REVIEW"
    review_status = source.get(review_key, "").strip()
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
    if test_mode and (schema.get("UF_CRM_WA_TEST", {}).get("type") != "string"
                      or schema["UF_CRM_WA_TEST"].get("isMultiple")):
        raise ValueError("Provision the test marker field first.")
    existing = api.call("crm.lead.list", {"filter": {"=UF_CRM_WA_ASSISTANCE_ID": case_id}, "select": ["*", "UF_*", "PHONE", "EMAIL"]})
    existing = [row for row in existing if row.get("UF_CRM_WA_ASSISTANCE_ID") == case_id]
    if len(existing) > 1:
        return dict(result, action="review", reason="duplicate_case_identity")
    if existing:
        if not _same_phone(existing[0], phone):
            return dict(result, action="review", reason="case_identity_mismatch")
        if (existing[0].get("UF_CRM_WA_TEST") == "SI") != test_mode:
            return dict(result, action="review", reason="case_mode_mismatch")
        return dict(result, action="already_processed", reason="case_exists", lead_id=str(existing[0]["ID"]),
                    contact_id=str(existing[0].get("CONTACT_ID") or ""))

    if test_mode:
        return _create_test_lead(api, config, source, payload, answer, phone, case_id, review_status, result)

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
    if intake:
        # Query every known binding separately; the portal does not honor nested OR.
        for field, record in (("CONTACT_ID", contact), ("LEAD_ID", lead)):
            if not record:
                continue
            deals = api.call("crm.deal.list", {"filter": {"=" + field: record["ID"],
                             "=STAGE_SEMANTIC_ID": "P", "@CATEGORY_ID": [1, 5]},
                             "select": ["ID", field, "STAGE_SEMANTIC_ID", "CATEGORY_ID"]})
            for deal in deals:
                if (str(deal.get(field)) != str(record["ID"])
                        or deal.get("STAGE_SEMANTIC_ID") != "P" or str(deal.get("CATEGORY_ID")) not in {"1", "5"}):
                    raise ValueError("CRM management identity requires review.")
            if deals:
                return dict(result, action="review", reason="existing_management",
                            lead_id=str((lead or {}).get("ID") or ""), contact_id=str((contact or {}).get("ID") or ""))
    if lead and lead.get("UF_CRM_WA_ASSISTANCE_ID") and lead["UF_CRM_WA_ASSISTANCE_ID"] != case_id:
        return dict(result, action="review", reason="existing_assisted_case")
    if lead and contact and lead.get("CONTACT_ID") and str(lead["CONTACT_ID"]) != str(contact["ID"]):
        return dict(result, action="review", reason="contact_lead_conflict")
    if lead and all(lead.get(k) for k in (config.fields.lead_commercial_owner, config.fields.lead_cuil,
                                         config.fields.lead_province, config.fields.lead_employment_status)):
        return dict(result, action="review", reason="existing_form_requires_review")

    automatic = bool(cuil) and answer["action"] == "intake"
    state = "ready" if automatic else "pending_identity" if not cuil else "pending_organism"
    if intake and not automatic:
        state = "pending_data"
    if answer["action"] == "bank_rejected":
        state = "bank_rejected"
    status = config.lead_statuses.new if automatic else review_status
    if state == "bank_rejected":
        status = config.lead_statuses.rejected
    attribution = normalize_attribution(payload.get("attribution")) or {
        "version": 1, "first": {}, "last": {}, "status": "unknown", "wa_assisted": True, "wa": {}}
    last = attribution["last"]
    source_name = {"google": "Google", "facebook": "Facebook", "fb": "Facebook", "meta": "Facebook", "instagram": "Instagram", "ig": "Instagram"}.get(
        str(last.get("utm_source") or "").strip().lower(), "Sin origen")
    source_item = ORIGENES_LEAD.resolve(source_name, "lead_source")
    source_id = (_resolve_enum_id(api, config.fields.lead_source, "Sin origen")
                 if source_name == "Sin origen" else source_item.bitrix_id)
    fields = {
        "STATUS_ID": status, "ASSIGNED_BY_ID": int(source.get("BITRIX24_ASSISTANCE_REVIEW_USER_ID", "57")),
        "UF_CRM_WA_ASSISTANCE_ID": case_id, "UF_CRM_WA_ASSISTANCE_STATE": state,
        "UF_CRM_WA_SUBFLOW": subflow, "UF_CRM_WA_SUBFLOW_ID": flow_id,
        "UF_CRM_WA_ORGANISMO": answer["organism"], "UF_CRM_WA_BANCO": answer["bank"],
        "UF_CRM_WA_CONTINUIDAD": answer["continuity"],
        config.fields.lead_province: PROVINCIAS.resolve(province, "province").bitrix_id,
        config.fields.lead_source: source_id,
        config.fields.lead_commercial_owner: resolve_commercial_owner_enum_id(api, config, "kestra" if automatic else "manual"),
        config.fields.lead_processing_policy: resolve_processing_policy_enum_id(api, config, "skip"),
    }
    fields.update(attribution_fields(api, attribution, source_label=source_item.label, source_id=source_id))
    # A new un-attributed inquiry must not retain campaign/click IDs from an older Guest.
    for name in CRM_FIELDS:
        fields.setdefault(name, "")
    fields.update(UF_CRM_WA_ASSISTED="SI", UF_CRM_WA_FLOW="web_whatsapp_intake" if intake else "web_whatsapp_router",
                  UF_CRM_WA_FLOW_ID=flow_id if intake else "1850162769693486",
                  UF_CRM_WA_PROVINCE=province_key, UF_CRM_WA_SEGMENT=segment)
    if intake:
        fields["UF_CRM_WA_ENTRY"] = "website"
        fields["UF_CRM_WA_TIMESTAMP"] = payload["received_at"]
    if not intake and (lead or {}).get("UF_CRM_WA_ENTRY") in {"website", "google_ads", "whatsapp_directo"}:
        fields["UF_CRM_WA_ENTRY"] = lead["UF_CRM_WA_ENTRY"]
    for key in ("utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"):
        fields[key.upper()] = str(last.get(key) or "")
    if cuil:
        fields[config.fields.lead_cuil] = cuil
    if answer["employment_status"]:
        fields[config.fields.lead_employment_status] = SITUACIONES_LABORALES.resolve(answer["employment_status"], "employment_status").bitrix_id
    if intake and answer["payment_bank"]:
        fields[config.fields.lead_payment_bank] = [BANCOS.resolve(answer["payment_bank"], "bank").bitrix_id]
    elif answer["bank"] == "bancor":
        fields[config.fields.lead_payment_bank] = [BANCOS.resolve("Banco de la Provincia de Cordoba S.A.", "bank").bitrix_id]
    if state == "bank_rejected":
        fields[config.fields.lead_rejection_reason] = _resolve_enum_id(api, config.fields.lead_rejection_reason, "OTRO BANCO")
    if contact:
        fields["CONTACT_ID"] = str(contact["ID"])
    name = " ".join(str((contact or lead or {}).get(k) or "").strip() for k in ("NAME", "LAST_NAME")).strip()
    fields["TITLE"] = (name or "Consulta WhatsApp") + " - " + province if intake else (name or "Consulta asistida") + " - Cordoba"
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


def _create_test_lead(api, config, source, payload, answer, phone, case_id, status, result):
    """Create only a new test lead; never update identities or enter business stages."""
    operator = source.get("BITRIX24_ASSISTANCE_TEST_USER_ID", "").strip()
    if not operator.isdigit() or int(operator) <= 0:
        raise ValueError("Configure the internal test owner before enabling test leads.")
    source_id = _resolve_enum_id(api, config.fields.lead_source, "Sin origen")
    attribution = normalize_attribution(payload.get("attribution")) or {
        "version": 1, "first": {}, "last": {}, "status": "unknown", "wa_assisted": True, "wa": {}}
    fields = {
        "TITLE": "[PRUEBA WHATSAPP] Jubilados Cordoba - " + answer["organism"],
        "COMMENTS": "PRUEBA INTERNA. No gestionar ni mover a INGRESO. Sin precalificacion ni negociacion automatica.",
        "STATUS_ID": status, "ASSIGNED_BY_ID": int(operator),
        "PHONE": [{"VALUE": phone, "VALUE_TYPE": "WORK"}],
        "UF_CRM_WA_TEST": "SI", "UF_CRM_WA_ASSISTANCE_ID": case_id,
        "UF_CRM_WA_ASSISTANCE_STATE": "test", "UF_CRM_WA_SUBFLOW": "jubilados_cordoba_continuidad",
        "UF_CRM_WA_SUBFLOW_ID": FLOW_ID, "UF_CRM_WA_ORGANISMO": answer["organism"],
        "UF_CRM_WA_BANCO": answer["bank"], "UF_CRM_WA_CONTINUIDAD": answer["continuity"],
        "UF_CRM_WA_ASSISTED": "SI", "UF_CRM_WA_FLOW": "web_whatsapp_router", "UF_CRM_WA_FLOW_ID": "1850162769693486",
        "UF_CRM_WA_PROVINCE": "cordoba", "UF_CRM_WA_SEGMENT": "cordoba_jubilado",
        config.fields.lead_source: source_id,
        config.fields.lead_province: PROVINCIAS.resolve("Cordoba", "province").bitrix_id,
        config.fields.lead_commercial_owner: resolve_commercial_owner_enum_id(api, config, "manual"),
        config.fields.lead_processing_policy: resolve_processing_policy_enum_id(api, config, "skip"),
    }
    fields.update(attribution_fields(api, attribution, source_label="Sin origen", source_id=source_id))
    for key in ("utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"):
        fields[key.upper()] = str(attribution["last"].get(key) or "")
    if answer["cuil"]:
        fields[config.fields.lead_cuil] = answer["cuil"]
    if answer["email"]:
        fields["EMAIL"] = [{"VALUE": answer["email"], "VALUE_TYPE": "WORK"}]
    if answer["employment_status"]:
        fields[config.fields.lead_employment_status] = SITUACIONES_LABORALES.resolve(answer["employment_status"], "employment_status").bitrix_id
    if answer["bank"] == "bancor":
        fields[config.fields.lead_payment_bank] = [BANCOS.resolve("Banco de la Provincia de Cordoba S.A.", "bank").bitrix_id]
    lead_id = str(api.call("crm.lead.add", {"fields": fields}))
    verified = api.call("crm.lead.get", {"id": lead_id})
    if (verified.get("UF_CRM_WA_TEST") != "SI" or str(verified.get("UF_CRM_WA_ASSISTANCE_ID")) != case_id
            or str(verified.get("STATUS_ID")) != status or not _same_phone(verified, phone)):
        raise RuntimeError("Test lead requires reconciliation.")
    return dict(result, action="test_created", reason="isolated_test_lead", lead_id=lead_id)


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
