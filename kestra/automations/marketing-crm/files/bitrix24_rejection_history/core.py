"""Apply an approved historical rejection inventory, with guarded resumable batches.

Only three lead fields can be written. Credentials and per-lead journals stay local.
The command intentionally does not infer rejection reasons or restore old stages.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path

TARGET = 'UC_1P8I07'
REASON = 'UF_CRM_REJECTION_REASON'
NOTICE = 'UF_CRM_REJ_NOTICE'
FIELDS = ['ID', 'STATUS_ID', 'STATUS_SEMANTIC_ID', 'DATE_CREATE', 'DATE_MODIFY', REASON, NOTICE]
SNAPSHOT_FIELDS = ['STATUS_ID', 'DATE_CREATE', 'DATE_MODIFY', REASON, NOTICE]
ARGENTINA = timezone(timedelta(hours=-3))


def utcnow():
    return datetime.now(timezone.utc).isoformat()


def in_night_window(moment=None):
    moment = moment or datetime.now(ARGENTINA)
    hour = moment.astimezone(ARGENTINA).hour
    return hour >= 22 or hour < 6


def queue_capacity(stats, maximum):
    if stats.get('mode') != 'active' or stats.get('unconfirmed_submissions') or stats.get('stale_business_receipts'):
        return 0
    jobs = stats.get('jobs', {})
    if 'pending' not in jobs and 'checking' not in jobs and 'done' not in jobs:
        raise ValueError('Unexpected receiver stats')
    occupied = sum(jobs.get(key, 0) for key in ('pending','checking','waiting'))
    return max(0, maximum - occupied)


def norm(value):
    return '' if value is None or value is False else str(value)


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def write_json(path, data):
    path = Path(path)
    temp = path.with_suffix(path.suffix + '.new')
    with temp.open('w', encoding='utf-8') as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    temp.replace(path)


def encode(params, prefix=''):
    pairs = []
    if isinstance(params, (dict, list, tuple)):
        entries = params.items() if isinstance(params, dict) else enumerate(params)
        for key, value in entries:
            pairs.extend(encode(value, f'{prefix}[{key}]' if prefix else str(key)))
    else:
        pairs.append((prefix, str(params)))
    return pairs


class ApiFailure(RuntimeError):
    pass


class NightWindowClosed(Exception):
    pass


class Client:
    def __init__(self, base_url, webhook_path):
        self.base = base_url.rstrip('/') + '/' + webhook_path.strip('/') + '/'
        if not self.base.startswith('https://redunisol.bitrix24.es/rest/'):
            raise ValueError('Unexpected Bitrix endpoint')

    def call(self, method, params):
        allowed = {'batch', 'crm.lead.list', 'crm.lead.userfield.list', 'crm.status.list', 'crm.activity.list'}
        if method not in allowed:
            raise ValueError('Method not allowed')
        request = urllib.request.Request(self.base + method + '.json', data=json.dumps(params).encode(), headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=55) as response:
                data = json.load(response)
        except Exception as exc:
            # urllib exceptions can contain the webhook URL. Never expose them.
            raise ApiFailure(type(exc).__name__) from None
        if data.get('error'):
            raise ApiFailure(str(data['error']))
        return data

    def batch(self, calls):
        if not 1 <= len(calls) <= 50:
            raise ValueError('Batch must contain 1..50 requests')
        allowed = {'crm.lead.update', 'crm.activity.list', 'imopenlines.crm.chat.get', 'im.dialog.messages.get'}
        commands = {}
        for key, (method, payload) in calls.items():
            if method not in allowed:
                raise ValueError('Batch method not allowed')
            if method == 'crm.lead.update':
                fields = payload['fields']
                if set(fields) != {'STATUS_ID', REASON, NOTICE} or fields['STATUS_ID'] != TARGET or fields[NOTICE] != 'HISTORICAL':
                    raise ValueError('Unsafe mutation payload')
            commands[key] = method + '?' + urllib.parse.urlencode(encode(payload))
        result = self.call('batch', {'halt': 0, 'cmd': commands})['result']
        # Bitrix serializes empty PHP maps as JSON arrays.
        result['result_error'] = result.get('result_error') or {}
        result['result'] = result.get('result') or {}
        return result

    def leads(self, ids):
        if not ids:
            return {}
        if len(ids) > 50 or len(ids) != len(set(ids)):
            raise ValueError('Invalid lead read batch')
        result = self.call('crm.lead.list', {'filter': {'@ID': ids}, 'select': FIELDS, 'order': {'ID': 'ASC'}, 'start': -1})
        rows = result['result']
        if any(row['ID'] not in ids for row in rows):
            raise ApiFailure('Unexpected lead returned')
        if any(REASON not in row or NOTICE not in row for row in rows):
            raise ApiFailure('Expected custom fields missing')
        return {row['ID']: row for row in rows}


def validate_guard(export, cutoff):
    root = export['TEMPLATE'][0]
    if len(export['TEMPLATE']) != 1 or root['Type'] != 'SequentialWorkflowActivity' or len(root['Children']) != 1:
        raise ValueError('Unexpected root activities')
    guard = root['Children'][0]
    if guard['Type'] != 'IfElseActivity' or len(guard['Children']) != 2:
        raise ValueError('Unexpected guard')
    eligible, skip = guard['Children']
    expected = [('STATUS_ID', '=', TARGET), ('ID', '>', str(cutoff)), (NOTICE, '=', '')]
    actual = eligible['Properties']['mixedcondition']
    if len(actual) != 3 or any(c['object'] != 'Document' or norm(c['joiner']) != '0' for c in actual):
        raise ValueError('Guard must use AND document conditions')
    if [(c['field'], c['operator'], norm(c['value'])) for c in actual] != expected:
        raise ValueError('Historical exclusion changed')
    if skip.get('Children') or norm(skip['Properties'].get('truecondition')) != '1':
        raise ValueError('Historical branch must be empty')


def validate_inventory(candidates, expected_hash, actual_hash, manifest, initial, cutoff):
    if actual_hash != expected_hash:
        raise ValueError('Approved inventory hash differs')
    enums = {e['XML_ID']: e for f in initial['reason_fields'] for e in f['LIST']}
    stages = {x['STATUS_ID']: x for x in initial['stages']}
    mapping = {}
    for source in manifest['sources']:
        reason = enums[source['reason_xml_id']]
        stage = stages[source['source_stage']]
        if stage['SEMANTICS'] != 'F' or stage['NAME'] != source['reason_label'] or reason['VALUE'] != source['reason_label']:
            raise ValueError('Unverified source stage or reason')
        mapping[source['source_stage']] = norm(reason['ID'])
    ids = set()
    for row in candidates:
        lead_id = row['ID']
        if not lead_id.isdigit() or not 0 < int(lead_id) <= cutoff or lead_id in ids:
            raise ValueError('Invalid, duplicate or newer lead')
        ids.add(lead_id)
        stage = row['STATUS_ID']
        if stage not in mapping or norm(row.get(NOTICE)) or norm(row.get(REASON)) not in ('', mapping[stage]):
            raise ValueError('Ambiguous candidate')
        if row['proposed'] != {'STATUS_ID': TARGET, REASON: mapping[stage], NOTICE: 'HISTORICAL'}:
            raise ValueError('Unapproved target fields')
    return mapping


def disposition(before, current, expected, attempted=False):
    if current is None:
        return 'skip_missing'
    if all(norm(current.get(key)) == norm(value) for key, value in expected.items()):
        return 'recovered' if attempted else 'skip_already_target'
    if attempted:
        raise ApiFailure('Unresolved previous write; manual review required')
    if any(norm(before.get(key)) != norm(current.get(key)) for key in SNAPSHOT_FIELDS):
        return 'skip_changed'
    if current.get('STATUS_SEMANTIC_ID') != 'F':
        return 'skip_not_failed'
    return 'eligible'


class Journal:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / 'journal.jsonl'
        self.events = []
        if self.path.exists():
            for line in self.path.read_text(encoding='utf-8').splitlines():
                self.events.append(json.loads(line))

    def append(self, event):
        event = {'at': utcnow(), **event}
        with self.path.open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(event, ensure_ascii=False) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        self.events.append(event)

    def states(self):
        states = {}
        attempted = set()
        for event in self.events:
            if event['type'] == 'intent':
                attempted.update(row['ID'] for row in event['rows'])
            if event['type'] == 'outcomes':
                states.update(event['states'])
        return states, attempted


def apply_chunk(client, journal, chunk, allow_write=None):
    _, attempted = journal.states()
    current = client.leads([row['ID'] for row in chunk])
    states = {}
    eligible = []
    for row in chunk:
        status = disposition(row, current.get(row['ID']), row['proposed'], row['ID'] in attempted)
        if status == 'eligible':
            eligible.append(row)
        else:
            states[row['ID']] = status
    if states:
        journal.append({'type': 'observed_without_write', 'rows': [current[k] for k in states if k in current]})
        journal.append({'type': 'outcomes', 'states': states})
    if not eligible:
        return states
    if allow_write is not None and not allow_write():
        raise NightWindowClosed()
    # fsync the original values and exact payload before any external mutation.
    journal.append({'type': 'intent', 'rows': [{**row, 'fresh_before': current[row['ID']]} for row in eligible]})
    calls = {f'u{row["ID"]}': ('crm.lead.update', {'id': row['ID'], 'fields': row['proposed'], 'params': {'REGISTER_SONET_EVENT': 'N'}}) for row in eligible}
    result = client.batch(calls)
    journal.append({'type': 'update_result', 'ids': [row['ID'] for row in eligible], 'ok': [k for k,v in result['result'].items() if v is True], 'errors': {k:v.get('error') for k,v in result.get('result_error',{}).items()}})
    after = client.leads([row['ID'] for row in eligible])
    failures = []
    for row in eligible:
        actual = after.get(row['ID'])
        if actual and all(norm(actual.get(k)) == norm(v) for k,v in row['proposed'].items()):
            states[row['ID']] = 'verified'
        else:
            failures.append(row['ID'])
    journal.append({'type': 'verification', 'rows': list(after.values()), 'failures': failures})
    journal.append({'type': 'outcomes', 'states': states})
    if failures or result.get('result_error'):
        raise ApiFailure('Batch requires review; no automatic mutation retry')
    return states


def communication_snapshot(client, ids):
    chats = {}
    activities = {}
    for offset in range(0, len(ids), 25):
        calls = {}
        for lead_id in ids[offset:offset + 25]:
            calls['a' + lead_id] = ('crm.activity.list', {'filter': {'OWNER_TYPE_ID': 1, 'OWNER_ID': lead_id}, 'order': {'ID': 'DESC'}, 'select': ['ID', 'CREATED', 'LAST_UPDATED', 'TYPE_ID', 'PROVIDER_ID', 'DIRECTION', 'SETTINGS']})
            calls['c' + lead_id] = ('imopenlines.crm.chat.get', {'CRM_ENTITY_TYPE': 'lead', 'CRM_ENTITY': lead_id, 'ACTIVE_ONLY': 'N'})
        result = client.batch(calls)
        if result.get('result_error'):
            raise ApiFailure('Communication snapshot access failed: ' + ','.join(sorted(set(v.get('error','unknown') for v in result['result_error'].values()))))
        for key, value in result['result'].items():
            if key.startswith('a'):
                activities[key[1:]] = [{k: row.get(k) for k in ('ID','CREATED','LAST_UPDATED','TYPE_ID','PROVIDER_ID','DIRECTION')} | {'BP_TEMPLATE_ID': (row.get('SETTINGS') or {}).get('BP_TEMPLATE_ID')} for row in value]
            else:
                chats[key[1:]] = sorted(str(row['CHAT_ID']) for row in value)
    chat_ids = sorted({chat_id for values in chats.values() for chat_id in values})
    messages = {}
    for offset in range(0, len(chat_ids), 50):
        result = client.batch({'c' + cid: ('im.dialog.messages.get', {'DIALOG_ID': 'chat' + cid, 'LIMIT': 1}) for cid in chat_ids[offset:offset + 50]})
        if result.get('result_error'):
            raise ApiFailure('Chat history access failed')
        for key, value in result['result'].items():
            messages[key[1:]] = max((int(m['id']) for m in value['messages']), default=0)
    return {'at': utcnow(), 'activities': activities, 'chats': chats, 'last_message_ids': messages}


def compare_communications(before, after):
    new_activities = []
    for lead_id, rows in after['activities'].items():
        old = {row['ID'] for row in before['activities'][lead_id]}
        new_activities.extend({'lead_id': lead_id, **row} for row in rows if row['ID'] not in old)
    new_chats = {lead: values for lead, values in after['chats'].items() if values != before['chats'].get(lead)}
    changed_messages = {cid: value for cid, value in after['last_message_ids'].items() if value != before['last_message_ids'].get(cid,0)}
    return {'new_activities': new_activities, 'changed_chats': new_chats, 'changed_message_ids': changed_messages, 'clean': not (new_activities or new_chats or changed_messages)}

