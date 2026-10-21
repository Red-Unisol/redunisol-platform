from __future__ import annotations

from contextlib import closing
from datetime import datetime, timezone
import json
import re
from pathlib import Path
import sqlite3
import time

from .formats import FormatError, base_record, rect_record, split_record
from .source import SourceError, check_deadline


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect_readonly(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(path.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)


SCHEMA = """
CREATE TABLE debts (
    identification TEXT NOT NULL, entity TEXT NOT NULL, period TEXT NOT NULL,
    situation INTEGER NOT NULL, amount_tenths INTEGER NOT NULL,
    days INTEGER, observation INTEGER, refinancing INTEGER, recategorization INTEGER,
    legal INTEGER, technical INTEGER, origin TEXT NOT NULL,
    PRIMARY KEY (identification, entity, period)
) WITHOUT ROWID;
CREATE TABLE entities (code TEXT PRIMARY KEY, name TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE names (identification TEXT PRIMARY KEY, name TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE metadata (value TEXT NOT NULL);
"""
INSERT = "INSERT INTO debts VALUES (" + ",".join(["?"] * 12) + ")"


def import_snapshot(path: Path, archives: dict, manifest: dict, min_rows: int, *, deadline: float | None = None) -> dict:
    check_deadline(deadline)
    connection = sqlite3.connect(path)
    if deadline is not None:
        connection.set_progress_handler(lambda: int(time.monotonic() >= deadline), 10_000)
    try:
        connection.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;" + SCHEMA)
        period = manifest["period"]
        monthly = archives["DEUDORES"]
        rows = 0
        base_periods = set()
        batch = []
        with monthly.lines("deudores.txt") as lines:
            for number, line in lines:
                try:
                    record = base_record(line)
                    if record is None:
                        continue
                    if record[2] > period:
                        raise FormatError("Base period is newer than publication")
                    base_periods.add(record[2])
                    batch.append(record)
                    rows += 1
                    if len(batch) >= 10_000:
                        connection.executemany(INSERT, batch)
                        batch.clear()
                except (FormatError, sqlite3.Error):
                    check_deadline(deadline)
                    raise SourceError(f"Invalid monthly BCRA record at line {number}") from None
        connection.executemany(INSERT, batch)
        if rows < min_rows:
            raise SourceError("Monthly BCRA import is below the minimum row count")

        with monthly.lines("maeent.txt") as lines:
            for number, line in lines:
                try:
                    fields, _ = split_record(line, [5, 70])
                    if not fields[0].isdigit() or not fields[1]:
                        raise FormatError("Invalid entity master")
                    connection.execute("INSERT INTO entities VALUES (?,?)", (fields[0].zfill(5), fields[1]))
                except (FormatError, sqlite3.Error):
                    check_deadline(deadline)
                    raise SourceError(f"Invalid BCRA entity master at line {number}") from None
        if connection.execute("SELECT count(*) FROM entities").fetchone()[0] == 0:
            raise SourceError("Empty BCRA entity master")

        non_fiscal_names = 0
        if "nomdeu.txt" in monthly.members:
            batch = []
            with monthly.lines("nomdeu.txt") as lines:
                for number, line in lines:
                    try:
                        line = line.rstrip("\r\n")
                        # 202608 has eleven additional blank padding characters;
                        # reject nonblank extensions rather than truncate names.
                        if len(line) == 77 and not line[66:].strip():
                            line = line[:66]
                        fields, _ = split_record(line, [11, 55])
                        # Foreign IDs follow entity(5)+country(2)+sequence(4).
                        # They are excluded just like non-fiscal base records.
                        if re.fullmatch(r"[0-9]{5}[A-Z]{2}[0-9]{4}", fields[0]):
                            non_fiscal_names += 1
                            continue
                        if len(fields[0]) != 11 or not fields[0].isascii() or not fields[0].isdigit():
                            raise FormatError("Invalid debtor name")
                        batch.append(tuple(fields))
                        if len(batch) >= 10_000:
                            connection.executemany("INSERT OR REPLACE INTO names VALUES (?,?)", batch)
                            batch.clear()
                    except FormatError:
                        raise SourceError(f"Invalid BCRA name record at line {number}") from None
            connection.executemany("INSERT OR REPLACE INTO names VALUES (?,?)", batch)

        corrections = 0
        deleted = 0
        for kind, member in (("INFRET", "inf_ret.txt"), ("INFRETPA", "inf_retparc.txt")):
            with archives[kind].lines(member) as lines:
                for number, line in lines:
                    try:
                        record = rect_record(line)
                        if record is None or record[2] not in base_periods:
                            continue  # Only rectify months represented in the base publication.
                        identification, entity, date, situation, amount, name = record
                        if situation == 0 and amount == 0:
                            connection.execute(
                                "DELETE FROM debts WHERE identification=? AND entity=? AND period=?",
                                (identification, entity, date),
                            )
                            deleted += 1
                        else:
                            # Correction files only supply situation and total amount.
                            # Do not present old days/flags as newly verified information.
                            connection.execute(
                                INSERT + """ ON CONFLICT(identification,entity,period) DO UPDATE SET
                                situation=excluded.situation, amount_tenths=excluded.amount_tenths,
                                days=NULL, observation=NULL, refinancing=NULL, recategorization=NULL,
                                legal=NULL, technical=NULL, origin=excluded.origin""",
                                (identification, entity, date, situation, amount, *([None] * 6), kind),
                            )
                            if name:
                                connection.execute(
                                    "INSERT OR REPLACE INTO names VALUES (?,?)", (identification, name)
                                )
                        corrections += 1
                    except (FormatError, sqlite3.Error):
                        check_deadline(deadline)
                        raise SourceError(f"Invalid {kind} BCRA record at line {number}") from None
        final_rows = connection.execute("SELECT count(*) FROM debts").fetchone()[0]
        if final_rows < min_rows:
            raise SourceError("Rectified BCRA import is below the minimum row count")
        unknown_entities = connection.execute(
            "SELECT count(*) FROM debts d LEFT JOIN entities e ON e.code=d.entity WHERE e.code IS NULL"
        ).fetchone()[0]
        if unknown_entities:
            raise SourceError("BCRA snapshot references entities absent from the master")
        name_encoding_replacements = sum(
            connection.execute(
                "SELECT COALESCE(SUM(length(name)-length(replace(name,char(65533),''))),0) FROM " + table
            ).fetchone()[0]
            for table in ("entities", "names")
        )
        unrecognized_flag_rows = connection.execute(
            """SELECT count(*) FROM debts WHERE observation NOT IN (0,1,2)
               OR refinancing NOT IN (0,1,9) OR recategorization NOT IN (0,1)
               OR legal NOT IN (0,1,9) OR technical NOT IN (0,1,9)"""
        ).fetchone()[0]
        warnings = list(manifest.get("warnings", []))
        if unrecognized_flag_rows:
            warnings.append(
                f"{unrecognized_flag_rows} source rows have unrecognized flag codes; raw codes retained and derived values are null"
            )
        if name_encoding_replacements:
            warnings.append(
                f"Source names contain {name_encoding_replacements} undecodable Windows-1252 bytes shown as U+FFFD"
            )
        manifest = {
            **manifest, "warnings": warnings,
            "name_encoding_replacements": name_encoding_replacements,
            "excluded_non_fiscal_names": non_fiscal_names, "imported_at": timestamp(), "base_rows": rows,
            "rows": final_rows, "corrections": corrections, "deletions": deleted,
            "coverage": "latest_publication_file",
            "data_periods": sorted(base_periods, reverse=True),
            "unrecognized_flag_rows": unrecognized_flag_rows,
            "amount_unit": "thousands_of_ARS",
            "limitations": [
                "denominacion may be absent; no ARCA padron is downloaded",
                "fechaSit1 is not imported",
                "source code 9 means not applicable and is represented as null in boolean flags",
                "days and observations are null when a correction does not provide them",
            ],
        }
        connection.execute("INSERT INTO metadata VALUES (?)", (json.dumps(manifest),))
        connection.commit()
        if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise SourceError("BCRA database integrity check failed")
        return manifest
    except sqlite3.Error:
        check_deadline(deadline)
        raise SourceError("Unable to construct BCRA database") from None
    finally:
        connection.close()


def lookup(path: Path, identification: str) -> dict:
    with closing(connect_readonly(path)) as connection:
        manifest = json.loads(connection.execute("SELECT value FROM metadata").fetchone()[0])
        rows = connection.execute(
            """SELECT d.period,d.entity,e.name,d.situation,d.amount_tenths,d.days,d.observation,
                      d.refinancing,d.recategorization,d.legal,d.technical,d.origin
               FROM debts d JOIN entities e ON e.code=d.entity
               WHERE identification=? ORDER BY d.period DESC,d.entity""", (identification,)
        ).fetchall()
        name = connection.execute("SELECT name FROM names WHERE identification=?", (identification,)).fetchone()
    periods = {}
    for period, code, entity_name, situation, amount, days, observation, ref, recat, legal, technical, origin in rows:
        entities = periods.setdefault(period, [])
        entities.append({
            "codigoEntidad": code, "entidad": entity_name, "situacion": situation,
            "monto": amount / 10, "diasAtrasoPago": days, "fechaSit1": None,
            "enRevision": None if observation not in (0, 1, 2) else observation == 2,
            "procesoJud": None if observation not in (0, 1, 2) else observation == 1,
            "refinanciaciones": None if ref not in (0, 1) else bool(ref),
            "recategorizacionOblig": None if recat not in (0, 1) else bool(recat),
            "situacionJuridica": None if legal not in (0, 1) else bool(legal),
            "irrecDisposicionTecnica": None if technical not in (0, 1) else bool(technical),
            "codigosBanderasFuente": {
                "procesoJudicialRevision": observation, "refinanciaciones": ref,
                "recategorizacionOblig": recat, "situacionJuridica": legal,
                "irrecDisposicionTecnica": technical,
            },
            "archivoOrigen": origin,
        })
    return {
        "status": 200 if periods else 404,
        "results": {
            "identificacion": identification,
            "denominacion": name[0] if name else None,
            "periodos": [{"periodo": period, "entidades": entities} for period, entities in periods.items()],
        },
        "meta": {"source": "bcra_monthly_file_poc", **manifest},
    }


def read_manifest(path: Path) -> dict | None:
    if not path.exists():
        return None
    with closing(connect_readonly(path)) as connection:
        return json.loads(connection.execute("SELECT value FROM metadata").fetchone()[0])
