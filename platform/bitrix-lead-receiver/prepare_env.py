"""Generate service env on the VPS from its existing Kestra runtime env.

Secrets stay on the VPS. Existing administrator token is preserved on upgrades.
This script does not start containers or change routing.
"""
import argparse
import base64
import os
from pathlib import Path
import secrets


def read_env(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        # Accept both bare values and literal quotes from runtime env files.
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values


def build_env(source, existing, revision):
    def secret(name):
        return base64.b64decode(source['SECRET_'+name], validate=True).decode()
    key = secret('BITRIX24_LEAD_WON_DEAL_WEBHOOK_KEY')
    return {
        'BITRIX_REST_URL': source['ENV_BITRIX24_BASE_URL'].rstrip('/')+'/'+secret('BITRIX24_WEBHOOK_PATH').strip('/'),
        'BITRIX_APPLICATION_TOKEN': secret('BITRIX24_LEAD_WON_DEAL_APPLICATION_TOKEN'),
        'BITRIX_WEBHOOK_KEY': key,
        'RECEIVER_ADMIN_TOKEN': existing.get('RECEIVER_ADMIN_TOKEN') or secrets.token_urlsafe(32),
        'ACTIONABLE_STATUSES': source.get('ENV_BITRIX24_LEAD_STATUS_PRECLASSIFICATION', 'NEW')+','+source['ENV_BITRIX24_LEAD_STATUS_QUALIFIED'],
        'KESTRA_DISPATCH_URL': 'http://kestra:8080/api/v1/main/executions/webhook/redunisol.prod.marketing-crm/bitrix24_lead_event_process/'+key,
        'KESTRA_API_URL': 'http://kestra:8080/api/v1/main',
        'KESTRA_USERNAME': source['KESTRA_ADMIN_EMAIL'],
        'KESTRA_PASSWORD': source['KESTRA_ADMIN_PASSWORD'],
        'RECEIVER_REVISION': revision,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default='/opt/kestra/.env')
    parser.add_argument('--output', default='/opt/bitrix-lead-receiver/.env')
    parser.add_argument('--revision', required=True)
    args = parser.parse_args()
    target = Path(args.output)
    values = build_env(read_env(args.source), read_env(target) if target.exists() else {}, args.revision)
    # Quote literally: Compose must not expand '$' in tokens/passwords.
    if any("'" in v or '\n' in v or '\r' in v for v in values.values()):
        raise ValueError('Unsupported newline or single quote in runtime env')
    os.umask(0o077)
    target.write_text(''.join(k+"='"+v+"'\n" for k,v in values.items()))
    os.chmod(str(target), 0o600)
    print('Receiver environment prepared; secrets not printed.')


if __name__ == '__main__':
    main()
