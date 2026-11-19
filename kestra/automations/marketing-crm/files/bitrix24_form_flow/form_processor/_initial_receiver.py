"""Proof of the first automated, stage-only edit to a native Sales lead."""
from hashlib import sha256
import json

from ._routing_cutover import new_routing_enabled


SALES_RECEIVER = "74827"
CRM_INTEGRATION = "71283"


def pristine_receiver(lead):
    created = lead.get("DATE_CREATE")
    return (new_routing_enabled(created) and lead.get("DATE_MODIFY") == created
            and all(str(lead.get(key)) == SALES_RECEIVER for key in
                    ("ASSIGNED_BY_ID", "CREATED_BY_ID", "MODIFY_BY_ID")))


def receiver_revision(lead):
    # DATE_MODIFY and its author invalidate prior evidence on any later CRM edit.
    fields = ("ID", "DATE_CREATE", "CREATED_BY_ID", "ASSIGNED_BY_ID", "DATE_MODIFY",
              "MODIFY_BY_ID", "MOVED_TIME", "MOVED_BY_ID", "STATUS_ID", "CONTACT_ID")
    values = [str(lead.get(key) or "") for key in fields]
    return sha256(json.dumps(values, separators=(",", ":")).encode()).hexdigest()


def prefill_receipt(before, after, stage):
    identity = ("ID", "DATE_CREATE", "CREATED_BY_ID", "ASSIGNED_BY_ID", "CONTACT_ID")
    if (pristine_receiver(before) and all(before.get(key) == after.get(key) for key in identity)
            and str(after.get("MODIFY_BY_ID")) == CRM_INTEGRATION and after.get("STATUS_ID") == stage
            and new_routing_enabled(after.get("DATE_MODIFY"))):
        return receiver_revision(after)
    return ""
