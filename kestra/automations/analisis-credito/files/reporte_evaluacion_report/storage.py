from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Sequence

from .core import DatasetMeta, MonthDataset, NovedadEvent, normalize_text

SCHEMA_VERSION = 1


class SQLiteDatasetStore:
    def __init__(self, path: Path):
        self.path = Path(path)

    def save_dataset(
        self,
        *,
        meta: DatasetMeta,
        months: Sequence[MonthDataset],
        replace: bool = False,
    ) -> Path:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists():
            if not replace:
                raise FileExistsError(
                    f"La base SQLite ya existe: {self.path}. Usar --replace-db o elegir otra ruta."
                )
            self.path.unlink()

        with sqlite3.connect(self.path) as conn:
            self._initialize(conn)
            self._write_meta(conn, meta)
            for month in months:
                self._write_month(conn, month)
            conn.commit()
        return self.path

    def load_dataset(self) -> tuple[DatasetMeta, List[MonthDataset]]:
        if not self.path.exists():
            raise FileNotFoundError(f"No existe la base SQLite: {self.path}")

        with sqlite3.connect(self.path) as conn:
            conn.row_factory = sqlite3.Row
            meta = self._load_meta(conn)
            months = []
            month_rows = conn.execute(
                """
                SELECT month_value, month_label, sample_seed
                FROM report_months
                ORDER BY month_value
                """
            ).fetchall()
            for month_row in month_rows:
                month_value = str(month_row["month_value"])
                months.append(
                    MonthDataset(
                        month_value=month_value,
                        month_label=str(month_row["month_label"]),
                        sample_seed=int(month_row["sample_seed"]),
                        month_events=self._load_events(conn, "month_events", month_value),
                        closed_solicitud_oids=self._load_closed_oids(conn, month_value),
                        history_events=self._load_events(conn, "historical_events", month_value),
                    )
                )
        return meta, months

    def _initialize(self, conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            PRAGMA foreign_keys = ON;

            CREATE TABLE dataset_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE report_months (
                month_value TEXT PRIMARY KEY,
                month_label TEXT NOT NULL,
                sample_seed TEXT NOT NULL,
                month_event_count INTEGER NOT NULL,
                closed_solicitudes_count INTEGER NOT NULL,
                historical_event_count INTEGER NOT NULL
            );

            CREATE TABLE closed_solicitudes (
                report_month TEXT NOT NULL,
                solicitud_oid INTEGER NOT NULL,
                PRIMARY KEY (report_month, solicitud_oid),
                FOREIGN KEY (report_month) REFERENCES report_months(month_value) ON DELETE CASCADE
            );

            CREATE TABLE month_events (
                report_month TEXT NOT NULL,
                event_id INTEGER NOT NULL,
                fecha TEXT NOT NULL,
                texto TEXT NOT NULL,
                creado_descripcion TEXT,
                created_at TEXT,
                usuario_evento TEXT,
                parsed_state TEXT,
                parsed_state_norm TEXT,
                solicitud_oid INTEGER NOT NULL,
                solicitud_socio_nro_raw INTEGER,
                solicitud_nro_socio_raw INTEGER,
                nro_socio INTEGER,
                linea_descripcion TEXT,
                solicitud_estado_descripcion TEXT,
                raw_payload TEXT,
                PRIMARY KEY (report_month, event_id),
                FOREIGN KEY (report_month) REFERENCES report_months(month_value) ON DELETE CASCADE
            );

            CREATE TABLE historical_events (
                report_month TEXT NOT NULL,
                event_id INTEGER NOT NULL,
                fecha TEXT NOT NULL,
                texto TEXT NOT NULL,
                creado_descripcion TEXT,
                created_at TEXT,
                usuario_evento TEXT,
                parsed_state TEXT,
                parsed_state_norm TEXT,
                solicitud_oid INTEGER NOT NULL,
                solicitud_socio_nro_raw INTEGER,
                solicitud_nro_socio_raw INTEGER,
                nro_socio INTEGER,
                linea_descripcion TEXT,
                solicitud_estado_descripcion TEXT,
                raw_payload TEXT,
                PRIMARY KEY (report_month, event_id),
                FOREIGN KEY (report_month) REFERENCES report_months(month_value) ON DELETE CASCADE
            );

            CREATE INDEX idx_month_events_solicitud
                ON month_events(report_month, solicitud_oid);

            CREATE INDEX idx_historical_events_solicitud
                ON historical_events(report_month, solicitud_oid);

            CREATE INDEX idx_historical_events_created_at
                ON historical_events(report_month, created_at);

            CREATE INDEX idx_historical_events_state
                ON historical_events(report_month, parsed_state_norm);

            CREATE VIEW vw_report_months AS
            SELECT
                month_value,
                month_label,
                sample_seed,
                month_event_count,
                closed_solicitudes_count,
                historical_event_count
            FROM report_months
            ORDER BY month_value;

            CREATE VIEW vw_historical_state_events AS
            SELECT *
            FROM historical_events
            WHERE parsed_state IS NOT NULL;
            """
        )

    def _write_meta(self, conn: sqlite3.Connection, meta: DatasetMeta) -> None:
        rows = [
            ("schema_version", str(SCHEMA_VERSION)),
            ("created_at", meta.created_at.isoformat()),
            ("effective_seed", str(meta.effective_seed)),
            ("base_url", meta.base_url),
            ("per_day_max", str(meta.per_day_max)),
            ("verify_ssl", "1" if meta.verify_ssl else "0"),
            ("month_values", ",".join(meta.month_values)),
        ]
        conn.executemany("INSERT INTO dataset_meta(key, value) VALUES(?, ?)", rows)

    def _write_month(self, conn: sqlite3.Connection, month: MonthDataset) -> None:
        conn.execute(
            """
            INSERT INTO report_months(
                month_value,
                month_label,
                sample_seed,
                month_event_count,
                closed_solicitudes_count,
                historical_event_count
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                month.month_value,
                month.month_label,
                str(month.sample_seed),
                len(month.month_events),
                len(month.closed_solicitud_oids),
                len(month.history_events),
            ),
        )
        conn.executemany(
            "INSERT INTO closed_solicitudes(report_month, solicitud_oid) VALUES(?, ?)",
            [(month.month_value, oid) for oid in month.closed_solicitud_oids],
        )
        self._insert_events(conn, "month_events", month.month_value, month.month_events)
        self._insert_events(conn, "historical_events", month.month_value, month.history_events)

    def _insert_events(
        self,
        conn: sqlite3.Connection,
        table_name: str,
        month_value: str,
        events: Sequence[NovedadEvent],
    ) -> None:
        conn.executemany(
            f"""
            INSERT INTO {table_name}(
                report_month,
                event_id,
                fecha,
                texto,
                creado_descripcion,
                created_at,
                usuario_evento,
                parsed_state,
                parsed_state_norm,
                solicitud_oid,
                solicitud_socio_nro_raw,
                solicitud_nro_socio_raw,
                nro_socio,
                linea_descripcion,
                solicitud_estado_descripcion,
                raw_payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [self._event_row(month_value, event) for event in events],
        )

    def _event_row(self, month_value: str, event: NovedadEvent) -> tuple[object, ...]:
        return (
            month_value,
            event.event_id,
            event.fecha,
            event.texto,
            event.creado_descripcion,
            event.created_at.isoformat() if event.created_at else None,
            event.usuario_evento,
            event.parsed_state,
            normalize_text(event.parsed_state) if event.parsed_state else None,
            event.solicitud_oid,
            event.solicitud_socio_nro_raw,
            event.solicitud_nro_socio_raw,
            event.nro_socio,
            event.linea_descripcion,
            event.solicitud_estado_descripcion,
            event.raw_payload,
        )

    def _load_meta(self, conn: sqlite3.Connection) -> DatasetMeta:
        rows = {
            str(row["key"]): str(row["value"])
            for row in conn.execute("SELECT key, value FROM dataset_meta")
        }
        return DatasetMeta(
            created_at=datetime.fromisoformat(rows["created_at"]),
            effective_seed=int(rows["effective_seed"]),
            base_url=rows["base_url"],
            per_day_max=int(rows["per_day_max"]),
            verify_ssl=rows["verify_ssl"] == "1",
            month_values=[value for value in rows["month_values"].split(",") if value],
        )

    def _load_closed_oids(self, conn: sqlite3.Connection, month_value: str) -> List[int]:
        rows = conn.execute(
            """
            SELECT solicitud_oid
            FROM closed_solicitudes
            WHERE report_month = ?
            ORDER BY solicitud_oid
            """,
            (month_value,),
        ).fetchall()
        return [int(row["solicitud_oid"]) for row in rows]

    def _load_events(
        self,
        conn: sqlite3.Connection,
        table_name: str,
        month_value: str,
    ) -> List[NovedadEvent]:
        rows = conn.execute(
            f"""
            SELECT
                event_id,
                fecha,
                texto,
                creado_descripcion,
                solicitud_oid,
                solicitud_socio_nro_raw,
                solicitud_nro_socio_raw,
                linea_descripcion,
                solicitud_estado_descripcion,
                created_at,
                parsed_state,
                usuario_evento,
                nro_socio,
                raw_payload
            FROM {table_name}
            WHERE report_month = ?
            ORDER BY event_id
            """,
            (month_value,),
        ).fetchall()
        return [self._row_to_event(row) for row in rows]

    def _row_to_event(self, row: sqlite3.Row) -> NovedadEvent:
        created_at = row["created_at"]
        return NovedadEvent(
            event_id=int(row["event_id"]),
            fecha=str(row["fecha"]),
            texto=row["texto"] or "",
            creado_descripcion=row["creado_descripcion"],
            solicitud_oid=int(row["solicitud_oid"]),
            solicitud_socio_nro_raw=row["solicitud_socio_nro_raw"],
            solicitud_nro_socio_raw=row["solicitud_nro_socio_raw"],
            linea_descripcion=row["linea_descripcion"],
            solicitud_estado_descripcion=row["solicitud_estado_descripcion"],
            created_at=datetime.fromisoformat(str(created_at)) if created_at else None,
            parsed_state=row["parsed_state"],
            usuario_evento=row["usuario_evento"],
            nro_socio=row["nro_socio"],
            raw_payload=row["raw_payload"],
        )
