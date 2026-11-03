from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import uuid
from zoneinfo import ZoneInfo

from .archive import Archive
from .config import Config
from .source import SourceClient, SourceError, check_deadline, content_version
from .store import import_snapshot, read_manifest, timestamp
from .bundle import active_bundle, active_current, inside, refresh_bundle


def refresh_budget_seconds(config: Config, now: datetime | None = None) -> float:
    """Bound work by both the ten-hour budget and the local window end."""
    budget = 10 * 3600
    if config.refresh_start_hour is None:
        return budget
    local = (now or datetime.now(timezone.utc)).astimezone(ZoneInfo(config.refresh_timezone))
    start, end = config.refresh_start_hour, config.refresh_end_hour
    allowed = start <= local.hour < end if start < end else local.hour >= start or local.hour < end
    if not allowed:
        raise SourceError("BCRA refresh is outside its configured nightly window")
    finish = local.replace(hour=end, minute=0, second=0, microsecond=0)
    if start > end and local.hour >= start:
        finish += timedelta(days=1)
    return min(budget, (finish.astimezone(timezone.utc) - local.astimezone(timezone.utc)).total_seconds())


class RefreshManager:
    """One process/volume. Refresh runs in a background thread; reads stay available."""
    def __init__(self, config: Config) -> None:
        self.config = config
        config.data_dir.mkdir(parents=True, exist_ok=True)
        self.database = config.data_dir / "snapshot.sqlite"
        self.state_path = config.data_dir / "refresh.json"
        self.lock = threading.Lock()
        self.snapshot_lock = threading.RLock()
        self.thread: threading.Thread | None = None
        self.state = json.loads(self.state_path.read_text()) if self.state_path.exists() else {}
        if self.state.get("status") == "running":
            self.state.update(status="failed", error="Refresh interrupted by service restart", finished_at=timestamp())
            self._persist()

    def _persist(self) -> None:
        temporary = self.state_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.state), encoding="utf-8")
        os.replace(temporary, self.state_path)

    def start(self, request_id: str) -> dict:
        with self.lock:
            if self.state.get("status") == "running" or self.state.get("request_id") == request_id:
                return dict(self.state)
            self.state = {
                "job_id": uuid.uuid4().hex, "request_id": request_id, "status": "running",
                "started_at": timestamp(),
                "last_successful_check_at": self.state.get("last_successful_check_at"),
                "checked_version": self.state.get("checked_version"),
            }
            self._persist()
            self.thread = threading.Thread(target=self._run, daemon=True, name="bcra-refresh")
            self.thread.start()
            return dict(self.state)

    def job(self, job_id: str) -> dict | None:
        with self.lock:
            return dict(self.state) if self.state.get("job_id") == job_id else None

    def publication(self, historical=False) -> dict:
        """Resolve a validated publication with freshness scoped to its endpoint."""
        with self.snapshot_lock:
            bundle = active_bundle(self.config.data_dir)
            monthly = active_current(self.config.data_dir)
            manifest = bundle if historical else monthly or bundle or read_manifest(self.database)
            with self.lock:
                state = dict(self.state)

            def checked(dataset):
                if dataset is not None and dataset is not monthly and state.get('checked_version') == dataset['version']:
                    return state.get('last_successful_check_at') or dataset.get('checked_at')
                return (dataset or {}).get('checked_at')

            def stale(at):
                return not at or (datetime.now(timezone.utc) - datetime.fromisoformat(at)).total_seconds() > self.config.max_check_age_hours * 3600

            checked_at = checked(manifest)
            outdated = stale(checked_at)
            supplements = bundle
            if not historical and monthly and (not bundle or stale(checked(bundle))
                    or bundle['components']['current']['version'] != monthly['version']):
                supplements = None
            database = (inside(self.config.data_dir, manifest['components']['current']['path'])
                        if manifest and 'components' in manifest else self.database)
            return {'ready': manifest is not None and not outdated, 'check_stale': outdated,
                    'last_successful_check_at': checked_at, 'dataset': manifest,
                    'database': database, 'bundle': supplements}

    def status(self) -> dict:
        with self.snapshot_lock:
            current, history = self.publication(), self.publication(historical=True)
            with self.lock:
                state = dict(self.state)
            return {
                'ready': current['ready'], 'check_stale': current['check_stale'],
                'last_successful_check_at': current['last_successful_check_at'],
                'dataset': current['dataset'], 'refresh': state,
                'history_ready': history['ready'], 'history_check_stale': history['check_stale'],
                'last_successful_history_check_at': history['last_successful_check_at'],
                'history_dataset': history['dataset'],
                'capabilities': {'current': current['dataset'] is not None, 'history': history['dataset'] is not None,
                                 'padron': current['bundle'] is not None, 'normal_since': current['bundle'] is not None},
            }

    def _refresh(self) -> dict:
        if not self.config.terms_accepted:
            raise SourceError("Operator acceptance of BCRA download terms is required")
        deadline = time.monotonic() + refresh_budget_seconds(self.config)
        if self.config.extended_enabled:
            return refresh_bundle(self, deadline)
        client = SourceClient(self.config, deadline=deadline)
        assets = client.catalog()
        previous = read_manifest(self.database)
        period = assets[0].period
        if previous and period < previous["period"]:
            raise SourceError("BCRA catalog regressed to an older period")
        # All three archives are revalidated by content daily: filenames and IDs
        # alone cannot detect an in-place rectification. No HEAD login HTML is trusted.
        with tempfile.TemporaryDirectory(prefix="refresh-", dir=self.config.data_dir) as temporary:
            work = Path(temporary)
            downloaded = [client.download(asset, work / asset.name) for asset in assets]
            version = content_version(downloaded)
            warnings = [
                "BCRA download log returned null for " + item["name"]
                for item in downloaded if item.get("terms_log_result") == "null_response"
            ]
            check_deadline(deadline)
            if previous and previous["version"] == version:
                return {"action": "unchanged", "version": version, "period": period, "warnings": warnings}
            archives = {
                asset.kind: Archive(work / asset.name, self.config.seven_zip, deadline=deadline) for asset in assets
            }
            manifest = {
                "version": version, "period": period, "checked_at": timestamp(),
                "files": downloaded, "warnings": warnings,
            }
            staged_database = work / "snapshot.sqlite"
            manifest = import_snapshot(staged_database, archives, manifest, self.config.min_rows, deadline=deadline)
            check_deadline(deadline)
            warnings = manifest["warnings"]
            if previous and manifest["rows"] < previous["rows"] * self.config.min_row_ratio:
                raise SourceError("BCRA row count dropped by more than the allowed threshold")
            # Retain exactly the active publication's raw archives plus the active
            # database. Old archive cleanup happens only after a successful swap.
            destination = self.config.data_dir / "archives" / version
            destination.mkdir(parents=True, exist_ok=True)
            for asset in assets:
                os.replace(work / asset.name, destination / asset.name)
            check_deadline(deadline)
            os.replace(staged_database, self.database)
            archive_root = self.config.data_dir / "archives"
            cleanup_pending = False
            try:
                for directory in archive_root.iterdir():
                    if directory.is_dir() and directory.name != version:
                        for path in directory.iterdir():
                            if path.is_file() and path.suffix.upper() == ".7Z":
                                path.unlink()
                        if not any(directory.iterdir()):
                            directory.rmdir()
            except OSError:
                # A valid published database must not be reported as a failed import
                # just because an old raw archive could not be removed.
                cleanup_pending = True
            return {"action": "updated", "version": version, "period": period,
                    "rows": manifest["rows"], "archive_cleanup_pending": cleanup_pending,
                    "warnings": warnings}

    def _run(self) -> None:
        try:
            result = self._refresh()
        except Exception as exc:
            # Only our controlled errors are safe for logs and job outputs.
            error = str(exc) if isinstance(exc, SourceError) else "Refresh failed; previous dataset retained"
            with self.lock:
                self.state.update(status="failed", error=error, finished_at=timestamp())
                self._persist()
        else:
            with self.lock:
                self.state.update(
                    status="completed", result=result, finished_at=timestamp(),
                    last_successful_check_at=timestamp(), checked_version=result["version"],
                )
                self._persist()
