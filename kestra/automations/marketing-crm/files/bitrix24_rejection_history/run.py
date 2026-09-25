"""Bounded, resumable night migration. No workstation or SSH dependency."""
from contextlib import contextmanager
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import shutil
import time
import urllib.request
import zipfile

from bitrix24_rejection_history import core

APPROVAL = core.read_json(Path(__file__).with_name('approved.json'))
ROOT = Path('/migration')
PROD = 'redunisol.prod.marketing-crm'


@contextmanager
def exclusive(root):
    """Kernel lock survives process crashes without a stale PID-file blocker."""
    import fcntl
    root.mkdir(parents=True, exist_ok=True)
    with (root / 'migration.lock').open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)


def validate_seed(directory):
    for name, expected in APPROVAL['sha256'].items():
        if hashlib.sha256((directory / name).read_bytes()).hexdigest() != expected:
            raise ValueError('Approved seed differs: ' + name)
    candidates = core.read_json(directory / 'candidates.json')
    if len(candidates) != APPROVAL['count']:
        raise ValueError('Unexpected inventory size')
    core.validate_inventory(candidates, APPROVAL['sha256']['candidates.json'],
                            APPROVAL['sha256']['candidates.json'],
                            core.read_json(directory / 'manifest.json'),
                            core.read_json(directory / 'initial-counts.json'), APPROVAL['cutoff'])
    core.validate_guard(core.read_json(directory / 'guard-before-migration.json'), APPROVAL['cutoff'])
    pilot = core.read_json(directory / 'execution/pilot-validation.json')
    if not pilot['clean'] or pilot['inventory_sha256'] != APPROVAL['sha256']['candidates.json']:
        raise ValueError('Pilot not verified')
    return candidates


def bootstrap(root, archive):
    """Import only the fixed approved files; never overwrite an existing journal."""
    if (root / 'approved').exists() or (root / 'execution').exists():
        raise ValueError('Already initialized; refusing to replace progress')
    staging = root / 'importing'
    if staging.exists():
        raise ValueError('Incomplete import requires review')
    staging.mkdir(mode=0o700)
    with zipfile.ZipFile(archive) as source:
        names = source.namelist()
        if set(names) != set(APPROVAL['sha256']) or len(names) != len(set(names)):
            raise ValueError('Unexpected archive members')
        if any(i.file_size > 40_000_000 for i in source.infolist()):
            raise ValueError('Oversized archive member')
        for name in names:
            target = staging / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as stream:
                stream.write(source.read(name))
                stream.flush()
                os.fsync(stream.fileno())
    candidates = validate_seed(staging)
    initial = core.Journal(staging / 'execution')
    states, attempted = initial.states()
    if len(states) != APPROVAL['imported_handled'] or attempted != set(states):
        raise ValueError('Imported journal has unexpected or uncertain progress')
    if set(states.values()) - {'verified', 'recovered'}:
        raise ValueError('Unexpected imported outcomes')
    staging.rename(root / 'approved')
    (root / 'execution').mkdir(mode=0o700)
    shutil.copyfile(root / 'approved/execution/journal.jsonl', root / 'execution/journal.jsonl')
    with (root / 'execution/journal.jsonl').open('ab') as stream:
        os.fsync(stream.fileno())
    return progress(root, candidates, core.Journal(root / 'execution'), 'imported')


def progress(root, candidates, journal, status, **extra):
    states, attempted = journal.states()
    known = {row['ID'] for row in candidates}
    if (set(states) | attempted) - known:
        raise ValueError('Journal contains IDs outside approved inventory')
    result = {'at': core.utcnow(), 'status': status, 'total_candidates': len(candidates),
              'handled': len(states), 'remaining': len(candidates) - len(states),
              'outcomes': dict(Counter(states.values())),
              'uncertain': len(attempted - set(states)),
              'paused': (root / 'execution/paused.json').exists(), **extra}
    core.write_json(root / 'execution/progress.json', result)
    return result


def receiver_stats():
    # Existing local admin token is mounted read-only; no SSH/password copy.
    text = Path('/receiver.env').read_text()
    token = next(line.split('=', 1)[1].strip().strip('\"\'')
                 for line in text.splitlines() if line.startswith('RECEIVER_ADMIN_TOKEN='))
    request = urllib.request.Request('http://bitrix-lead-receiver:8092/internal/stats',
                                     headers={'Authorization': 'Bearer ' + token})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            stats = json.load(response)
    except Exception as exc:
        raise core.ApiFailure('Receiver read failed: ' + type(exc).__name__) from None
    # Require the full safety contract rather than treating missing fields as zero.
    for key in ('mode', 'jobs', 'unconfirmed_submissions', 'stale_business_receipts'):
        if key not in stats:
            raise ValueError('Incomplete receiver stats')
    return stats


def validate_live(client, approved):
    initial = core.read_json(approved / 'initial-counts.json')
    reasons = client.call('crm.lead.userfield.list', {'filter': {'FIELD_NAME': core.REASON}})['result']
    flatten = lambda fields: {(str(e['ID']), e['XML_ID'], e['VALUE']) for f in fields for e in f['LIST']}
    if flatten(reasons) != flatten(initial['reason_fields']):
        raise ValueError('Live reason catalog changed')
    stages = {s['STATUS_ID']: s for s in client.call('crm.status.list', {'filter': {'ENTITY_ID': 'STATUS'}})['result']}
    for source in core.read_json(approved / 'manifest.json')['sources']:
        current = stages.get(source['source_stage'], {})
        if current.get('SEMANTICS') != 'F' or current.get('NAME') != source['reason_label']:
            raise ValueError('Live source stage catalog changed')


def inspect(client, candidates, journal):
    states, attempted = journal.states()
    migrated = [r for r in candidates if states.get(r['ID']) in ('verified', 'recovered')]
    # Inspect the imported 75 in full; cap later diagnostics to the last 100.
    checked = migrated[-100:]
    for offset in range(0, len(checked), 25):
        chunk = checked[offset:offset + 25]
        live = client.leads([r['ID'] for r in chunk])
        if any(not all(core.norm(live.get(r['ID'], {}).get(k)) == core.norm(v)
                       for k, v in r['proposed'].items()) for r in chunk):
            raise ValueError('Previously migrated lead differs on live verification')
    pending = [r for r in candidates if r['ID'] not in states][:25]
    current = client.leads([r['ID'] for r in pending])
    outcomes = Counter(core.disposition(r, current.get(r['ID']), r['proposed'], r['ID'] in attempted) for r in pending)
    return {'live_verified': len(checked), 'next_batch': dict(outcomes), 'external_mutations': 0}


def process(root, client, candidates, journal, *, seconds=480):
    if (root / 'execution/paused.json').exists():
        return progress(root, candidates, journal, 'paused_requires_review')
    if not core.in_night_window():
        return progress(root, candidates, journal, 'outside_night_window')
    states, _ = journal.states()
    rows = [r for r in candidates if r['ID'] not in states]
    stop = time.monotonic() + seconds
    offset = 0
    while offset < len(rows) and time.monotonic() < stop and core.in_night_window():
        stats = receiver_stats()
        core.write_json(root / 'execution/receiver-latest.json', {'at': core.utcnow(), **stats})
        chunk = rows[offset:offset + 25]
        if core.queue_capacity(stats, 125) < len(chunk):
            progress(root, candidates, journal, 'waiting_for_receiver')
            time.sleep(min(30, max(0, stop - time.monotonic())))
            continue
        started = time.monotonic()
        try:
            core.apply_chunk(client, journal, chunk,
                             allow_write=lambda: core.in_night_window() and time.monotonic() < stop)
        except core.NightWindowClosed:
            break
        offset += len(chunk)
        progress(root, candidates, journal, 'running')
        time.sleep(max(0, min(30 - (time.monotonic() - started), stop - time.monotonic())))
    return progress(root, candidates, journal, 'complete' if offset == len(rows) else 'window_yield')


def main():
    os.umask(0o077)
    if os.environ.get('FLOW_NAMESPACE') != PROD:
        raise ValueError('Migration is restricted to the production namespace')
    mode = os.environ.get('MIGRATION_MODE', 'inspect')
    if mode not in ('bootstrap', 'inspect', 'run'):
        raise ValueError('Unknown mode')
    with exclusive(ROOT):
        if mode == 'bootstrap':
            result = bootstrap(ROOT, Path('seed.zip'))
        elif not (ROOT / 'approved').exists():
            result = {'status': 'not_initialized', 'external_mutations': 0}
        else:
            try:
                candidates = validate_seed(ROOT / 'approved')
                journal = core.Journal(ROOT / 'execution')
                # Validate progress before selecting any rows to write.
                progress(ROOT, candidates, journal, 'checking')
                client = core.Client(os.environ['BITRIX24_BASE_URL'], os.environ['BITRIX24_WEBHOOK_PATH'])
                validate_live(client, ROOT / 'approved')
                if mode == 'inspect':
                    result = progress(ROOT, candidates, journal, 'inspected',
                                      **inspect(client, candidates, journal),
                                      receiver=receiver_stats(),
                                      paused=(ROOT / 'execution/paused.json').exists())
                else:
                    result = process(ROOT, client, candidates, journal)
            except Exception as exc:
                core.write_json(ROOT / 'execution/paused.json',
                                {'at': core.utcnow(), 'error_type': type(exc).__name__})
                raise
    # Emit aggregate data only. Private records remain on the persistent volume.
    from kestra import Kestra
    Kestra.outputs(result)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('Migration stopped: ' + type(exc).__name__, flush=True)
        raise SystemExit(1) from None
