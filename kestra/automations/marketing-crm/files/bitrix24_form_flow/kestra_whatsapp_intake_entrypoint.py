import json
import os

from kestra import Kestra
from .form_processor.whatsapp_intake import InvalidIntake, process

try:
    result = process(json.loads(os.environ.get("TRIGGER_BODY_JSON", "{}")))
except InvalidIntake:
    result = {"ok": False, "case_id": "", "lead_id": "", "contact_id": "", "action": "invalid", "reason": "invalid_intake_response"}
except Exception:
    result = {"ok": False, "case_id": "", "lead_id": "", "contact_id": "", "action": "error", "reason": "intake_processing_uncertain"}
Kestra.outputs(result)
