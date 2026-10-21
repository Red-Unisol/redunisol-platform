import json
import os

from kestra import Kestra
from .form_processor.whatsapp_assistance import process


try:
    result = process(json.loads(os.environ.get("TRIGGER_BODY_JSON", "{}")))
except Exception:
    # Do not log provider messages, customer identity or credential-bearing URLs.
    result = {"ok": False, "case_id": "", "lead_id": "", "contact_id": "", "action": "error", "reason": "assistance_processing_failed"}
Kestra.outputs(result)
