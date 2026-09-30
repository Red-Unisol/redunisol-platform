"""Attribution v1 from the authenticated web bridge; snapshots belong to a submission."""
from __future__ import annotations

import json
import re
from typing import Any

CRM_FIELDS = ("UF_CRM_JOURNEY_ID", "UF_CRM_ATTR_JSON", "UF_CRM_ATTR_STATUS",
              "UF_CRM_GCLID", "UF_CRM_GBRAID", "UF_CRM_WBRAID", "UF_CRM_FBCLID",
              "UF_CRM_LANDING_ORIGEN", "UF_CRM_FECHA_ORIGEN")
WA_FIELDS = (
    "UF_CRM_WA_ASSISTED", "UF_CRM_WA_ENTRY", "UF_CRM_WA_FLOW",
    "UF_CRM_WA_PROVINCE", "UF_CRM_WA_SEGMENT", "UF_CRM_WA_FLOW_ID", "UF_CRM_WA_TIMESTAMP",
)


def normalize_attribution(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict) or value.get("version") != 1:
        raise ValueError("Invalid attribution contract.")
    if value.get("status") not in {"resolved", "url_only", "unknown", "unresolved_ref"}:
        raise ValueError("Invalid attribution status.")
    value = dict(value)
    # PHP json_encode represents an empty associative array as []; accept only
    # that empty shape, never a non-empty list or a scalar.
    for key in ("first", "last", "wa"):
        if value.get(key) == []:
            value[key] = {}
    if not isinstance(value.get("first"), dict) or not isinstance(value.get("last"), dict):
        raise ValueError("Invalid attribution snapshots.")
    if not isinstance(value.get("wa", {}), dict):
        raise ValueError("Invalid WhatsApp attribution context.")
    journey_id = value.get("journey_id")
    if journey_id is not None and (not isinstance(journey_id, str) or not re.fullmatch(r"[a-f0-9]{24}", journey_id)):
        raise ValueError("Invalid journey reference.")
    if len(json.dumps(value)) > 16000:
        raise ValueError("Attribution snapshot is too large.")
    return dict(value)


def lead_fields(client: Any, attribution: dict[str, Any] | None, *, source_label: str, source_id: str) -> dict[str, str]:
    if attribution is None:
        return {}
    schema = client.call("crm.lead.fields", {})
    expected = list(CRM_FIELDS)
    if attribution.get("wa_assisted") is True:
        expected += ["UF_CRM_WA_ASSISTED", "UF_CRM_WA_ENTRY"]
        expected += [name for name in WA_FIELDS if name[7:] in attribution.get("wa", {})]
    for name in expected:
        meta = schema.get(name, {})
        expected_type = "datetime" if name in {"UF_CRM_WA_TIMESTAMP", "UF_CRM_FECHA_ORIGEN"} else "string"
        if meta.get("type") != expected_type or meta.get("isMultiple"):
            raise RuntimeError("CRM attribution fields require provisioning.")
    snapshot = dict(attribution, source_label=source_label, source_id=source_id)
    fields = {
        "UF_CRM_ATTR_JSON": json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")),
        "UF_CRM_ATTR_STATUS": attribution["status"],
    }
    for key, field in {"gclid": "GCLID", "gbraid": "GBRAID", "wbraid": "WBRAID", "fbclid": "FBCLID",
                       "landing": "LANDING_ORIGEN", "at": "FECHA_ORIGEN"}.items():
        if attribution["last"].get(key):
            fields["UF_CRM_" + field] = str(attribution["last"][key])
    if attribution.get("journey_id"):
        fields["UF_CRM_JOURNEY_ID"] = attribution["journey_id"]
    if attribution.get("wa_assisted") is True:
        fields.update(UF_CRM_WA_ASSISTED="SI", UF_CRM_WA_ENTRY="website")
        for name in WA_FIELDS:
            value = attribution.get("wa", {}).get(name[7:])
            if value and name not in fields:
                fields[name] = str(value)
    return fields


def source_from_lead(lead: dict[str, Any], field: str) -> Any:
    value = lead.get(field)
    if isinstance(value, list):
        value = value[0] if value else None
    try:
        snapshot = json.loads(lead.get("UF_CRM_ATTR_JSON") or "{}")
    except (ValueError, TypeError):
        return value
    # Unknown source enum is provisioned dynamically, not a portable numeric catalog ID.
    if isinstance(snapshot, dict) and snapshot.get("source_label") == "Sin origen" and str(snapshot.get("source_id")) == str(value):
        return "Sin origen"
    return value


def copy_to_deal(client: Any, lead: dict[str, Any], fields: dict[str, Any]) -> None:
    if not lead.get("UF_CRM_ATTR_JSON"):
        return
    metadata = client.call("crm.item.fields", {"entityTypeId": 2}).get("fields", {})
    names = {value.get("upperName", key): key for key, value in metadata.items()}
    for name in (*CRM_FIELDS, *WA_FIELDS):
        value = lead.get(name)
        if value is None or value == "":
            continue
        destination = names.get(name)
        if not destination:
            raise RuntimeError("Deal attribution fields require provisioning.")
        fields[destination] = value
