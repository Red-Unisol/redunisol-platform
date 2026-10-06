import json
import os
from pathlib import Path

from .receiver import classify


def main():
    from kestra import Kestra

    event = json.loads(Path("request.json").read_text(encoding="utf-8"))
    receipt, normalized = classify(event, os.environ.get("EDNA_INCOMING_SUBJECT_ID", ""))
    # PII belongs in restricted execution storage, never the task log or public response.
    Path("event.json").write_text(json.dumps(normalized, ensure_ascii=False), encoding="utf-8")
    Kestra.outputs(receipt)


if __name__ == "__main__":
    main()
