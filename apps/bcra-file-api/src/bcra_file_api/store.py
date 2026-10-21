from __future__ import annotations

from contextlib import closing
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3

from .formats import FormatError, base_record, rect_record, split_record
from .source import SourceError


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


def import_snapshot(path: Path, archives: dict, manifest: dict, min_rows: int) -> dict:
    connection = sqlite3.connect(path)
    try:
        connection.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;" + SCHEMA)
        period = manifest["period"]
        monthly = archives["DEUDORES"]
        rows = 0
        batch = []
        with monthly.lines("deudores.txt") as lines:
            for number, line in lines:
                try:
                    record = base_record(line)
                    if record is None:
                        continue
                    if record[2] != period:
                        raise FormatError("Base period differs from publication")
                    batch.append(record)
                    rows += 1
                    if len(batch) >= 10_000:
                        connection.executemany(INSERT, batch)
                        batch.clear()
                except (FormatError, sqlite3.Error):
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
                    raise SourceError(f"Invalid BCRA entity master at line {number}") from None
        if connection.execute("SELECT count(*) FROM entities").fetchone()[0] == 0:
            raise SourceError("Empty BCRA entity master")

        if "nomdeu.txt" in monthly.members:
            batch = []
            with monthly.lines("nomdeu.txt") as lines:
                for number, line in lines:
                    try:
                        fields, _ = split_record(line, [11, 55])
                        if len(fields[0]) != 11 or not fields[0].isdigit():
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
                        if record is None or record[2] != period:
                            continue  # Historical corrections do not belong to this monthly snapshot.
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
                        raise SourceError(f"Invalid {kind} BCRA record at line {number}") from None
        final_rows = connection.execute("SELECT count(*) FROM debts").fetchone()[0]
        if final_rows < min_rows:
            raise SourceError("Rectified BCRA import is below the minimum row count")
        unknown_entities = connection.execute(
            "SELECT count(*) FROM debts d LEFT JOIN entities e ON e.code=d.entity WHERE e.code IS NULL"
        ).fetchone()[0]
        if unknown_entities:
            raise SourceError("BCRA snapshot references entities absent from the master")
        manifest = {
            **manifest, "imported_at": timestamp(), "base_rows": rows,
            "rows": final_rows, "corrections": corrections, "deletions": deleted,
            "coverage": "latest_published_month",
            "amount_unit": "thousands_of_ARS",
            "limitations": [
                "denominacion may be absent; no ARCA padron is downloaded",
                "fechaSit1 is not imported",
                "days and observations are null when a correction does not provide them",
            ],
        }
        connection.execute("INSERT INTO metadata VALUES (?)", (json.dumps(manifest),))
        connection.commit()
        if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise SourceError("BCRA database integrity check failed")
        return manifest
    except sqlite3.Error:
        raise SourceError("Unable to construct BCRA database") from None
    finally:
        connection.close()


def lookup(path: Path, identification: str) -> dict:
    with closing(connect_readonly(path)) as connection:
        manifest = json.loads(connection.execute("SELECT value FROM metadata").fetchone()[0])
        rows = connection.execute(
            """SELECT d.entity,e.name,d.situation,d.amount_tenths,d.days,d.observation,
                      d.refinancing,d.recategorization,d.legal,d.technical,d.origin
               FROM debts d JOIN entities e ON e.code=d.entity
               WHERE identification=? ORDER BY d.entity""", (identification,)
        ).fetchall()
        name = connection.execute("SELECT name FROM names WHERE identification=?", (identification,)).fetchone()
    entities = []
    for code, entity_name, situation, amount, days, observation, ref, recat, legal, technical, origin in rows:
        entities.append({
            "codigoEntidad": code, "entidad": entity_name, "situacion": situation,
            "monto": amount / 10, "diasAtrasoPago": days, "fechaSit1": None,
            "enRevision": None if observation is None else observation == 2,
            "procesoJud": None if observation is None else observation == 1,
            "refinanciaciones": None if ref is None else bool(ref),
            "recategorizacionOblig": None if recat is None else bool(recat),
            "situacionJuridica": None if legal is None else bool(legal),
            "irrecDisposicionTecnica": None if technical is None else bool(technical),
            "archivoOrigen": origin,
        })
    return {
        "status": 200 if entities else 404,
        "results": {
            "identificacion": identification,
            "denominacion": name[0] if name else None,
            "periodos": [{"periodo": manifest["period"], "entidades": entities}] if entities else [],
        },
        "meta": {"source": "bcra_monthly_file_poc", **manifest},
    }


def read_manifest(path: Path) -> dict | None:
    if not path.exists():
        return None
    with closing(connect_readonly(path)) as connection:
        return json.loads(connection.execute("SELECT value FROM metadata").fetchone()[0])
