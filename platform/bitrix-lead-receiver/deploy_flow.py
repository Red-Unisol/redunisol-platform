"""Deploy ONLY the receiver's worker flow from the checked-out Git artifact."""
import argparse
import base64
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from prepare_env import read_env


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--env', default='/opt/bitrix-lead-receiver/.env')
    args = parser.parse_args()
    env = read_env(args.env)
    auth = base64.b64encode((env['KESTRA_USERNAME']+':'+env['KESTRA_PASSWORD']).encode()).decode()
    source = Path(args.source).read_text()
    if source.count('\nnamespace: redunisol\n') != 1 or not source.startswith('id: bitrix24_lead_event_process\n'):
        raise ValueError('Unexpected flow source')
    source = source.replace('\nnamespace: redunisol\n', '\nnamespace: redunisol.prod.marketing-crm\n', 1)
    base = 'http://127.0.0.1:8080/api/v1/main/flows'
    path = '/redunisol.prod.marketing-crm/bitrix24_lead_event_process'
    headers = {'Authorization':'Basic '+auth, 'Content-Type':'application/x-yaml'}
    exists = True
    try:
        with urlopen(Request(base+path, headers=headers), timeout=30):
            pass
    except HTTPError as exc:
        if exc.code != 404:
            raise RuntimeError('Flow lookup failed HTTP '+str(exc.code)) from None
        exists = False
    request = Request(base+path if exists else base, data=source.encode(), headers=headers, method='PUT' if exists else 'POST')
    try:
        with urlopen(request, timeout=30) as response:
            if response.status not in (200,201):
                raise RuntimeError('Unexpected deploy response')
    except HTTPError as exc:
        raise RuntimeError('Flow deploy failed HTTP '+str(exc.code)) from None
    print('Deployed bitrix24_lead_event_process from Git artifact. Ingress unchanged.')


if __name__ == '__main__':
    main()
