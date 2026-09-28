"""Persist the classification independently from the deal's workflow stage."""

DECISION_FIELD = "ufCrmKCommDecision"
DECISION_FIELD_REST = "UF_CRM_K_COMM_DECISION"
DECISIONS = frozenset({"approved", "manual_review", "rejected", "commercial_rejected"})
CONTACTABLE_DECISIONS = frozenset({"approved", "manual_review"})


def persist_commercial_decision(client, deal_id: int, action: str) -> None:
    if action not in DECISIONS:
        raise ValueError("Unknown commercial decision")
    client.call("crm.item.update", {
        "entityTypeId": 2, "id": deal_id, "useOriginalUfNames": "Y",
        "fields": {DECISION_FIELD_REST: action},
    })
    actual = client.call("crm.item.get", {"entityTypeId": 2, "id": deal_id})
    if (actual or {}).get("item", {}).get(DECISION_FIELD) != action:
        raise RuntimeError("Commercial decision was not persisted")


def ensure_decision_field(client) -> int:
    """Explicit provisioning command; never called by scheduled executions."""
    existing = client.call("crm.deal.userfield.list", {"filter": {"FIELD_NAME": DECISION_FIELD_REST}})
    if existing:
        field = existing[0]
        if field["USER_TYPE_ID"] != "string" or field.get("MULTIPLE") == "Y":
            raise ValueError("Commercial decision field has an incompatible type")
        return int(field["ID"])
    return int(client.call("crm.deal.userfield.add", {"fields": {
        "FIELD_NAME": "K_COMM_DECISION", "USER_TYPE_ID": "string",
        "LABEL": "Decisión comercial Kestra",
        "XML_ID": "kestra.commercial-decision.v1", "MULTIPLE": "N", "MANDATORY": "N",
        "EDIT_FORM_LABEL": {"la": "Decisión comercial Kestra", "en": "Kestra commercial decision"},
        "LIST_COLUMN_LABEL": {"la": "Decisión comercial Kestra", "en": "Kestra commercial decision"},
        "LIST_FILTER_LABEL": {"la": "Decisión comercial Kestra", "en": "Kestra commercial decision"},
        "SHOW_FILTER": "Y", "EDIT_IN_LIST": "N", "IS_SEARCHABLE": "N",
    }}))
