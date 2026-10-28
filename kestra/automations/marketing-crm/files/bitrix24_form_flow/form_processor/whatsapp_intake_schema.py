"""Explicit, idempotent CRM metadata provisioning. Never run from a callback."""
import argparse
import json
import os

from .bitrix_client import BitrixClient
from .config import load_config
from .logger import create_logger
from .whatsapp_intake_crm import CUIL_REVIEW_STATUS, INVALID_CUIL_FIELD, REVIEW_REASON_FIELD

FIELDS = {
    INVALID_CUIL_FIELD: "CUIL informado inválido (no usar como identidad)",
    REVIEW_REASON_FIELD: "Motivo de revisión WhatsApp",
}
STAGE_NAME = "WHATSAPP - CORREGIR CUIL"


def provision(client, *, apply=False):
    statuses = client.call("crm.status.list", {"filter": {"ENTITY_ID": "STATUS"}})
    if not isinstance(statuses, list) or any(not isinstance(s, dict) for s in statuses):
        raise ValueError("Invalid lead stages.")
    stages = [s for s in statuses if s.get("STATUS_ID") == CUIL_REVIEW_STATUS]
    if len(stages) > 1 or (stages and stages[0].get("SEMANTICS") in {"S", "F"}):
        raise ValueError("Incompatible CUIL correction stage; reconcile manually.")
    definitions = {}
    for name in FIELDS:
        found = client.call("crm.lead.userfield.list", {"filter": {"FIELD_NAME": name}})
        if (not isinstance(found, list) or len(found) > 1
                or any(not isinstance(f, dict) or f.get("FIELD_NAME") != name
                       or f.get("USER_TYPE_ID") != "string" or f.get("MULTIPLE") != "N"
                       or f.get("MANDATORY") != "N" for f in found)):
            raise ValueError("Incompatible intake field; reconcile manually.")
        definitions[name] = found
    missing = [name for name, found in definitions.items() if not found]
    result = {"missing_fields": missing, "missing_stage": not bool(stages), "applied": apply}
    if not apply:
        return result
    for name in missing:
        label = FIELDS[name]
        client.call("crm.lead.userfield.add", {"fields": {
            "FIELD_NAME": name.removeprefix("UF_CRM_"), "USER_TYPE_ID": "string",
            "LABEL": label, "XML_ID": "whatsapp.intake." + name.lower(),
            "MULTIPLE": "N", "MANDATORY": "N", "SHOW_FILTER": "Y", "SHOW_IN_LIST": "Y",
            "EDIT_IN_LIST": "N", "IS_SEARCHABLE": "N",
            **{key: {"la": label, "en": label} for key in (
                "EDIT_FORM_LABEL", "LIST_COLUMN_LABEL", "LIST_FILTER_LABEL")},
        }})
    if not stages:
        terminal_sort = min((int(s["SORT"]) for s in statuses if s.get("SEMANTICS") == "S"), default=100)
        client.call("crm.status.add", {"fields": {"ENTITY_ID": "STATUS", "STATUS_ID": CUIL_REVIEW_STATUS,
                    "NAME": STAGE_NAME, "SORT": max(1, terminal_sort - 1), "COLOR": "#FFA900", "SEMANTICS": ""}})
    verified = provision(client)
    if verified["missing_fields"] or verified["missing_stage"]:
        raise RuntimeError("Intake schema provisioning requires reconciliation; do not retry uncertain writes.")
    return {**result, "verified": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Create only missing metadata; default is preview")
    args = parser.parse_args()
    client = BitrixClient(load_config(dict(os.environ)), create_logger(), log_api_calls=False)
    print(json.dumps(provision(client, apply=args.apply)))


if __name__ == "__main__":
    main()
