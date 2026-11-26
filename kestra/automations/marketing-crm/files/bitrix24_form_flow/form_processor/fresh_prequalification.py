"""Evaluate the commercial fields of an authenticated v3 revision without CRM effects."""
from datetime import datetime
from hashlib import sha256
import json
import os
import re
from uuid import UUID

from edna_incoming.intake import LEGACY_GROUPED_FLOW_IDS, normalize_answer
from .commercial_prequalification import RULE_VERSION
from .input_parser import normalize_prequalification_input
from .qualification import evaluate_prequalification


CONTRACT = "web-v3-prequalification-v1"


def process(payload, *, env=None):
    result = {"ok": False, "contract": CONTRACT, "case_id": "", "web_submission_id": "", "input_digest": "",
              "lead_id": "", "contact_id": "", "write_attempted": False, "action": "invalid",
              "reason": "invalid_declaration_revision", "rule_version": RULE_VERSION}
    try:
        case = str(UUID(payload["case_id"]))
        submission = str(UUID(payload["web_submission_id"]))
        if case != payload["case_id"] or submission != payload["web_submission_id"] or payload.get("contract") != CONTRACT:
            return result
        received = datetime.fromisoformat(payload["received_at"].replace("Z", "+00:00"))
        if received.utcoffset() is None:
            return result
        source = os.environ if env is None else env
        flow = payload["flow_id"]
        flows = [source.get("EDNA_INTAKE_FLOW_ID", ""), *source.get("EDNA_INTAKE_ACCEPTED_FLOW_IDS", "").split(",")]
        if (not re.fullmatch(r"[0-9]{1,18}", flow) or flow not in {value.strip() for value in flows}
                or flow in LEGACY_GROUPED_FLOW_IDS | {"1850162769693486", "1993586314642842"}):
            return result
        fields = payload["fields"]
        province = fields.get("provincia", "")
        allowed = {"provincia", "situacion_" + province, "organismo", "organismo_" + province,
                   "banco_jubilado", "banco_" + province}
        if set(fields) - allowed or any(not isinstance(v, str) or not re.fullmatch(r"[a-z_]{0,64}", v) for v in fields.values()):
            return result
        digest = sha256(json.dumps(fields, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        if digest != payload["input_digest"]:
            return result
        result.update(ok=True, case_id=case, web_submission_id=submission, input_digest=digest,
                      action="pending", reason="missing_policy_input")
        # This scoped calculation needs neither CUIL nor correspondence details.
        answer = normalize_answer(fields, flow_id=flow, retain_invalid_identity=True)
        if answer["rejection_reason"]:
            return dict(result, action="rejected", reason=answer["rejection_reason"])
        normalized = normalize_prequalification_input({
            "province": answer["province"], "employment_status": answer["employment_status"],
            "payment_bank": answer["payment_bank"], "organismo": answer["organism"],
        })
        verdict = evaluate_prequalification(normalized, evaluated_at=received)
        return dict(result, action=verdict.outcome, reason=verdict.reason)
    except (AttributeError, KeyError, TypeError, ValueError):
        return result
