from __future__ import annotations

import base64
import json
import os
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from .bcra_recovery import run_recovery


class KestraKV:
    def __init__(self, base_url, tenant, namespace, username, password):
        self.base = (base_url.rstrip('/') + '/api/v1/' + quote(tenant, safe='')
                     + '/namespaces/' + quote(namespace, safe='') + '/kv/')
        self.authorization = 'Basic ' + base64.b64encode((username + ':' + password).encode()).decode()

    def _request(self, method, key, payload=None, ttl=None):
        headers = {'Authorization': self.authorization, 'Content-Type': 'text/plain', 'Accept': 'application/json'}
        if ttl is not None:
            headers['ttl'] = 'PT' + str(ttl) + 'S'
        request = Request(self.base + quote(key, safe=''), method=method, headers=headers,
                          data=json.dumps(payload, ensure_ascii=True).encode() if payload is not None else None)
        try:
            with urlopen(request, timeout=5) as response:
                return response.read()
        except HTTPError as exc:
            if method == 'GET' and exc.code in {404, 410}:
                exc.close()
                return None
            exc.close()
            raise RuntimeError('Kestra KV request failed') from None

    def get(self, key):
        raw = self._request('GET', key)
        if raw is None:
            return None
        wrapper = json.loads(raw)
        value = wrapper['value']
        if isinstance(value, str):
            value = json.loads(value)
        if not isinstance(value, dict):
            raise ValueError('Invalid KV report')
        return value

    def put(self, key, payload, ttl):
        self._request('PUT', key, payload, ttl)


def main():
    try:
        kv = KestraKV(os.environ['KESTRA_URL'], os.getenv('KESTRA_TENANT', 'main'),
                      os.environ['KV_NAMESPACE'], os.environ['KESTRA_USERNAME'], os.environ['KESTRA_PASSWORD'])
        summary = run_recovery(os.environ['CREDIX_CACHE_SQLITE_PATH'], kv,
                               max_per_run=int(os.getenv('BCRA_RECOVERY_MAX_PER_RUN', '5')))
    except Exception as exc:
        print(json.dumps({'event': 'bcra_recovery_failed', 'error_type': type(exc).__name__}))
        return 1
    from kestra import Kestra
    Kestra.outputs(summary)
    print(json.dumps({'event': 'bcra_recovery_completed', **summary}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
