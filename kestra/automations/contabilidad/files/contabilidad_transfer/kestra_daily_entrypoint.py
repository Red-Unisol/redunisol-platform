from __future__ import annotations

import fnmatch
import json
import os
import shutil
import stat
import sys
import tempfile
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

import paramiko

try:
    from kestra import Kestra
except ImportError:  # pragma: no cover - optional outside Kestra
    Kestra = None

from contabilidad_transfer.cruce_mov_emp_vimarx import (
    DEFAULT_API_BASE_URL,
    ApiBundle,
    VimarxClient,
    build_report_rows,
    filter_report_rows,
    get_report_headers,
    load_movements,
    write_excel,
)


DEFAULT_REMOTE_DIR = "."
DEFAULT_REMOTE_PATTERN = "mov_emp_431*.txt"
DEFAULT_OUTPUT_ROOT = "/data/contabilidad-transfer"
DEFAULT_CACHE_DIR = "/data/contabilidad-transfer/cache/vimarx"


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def require_env(name: str) -> str:
    value = env(name)
    if value == "":
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def parse_run_date() -> str:
    raw = env("CONTABILIDAD_RUN_DATE")
    if raw == "":
        return datetime.now().date().isoformat()
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date().isoformat()
    except ValueError as exc:
        raise RuntimeError("CONTABILIDAD_RUN_DATE must use YYYY-MM-DD format") from exc


def connect_sftp() -> paramiko.SFTPClient:
    host = require_env("CONTABILIDAD_SFTP_HOST")
    port = int(env("CONTABILIDAD_SFTP_PORT", "22"))
    username = require_env("CONTABILIDAD_SFTP_USERNAME")
    password = require_env("CONTABILIDAD_SFTP_PASSWORD")

    transport = paramiko.Transport((host, port))
    transport.banner_timeout = int(env("CONTABILIDAD_SFTP_BANNER_TIMEOUT", "30"))
    transport.connect(username=username, password=password)
    return paramiko.SFTPClient.from_transport(transport)


def list_remote_files(sftp: paramiko.SFTPClient, remote_dir: str, pattern: str) -> list[paramiko.SFTPAttributes]:
    entries = sftp.listdir_attr(remote_dir)
    files = [
        entry
        for entry in entries
        if not stat.S_ISDIR(entry.st_mode)
        and fnmatch.fnmatch(entry.filename, pattern)
        and not fnmatch.fnmatch(entry.filename, "mov_emp_mes_*")
    ]
    return sorted(files, key=lambda entry: entry.filename)


def download_files(
    sftp: paramiko.SFTPClient,
    remote_dir: str,
    entries: list[paramiko.SFTPAttributes],
    input_dir: Path,
) -> list[dict[str, Any]]:
    downloaded: list[dict[str, Any]] = []
    input_dir.mkdir(parents=True, exist_ok=True)

    for entry in entries:
        remote_path = f"{remote_dir.rstrip('/')}/{entry.filename}" if remote_dir not in ("", ".") else entry.filename
        local_path = input_dir / entry.filename
        sftp.get(remote_path, str(local_path))
        downloaded.append(
            {
                "name": entry.filename,
                "size": entry.st_size,
                "modified_at": datetime.fromtimestamp(entry.st_mtime).isoformat() if entry.st_mtime else None,
            }
        )

    return downloaded


def persist_outputs(temp_output_dir: Path, output_dir: Path) -> dict[str, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    persisted: dict[str, str] = {}
    for source in temp_output_dir.glob("*.xlsx"):
        target = output_dir / source.name
        shutil.copy2(source, target)
        persisted[source.stem] = str(target)
    return persisted


def write_metadata(output_dir: Path, metadata: dict[str, Any]) -> Path:
    target = output_dir / "metadata.json"
    target.write_text(json.dumps(metadata, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return target


def set_kestra_outputs(values: dict[str, Any]) -> None:
    if Kestra is not None:
        Kestra.outputs(values)
        return

    for name, value in values.items():
        print(f"{name}={value}")


def main() -> int:
    run_date = parse_run_date()
    run_date_compact = run_date.replace("-", "")
    remote_dir = env("CONTABILIDAD_SFTP_REMOTE_DIR", DEFAULT_REMOTE_DIR)
    remote_pattern = env("CONTABILIDAD_SFTP_PATTERN", DEFAULT_REMOTE_PATTERN)
    output_root = Path(env("CONTABILIDAD_OUTPUT_ROOT", DEFAULT_OUTPUT_ROOT))
    cache_dir = Path(env("CONTABILIDAD_CACHE_DIR", DEFAULT_CACHE_DIR))
    output_dir = output_root / run_date

    with tempfile.TemporaryDirectory(prefix="contabilidad-transfer-") as tmp:
        work_dir = Path(tmp)
        input_dir = work_dir / "input"
        temp_output_dir = work_dir / "output"
        temp_output_dir.mkdir(parents=True, exist_ok=True)

        sftp = connect_sftp()
        try:
            remote_files = list_remote_files(sftp, remote_dir, remote_pattern)
            downloaded = download_files(sftp, remote_dir, remote_files, input_dir)
        finally:
            transport = sftp.get_channel().get_transport()
            sftp.close()
            if transport is not None:
                transport.close()

        movements = load_movements(input_dir, remote_pattern)
        if not movements:
            raise RuntimeError("No se encontraron movimientos bancarios en los archivos descargados.")

        unique_cuits = sorted(
            {movement.cuit_tercero for movement in movements if movement.cuit_tercero}
        )
        client = VimarxClient(
            base_url=env("VIMARX_BASE_URL", DEFAULT_API_BASE_URL),
            timeout=int(env("VIMARX_TIMEOUT_SECONDS", "30")),
            max_rows=int(env("VIMARX_MAX_ROWS", "200")),
            cache_dir=None if env("VIMARX_NO_CACHE", "false").lower() == "true" else cache_dir,
        )

        bundles: dict[str, ApiBundle] = {}
        for cuit in unique_cuits:
            bundles[cuit] = client.fetch_bundle(cuit)

        report_rows = build_report_rows(
            movements,
            bundles,
            int(env("VIMARX_DATE_WINDOW_DAYS", "120")),
        )
        high_rows = filter_report_rows(report_rows, only_high_matches=True)

        full_name = f"cruce_mov_emp_vimarx_{run_date_compact}.xlsx"
        high_name = f"cruce_mov_emp_vimarx_altos_{run_date_compact}.xlsx"
        write_excel(temp_output_dir / full_name, report_rows, get_report_headers(False))
        write_excel(temp_output_dir / high_name, high_rows, get_report_headers(True))

        persisted = persist_outputs(temp_output_dir, output_dir)
        status_counter = Counter(row.get("MatchEstado", "") for row in report_rows)
        metadata = {
            "ok": True,
            "run_date": run_date,
            "generated_at": datetime.now().isoformat(),
            "remote_dir": remote_dir,
            "remote_pattern": remote_pattern,
            "downloaded_files": downloaded,
            "downloaded_file_count": len(downloaded),
            "movement_count": len(movements),
            "movements_without_cuit_count": sum(
                1 for movement in movements if not movement.cuit_tercero
            ),
            "movements_without_amount_count": sum(
                1 for movement in movements if movement.monto is None
            ),
            "unique_cuit_count": len(unique_cuits),
            "full_row_count": len(report_rows),
            "high_match_row_count": len(high_rows),
            "match_status_counts": dict(status_counter),
            "outputs": {
                "full": str(output_dir / full_name),
                "high_matches": str(output_dir / high_name),
            },
        }
        metadata_path = write_metadata(output_dir, metadata)

    set_kestra_outputs(
        {
            "ok": True,
            "run_date": run_date,
            "output_dir": str(output_dir),
            "metadata_path": str(metadata_path),
            "full_output": metadata["outputs"]["full"],
            "high_matches_output": metadata["outputs"]["high_matches"],
            "movement_count": metadata["movement_count"],
            "high_match_row_count": metadata["high_match_row_count"],
        }
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
