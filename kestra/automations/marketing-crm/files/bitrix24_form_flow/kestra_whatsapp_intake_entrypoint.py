import json
import os
from pathlib import Path
import re
import traceback

from kestra import Kestra
from .form_processor.whatsapp_intake import InvalidIntake, process
from .form_processor.logger import create_logger

try:
    result = process(json.loads(os.environ.get("TRIGGER_BODY_JSON", "{}")))
except InvalidIntake:
    result = {"ok": False, "case_id": "", "lead_id": "", "contact_id": "", "action": "invalid", "reason": "invalid_intake_response"}
except Exception as error:
    frames = traceback.extract_tb(error.__traceback__)
    diagnostic = {"event": "whatsapp_intake_processing_error", "error_type": type(error).__name__}
    cause = error.__cause__
    if cause is not None:
        diagnostic["cause_type"] = type(cause).__name__
        code = getattr(cause, "code", None)
        if isinstance(code, int) and 100 <= code <= 599:
            diagnostic["http_status"] = code
    if frames:
        diagnostic.update(source=Path(frames[-1].filename).name,
                          line=frames[-1].lineno, function=frames[-1].name)
    method = getattr(error, "intake_crm_method", "")
    if re.fullmatch(r"[a-z]+(?:\.[a-z]+)+", method):
        diagnostic.update(method=method, attempts=getattr(error, "intake_crm_attempts", None),
                          write_attempted=getattr(error, "intake_crm_write_attempted", None))
    create_logger().error(json.dumps(diagnostic, ensure_ascii=True))
    result = {"ok": False, "case_id": "", "lead_id": "", "contact_id": "", "action": "error", "reason": "intake_processing_uncertain"}
Kestra.outputs(result)
