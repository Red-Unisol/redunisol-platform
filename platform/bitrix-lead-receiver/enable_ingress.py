"""Enable the narrowly scoped Apache route only after install and shadow checks."""
import datetime
import http.client
import json
import re
from pathlib import Path
import shutil
import subprocess
import socket
import ssl
import time

from operate import request
from prepare_env import read_env


class OriginHTTPSConnection(http.client.HTTPSConnection):
    """Reach Apache locally, retaining certificate verification and domain SNI."""
    def connect(self):
        sock = socket.create_connection(('127.0.0.1', self.port), self.timeout)
        try:
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except BaseException:
            sock.close()
            raise


def probe_ingress(base, path):
    payload = json.dumps({'event':'ONCRMLEADUPDATE','data':{'FIELDS':{'ID':'1'}},
                          'auth':{'application_token':'invalid-route-probe'}}).encode()
    for attempt in range(10):
        connection = (OriginHTTPSConnection('kestra.redunisol.com.ar', 443, timeout=5,
                                            context=ssl.create_default_context())
                      if base.startswith('https:') else http.client.HTTPConnection('127.0.0.1', 80, timeout=5))
        try:
            connection.request('POST', path, body=payload,
                               headers={'Host':'kestra.redunisol.com.ar','Content-Type':'application/json'})
            response = connection.getresponse()
            raw = response.read()
            try:
                body = json.loads(raw)
            except ValueError:
                body = None
            if response.status == 403 and body == {'error':'forbidden'}:
                return
        except (OSError, http.client.HTTPException):
            pass  # A graceful reload can briefly retain the previous route.
        finally:
            connection.close()
        if attempt < 9:
            time.sleep(1)
    # Never print the secret-bearing path or assume any arbitrary 403 is success.
    raise RuntimeError('Origin ingress did not return the receiver authentication rejection')


def prepare_vhost(source):
    """Patch only the serving vhost; preserve HTTP redirects and other routes."""
    include = '    IncludeOptional /opt/bitrix-lead-receiver/apache-route.enabled.conf\n'
    candidates = []
    for match in re.finditer(r'<VirtualHost\b[^>]*>.*?</VirtualHost>', source, re.S | re.I):
        block = match.group()
        if not re.search(r'^\s*ServerName\s+kestra\.redunisol\.com\.ar\s*$', block, re.M):
            continue
        proxies = list(re.finditer(r'^[ \t]*ProxyPass\s+"/"\s+"http://127\.0\.0\.1:8080/"[^\n]*', block, re.M))
        if proxies:
            candidates.append((match, proxies))
    if len(candidates) != 1 or len(candidates[0][1]) != 1:
        raise RuntimeError('Expected exactly one serving Kestra virtual host')
    match, proxies = candidates[0]
    block = match.group()
    proxy = proxies[0]
    if include.strip() in block:
        if block.count(include.strip()) != 1 or block.index(include.strip()) > proxy.start():
            raise RuntimeError('Receiver include must precede the catch-all proxy')
        new = source
    else:
        position = match.start()+proxy.start()
        new = source[:position]+include+'\n'+source[position:]
    tls = bool(re.search(r'^\s*SSLEngine\s+on\s*$', block, re.M | re.I))
    return new, 'https://kestra.redunisol.com.ar' if tls else 'http://127.0.0.1'


def main():
    root = Path('/opt/bitrix-lead-receiver')
    env = read_env(root/'.env')
    if request('http://127.0.0.1:8092/internal/stats',env)['mode'] != 'paused':
        raise RuntimeError('Pause the receiver before changing ingress')
    vhost = Path('/opt/apache/conf.d/10-kestra-redunisol.conf')
    old = vhost.read_text()
    new, probe_base = prepare_vhost(old)
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
        probe_ingress(probe_base, path)
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
