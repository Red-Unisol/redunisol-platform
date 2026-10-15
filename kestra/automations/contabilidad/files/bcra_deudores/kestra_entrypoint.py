"""On-demand Celesol presentations. Secrets and source expressions stay server-side."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import sys
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID
from zoneinfo import ZoneInfo

from . import process

SOURCE_SHA256 = "59cc97e508414df9f92664832a79b4360d08aeeb8b28de5c1d6c376545271dd4"
CATALOG_TYPE = "F.Module.Cuentas.Prestamos.LineaPrestamo"
CATALOG_FIELDS = "ID;Descripcion;Superior.ID;Superior.Descripcion"


def atomic_json(path: Path, data: dict) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    temporary.replace(path)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def validate_request(data: dict, today: date | None = None) -> dict:
    if not isinstance(data, dict):
        raise ValueError("La solicitud debe ser un objeto JSON.")
    run_id = str(UUID(str(data.get("run_id", ""))))
    period = str(data.get("period", ""))
    if not re.fullmatch(r"20\d{2}-(0[1-9]|1[0-2])", period):
        raise ValueError("Período inválido.")
    year, month = map(int, period.split("-"))
    cutoff = date(year, month, monthrange(year, month)[1])
    if cutoff >= (today or datetime.now(ZoneInfo("America/Argentina/Buenos_Aires")).date()).replace(day=1):
        raise ValueError("Elegí un mes cerrado.")
    ids = data.get("selected_line_ids")
    if not isinstance(ids, list) or not ids or len(ids) > 10000:
        raise ValueError("Seleccioná al menos una línea.")
    if any(not re.fullmatch(r"[1-9]\d{0,9}", str(value)) for value in ids):
        raise ValueError("Identificador de línea inválido.")
    special = data.get("normal_until_66_superior_ids", [])
    if not isinstance(special, list) or any(not re.fullmatch(r"[1-9]\d{0,9}", str(v)) for v in special):
        raise ValueError("Regla de mora inválida.")
    presentation = data.get("presentation_type", "NORMAL")
    if presentation not in {"NORMAL", "RECTIFICATIVA"}:
        raise ValueError("Tipo de presentación inválido.")
    granted = data.get("granted_without_real_guarantee", True)
    if not isinstance(granted, bool):
        raise ValueError("Indicador de otorgamientos inválido.")
    rate = str(data.get("rate", ""))
    if granted and not re.fullmatch(r"\d{1,3},\d{2}", rate):
        raise ValueError("Ingresá la TNA con coma y dos decimales.")
    rate = rate.zfill(6) if granted else "000,00"
    declared_by = str(data.get("declared_by", "")).strip()
    if not declared_by or len(declared_by) > 80:
        raise ValueError("Indicá quién prepara la presentación.")
    exclusions = {}
    for key, pattern in [("excluded_cuits", r"\d{11}"), ("excluded_accounts", r"[A-Za-z0-9 ._/-]{1,50}")]:
        values = data.get(key, [])
        if not isinstance(values, list) or len(values) > 1000:
            raise ValueError("Lista de exclusiones inválida.")
        cleaned = []
        for item in values:
            if not isinstance(item, dict) or not re.fullmatch(pattern, str(item.get("value", ""))):
                raise ValueError("Valor de exclusión inválido.")
            reason = str(item.get("reason", "")).strip()
            if not reason or len(reason) > 300:
                raise ValueError("Cada exclusión necesita un motivo de hasta 300 caracteres.")
            cleaned.append({"value": str(item["value"]), "reason": reason})
        exclusions[key] = cleaned
    return {"run_id": run_id, "period": period, "cutoff": cutoff.isoformat(),
            "selected_line_ids": sorted(set(map(str, ids)), key=int),
            "normal_until_66_superior_ids": sorted(set(map(str, special)), key=int),
            "presentation_type": presentation, "granted_without_real_guarantee": granted,
            "rate": rate, "declared_by": declared_by, **exclusions}


def source_config(cutoff: date, environment: dict) -> process.ProcessConfig:
    base = environment.get("BCRA_CORE_URL", "").rstrip("/")
    if not base.startswith(("https://", "http://")):
        raise ValueError("Falta configurar la fuente Vimarx.")
    endpoint = base if base.endswith("/EvaluateList") else base + "/api/Empresa/EvaluateList"
    headers = {"Accept": "text/plain"}
    if environment.get("BCRA_CORE_TOKEN"):
        headers["Authorization"] = "Bearer " + environment["BCRA_CORE_TOKEN"]
    return process.ProcessConfig(fecha_corte=cutoff, api_url=endpoint, headers=headers,
        max=1000000, timeout_seconds=300,
        verify_tls=environment.get("BCRA_CORE_VERIFY_TLS", "true").lower() == "true")


def catalog(config: process.ProcessConfig) -> dict[str, dict]:
    rows = process.fetch_api_payload(config, {"tipo": CATALOG_TYPE, "cmd": "",
        "campos": CATALOG_FIELDS, "max": 10001})
    if not rows or len(rows) >= 10001:
        raise ValueError("El catálogo de líneas está vacío o incompleto.")
    result = {}
    for row in rows:
        if not isinstance(row, list) or len(row) != 4 or not str(row[0]).isdigit() or not row[1]:
            raise ValueError("El catálogo contiene una línea inválida.")
        line_id = str(row[0])
        if line_id in result:
            raise ValueError("El catálogo contiene identificadores duplicados.")
        result[line_id] = {"id": line_id, "name": str(row[1]).strip(),
            "superior_id": str(row[2]) if row[2] is not None else line_id,
            "superior_name": str(row[3] or row[1]).strip()}
    return result


def prepare_rows(rows: list, request: dict, lines: dict, issues_path: Path | None = None) -> list:
    """Validate the projection and enforce selection/date even if the source ignores criteria."""
    selected = set(request["selected_line_ids"])
    excluded_cuits = {x["value"] for x in request["excluded_cuits"]}
    excluded_accounts = {x["value"] for x in request["excluded_accounts"]}
    result = []
    for position, row in enumerate(rows, 1):
        if not isinstance(row, list) or len(row) != 13:
            raise ValueError("La fuente devolvió una estructura de cuotas inesperada.")
        line_id = str(row[11])
        if line_id not in selected or process.normalize_cuit_value(row[3]) in excluded_cuits or process.normalize_nro_cuenta(row[0]) in excluded_accounts:
            continue
        if line_id not in lines:
            raise ValueError("Una cuota corresponde a una línea que ya no está en el catálogo.")
        # FechaEmision is mandatory: an absent date must never silently become a valid cutoff.
        issued = str(row[12] or "")[:10]
        try:
            issued_date = date.fromisoformat(issued)
        except ValueError as exc:
            if issues_path is not None:
                process.write_semicolon_file(issues_path, [
                    ["Codigo", "Fila", "NroCuenta", "CUIT", "Mensaje"],
                    ["INVALID_ISSUE_DATE", str(position), str(row[0]), str(row[3]), "Falta fecha de emisión válida"],
                ])
            raise ValueError("Hay préstamos seleccionados sin fecha de emisión válida. Revisá la fuente o sus exclusiones.") from exc
        if issued_date > date.fromisoformat(request["cutoff"]):
            continue
        balance = process.parse_decimal(row[5])
        if balance is not None and balance <= 0:
            continue
        clean = list(row[:11])
        clean[1] = lines[line_id]["superior_name"]
        clean[2] = lines[line_id]["name"]
        result.append(clean)
    return result


def execute(data: dict, root: Path, environment: dict | None = None) -> dict:
    environment = environment if environment is not None else dict(os.environ)
    request = validate_request(data)
    mount = Path(environment.get("BCRA_REPORTS_MOUNT", "/reports"))
    if not mount.is_dir() or not root.resolve().is_relative_to(mount.resolve()):
        raise ValueError("No está disponible el volumen persistente de reportes BCRA.")
    root.mkdir(parents=True, exist_ok=True)
    directory = root / request["run_id"]
    directory.mkdir()  # Exclusive claim: duplicate execution IDs cannot overwrite a previous run.
    metadata = {"run_id": request["run_id"], "execution_id": environment.get("BCRA_EXECUTION_ID"),
        "period": request["period"], "cutoff": request["cutoff"], "declared_by": request["declared_by"],
        "status": "RUNNING", "started_at": now(), "company": "Celesol",
        "balance_basis": "VIMARX_CURRENT_BALANCE", "balance_extracted_at": None,
        "engine_archive_sha256": SOURCE_SHA256}
    atomic_json(directory / "metadata.json", metadata)
    try:
        config = source_config(date.fromisoformat(request["cutoff"]), environment)
        lines = catalog(config)
        if set(request["selected_line_ids"]) - lines.keys():
            raise ValueError("Cambió el catálogo. Actualizá las líneas antes de generar.")
        superior_names = {line["superior_id"]: line["superior_name"] for line in lines.values()}
        if set(request["normal_until_66_superior_ids"]) - superior_names.keys():
            raise ValueError("La regla de 66 días contiene un superior desconocido.")
        snapshot = {**request, "selected_lines": [lines[v] for v in request["selected_line_ids"]],
            "minimum_debt_per_debtor": "25000.00", "balance_basis": metadata["balance_basis"],
            "normal_until_66_superiors": [superior_names[v] for v in request["normal_until_66_superior_ids"]],
            "preset": "julio-2026-v2", "engine_archive_sha256": SOURCE_SHA256,
            "engine_code_sha256": hashlib.sha256(Path(process.__file__).read_bytes()).hexdigest(),
            "runtime_code_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
        atomic_json(directory / "config_aplicada.json", snapshot)
        ids = ",".join(request["selected_line_ids"])
        next_month = (config.fecha_corte + timedelta(days=1)).isoformat()
        # Threshold belongs after consolidation by debtor, never in this per-loan query.
        config.cmd = (f"Prestamo.SaldoPrestamo > 0.0m AND Prestamo.Estado = 'Activa' "
            f"AND Prestamo.FechaEmision < #{next_month}# "
            f"AND Prestamo.LineaPrestamo.ID In ({ids})")
        config.campos += ";Prestamo.LineaPrestamo.ID;Prestamo.FechaEmision"
        raw_rows = process.fetch_api(config)
        metadata["balance_extracted_at"] = now()
        if len(raw_rows) >= config.max:
            raise ValueError("La consulta alcanzó el límite de filas. No se genera un archivo incompleto.")
        rows = prepare_rows(raw_rows, request, lines, directory / "control" / "errores.csv")
        config.output_dir = directory / "output"
        config.control_dir = directory / "control"
        config.cuits_excluidos = {x["value"] for x in request["excluded_cuits"]}
        config.nro_cuentas_excluidas = {x["value"] for x in request["excluded_accounts"]}
        config.lineas_situacion_01_hasta_66_dias = {process.normalize_text(superior_names[v])
            for v in request["normal_until_66_superior_ids"]}
        config.tipo_presentacion = request["presentation_type"]
        config.tasa = process.TasaConfig(modo="MANUAL",
            otorgadas_sin_garantia_real_mes=int(request["granted_without_real_guarantee"]),
            tasa_promedio_manual=request["rate"])
        # Reuse the supplied engine's complete artifact generation/validation without a second extraction.
        result = process.run(config, rows=rows)
        issues = result["controls"]
        report = result["report"]
        metadata.update(status="NEEDS_REVIEW" if issues.errors or issues.warnings else "SUCCESS",
            debtors=len(result["debtors"]), loans=len(result["included_loans"]),
            total_miles=sum(d.total_miles for d in result["debtors"].values()),
            below_minimum=report.get("cantidad_deudores_bajo_minimo", 0),
            errors=len(issues.errors), warnings=len(issues.warnings),
            api_rows=len(raw_rows), selected_lines=len(request["selected_line_ids"]))
    except Exception as exc:
        # Partial output is audit material, never a downloadable presentation.
        for path in (directory / "output").glob("*.zip"):
            path.unlink()
        metadata.update(status="FAILED", message=(str(exc) if isinstance(exc, ValueError) else
            "No se pudo generar la presentación. Revisá la fuente, la configuración y el detalle de la ejecución en Kestra."))
        raise
    finally:
        artifacts = {}
        for key, relative in {"zip": "output/informacion.zip", "config": "config_aplicada.json",
            "control": "control/reporte_control.json", "errors": "control/errores.csv",
            "excel": "control/deudores_por_superior.xlsx"}.items():
            path = directory / relative
            if path.is_file():
                artifacts[key] = {"path": relative, "bytes": path.stat().st_size,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        metadata["artifacts"] = artifacts
        metadata["finished_at"] = now()
        atomic_json(directory / "metadata.json", metadata)
    return metadata


def main() -> int:
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
    try:
        data = json.loads(os.environ["BCRA_REQUEST"])
        # Kestra JSON inputs are stored as JSON strings in some supported versions.
        if isinstance(data, str):
            data = json.loads(data)
        metadata = execute(data, Path(os.environ["BCRA_OUTPUT_ROOT"]))
        summary = {k: metadata[k] for k in ["run_id", "status", "debtors", "loans", "total_miles"]}
        try:
            from kestra import Kestra
            Kestra.outputs(summary)
        except ImportError:
            print(json.dumps(summary))
        return 0
    except Exception as exc:
        # Source errors and validation exceptions can contain account identifiers; keep them out of runtime logs.
        logging.error("Falló la generación BCRA (%s). Consultar los controles privados de la corrida.", type(exc).__name__)
        return 1


if __name__ == "__main__":
    sys.exit(main())
