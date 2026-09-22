"""Local VPS operations. Default actions are read-only; cutover is explicit.

This tool never writes directly to the Kestra database. It reads snapshots and
uses the supported execution cancellation API after durable import.
"""
import argparse
import base64
import datetime
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.parse import parse_qs
from urllib.request import Request, urlopen

from prepare_env import read_env


def request(url, env, body=None, method=None, kestra=False):
    auth = 'Basic '+base64.b64encode((env['KESTRA_USERNAME']+':'+env['KESTRA_PASSWORD']).encode()).decode() if kestra else 'Bearer '+env['RECEIVER_ADMIN_TOKEN']
    req = Request(url, data=None if body is None else json.dumps(body).encode(),
                  headers={'Authorization':auth,'Content-Type':'application/json'}, method=method)
    try:
        with urlopen(req, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw.strip() else {}
    except Exception as exc:
        raise RuntimeError('Operation failed: '+type(exc).__name__) from None


def snapshot():
    sql = """SELECT jsonb_build_object('id',id,'state',state_current,'body',value->'trigger'->'variables'->'body')
        FROM executions WHERE namespace='redunisol.prod.marketing-crm'
        AND flow_id='bitrix24_lead_won_deal_webhook'
        AND state_current IN ('CREATED','QUEUED','RUNNING','RESTARTED','KILLING')"""
    import shlex
    command = 'PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=15000" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc '+shlex.quote(sql)
    raw = subprocess.check_output(['docker','exec','kestra-postgres-1','sh','-c',command], universal_newlines=True)
    rows = []
    for line in raw.splitlines():
        row = json.loads(line)
        body = row.pop('body')
        if isinstance(body, str):
            try:
                body = json.loads(body)
            except ValueError:
                body = {k:v[-1] for k,v in parse_qs(body).items()}
        lead = body.get('data[FIELDS][ID]') or body.get('data',{}).get('FIELDS',{}).get('ID')
        if not str(lead).isdigit():
            raise ValueError('Cannot migrate an execution without a valid lead ID')
        row['lead'] = str(lead)
        rows.append(row)
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['stats','shadow','pause','preview','cutover'])
    parser.add_argument('--env', default='/opt/bitrix-lead-receiver/.env')
    args = parser.parse_args()
    env = read_env(args.env)
    local = 'http://127.0.0.1:8092/internal/'
    if args.action == 'stats':
        print(json.dumps(request(local+'stats',env),indent=2))
        return
    if args.action in ('pause','shadow'):
        print(request(local+'mode',env,{'mode':'paused' if args.action=='pause' else 'shadow'}))
        return
    rows = snapshot()
    print(json.dumps({'executions':len(rows),'distinct_leads':len(set(r['lead'] for r in rows)),
                      'queued':sum(r['state']=='QUEUED' for r in rows)}))
    if args.action == 'preview':
        return
    if not Path('/opt/bitrix-lead-receiver/ingress-enabled').exists():
        raise RuntimeError('Enable and verify Apache ingress before migrating')
    if request(local+'stats',env)['mode'] != 'paused':
        raise RuntimeError('Receiver must be paused before migration')
    os.umask(0o077)
    stamp = datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')
    archive = Path('/opt/bitrix-lead-receiver/migrations')/stamp
    archive.mkdir(parents=True)
    (archive/'executions.json').write_text(json.dumps(rows,indent=2))
    leads = sorted(set(r['lead'] for r in rows))
    for offset in range(0,len(leads),500):
        result = request(local+'enqueue',env,{'leads':leads[offset:offset+500]})
        if result.get('accepted') != len(leads[offset:offset+500]):
            raise RuntimeError('Import not acknowledged; cancellation not permitted')
    # Import is durable before cancellation. An execution crossing QUEUED->RUNNING
    # can be cancelled too: do NOT activate until ALL legacy activity is terminal.
    queued = [r['id'] for r in rows if r['state']=='QUEUED']
    for offset in range(0,len(queued),100):
        still_open = {r['id'] for r in snapshot()}
        ids = [i for i in queued[offset:offset+100] if i in still_open]
        if ids:
            request('http://127.0.0.1:8080/api/v1/main/executions/kill/by-ids',env,ids,method='DELETE',kestra=True)
    deadline = time.monotonic()+300
    while snapshot():
        if time.monotonic()>deadline:
            raise RuntimeError('Legacy executions still open. Receiver remains paused; investigate before retrying.')
        time.sleep(5)
    # Docker tasks should already have stopped. Check execution labels as well;
    # do not assume terminal database state means no remaining business process.
    running = subprocess.check_output(['docker','ps','-q'],universal_newlines=True).split()
    if running:
        containers = json.loads(subprocess.check_output(['docker','inspect']+running,universal_newlines=True))
        # Include previous interrupted attempts: their executions can already be
        # terminal and therefore absent from this attempt's database snapshot.
        old_ids = {r['id'] for r in rows}
        for previous in archive.parent.glob('*/executions.json'):
            old_ids.update(r['id'] for r in json.loads(previous.read_text()))
        for container in containers:
            labels = (container.get('Config') or {}).get('Labels') or {}
            if any(value in old_ids for value in labels.values()):
                raise RuntimeError('Legacy task container is still running; receiver remains paused')
    print(request(local+'mode',env,{'mode':'active'}))
    (archive/'activated.txt').write_text(datetime.datetime.utcnow().isoformat()+'Z\n')
    print('Cutover completed. Snapshot retained; no execution records deleted.')


if __name__ == '__main__':
    main()
