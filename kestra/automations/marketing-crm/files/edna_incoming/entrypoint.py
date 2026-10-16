import json
import os
from pathlib import Path

from .receiver import classify
from .out_of_hours import evaluate


def main():
    from kestra import Kestra

    event = json.loads(Path("request.json").read_text(encoding="utf-8"))
    allowed_subject = os.environ.get("EDNA_INCOMING_SUBJECT_ID", "")
    if isinstance(event, dict) and event.get("operation") == "out_of_hours":
        receipt, normalized = evaluate(event, allowed_subject), None
    else:
        receipt, normalized = classify(event, allowed_subject)
    # PII belongs in restricted execution storage, never the task log or public response.
    Path("event.json").write_text(json.dumps(normalized, ensure_ascii=False), encoding="utf-8")
    Kestra.outputs(receipt)


if __name__ == "__main__":
    main()
