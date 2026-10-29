"""One visible lead per authenticated intake case, with CUIL-first identity."""
from __future__ import annotations

from html import escape
import json
import re
from uuid import UUID

from edna_incoming.intake import REJECTION_LABELS
from edna_incoming.test_reference import TEST_MARKER, TEST_REFERENCE, TEST_TITLE
from .attribution import CRM_FIELDS, lead_fields as attribution_fields, normalize_attribution
from .bitrix_client import BitrixClient
from .catalogs import BANCOS, ORIGENES_LEAD, PROVINCIAS, SITUACIONES_LABORALES
from .config import load_config
from .lead_service import _resolve_enum_id, resolve_commercial_owner_enum_id, resolve_processing_policy_enum_id
from .logger import create_logger
from .normalization import normalize_whatsapp
from .whatsapp_assistance import EXTRA_FIELDS, _duplicate_ids, _merge, _same_phone

INVALID_CUIL_FIELD = "UF_CRM_WA_CUIL_INVALID"
REVIEW_REASON_FIELD = "UF_CRM_WA_REVIEW_REASON"
CUIL_REVIEW_STATUS = "UC_WA_CUIL_REVIEW"
GUEST_STATUS = "UC_PWTVG6"
REVIEW_LABELS = {
    "pending_cuil": "CUIL pendiente de corrección. El valor informado no se usa como identidad.",
    "invalid_email": "Email informado inválido. Requiere corrección.",
    "pending_data": "Datos del formulario pendientes de revisión.",
    "ambiguous_cuil_contact": "Hay varios contactos con el mismo CUIL. Revisar sin fusionar automáticamente.",
    "ambiguous_cuil_lead": "Hay varios leads activos para el mismo CUIL.",
    "contact_lead_conflict": "La vinculación del lead y el contacto requiere revisión.",
    "existing_management": "La persona tiene una gestión abierta. Incorporar esta consulta a esa gestión.",
    "existing_form_requires_review": "Hay otro formulario o lead activo de esta persona. Revisar su continuidad.",
    "ambiguous_guest": "Hay varios ingresos sin identidad para este WhatsApp. Se conserva esta consulta por separado.",
    "identity_search_too_large": "La búsqueda de identidad supera el límite de revisión automática.",
    "province_not_eligible": "Solicitud rechazada: seleccionó Otra provincia, fuera del circuito interno.",
    "employment_status_not_eligible": "Solicitud rechazada: seleccionó Otra situación laboral, fuera de las categorías del circuito interno.",
}


def persist(payload, answer, *, env, client=None):
    case_id = str(UUID(str(payload.get("case_id", ""))))
    phone = normalize_whatsapp(payload.get("phone"))
    test = payload.get("test_reference") == TEST_REFERENCE
    result = {"ok": True, "case_id": case_id, "lead_id": "", "contact_id": "",
              "action": "dry_run", "reason": answer["action"],
              "has_cuil": bool(answer["cuil"]), "has_email": bool(answer["email"]), "is_test": test}
    if payload.get("dry_run") is not False:
        return result
    recipients = [p.strip() for p in env.get("EDNA_INTAKE_RECIPIENTS", "").split(",") if p.strip()]
    if (env.get("EDNA_INTAKE_CRM_ENABLED", "").lower() not in {"true", "1"}
            or (not test and recipients and phone.lstrip("+") not in recipients)):
        return dict(result, action="disabled", reason="disabled_or_outside_pilot")
    config = load_config(env)
    api = client or BitrixClient(config, create_logger())
    review_status = env.get("BITRIX24_LEAD_STATUS_ASSISTANCE_REVIEW", "").strip()
    _validate_schema(api, config, review_status, test=test)

    # The UUID belongs to the original saved response, not to a phone or a CUIL.
    existing = _rows(api, "crm.lead.list", {"filter": {"=UF_CRM_WA_ASSISTANCE_ID": case_id},
                                           "select": ["*", "UF_*", "PHONE", "EMAIL"]})
    if any(r.get("UF_CRM_WA_ASSISTANCE_ID") != case_id for r in existing) or len(existing) > 1:
        raise ValueError("Intake case identity requires reconciliation.")
    if existing:
        lead = existing[0]
        if (not _same_phone(lead, phone) or lead.get("UF_CRM_WA_TEST") == "SI"
                or (lead.get("UF_CRM_WA_TEST") == TEST_MARKER) != test
                or str(lead.get("UF_CRM_WA_FLOW_ID")) != str(payload["flow_id"])
                or _cuil(lead, config.fields.lead_cuil) != (answer["cuil"] or "")
                or (lead.get(INVALID_CUIL_FIELD) or "") != answer["reported_cuil"]):
            raise ValueError("Intake case provenance requires reconciliation.")
        state = lead.get("UF_CRM_WA_ASSISTANCE_STATE")
        if state in REJECTION_LABELS:
            return dict(result, action="rejected", reason=state, lead_id=str(lead["ID"]),
                        contact_id=str(lead.get("CONTACT_ID") or ""))
        if state != "ready":
            return dict(result, action="manual_review", reason=lead.get(REVIEW_REASON_FIELD) or state or "pending_data",
                        lead_id=str(lead["ID"]), contact_id=str(lead.get("CONTACT_ID") or ""))
        return dict(result, action="already_processed", reason="case_exists", lead_id=str(lead["ID"]),
                    contact_id=str(lead.get("CONTACT_ID") or ""))

    contact, guest, reason, related = _resolve(api, config, answer, phone)
    if test:
        # Each deliberate test has its own lead; never consume an ordinary Guest.
        guest = None
    rejected = bool(answer["rejection_reason"])
    if rejected:
        # An explicit out-of-scope selection does not need identity correction
        # to reject this inquiry. Keep invalid identity data isolated anyway.
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
        config.lead_statuses.new if automatic else CUIL_REVIEW_STATUS if reason == "pending_cuil" else review_status)
    fields = _lead_fields(api, config, payload, answer, env, case_id, phone, contact, guest, status, state, reason, related)

    # Invalid/missing CUIL never inherits a person's identity from a shared phone.
    # Ambiguous identities remain an unbound manual lead; no contact is guessed.
    create_contact = not rejected and answer["cuil"] and not contact and reason not in {
        "ambiguous_cuil_contact", "ambiguous_cuil_lead", "contact_lead_conflict", "identity_search_too_large"}
    if create_contact:
        new = {"PHONE": [{"VALUE": phone, "VALUE_TYPE": "WORK"}], config.fields.contact_cuil: answer["cuil"]}
        if answer["email"]:
            new["EMAIL"] = [{"VALUE": answer["email"], "VALUE_TYPE": "WORK"}]
        contact_id = str(api.call("crm.contact.add", {"fields": new}))
        contact = api.call("crm.contact.get", {"id": contact_id})
        if (str(contact.get("ID")) != contact_id or not _same_phone(contact, phone)
                or _cuil(contact, config.fields.contact_cuil) != answer["cuil"]):
            raise RuntimeError("Intake contact creation requires reconciliation.")
        fields["CONTACT_ID"] = contact_id
    elif contact and automatic:
        # A phone is a communication channel, so preserve all previous numbers.
        update = {"PHONE": _merge(contact.get("PHONE"), phone)}
        if answer["email"]:
            update["EMAIL"] = _merge(contact.get("EMAIL"), answer["email"])
        api.call("crm.contact.update", {"id": contact["ID"], "fields": update})
    if guest:
        api.call("crm.lead.update", {"id": guest["ID"], "fields": fields})
        lead_id = str(guest["ID"])
    else:
        lead_id = str(api.call("crm.lead.add", {"fields": fields}))
    verified = api.call("crm.lead.get", {"id": lead_id})
    if (str(verified.get("UF_CRM_WA_ASSISTANCE_ID")) != case_id or not _same_phone(verified, phone)
            or verified.get("UF_CRM_WA_ASSISTANCE_STATE") != state
            or str(verified.get("CONTACT_ID") or "") != str(fields.get("CONTACT_ID") or "")
            or (verified.get("UF_CRM_WA_TEST") == TEST_MARKER) != test
            or (verified.get(REVIEW_REASON_FIELD) or "") != fields[REVIEW_REASON_FIELD]
            or (not automatic and verified.get("STATUS_ID") != status)):
        raise RuntimeError("Intake lead write requires reconciliation.")
    if rejected and str(verified.get(config.fields.lead_rejection_reason)) != str(fields[config.fields.lead_rejection_reason]):
        raise RuntimeError("Intake rejection requires reconciliation.")
    if answer["cuil"]:
        if _cuil(verified, config.fields.lead_cuil) != answer["cuil"]:
            raise RuntimeError("Intake CUIL requires reconciliation.")
    elif (verified.get(config.fields.lead_cuil) or verified.get("CONTACT_ID")
          or (verified.get(INVALID_CUIL_FIELD) or "") != answer["reported_cuil"]
          or verified.get("STATUS_ID") != status):
        raise RuntimeError("Unverified intake identity requires reconciliation.")
    return dict(result, action="rejected" if rejected else "queued" if automatic else "manual_review", reason=state,
                lead_id=lead_id, contact_id=str((contact or {}).get("ID") or ""))


def _rows(api, method, body):
    # REST list methods return 50 rows per page. Never infer uniqueness from
    # a truncated page; stop safely on an invalid or repeated provider page.
    rows = []
    seen = set()
    for start in range(0, 1000, 50):
        page = api.call(method, {**body, "start": start, "order": {"ID": "ASC"}})
        if (not isinstance(page, list) or len(page) > 50
                or any(not isinstance(r, dict) or isinstance(r.get("ID"), bool)
                       or not re.fullmatch(r"[1-9][0-9]{0,63}", str(r.get("ID", ""))) for r in page)):
            raise ValueError("Invalid CRM identity list; requires reconciliation.")
        ids = [str(r["ID"]) for r in page]
        if len(set(ids)) != len(ids) or seen.intersection(ids):
            raise ValueError("Repeated CRM identity page; requires reconciliation.")
        rows.extend(page)
        seen.update(ids)
        if len(page) < 50:
            return rows
    raise ValueError("CRM identity search requires reconciliation.")


def _cuil(record, field):
    return re.sub(r"\D", "", str(record.get(field) or ""))


def _test_record(record):
    if record.get("UF_CRM_WA_TEST") == TEST_MARKER:
        return True
    try:
        snapshot = json.loads(record.get("UF_CRM_ATTR_JSON") or "{}")
    except (TypeError, ValueError):
        return False
    return isinstance(snapshot, dict) and snapshot.get("test_reference") == TEST_REFERENCE


def _resolve(api, config, answer, phone):
    contact = None
    reason = ""
    related = {"contact_ids": [], "lead_ids": [], "deal_ids": []}
    cuil = answer["cuil"]
    if cuil:
        contacts = _rows(api, "crm.contact.list", {"filter": {"=" + config.fields.contact_cuil: cuil},
                                                   "select": ["*", "UF_*", "PHONE", "EMAIL"]})
        if any(_cuil(r, config.fields.contact_cuil) != cuil for r in contacts):
            raise ValueError("CRM contact CUIL does not match the requested identity.")
        related["contact_ids"] = [str(r["ID"]) for r in contacts]
        if len(contacts) > 1:
            reason = "ambiguous_cuil_contact"
        elif contacts:
            contact = contacts[0]
        leads = _rows(api, "crm.lead.list", {"filter": {"=" + config.fields.lead_cuil: cuil, "STATUS_SEMANTIC_ID": "P"},
                                              "select": ["*", "UF_*", "PHONE", "EMAIL"]})
        if any(_cuil(r, config.fields.lead_cuil) != cuil or r.get("STATUS_SEMANTIC_ID") != "P" for r in leads):
            raise ValueError("CRM lead CUIL does not match the requested identity.")
        # Test cases must not block a new test or an ordinary inquiry. Real
        # inquiries and open management still retain all identity protections.
        leads = [r for r in leads if not _test_record(r)]
        related["lead_ids"] = [str(r["ID"]) for r in leads]
        if len(leads) > 1 and not reason:
            reason = "ambiguous_cuil_lead"
        if any(r.get("CONTACT_ID") and (not contact or str(r["CONTACT_ID"]) != str(contact["ID"])) for r in leads) and not reason:
            reason = "contact_lead_conflict"
        for field, records in (("CONTACT_ID", [contact] if contact else []), ("LEAD_ID", leads)):
            for record in records:
                deals = _rows(api, "crm.deal.list", {"filter": {"=" + field: record["ID"], "=STAGE_SEMANTIC_ID": "P", "@CATEGORY_ID": [1, 5]},
                                                      "select": ["ID", field, "STAGE_SEMANTIC_ID", "CATEGORY_ID", "UF_CRM_WA_TEST", "UF_CRM_ATTR_JSON"]})
                if any(str(d.get(field)) != str(record["ID"]) or d.get("STAGE_SEMANTIC_ID") != "P"
                       or str(d.get("CATEGORY_ID")) not in {"1", "5"} for d in deals):
                    raise ValueError("CRM management does not match the requested identity.")
                related["deal_ids"].extend(str(d["ID"]) for d in deals if not _test_record(d))
        if related["deal_ids"] and not reason:
            reason = "existing_management"
        elif leads and not reason:
            reason = "existing_form_requires_review"

    # Phone lookup is only for reusing an empty channel-created Guest. It never
    # chooses a contact, borrows a known CUIL, or overwrites a completed inquiry.
    matches = api.call("crm.duplicate.findbycomm", {"entity_type": "LEAD", "type": "PHONE", "values": [phone]})
    ids = _duplicate_ids(matches, "LEAD")
    if len(ids) > 50:
        return contact, None, reason or "identity_search_too_large", related
    candidates = [api.call("crm.lead.get", {"id": i}) for i in ids]
    if any(not isinstance(r, dict) or str(r.get("ID")) != id or not _same_phone(r, phone)
           for id, r in zip(ids, candidates)):
        raise ValueError("CRM phone lookup returned another channel.")
    guests = [r for r in candidates if _empty_guest(r, config)]
    # Several empty Guests are a channel ambiguity, not a CUIL ambiguity.
    # Create a separate case rather than selecting one or blocking a person.
    guest = guests[0] if len(guests) == 1 else None
    return contact, guest, reason, related


def _empty_guest(record, config):
    return (record.get("STATUS_SEMANTIC_ID") == "P" and record.get("STATUS_ID") == GUEST_STATUS
            and str(record.get("NAME") or "").strip().lower() in {"", "guest"} and not record.get("LAST_NAME")
            and not record.get("CONTACT_ID") and not record.get(config.fields.lead_cuil)
            and not record.get("UF_CRM_WA_ASSISTANCE_ID") and not record.get(config.fields.lead_commercial_owner)
            and not record.get(config.fields.lead_employment_status) and not record.get(config.fields.lead_province))


def _validate_schema(api, config, review_status, *, test=False):
    protected = {config.lead_statuses.new, config.lead_statuses.preclassification, config.lead_statuses.qualified,
                 config.lead_statuses.rejected, config.lead_statuses.converted, config.lead_statuses.external_referral}
    statuses = api.call("crm.status.list", {"filter": {"ENTITY_ID": "STATUS"}})
    if not isinstance(statuses, list) or any(not isinstance(s, dict) for s in statuses):
        raise ValueError("Invalid intake stage metadata.")
    for status in [review_status, CUIL_REVIEW_STATUS]:
        if (not status or status in protected or not any(s.get("STATUS_ID") == status
                and s.get("SEMANTICS", "P") not in {"S", "F"} for s in statuses)):
            raise ValueError("Provision a non-automatic intake review stage before enabling writes.")
    if review_status == CUIL_REVIEW_STATUS:
        raise ValueError("CUIL correction requires a distinct review stage.")
    if not any(s.get("STATUS_ID") == config.lead_statuses.rejected and s.get("SEMANTICS") == "F" for s in statuses):
        raise ValueError("Configure a failed lead stage before enabling intake writes.")
    schema = api.call("crm.lead.fields", {})
    if not isinstance(schema, dict):
        raise ValueError("Invalid intake field metadata.")
    for name in [*("UF_CRM_" + n for n in EXTRA_FIELDS), INVALID_CUIL_FIELD, REVIEW_REASON_FIELD,
                 *(["UF_CRM_WA_TEST"] if test else [])]:
        if schema.get(name, {}).get("type") != "string" or schema[name].get("isMultiple") not in (None, False, "N"):
            raise ValueError("Provision the intake review fields before enabling writes.")


def _lead_fields(api, config, payload, answer, env, case_id, phone, contact, guest, status, state, reason, related):
    rejected = reason in REJECTION_LABELS
    attribution = normalize_attribution(payload["attribution"])
    last = attribution["last"]
    source_name = {"google": "Google", "facebook": "Facebook", "fb": "Facebook", "meta": "Facebook", "instagram": "Instagram", "ig": "Instagram"}.get(
        str(last.get("utm_source") or "").strip().lower(), "Sin origen")
    source_item = ORIGENES_LEAD.resolve(source_name, "lead_source")
    source_id = _resolve_enum_id(api, config.fields.lead_source, "Sin origen") if source_name == "Sin origen" else source_item.bitrix_id
    name = " ".join(str((contact or {}).get(k) or "").strip() for k in ("NAME", "LAST_NAME")).strip()
    fields = {
        "TITLE": (name or "Consulta WhatsApp") + " - " + answer["province"],
        "STATUS_ID": status, "ASSIGNED_BY_ID": int(env.get("BITRIX24_ASSISTANCE_REVIEW_USER_ID", "57")),
        "PHONE": _merge((guest or {}).get("PHONE"), phone),
        "UF_CRM_WA_ASSISTANCE_ID": case_id, "UF_CRM_WA_ASSISTANCE_STATE": state,
        "UF_CRM_WA_SUBFLOW": "website_single_intake", "UF_CRM_WA_SUBFLOW_ID": payload["flow_id"],
        "UF_CRM_WA_ORGANISMO": answer["organism"], "UF_CRM_WA_BANCO": answer["bank"],
        "UF_CRM_WA_CONTINUIDAD": "whatsapp", "UF_CRM_WA_ASSISTED": "SI",
        "UF_CRM_WA_FLOW": "web_whatsapp_intake", "UF_CRM_WA_FLOW_ID": payload["flow_id"],
        "UF_CRM_WA_PROVINCE": answer["province_key"], "UF_CRM_WA_SEGMENT": answer["segment"],
        "UF_CRM_WA_ENTRY": "website", "UF_CRM_WA_TIMESTAMP": payload["received_at"],
        INVALID_CUIL_FIELD: answer["reported_cuil"], REVIEW_REASON_FIELD: "" if rejected else reason or "",
        config.fields.lead_province: PROVINCIAS.resolve(answer["province"], "province").bitrix_id,
        config.fields.lead_source: source_id,
        config.fields.lead_commercial_owner: resolve_commercial_owner_enum_id(api, config, "manual" if reason and not rejected else "kestra"),
        config.fields.lead_processing_policy: resolve_processing_policy_enum_id(api, config, "skip"),
    }
    if rejected:
        fields[config.fields.lead_rejection_reason] = _resolve_enum_id(api, config.fields.lead_rejection_reason, REJECTION_LABELS[reason])
    fields.update(attribution_fields(api, attribution, source_label=source_item.label, source_id=source_id))
    for n in CRM_FIELDS:
        fields.setdefault(n, "")
    for k in ("utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"):
        fields[k.upper()] = str(last.get(k) or "")
    if answer["cuil"]:
        fields[config.fields.lead_cuil] = answer["cuil"]
    if contact:
        fields["CONTACT_ID"] = str(contact["ID"])
    if name:
        fields["NAME"] = name
    if answer["email"]:
        fields["EMAIL"] = _merge((guest or {}).get("EMAIL"), answer["email"])
    if answer["employment_status"]:
        fields[config.fields.lead_employment_status] = SITUACIONES_LABORALES.resolve(answer["employment_status"], "employment_status").bitrix_id
    if answer["payment_bank"]:
        fields[config.fields.lead_payment_bank] = [BANCOS.resolve(answer["payment_bank"], "bank").bitrix_id]
    if reason:
        notes = [REVIEW_LABELS.get(reason, reason), "Caso WhatsApp: " + case_id]
        for key, label in [("contact_ids", "Contactos por CUIL"), ("lead_ids", "Leads previos"), ("deal_ids", "Gestiones abiertas")]:
            if related[key]:
                notes.append(label + ": " + ", ".join(sorted(set(related[key]))))
        if answer["reported_email"]:
            notes.append("Email informado sin validar: " + answer["reported_email"])
        previous = str((guest or {}).get("COMMENTS") or "")
        fields["COMMENTS"] = previous + ("<br>" if previous else "") + "<br>".join(escape(n) for n in notes)
    if payload.get("test_reference") == TEST_REFERENCE:
        fields["UF_CRM_WA_TEST"] = TEST_MARKER
        fields["TITLE"] = TEST_TITLE + fields["TITLE"]
        note = "PRUEBA WHATSAPP E2E. Referencia: " + TEST_REFERENCE + ". Ejecuta el prefill, la evaluación y la continuidad comercial reales. Caso: " + case_id
        fields["COMMENTS"] = escape(note) + ("<br>" + fields["COMMENTS"] if fields.get("COMMENTS") else "")
    return fields
