"""Package the approved private inventory and the 75 verified outcomes for Kestra.

This tool does not call Bitrix, schedule Windows tasks or include credentials.
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile


def package(inventory, output):
    domain = Path(__file__).resolve().parents[1] / 'automations/marketing-crm'
    approval = json.loads((domain / 'files/bitrix24_rejection_history/approved.json').read_text())
    payloads = {}
    for name, expected in approval['sha256'].items():
        if name == 'manifest.json':
            data = (domain / 'bitrix/rejection-notifications/manifest.json').read_text(encoding='utf-8').encode()
        else:
            data = (inventory / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError('Approved file changed: ' + name)
        payloads[name] = data
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('xb') as stream, zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in payloads.items():
            archive.writestr(name, data)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory-dir', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    package(args.inventory_dir, args.output)
    print('Private seed created; no external changes.')
