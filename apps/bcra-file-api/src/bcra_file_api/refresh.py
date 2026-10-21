from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import uuid

from .archive import Archive
from .config import Config
from .source import SourceClient, SourceError, content_version
from .store import import_snapshot, read_manifest, timestamp


class RefreshManager:
    """One process/volume. Refresh runs in a background thread; reads stay available."""
    def __init__(self, config: Config) -> None:
        self.config = config
        config.data_dir.mkdir(parents=True, exist_ok=True)
        self.database = config.data_dir / "snapshot.sqlite"
        self.state_path = config.data_dir / "refresh.json"
        self.lock = threading.Lock()
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

    def status(self) -> dict:
        manifest = read_manifest(self.database)
        with self.lock:
            state = dict(self.state)
        checked_at = (
            state.get("last_successful_check_at")
            if manifest and state.get("checked_version") == manifest["version"]
            else (manifest or {}).get("checked_at")
        )
        stale = True
        if checked_at:
            age = datetime.now(timezone.utc) - datetime.fromisoformat(checked_at)
            stale = age.total_seconds() > self.config.max_check_age_hours * 3600
        return {
            "ready": manifest is not None and not stale, "check_stale": stale,
            "last_successful_check_at": checked_at, "refresh": state, "dataset": manifest,
        }

    def _refresh(self) -> dict:
        if not self.config.terms_accepted:
            raise SourceError("Operator acceptance of BCRA download terms is required")
        deadline = time.monotonic() + 10 * 3600
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
            manifest = import_snapshot(staged_database, archives, manifest, self.config.min_rows)
            warnings = manifest["warnings"]
            if previous and manifest["rows"] < previous["rows"] * self.config.min_row_ratio:
                raise SourceError("BCRA row count dropped by more than the allowed threshold")
            # Retain exactly the active publication's raw archives plus the active
            # database. Old archive cleanup happens only after a successful swap.
            destination = self.config.data_dir / "archives" / version
            destination.mkdir(parents=True, exist_ok=True)
            for asset in assets:
                os.replace(work / asset.name, destination / asset.name)
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
