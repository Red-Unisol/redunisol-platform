from __future__ import annotations

import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import ssl
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import uuid

SCHEMA_VERSION = 1
APPLICATION_TYPE = 'PreSolicitud.Module.Solicitud'
APPLICATION_FIELDS = [
    'Oid', 'Fecha', 'Estado.ID', 'Estado.Descripcion', 'EstadoBase',
    'LineaPrestamo.ID', 'LineaPrestamo.Codigo', 'LineaPrestamo.Descripcion',
    'LineaPrestamo.Superior.Descripcion', 'NroDocumento', 'CUIT', 'NombreCompleto',
    'NroSocio', 'MontoOriginal', 'MontoAFinanciar', 'MontoADesembolsar', 'Capital',
    'Cuotas', 'CuotaResultante', 'TEM', 'FechaPrimerVencimiento', 'FechaUltimaCuota',
    'MontoRecibo', 'IngresosMensuales', 'IngresosMensualesConyuge', 'FacturacionMensual',
    'CupoTitular', 'NivelRiesgo', 'Antiguedad', 'NuevoSocio', 'Actividad',
    'ActividadPrincipal', 'Empleador', 'Observaciones', 'EstadoDocumentacion',
    'EjecutivoSolicitud.Nombre', 'EjecutivoSolicitud.Usuario.UserName',
    'VendedorSolicitud.Nombre', 'Prestamo.ID', 'Adjuntos.Count()',
    'Novedades.Count()', 'Novedades.Max(Fecha)', 'Adicional1.NroDocumento',
    'Adicional1.CUIT', 'Adicional1.NombreCompleto', 'Adicional1.IngresoMensual',
    'Adicional1.AntiguedadLaboralMeses', 'Adicional2.NroDocumento',
    'Adicional2.CUIT', 'Adicional2.NombreCompleto', 'Adicional2.IngresoMensual',
    'Adicional2.AntiguedadLaboralMeses', 'LineaPrestamo.TasaMinima',
    'LineaPrestamo.TasaMaxima', 'VendedorSolicitud.Usuario.UserName', 'Destino.Descripcion',
]
ATTACHMENT_FIELDS = ['Oid', 'Archivo.FileName', 'Archivo.Size', 'Descripcion']
EVENT_FIELDS = ['ID', 'Fecha', 'Texto']
# Una persona editando la solicitud durante la captura deja la observacion
# parcial sin que falte nada por recuperar: el proximo sondeo la vuelve a
# fotografiar. No es una falla del archivo y no justifica alertar.
CONCURRENT_EDIT_CODES = frozenset({
    'changed_during_capture', 'attachment_size_changed',
    'attachment_count_mismatch', 'event_count_mismatch',
})
# Intentos sobre la misma solicitud antes de tratar el pendiente como atascado.
# Con la espera creciente de pending, cinco intentos cubren cerca de una hora.
STUCK_RETRY_ATTEMPTS = 5


class CaptureError(Exception):
    """Only safe, fixed error codes; never remote response bodies or URLs."""


def now():
    return datetime.now(timezone.utc).isoformat()


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def identifier(value):
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise CaptureError('invalid_identifier')
    return value


class CoreClient:
    def __init__(self, base_url, token='', verify_tls=True, timeout=20, max_file_bytes=50 * 1024 * 1024):
        self.base_url = base_url.rstrip('/')
        if not self.base_url.endswith('/api/Empresa'):
            self.base_url += '/api/Empresa'
        self.token = token
        self.context = ssl.create_default_context() if verify_tls else ssl._create_unverified_context()
        self.timeout = timeout
        self.max_file_bytes = max_file_bytes

    def query(self, kind, criteria, fields, limit):
        payload = encoded({'tipo': kind, 'cmd': criteria, 'campos': ';'.join(fields), 'max': limit + 1})
        headers = {'Content-Type': 'application/json', 'Accept': 'text/plain'}
        if self.token:
            headers['Authorization'] = 'Bearer ' + self.token
        request = Request(self.base_url + '/EvaluateList', data=payload, headers=headers, method='POST')
        try:
            with urlopen(request, timeout=self.timeout, context=self.context) as response:
                cap = max(8 * 1024 * 1024, self.max_file_bytes * 2)
                raw = response.read(cap + 1)
            if len(raw) > cap:
                raise CaptureError('response_size_limit')
            rows = json.loads(raw)
            if isinstance(rows, str):
                rows = json.loads(rows)
        except HTTPError as exc:
            raise CaptureError('http_' + str(exc.code)) from None
        except (URLError, TimeoutError, OSError):
            raise CaptureError('network_error') from None
        except (ValueError, UnicodeError):
            raise CaptureError('invalid_json') from None
        if not isinstance(rows, list) or len(rows) > limit:
            raise CaptureError('invalid_or_truncated_projection')
        if any(not isinstance(row, list) or len(row) != len(fields) for row in rows):
            raise CaptureError('invalid_projection_shape')
        return [dict(zip(fields, row)) for row in rows]

    def active(self):
        rows = self.query(APPLICATION_TYPE, '[Estado.ID] = 114', APPLICATION_FIELDS, 2000)
        ids = [identifier(row['Oid']) for row in rows]
        if len(set(ids)) != len(ids) or any(row['Estado.ID'] != 114 for row in rows):
            raise CaptureError('invalid_state_selection')
        return rows

    def application(self, oid):
        rows = self.query(APPLICATION_TYPE, f'[Oid] = {identifier(oid)}', APPLICATION_FIELDS, 1)
        if len(rows) != 1 or rows[0]['Oid'] != oid:
            raise CaptureError('application_missing')
        return rows[0]

    def attachments(self, oid):
        rows = self.query('PreSolicitud.Module.AdjuntoSolicitud', f'[Solicitud.Oid] = {identifier(oid)}', ATTACHMENT_FIELDS, 1000)
        ids = [identifier(row['Oid']) for row in rows]
        if len(set(ids)) != len(ids):
            raise CaptureError('duplicate_attachment_identifier')
        return sorted(rows, key=lambda row: row['Oid'])

    def events(self, oid):
        rows = self.query('PreSolicitud.Module.NovedadSolicitud', f'[Solicitud.Oid] = {identifier(oid)}', EVENT_FIELDS, 10000)
        return sorted(rows, key=lambda row: identifier(row['ID']))

    def content(self, oid):
        rows = self.query('PreSolicitud.Module.AdjuntoSolicitud', f'[Oid] = {identifier(oid)}', ['Archivo.Content'], 1)
        if len(rows) != 1 or not isinstance(rows[0]['Archivo.Content'], str):
            raise CaptureError('attachment_missing')
        try:
            data = base64.b64decode(rows[0]['Archivo.Content'], validate=True)
        except (ValueError, TypeError):
            raise CaptureError('invalid_base64') from None
        if len(data) > self.max_file_bytes:
            raise CaptureError('attachment_size_limit')
        return data


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.write-')
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(encoded(value))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def read_json(path, default):
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else default


class Archive:
    def __init__(self, root, reserve_bytes=1024**3):
        self.root = Path(root)
        self.reserve_bytes = reserve_bytes
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def blob(self, data):
        digest = hashlib.sha256(data).hexdigest()
        path = self.root / 'objects' / digest[:2] / digest
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not path.exists():
            if shutil.disk_usage(self.root).free < self.reserve_bytes + len(data):
                raise CaptureError('insufficient_disk_space')
            fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.blob-')
            try:
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
                try:
                    os.link(temporary, path)
                except FileExistsError:
                    pass
            finally:
                os.unlink(temporary)
        if path.stat().st_size != len(data) or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise CaptureError('stored_object_integrity_error')
        return {'sha256': digest, 'bytes': len(data), 'path': path.relative_to(self.root).as_posix()}

    @contextmanager
    def lock(self):
        with open(self.root / '.capture.lock', 'a+b') as stream:
            try:
                if os.name == 'nt':
                    import msvcrt
                    stream.seek(0)
                    if not stream.read(1):
                        stream.write(b'0')
                        stream.flush()
                    stream.seek(0)
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise CaptureError('another_capture_running') from None
            try:
                yield
            finally:
                if os.name == 'nt':
                    stream.seek(0)
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)

    def start(self, application, observed_at, origin, run_id):
        oid = identifier(application['Oid'])
        relative = Path('applications') / str(oid) / 'observations' / run_id
        folder = self.root / relative
        initial = {'schema_version': SCHEMA_VERSION, 'observed_at': observed_at, 'origin': origin,
                   'application_fields': APPLICATION_FIELDS, 'application': application,
                   'temporal_scope': 'first observation, not a transaction snapshot or a guaranteed pre-edit version'}
        atomic_json(folder / 'initial.json', initial)
        first = self.root / 'applications' / str(oid) / 'first.json'
        if not first.exists():
            atomic_json(first, {'observed_at': observed_at, 'observation': relative.as_posix(), 'origin': origin})
        return folder


def partial_reason(errors):
    """Distingue la edicion concurrente de lo que dejo datos sin archivar."""
    if not errors:
        return None
    if all(error['code'] in CONCURRENT_EDIT_CODES for error in errors):
        return 'changed_during_capture'
    return 'fetch_or_storage_error'


def capture_one(client, archive, application, folder, origin):
    """Never rewrite initial.json; partial and completed observations stay distinct."""
    oid = application['Oid']
    errors = []
    observations = []
    attachment_index = []
    attachment_index_ok = False
    events = []
    after = None
    metadata_stable = False
    missing_previous = []
    try:
        events = client.events(oid)
        atomic_json(folder / 'events.json', {'read_at': now(), 'fields': EVENT_FIELDS, 'rows': events})
    except CaptureError as exc:
        errors.append({'stage': 'events', 'code': str(exc)})
    try:
        attachment_index = client.attachments(oid)
        attachment_index_ok = True
        atomic_json(folder / 'attachment-index.json', {'read_at': now(), 'fields': ATTACHMENT_FIELDS, 'rows': attachment_index})
        for meta in attachment_index:
            observation = {'metadata': meta, 'download_started_at': now()}
            try:
                data = client.content(meta['Oid'])
                # Preserve every byte even if metadata changed while being downloaded.
                observation['object'] = archive.blob(data)
                if meta['Archivo.Size'] is not None and len(data) != meta['Archivo.Size']:
                    observation['error'] = 'attachment_size_changed'
                    errors.append({'stage': 'attachment', 'oid': meta['Oid'], 'code': 'attachment_size_changed'})
            except CaptureError as exc:
                observation['error'] = str(exc)
                errors.append({'stage': 'attachment', 'oid': meta['Oid'], 'code': str(exc)})
            observation['download_finished_at'] = now()
            observations.append(observation)
            atomic_json(folder / 'downloads' / (str(meta['Oid']) + '.json'), observation)
    except CaptureError as exc:
        errors.append({'stage': 'attachment_index', 'code': str(exc)})
    try:
        after = client.application(oid)
        index_after = client.attachments(oid)
        events_after = client.events(oid)
        metadata_stable = (application == after and attachment_index == index_after and events == events_after)
        atomic_json(folder / 'after.json', {'read_at': now(), 'application': after, 'attachment_index': index_after, 'events': events_after})
        if not metadata_stable:
            errors.append({'stage': 'consistency', 'code': 'changed_during_capture'})
    except CaptureError as exc:
        errors.append({'stage': 'consistency', 'code': str(exc)})
    if application.get('Adjuntos.Count()') != len(attachment_index):
        errors.append({'stage': 'coverage', 'code': 'attachment_count_mismatch'})
    if application.get('Novedades.Count()') != len(events):
        errors.append({'stage': 'coverage', 'code': 'event_count_mismatch'})
    previous = read_json(folder.parent.parent / 'latest.json', {})
    previous_ids = set(previous.get('attachment_ids', []))
    missing_previous = sorted(previous_ids - {row['Oid'] for row in attachment_index}) if attachment_index_ok else None
    payload = {'schema_version': SCHEMA_VERSION, 'application_fields': APPLICATION_FIELDS,
               'application': application, 'events': events,
               'attachments': [{'metadata': item['metadata'], 'object': item.get('object'), 'error': item.get('error')} for item in observations]}
    payload_object = archive.blob(encoded(payload))
    result = {'schema_version': SCHEMA_VERSION, 'finished_at': now(), 'origin': origin,
              'complete': not errors, 'partial_reason': partial_reason(errors),
              'metadata_stable': metadata_stable,
              'state_before': application.get('Estado.ID'), 'state_after': after.get('Estado.ID') if after else None,
              'payload': payload_object, 'downloads': observations, 'errors': errors,
              'attachment_ids_absent_since_last_capture': missing_previous,
              'changed_from_previous_capture': previous.get('payload_sha256') != payload_object['sha256']}
    atomic_json(folder / 'manifest.json', result)
    atomic_json(folder.parent.parent / 'latest.json', {'observation': folder.relative_to(archive.root).as_posix(),
        'payload_sha256': payload_object['sha256'], 'attachment_ids': [row['Oid'] for row in attachment_index] if attachment_index_ok else sorted(previous_ids), 'complete': result['complete']})
    return result


def poll(client, archive, *, workers=3, min_free_bytes=1024**3):
    with archive.lock():
        if shutil.disk_usage(archive.root).free < min_free_bytes:
            raise CaptureError('insufficient_disk_space')
        started_at = now()
        run_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-' + uuid.uuid4().hex[:8]
        # Fail closed on a failed/truncated scan; never interpret it as an empty queue.
        active = client.active()
        scan_finished_at = now()
        atomic_json(archive.root / 'runs' / (run_id + '-scan.json'), {'started_at': started_at, 'finished_at': scan_finished_at, 'criteria': '[Estado.ID] = 114', 'fields': APPLICATION_FIELDS, 'rows': active})
        pending_path = archive.root / 'pending.json'
        pending = read_json(pending_path, {})
        active_ids = {row['Oid'] for row in active}
        jobs = []
        summary = {'ok': True, 'active': len(active), 'captured': 0, 'partial': 0,
                   'partial_changed': 0, 'partial_error': 0, 'stuck': 0,
                   'changed': 0, 'attachments': 0, 'late_retries': 0, 'retry_fetch_failures': 0}
        # Persist all first-observed application rows before any slow binary download.
        for application in active:
            oid = str(application['Oid'])
            folder = archive.start(application, scan_finished_at, 'observed_in_risk', run_id)
            pending.setdefault(oid, {'attempts': 0, 'next_retry': 0})
            jobs.append((application, folder, 'observed_in_risk'))
        atomic_json(pending_path, pending)
        for key, state in list(pending.items()):
            oid = identifier(int(key))
            if oid in active_ids or state.get('next_retry', 0) > time.time():
                continue
            try:
                application = client.application(oid)
                folder = archive.start(application, now(), 'late_retry_after_absence_from_risk', run_id)
                jobs.append((application, folder, 'late_retry_after_absence_from_risk'))
                summary['late_retries'] += 1
            except CaptureError:
                state['attempts'] += 1
                state['next_retry'] = time.time() + min(3600, 60 * 2 ** min(6, state['attempts']))
                summary['retry_fetch_failures'] += 1
        atomic_json(pending_path, pending)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(capture_one, client, archive, app, folder, origin): (app, folder) for app, folder, origin in jobs}
            for future in as_completed(futures):
                app, folder = futures[future]
                key = str(app['Oid'])
                try:
                    result = future.result()
                except Exception:
                    # Initial rows and per-file journals survive interruptions/unexpected failures.
                    atomic_json(folder / 'failure.json', {'at': now(), 'code': 'capture_interrupted_or_storage_error'})
                    result = {'complete': False, 'partial_reason': 'fetch_or_storage_error',
                              'changed_from_previous_capture': False, 'downloads': []}
                summary['captured'] += 1
                summary['changed'] += int(result['changed_from_previous_capture'])
                summary['attachments'] += sum('object' in item for item in result['downloads'])
                if result['complete']:
                    pending.pop(key, None)
                else:
                    summary['partial'] += 1
                    reason = result.get('partial_reason') or 'fetch_or_storage_error'
                    summary['partial_changed' if reason == 'changed_during_capture' else 'partial_error'] += 1
                    state = pending[key]
                    state['attempts'] += 1
                    state['next_retry'] = time.time() + min(3600, 60 * 2 ** min(6, state['attempts']))
                atomic_json(pending_path, pending)
        # Una observacion parcial por edicion concurrente se reintenta sola en el
        # sondeo siguiente. Solo se reporta como falla lo que dejo datos sin
        # archivar o lo que no se resolvio despues de varios intentos.
        summary['stuck'] = sum(1 for state in pending.values() if state.get('attempts', 0) >= STUCK_RETRY_ATTEMPTS)
        summary.update(ok=not (summary['partial_error'] or summary['retry_fetch_failures'] or summary['stuck']),
                       pending=len(pending), started_at=started_at, finished_at=now())
        atomic_json(archive.root / 'runs' / (run_id + '-summary.json'), summary)
        return summary


def main():
    os.umask(0o077)
    try:
        base = os.environ['VIMARX_EVAL_BASE_URL']
        archive = Archive(os.environ['RISK_SNAPSHOT_ROOT'])
        client = CoreClient(base, token=os.getenv('VIMARX_BEARER_TOKEN', ''),
            verify_tls=os.getenv('VIMARX_VERIFY_TLS', 'true').lower() == 'true',
            timeout=float(os.getenv('VIMARX_TIMEOUT_SECONDS', '20')))
        summary = poll(client, archive)
    except Exception as exc:
        summary = {'ok': False, 'error_code': str(exc) if isinstance(exc, CaptureError) else 'capture_configuration_or_storage_error'}
    # No identifiers, names, amounts, filenames, response bodies or documents in logs/outputs.
    print(json.dumps(summary, ensure_ascii=True))
    try:
        from kestra import Kestra
        Kestra.outputs(summary)
    except ImportError:
        pass
    return 0 if summary['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
