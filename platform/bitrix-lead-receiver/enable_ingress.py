"""Enable the narrowly scoped Apache route only after install and shadow checks."""
import datetime
import json
from pathlib import Path
import shutil
import subprocess
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from operate import request
from prepare_env import read_env


def main():
    root = Path('/opt/bitrix-lead-receiver')
    env = read_env(root/'.env')
    if request('http://127.0.0.1:8092/internal/stats',env)['mode'] != 'paused':
        raise RuntimeError('Pause the receiver before changing ingress')
    vhost = Path('/opt/apache/conf.d/10-kestra-redunisol.conf')
    old = vhost.read_text()
    include = '    IncludeOptional /opt/bitrix-lead-receiver/apache-route.enabled.conf\n'
    if old.count('ServerName kestra.redunisol.com.ar') != 1 or old.count('ProxyPass "/"') != 1:
        raise RuntimeError('Unexpected Apache virtual host: review manually')
    new = old
    if include.strip() not in old:
        position = old.index('    ProxyPass "/"')
        new = old[:position]+include+'\n'+old[position:]
    archive = root/'migrations'/datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')
    archive.mkdir(parents=True,exist_ok=True)
    (archive/'apache-before.conf').write_text(old)
    enabled = root/'apache-route.enabled.conf'
    previous = enabled.read_bytes() if enabled.exists() else None
    try:
        vhost.write_text(new)
        shutil.copyfile(str(root/'apache-route.conf'),str(enabled))
        subprocess.check_call(['/opt/apache/bin/httpd','-t'])
        subprocess.check_call(['/opt/apache/bin/httpd','-k','graceful'])
        path = '/api/v1/executions/webhook/redunisol.prod.marketing-crm/bitrix24_lead_won_deal_webhook/'+env['BITRIX_WEBHOOK_KEY']
        req = Request('http://127.0.0.1'+path, data=json.dumps({'event':'ONCRMLEADUPDATE','data':{'FIELDS':{'ID':'1'}},'auth':{'application_token':'invalid-route-probe'}}).encode(),
                      headers={'Host':'kestra.redunisol.com.ar','Content-Type':'application/json'})
        try:
            with urlopen(req,timeout=20):
                raise RuntimeError('Ingress probe unexpectedly accepted invalid credentials')
        except HTTPError as exc:
            if exc.code != 403 or json.loads(exc.read()) != {'error':'forbidden'}:
                raise RuntimeError('Ingress did not reach the receiver') from None
    except BaseException:
        vhost.write_text(old)
        if previous is None:
            if enabled.exists():
                enabled.unlink()
        else:
            enabled.write_bytes(previous)
        subprocess.check_call(['/opt/apache/bin/httpd','-t'])
        subprocess.check_call(['/opt/apache/bin/httpd','-k','graceful'])
        raise
    (root/'ingress-enabled').write_text(datetime.datetime.utcnow().isoformat()+'Z\n')
    print('Ingress enabled and authentication rejection verified. Receiver still paused.')


if __name__ == '__main__':
    main()
