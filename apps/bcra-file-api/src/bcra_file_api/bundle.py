"""Publish immutable file components together, retaining the old bundle on failure."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import time
from contextlib import closing

from .archive import Archive
from .component_store import build_component
from .source import SourceClient, SourceError, check_deadline, content_version
from .store import connect_readonly, import_snapshot, read_manifest, timestamp

COMPONENT_KINDS = {
    'current': ('DEUDORES', 'INFRET', 'INFRETPA'),
    'history': ('24DSF',),
    'corrections': ('INFRET', 'INFRETPA'),
    'normal': ('1DSF',),
    'padron': ('PADRON',),
}


def inside(root: Path, relative: str) -> Path:
    candidate = (root / relative).resolve()
    if not candidate.is_relative_to(root.resolve()) or candidate == root.resolve():
        raise SourceError('Invalid BCRA component path')
    return candidate


def active_bundle(root: Path) -> dict | None:
    path = root / 'active.json'
    if not path.exists():
        return None
    try:
        manifest = json.loads(path.read_text())
        if manifest['schema_version'] != 2 or set(manifest['components']) != set(COMPONENT_KINDS):
            raise ValueError
        for component in manifest['components'].values():
            if not inside(root, component['path']).is_file():
                raise ValueError
        return manifest
    except (OSError, ValueError, KeyError, TypeError):
        raise SourceError('Invalid active BCRA bundle; previous publication must be recovered') from None


def component_version(kind: str, files: list[dict], period: str) -> str:
    selected = [file for file in files if file['kind'] in COMPONENT_KINDS[kind]]
    if kind == 'current':
        return content_version(selected)
    values = sorted((file['kind'], file['sha256']) for file in selected)
    scope = '' if kind == 'padron' else period
    return hashlib.sha256(json.dumps([kind + '-v1', scope, values]).encode()).hexdigest()


class BuildBudget:
    def __init__(self, config, work: Path, deadline: float):
        self.config, self.work, self.deadline = config, work, deadline
        self.last_check = -1.0

    def __call__(self, *, force=False):
        check_deadline(self.deadline)
        now = time.monotonic()
        if not force and now - self.last_check < 1:
            return
        if shutil.disk_usage(self.work).free < self.config.min_free_bytes:
            raise SourceError('BCRA build reached the disk reserve; active data retained')
        size = sum(path.stat().st_size for path in self.work.iterdir() if path.is_file())
        if size > self.config.max_build_bytes:
            raise SourceError('BCRA build exceeded its storage budget; active data retained')
        self.last_check = now


def clean_staging(root: Path):
    # One refresh coordinator per process/volume. Called before creating this
    # job's directory, so previous refresh-* directories are abandoned builds.
    for path in root.glob('refresh-*'):
        if path.is_dir() and not path.is_symlink() and path.resolve().is_relative_to(root.resolve()):
            shutil.rmtree(path)


def collect_unused(root: Path, manifest: dict):
    keep = {inside(root, component['path']) for component in manifest['components'].values()}
    keep.update(inside(root, file['path']) for file in manifest['files'])
    for directory in ('components', 'raw', 'archives'):
        parent = root / directory
        if not parent.exists() or parent.is_symlink():
            continue
        for path in parent.rglob('*'):
            if path.is_file() and not path.is_symlink() and path.resolve() not in keep:
                if path.suffix.lower() in ('.sqlite', '.7z') and path.resolve().is_relative_to(root.resolve()):
                    path.unlink()
        for path in sorted(parent.rglob('*'), key=lambda value: len(value.parts), reverse=True):
            if path.is_dir() and not path.is_symlink() and not any(path.iterdir()):
                path.rmdir()


def _atomic_manifest(root: Path, manifest: dict):
    temporary = root / 'active.json.tmp'
    with temporary.open('w', encoding='utf-8') as output:
        json.dump(manifest, output)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, root / 'active.json')
    if os.name == 'posix':
        descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def refresh_bundle(manager, deadline: float) -> dict:
    config, root = manager.config, manager.config.data_dir
    previous = active_bundle(root)
    legacy = read_manifest(manager.database)
    with manager.snapshot_lock:
        clean_staging(root)
        if previous:
            collect_unused(root, previous)
    if shutil.disk_usage(root).free < config.min_free_bytes + min(config.max_build_bytes, 25 * 1024**3):
        raise SourceError('Insufficient free space to start the extended BCRA build')
    client = SourceClient(config, deadline=deadline)
    assets = client.catalog()
    period = next(asset.period for asset in assets if asset.kind == 'DEUDORES')
    if (previous or legacy) and period < (previous or legacy)['period']:
        raise SourceError('BCRA catalog regressed to an older period')
    last_progress = [-1.0, '']

    def progress(phase, rows=0):
        now = time.monotonic()
        if phase != last_progress[1] or now - last_progress[0] >= 30:
            with manager.lock:
                manager.state['progress'] = {'phase': phase, 'rows': rows, 'at': timestamp()}
                manager._persist()
            last_progress[:] = [now, phase]

    with tempfile.TemporaryDirectory(prefix='refresh-', dir=root) as temporary:
        work = Path(temporary)
        guard = BuildBudget(config, work, deadline)
        downloaded = []
        for asset in assets:
            guard()
            progress('download_' + asset.kind)
            downloaded.append(client.download(asset, work / asset.name))
        guard(force=True)
        by_kind = {file['kind']: file for file in downloaded}
        expected = set(kind for kinds in COMPONENT_KINDS.values() for kind in kinds)
        if set(by_kind) != expected:
            raise SourceError('Extended BCRA publication is incomplete')
        versions = {kind: component_version(kind, downloaded, period) for kind in COMPONENT_KINDS}
        version = hashlib.sha256(json.dumps(['bundle-v1', period, versions], sort_keys=True).encode()).hexdigest()
        warnings = ['BCRA download log returned null for ' + file['name']
                    for file in downloaded if file.get('terms_log_result') == 'null_response']
        if previous and version == previous['version']:
            return {'action': 'unchanged', 'version': version, 'period': period,
                    'capabilities': previous['capabilities'], 'warnings': warnings}
        opened = {}

        def archive(kind):
            if kind not in opened:
                asset = next(asset for asset in assets if asset.kind == kind)
                opened[kind] = Archive(work / asset.name, config.seven_zip, deadline=deadline)
            return opened[kind]

        components = {}
        staged = {}
        for kind, required in COMPONENT_KINDS.items():
            guard()
            wanted = versions[kind]
            old = (previous or {}).get('components', {}).get(kind)
            baseline = old or (legacy if kind == 'current' else None)
            destination = root / 'components' / kind / (wanted + '.sqlite')
            metadata = None
            if old and old['version'] == wanted:
                components[kind] = old
                progress('reuse_' + kind, old.get('rows', 0))
                continue
            completed = read_manifest(destination) if destination.is_file() else None
            if completed and completed['version'] == wanted:
                components[kind] = {**completed, 'path': str(destination.relative_to(root)).replace('\\', '/'),
                                    'bytes': destination.stat().st_size}
                progress('reuse_completed_' + kind, completed['rows'])
                continue
            path = work / (kind + '.sqlite')
            if kind == 'current' and legacy and legacy['version'] == wanted:
                # Reuse the already validated database without copying its 2+ GB.
                os.link(manager.database, path)
                metadata = legacy
            else:
                progress('import_' + kind)
                inputs = {key: archive(key) for key in required}
                if kind == 'current':
                    current_files = [by_kind[key] for key in required]
                    metadata = import_snapshot(path, inputs,
                        {'period': period, 'version': wanted, 'checked_at': timestamp(), 'files': current_files},
                        config.min_rows, deadline=deadline, guard=guard, progress=progress)
                else:
                    metadata = build_component(path, kind, inputs, period, wanted,
                                               config.min_extended_rows, guard, progress)
            if baseline and kind != 'corrections' and metadata['rows'] < baseline['rows'] * config.min_row_ratio:
                raise SourceError(f'{kind} row count dropped by more than the allowed threshold')
            components[kind] = {**metadata, 'path': str(destination.relative_to(root)).replace('\\', '/'),
                                'version': wanted, 'bytes': path.stat().st_size}
            staged[kind] = path
        guard(force=True)
        current_path = staged.get('current') or inside(root, components['current']['path'])
        with closing(connect_readonly(current_path)) as connection:
            known = {row[0] for row in connection.execute('SELECT code FROM entities')}
        if any(set(components[kind].get('entity_codes', [])) - known for kind in ('history', 'corrections')):
            raise SourceError('Historical publication references an entity absent from its master')
        files = []
        reusable = {(file['kind'], file['sha256']): file.get('path') for file in (previous or {}).get('files', [])}
        legacy_files = {(file['kind'], file['sha256']): file for file in (legacy or {}).get('files', [])}
        for file in downloaded:
            match = (file['kind'], file['sha256'])
            old_path = reusable.get(match)
            if not old_path and match in legacy_files:
                candidate = root / 'archives' / legacy['version'] / file['name']
                if candidate.is_file() and candidate.stat().st_size == file['bytes']:
                    old_path = str(candidate.relative_to(root)).replace('\\', '/')
            destination = inside(root, old_path) if old_path else root / 'raw' / file['kind'] / file['sha256'] / file['name']
            if not old_path:
                destination.parent.mkdir(parents=True, exist_ok=True)
                os.replace(work / file['name'], destination)
            files.append({**file, 'path': str(destination.relative_to(root)).replace('\\', '/')})
        for kind, path in staged.items():
            guard()
            destination = inside(root, components[kind]['path'])
            destination.parent.mkdir(parents=True, exist_ok=True)
            with path.open('r+b') as handle:
                os.fsync(handle.fileno())
            os.replace(path, destination)
        guard(force=True)
        manifest = {'schema_version': 2, 'version': version, 'period': period,
                    'checked_at': timestamp(), 'imported_at': timestamp(),
                    'rows': components['current']['rows'], 'files': files, 'components': components,
                    'warnings': warnings,
                    'capabilities': {'current': True, 'history': True, 'padron': True, 'normal_since': True}}
        progress('publish')
        with manager.snapshot_lock:
            _atomic_manifest(root, manifest)
            try:
                collect_unused(root, manifest)
                cleanup_pending = False
            except OSError:
                cleanup_pending = True
        return {'action': 'updated', 'version': version, 'period': period,
                'capabilities': manifest['capabilities'], 'rows': manifest['rows'],
                'component_rows': {kind: value['rows'] for kind, value in components.items()},
                'archive_cleanup_pending': cleanup_pending, 'warnings': warnings}
