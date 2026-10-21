"""Offline preview: this command cannot enable CRM or send WhatsApp messages."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "automations/marketing-crm/files"))
from bitrix24_form_flow.form_processor.whatsapp_assistance import process


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    payload["dry_run"] = True
    print(json.dumps(process(payload, env={}), ensure_ascii=True))


if __name__ == "__main__":
    main()
