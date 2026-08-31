from __future__ import annotations

import csv
import json
import mimetypes
import shutil
import sqlite3
import threading
import traceback
import urllib.parse
from contextlib import closing
from calendar import monthrange
from datetime import UTC, datetime
from decimal import Decimal
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from . import process


DEFAULT_DB_PATH = Path("data/panel_control.db")
DEFAULT_BASE_CONFIG = Path("config.full.json")
POLICIA_SUPERIOR = "HABERES DESCUENTO POLICIA CBA"
SUPERIOR_CAMPO = "Prestamo.LineaPrestamo.Superior.Descripcion"
LINEA_PRESTAMO_CAMPO = "Prestamo.LineaPrestamo.Descripcion"
DEFAULT_TASA_CLASSIFICATION = "SIN_GARANTIA_REAL"
ALLOWED_OUTPUT_FILES = {
    "PROVEEDORES.TXT",
    "IMPORTES.TXT",
    "TASA.TXT",
    "detalle.xml",
    "informacion.zip",
}
ALLOWED_CONTROL_FILES = {
    "reporte_control.json",
    "reporte_control.csv",
    "errores.csv",
    "prestamos_unicos.csv",
    "deudores_consolidados.csv",
    "deudores_por_superior.xlsx",
    "prestamos_tasa.csv",
    "exclusiones_manuales.csv",
}
CONFIG_FILE_NAME = "config.json"
APPLIED_CONFIG_FILE_NAME = "config_aplicada.json"
MANIFEST_FILE_NAME = "manifiesto_presentacion.json"
EXPECTED_ZIP_CONTENTS = [
    "detalle.xml",
    "YYYYMMDD/IMPORTES.TXT",
    "YYYYMMDD/PROVEEDORES.TXT",
    "YYYYMMDD/TASA.TXT",
]
TASA_CLASSIFICATIONS = {
    "SIN_DEFINIR",
    "SIN_GARANTIA_REAL",
    "CON_GARANTIA_REAL",
    "NO_APLICA",
}


def utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_key(value: Any) -> str:
    return process.normalize_text(value)


def ensure_linea_prestamo_campo(campos: str) -> str:
    parts = [part.strip() for part in str(campos or "").split(";") if part.strip()]
    if not parts or LINEA_PRESTAMO_CAMPO in parts:
        return ";".join(parts)
    if SUPERIOR_CAMPO not in parts:
        return ";".join(parts)
    insert_at = parts.index(SUPERIOR_CAMPO) + 1
    parts.insert(insert_at, LINEA_PRESTAMO_CAMPO)
    return ";".join(parts)


def month_to_cutoff(month: str) -> str:
    if not isinstance(month, str) or not month:
        raise ValueError("El mes debe tener formato YYYY-MM")
    parsed = datetime.strptime(month, "%Y-%m")
    last_day = monthrange(parsed.year, parsed.month)[1]
    return f"{parsed.year:04d}-{parsed.month:02d}-{last_day:02d}"


def expected_zip_contents_for_cutoff(cutoff: str) -> list[str]:
    folder = cutoff.replace("-", "") if cutoff else "YYYYMMDD"
    return [
        "detalle.xml",
        f"{folder}/IMPORTES.TXT",
        f"{folder}/PROVEEDORES.TXT",
        f"{folder}/TASA.TXT",
    ]


def dict_rows(connection: sqlite3.Connection, query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    cursor = connection.execute(query, params)
    return [dict(row) for row in cursor.fetchall()]


def init_db(db_path: Path = DEFAULT_DB_PATH, base_config_path: Path = DEFAULT_BASE_CONFIG) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    raw_config = (
        json.loads(base_config_path.read_text(encoding="utf-8"))
        if base_config_path.exists()
        else {}
    )
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS superiores (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              nombre_api_original TEXT NOT NULL DEFAULT '',
              nombre_normalizado TEXT NOT NULL UNIQUE,
              nombre_display TEXT NOT NULL,
              alias_usuario TEXT NOT NULL DEFAULT '',
              excluir INTEGER NOT NULL DEFAULT 0,
              situacion_01_hasta_66 INTEGER NOT NULL DEFAULT 0,
              clasificacion_tasa TEXT NOT NULL DEFAULT 'SIN_GARANTIA_REAL',
              activo INTEGER NOT NULL DEFAULT 1,
              notas TEXT NOT NULL DEFAULT '',
              cantidad_prestamos INTEGER NOT NULL DEFAULT 0,
              first_seen_at TEXT NOT NULL,
              last_seen_at TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT '',
              actualizado_en TEXT NOT NULL DEFAULT '',
              actualizado_por_panel INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS lineas_prestamo (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              superior_normalizado TEXT NOT NULL,
              linea_normalizada TEXT NOT NULL,
              superior_display TEXT NOT NULL DEFAULT '',
              linea_display TEXT NOT NULL,
              excluir INTEGER NOT NULL DEFAULT 0,
              cantidad_prestamos INTEGER NOT NULL DEFAULT 0,
              first_seen_at TEXT NOT NULL,
              last_seen_at TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT '',
              notas TEXT NOT NULL DEFAULT '',
              UNIQUE(superior_normalizado, linea_normalizada)
            );

            CREATE TABLE IF NOT EXISTS exclusiones_cuit (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              cuit TEXT NOT NULL UNIQUE,
              motivo TEXT NOT NULL DEFAULT '',
              activo INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS exclusiones_nro_cuenta (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              nro_cuenta TEXT NOT NULL UNIQUE,
              cuit_asociado TEXT NOT NULL DEFAULT '',
              motivo TEXT NOT NULL DEFAULT '',
              activo INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS presentaciones (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              mes TEXT NOT NULL,
              fecha_corte TEXT NOT NULL,
              tipo_presentacion TEXT NOT NULL,
              tasa_modo TEXT NOT NULL,
              tasa_otorgadas_sin_garantia_real INTEGER NOT NULL DEFAULT 1,
              tasa_manual TEXT NOT NULL,
              estado TEXT NOT NULL,
              resultado TEXT NOT NULL DEFAULT '',
              cantidad_filas_api INTEGER,
              filas_api INTEGER,
              cantidad_prestamos_unicos INTEGER,
              cantidad_prestamos_incluidos INTEGER,
              cantidad_deudores_informados INTEGER,
              deudores INTEGER,
              total_proveedores_miles INTEGER,
              total_importes_miles INTEGER,
              total_miles INTEGER,
              errores_count INTEGER NOT NULL DEFAULT 0,
              errores INTEGER NOT NULL DEFAULT 0,
              advertencias_count INTEGER NOT NULL DEFAULT 0,
              advertencias INTEGER NOT NULL DEFAULT 0,
              output_dir TEXT NOT NULL,
              control_dir TEXT NOT NULL,
              config_path TEXT NOT NULL DEFAULT '',
              ruta_config_aplicada TEXT NOT NULL DEFAULT '',
              ruta_manifest TEXT NOT NULL DEFAULT '',
              zip_path TEXT NOT NULL,
              ruta_zip TEXT NOT NULL DEFAULT '',
              error_message TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL DEFAULT '',
              started_at TEXT NOT NULL,
              finished_at TEXT
            );

            CREATE TABLE IF NOT EXISTS errores_ignorados (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              code TEXT NOT NULL,
              nro_cuenta TEXT NOT NULL DEFAULT '',
              cuit TEXT NOT NULL DEFAULT '',
              message TEXT NOT NULL DEFAULT '',
              motivo TEXT NOT NULL DEFAULT '',
              activo INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS errores_resoluciones (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              run_id INTEGER,
              tipo_error TEXT NOT NULL,
              nro_cuenta TEXT NOT NULL DEFAULT '',
              cuit TEXT NOT NULL DEFAULT '',
              accion TEXT NOT NULL,
              motivo TEXT NOT NULL,
              activo INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            """
        )
        migrate_schema(connection)
        seed_settings(connection, base_config_path, raw_config)
        seed_default_rules(connection)
        seed_config_lists(connection, raw_config)
        apply_product_tasa_defaults(connection)
        connection.commit()


def migrate_schema(connection: sqlite3.Connection) -> None:
    migrate_superiores_table(connection)
    migrate_lineas_prestamo_table(connection)
    migrate_exclusiones_table(
        connection,
        table_name="exclusiones_cuit",
        key_field="cuit",
        extra_columns="",
        extra_select="",
    )
    migrate_exclusiones_table(
        connection,
        table_name="exclusiones_nro_cuenta",
        key_field="nro_cuenta",
        extra_columns=", cuit_asociado TEXT NOT NULL DEFAULT ''",
        extra_select=", COALESCE(cuit_asociado, '')",
    )
    columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(presentaciones)").fetchall()
    }
    additions = {
        "tasa_otorgadas_sin_garantia_real": "INTEGER NOT NULL DEFAULT 1",
        "resultado": "TEXT NOT NULL DEFAULT ''",
        "filas_api": "INTEGER",
        "deudores": "INTEGER",
        "total_miles": "INTEGER",
        "errores": "INTEGER NOT NULL DEFAULT 0",
        "advertencias": "INTEGER NOT NULL DEFAULT 0",
        "config_path": "TEXT NOT NULL DEFAULT ''",
        "ruta_config_aplicada": "TEXT NOT NULL DEFAULT ''",
        "ruta_manifest": "TEXT NOT NULL DEFAULT ''",
        "ruta_zip": "TEXT NOT NULL DEFAULT ''",
        "created_at": "TEXT NOT NULL DEFAULT ''",
    }
    for column, definition in additions.items():
        if column not in columns:
            connection.execute(
                f"ALTER TABLE presentaciones ADD COLUMN {column} {definition}"
            )


def migrate_lineas_prestamo_table(connection: sqlite3.Connection) -> None:
    columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(lineas_prestamo)").fetchall()
    }
    additions = {
        "excluir": "INTEGER NOT NULL DEFAULT 0",
        "notas": "TEXT NOT NULL DEFAULT ''",
        "updated_at": "TEXT NOT NULL DEFAULT ''",
    }
    for column, definition in additions.items():
        if column not in columns:
            connection.execute(
                f"ALTER TABLE lineas_prestamo ADD COLUMN {column} {definition}"
            )


def migrate_superiores_table(connection: sqlite3.Connection) -> None:
    columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(superiores)").fetchall()
    }
    required = {
        "id",
        "nombre_api_original",
        "alias_usuario",
        "clasificacion_tasa",
        "updated_at",
        "actualizado_en",
        "actualizado_por_panel",
    }
    if required.issubset(columns):
        connection.execute("DROP TABLE IF EXISTS superiores_old")
        return
    connection.execute("ALTER TABLE superiores RENAME TO superiores_old")
    connection.execute(
        """
        CREATE TABLE superiores (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nombre_api_original TEXT NOT NULL DEFAULT '',
          nombre_normalizado TEXT NOT NULL UNIQUE,
          nombre_display TEXT NOT NULL,
          alias_usuario TEXT NOT NULL DEFAULT '',
          excluir INTEGER NOT NULL DEFAULT 0,
          situacion_01_hasta_66 INTEGER NOT NULL DEFAULT 0,
          clasificacion_tasa TEXT NOT NULL DEFAULT 'SIN_GARANTIA_REAL',
          activo INTEGER NOT NULL DEFAULT 1,
          notas TEXT NOT NULL DEFAULT '',
          cantidad_prestamos INTEGER NOT NULL DEFAULT 0,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT '',
          actualizado_en TEXT NOT NULL DEFAULT '',
          actualizado_por_panel INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    old_columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(superiores_old)").fetchall()
    }
    tasa_expr = f"'{DEFAULT_TASA_CLASSIFICATION}'"
    if {"tasa_sin_garantia_real", "tasa_con_garantia_real"}.issubset(old_columns):
        tasa_expr = (
            "CASE WHEN tasa_sin_garantia_real = 1 THEN 'SIN_GARANTIA_REAL' "
            "WHEN tasa_con_garantia_real = 1 THEN 'CON_GARANTIA_REAL' "
            f"ELSE '{DEFAULT_TASA_CLASSIFICATION}' END"
        )
    connection.execute(
        f"""
        INSERT INTO superiores (
          nombre_api_original, nombre_normalizado, nombre_display, alias_usuario,
          excluir, situacion_01_hasta_66, clasificacion_tasa, activo, notas,
          cantidad_prestamos, first_seen_at, last_seen_at, updated_at,
          actualizado_en, actualizado_por_panel
        )
        SELECT
          COALESCE(NULLIF(nombre_display, ''), nombre_normalizado),
          nombre_normalizado,
          COALESCE(NULLIF(nombre_display, ''), nombre_normalizado),
          '',
          COALESCE(excluir, 0),
          COALESCE(situacion_01_hasta_66, 0),
          {tasa_expr},
          COALESCE(activo, 1),
          COALESCE(notas, ''),
          COALESCE(cantidad_prestamos, 0),
          COALESCE(first_seen_at, ''),
          COALESCE(last_seen_at, ''),
          COALESCE(last_seen_at, ''),
          COALESCE(last_seen_at, ''),
          0
        FROM superiores_old
        """
    )
    connection.execute("DROP TABLE superiores_old")


def migrate_exclusiones_table(
    connection: sqlite3.Connection,
    *,
    table_name: str,
    key_field: str,
    extra_columns: str,
    extra_select: str,
) -> None:
    columns = {
        row["name"]
        for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    }
    if "id" in columns and ("cuit_asociado" in columns or table_name == "exclusiones_cuit"):
        connection.execute(f"DROP TABLE IF EXISTS {table_name}_old")
        return
    connection.execute(f"ALTER TABLE {table_name} RENAME TO {table_name}_old")
    select_extra = extra_select
    if table_name == "exclusiones_nro_cuenta" and "cuit_asociado" not in columns:
        select_extra = ", ''"
    connection.execute(
        f"""
        CREATE TABLE {table_name} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          {key_field} TEXT NOT NULL UNIQUE
          {extra_columns},
          motivo TEXT NOT NULL DEFAULT '',
          activo INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        f"""
        INSERT INTO {table_name}(
          {key_field}{', cuit_asociado' if table_name == 'exclusiones_nro_cuenta' else ''},
          motivo, activo, created_at, updated_at
        )
        SELECT {key_field}{select_extra},
               COALESCE(motivo, ''),
               COALESCE(activo, 1),
               COALESCE(created_at, ''),
               COALESCE(updated_at, '')
        FROM {table_name}_old
        """
    )
    connection.execute(f"DROP TABLE {table_name}_old")


def seed_settings(
    connection: sqlite3.Connection, base_config_path: Path, raw: dict[str, Any]
) -> None:
    defaults = {
        "base_config_path": str(base_config_path),
        "max": str(raw.get("max", 1000000)),
        "api_url": str(raw.get("api_url", process.API_URL)),
        "cmd": str(raw.get("cmd", process.DEFAULT_CMD)),
        "tipo": str(raw.get("tipo", process.DEFAULT_TIPO)),
        "campos": ensure_linea_prestamo_campo(
            str(raw.get("campos", process.DEFAULT_CAMPOS))
        ),
        "timeout_seconds": str(raw.get("timeout_seconds", 1800)),
        "retries": str(raw.get("retries", 3)),
        "backoff_seconds": str(raw.get("backoff_seconds", 5)),
        "verify_tls": json.dumps(bool(raw.get("verify_tls", True))),
        "nombre_zip": str(raw.get("nombre_zip", "informacion.zip")),
        "tasa_manual_default": latest_tasa_manual(connection)
        or str(raw.get("tasa", {}).get("tasa_promedio_manual", "000,00")),
    }
    for key, value in defaults.items():
        connection.execute(
            "INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)",
            (key, value),
        )
    current_campos = connection.execute(
        "SELECT value FROM settings WHERE key = 'campos'"
    ).fetchone()
    if current_campos:
        updated_campos = ensure_linea_prestamo_campo(str(current_campos[0]))
        if updated_campos != str(current_campos[0]):
            connection.execute(
                "UPDATE settings SET value = ? WHERE key = 'campos'",
                (updated_campos,),
            )
    meaningful_tasa = latest_tasa_manual(connection)
    current_tasa = connection.execute(
        "SELECT value FROM settings WHERE key = 'tasa_manual_default'"
    ).fetchone()
    if meaningful_tasa and (
        current_tasa is None or str(current_tasa[0]) in {"", "000,00"}
    ):
        connection.execute(
            """
            INSERT INTO settings(key, value) VALUES ('tasa_manual_default', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (meaningful_tasa,),
        )


def latest_tasa_manual(connection: sqlite3.Connection) -> str:
    row = connection.execute(
        """
        SELECT tasa_manual
        FROM presentaciones
        WHERE tasa_manual IS NOT NULL AND tasa_manual <> '' AND tasa_manual <> '000,00'
        ORDER BY id DESC
        LIMIT 1
        """
    ).fetchone()
    if row:
        return str(row[0])
    row = connection.execute(
        """
        SELECT tasa_manual
        FROM presentaciones
        WHERE tasa_manual IS NOT NULL AND tasa_manual <> ''
        ORDER BY id DESC
        LIMIT 1
        """
    ).fetchone()
    return str(row[0]) if row else ""


def remember_tasa_manual_default(db_path: Path, value: Any) -> None:
    tasa_manual = str(value or "").strip()
    if not process.validate_tasa_manual_value(tasa_manual):
        return
    with closing(sqlite3.connect(db_path)) as connection:
        connection.execute(
            """
            INSERT INTO settings(key, value) VALUES ('tasa_manual_default', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (tasa_manual,),
        )
        connection.commit()


def apply_product_tasa_defaults(connection: sqlite3.Connection) -> None:
    # En esta operatoria los productos no tienen garantia real.
    connection.execute(
        """
        UPDATE superiores
        SET clasificacion_tasa = ?
        WHERE clasificacion_tasa IN ('SIN_DEFINIR', 'CON_GARANTIA_REAL', '')
        """,
        (DEFAULT_TASA_CLASSIFICATION,),
    )


def seed_default_rules(connection: sqlite3.Connection) -> None:
    now = utc_now()
    normalized = normalize_key(POLICIA_SUPERIOR)
    connection.execute(
        """
        INSERT INTO superiores (
          nombre_api_original, nombre_normalizado, nombre_display,
          situacion_01_hasta_66, first_seen_at, last_seen_at,
          updated_at, actualizado_en
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(nombre_normalizado) DO UPDATE SET
          nombre_api_original = CASE
            WHEN nombre_api_original = '' THEN excluded.nombre_api_original
            ELSE nombre_api_original
          END,
          situacion_01_hasta_66 = 1,
          last_seen_at = excluded.last_seen_at,
          updated_at = excluded.updated_at,
          actualizado_en = excluded.actualizado_en
        """,
        (POLICIA_SUPERIOR, normalized, POLICIA_SUPERIOR, now, now, now, now),
    )


def upsert_superior_seed(
    connection: sqlite3.Connection,
    display: str,
    *,
    excluir: bool = False,
    situacion_01_hasta_66: bool = False,
) -> None:
    if not display:
        return
    now = utc_now()
    normalized = normalize_key(display)
    connection.execute(
        """
        INSERT INTO superiores (
          nombre_api_original, nombre_normalizado, nombre_display, excluir,
          situacion_01_hasta_66, first_seen_at, last_seen_at, updated_at,
          actualizado_en
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(nombre_normalizado) DO UPDATE SET
          nombre_api_original = CASE
            WHEN nombre_api_original = '' THEN excluded.nombre_api_original
            ELSE nombre_api_original
          END,
          nombre_display = excluded.nombre_display,
          excluir = CASE WHEN excluded.excluir = 1 THEN 1 ELSE excluir END,
          situacion_01_hasta_66 = CASE
            WHEN excluded.situacion_01_hasta_66 = 1 THEN 1
            ELSE situacion_01_hasta_66
          END,
          last_seen_at = excluded.last_seen_at,
          updated_at = excluded.updated_at,
          actualizado_en = excluded.actualizado_en
        """,
        (
            display,
            normalized,
            display,
            int(excluir),
            int(situacion_01_hasta_66),
            now,
            now,
            now,
            now,
        ),
    )


def seed_config_lists(connection: sqlite3.Connection, raw: dict[str, Any]) -> None:
    for display in raw.get("lineas_excluidas", []):
        upsert_superior_seed(connection, str(display), excluir=True)
    for display in raw.get("lineas_situacion_01_hasta_66_dias", []):
        upsert_superior_seed(connection, str(display), situacion_01_hasta_66=True)

    now = utc_now()
    for cuit in raw.get("cuits_excluidos", []):
        normalized = process.normalize_cuit_value(cuit)
        if normalized:
            connection.execute(
                """
                INSERT OR IGNORE INTO exclusiones_cuit(
                  cuit, motivo, activo, created_at, updated_at
                ) VALUES (?, 'Migrado desde configuración', 1, ?, ?)
                """,
                (normalized, now, now),
            )
    for nro_cuenta in raw.get("nro_cuentas_excluidas", []):
        normalized = process.normalize_nro_cuenta(nro_cuenta)
        if normalized:
            connection.execute(
                """
                INSERT OR IGNORE INTO exclusiones_nro_cuenta(
                  nro_cuenta, motivo, activo, created_at, updated_at
                ) VALUES (?, 'Migrado desde configuración', 1, ?, ?)
                """,
                (normalized, now, now),
            )


def sync_superiores_from_csv(db_path: Path, csv_path: Path) -> int:
    if not csv_path.exists():
        return 0
    counts: dict[str, tuple[str, int]] = {}
    line_counts: dict[tuple[str, str], tuple[str, str, int]] = {}
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter=";")
        for row in reader:
            display = (row.get("LineaDescripcion") or "").strip()
            if not display:
                continue
            normalized = normalize_key(display)
            current_display, current_count = counts.get(normalized, (display, 0))
            counts[normalized] = (current_display, current_count + 1)
            line_display = (row.get("LineaPrestamoDescripcion") or "").strip()
            if line_display:
                line_normalized = normalize_key(line_display)
                key = (normalized, line_normalized)
                current_superior, current_line, current_line_count = line_counts.get(
                    key,
                    (display, line_display, 0),
                )
                line_counts[key] = (
                    current_superior,
                    current_line,
                    current_line_count + 1,
                )

    now = utc_now()
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        seed_default_rules(connection)
        for normalized, (display, count) in counts.items():
            connection.execute(
                """
                INSERT INTO superiores (
                  nombre_api_original, nombre_normalizado, nombre_display,
                  cantidad_prestamos, first_seen_at, last_seen_at, updated_at,
                  actualizado_en
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(nombre_normalizado) DO UPDATE SET
                  nombre_api_original = CASE
                    WHEN nombre_api_original = '' THEN excluded.nombre_api_original
                    ELSE nombre_api_original
                  END,
                  nombre_display = excluded.nombre_display,
                  cantidad_prestamos = excluded.cantidad_prestamos,
                  activo = 1,
                  last_seen_at = excluded.last_seen_at,
                  updated_at = excluded.updated_at,
                  actualizado_en = excluded.actualizado_en
                """,
                (display, normalized, display, count, now, now, now, now),
            )
        for (superior_normalized, line_normalized), (
            superior_display,
            line_display,
            count,
        ) in line_counts.items():
            connection.execute(
                """
                INSERT INTO lineas_prestamo (
                  superior_normalizado, linea_normalizada, superior_display,
                  linea_display, cantidad_prestamos, first_seen_at, last_seen_at,
                  updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(superior_normalizado, linea_normalizada) DO UPDATE SET
                  superior_display = excluded.superior_display,
                  linea_display = excluded.linea_display,
                  cantidad_prestamos = excluded.cantidad_prestamos,
                  last_seen_at = excluded.last_seen_at,
                  updated_at = excluded.updated_at
                """,
                (
                    superior_normalized,
                    line_normalized,
                    superior_display,
                    line_display,
                    count,
                    now,
                    now,
                    now,
                ),
            )
        connection.commit()
    return len(counts)


def get_settings(connection: sqlite3.Connection) -> dict[str, str]:
    rows = dict_rows(connection, "SELECT key, value FROM settings")
    return {row["key"]: row["value"] for row in rows}


def process_config_from_settings(
    connection: sqlite3.Connection,
    base_config_path: Path,
) -> process.ProcessConfig:
    if not base_config_path.exists():
        base_config_path = Path("config.example.json")
    config = process.load_config(base_config_path)
    settings = get_settings(connection)
    config.max = int(settings.get("max", config.max))
    config.api_url = settings.get("api_url", config.api_url)
    config.cmd = settings.get("cmd", config.cmd)
    config.tipo = settings.get("tipo", config.tipo)
    config.campos = ensure_linea_prestamo_campo(settings.get("campos", config.campos))
    config.timeout_seconds = int(settings.get("timeout_seconds", config.timeout_seconds))
    config.retries = int(settings.get("retries", config.retries))
    config.backoff_seconds = Decimal(str(settings.get("backoff_seconds", config.backoff_seconds)))
    config.verify_tls = json.loads(settings.get("verify_tls", json.dumps(config.verify_tls)))
    return config


def get_superiores(db_path: Path) -> list[dict[str, Any]]:
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        return dict_rows(
            connection,
            """
            SELECT *,
                   (
                     SELECT COUNT(*)
                     FROM lineas_prestamo lp
                     WHERE lp.superior_normalizado = superiores.nombre_normalizado
                   ) AS cantidad_lineas,
                   (
                     SELECT COUNT(*)
                     FROM lineas_prestamo lp
                     WHERE lp.superior_normalizado = superiores.nombre_normalizado
                       AND lp.excluir = 1
                   ) AS cantidad_lineas_excluidas,
                   CASE WHEN clasificacion_tasa = 'SIN_GARANTIA_REAL' THEN 1 ELSE 0 END
                     AS tasa_sin_garantia_real,
                   CASE WHEN clasificacion_tasa = 'CON_GARANTIA_REAL' THEN 1 ELSE 0 END
                     AS tasa_con_garantia_real,
                   CASE
                     WHEN alias_usuario <> '' THEN alias_usuario
                     ELSE nombre_display
                   END AS nombre_visible
            FROM superiores
            ORDER BY cantidad_prestamos DESC, nombre_display COLLATE NOCASE
            """,
        )


def get_panel_totals(db_path: Path) -> dict[str, int]:
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            """
            SELECT COUNT(*) AS superiores_total,
                   COALESCE(SUM(cantidad_prestamos), 0) AS creditos_por_superiores
            FROM superiores
            """
        ).fetchone()
        line_row = connection.execute(
            """
            SELECT COUNT(*) AS lineas_total,
                   COALESCE(SUM(CASE WHEN excluir = 1 THEN 1 ELSE 0 END), 0)
                     AS lineas_excluidas
            FROM lineas_prestamo
            """
        ).fetchone()
        return {
            "superiores_total": int(row["superiores_total"] or 0),
            "creditos_por_superiores": int(row["creditos_por_superiores"] or 0),
            "lineas_prestamo_total": int(line_row["lineas_total"] or 0),
            "lineas_prestamo_excluidas": int(line_row["lineas_excluidas"] or 0),
        }


def update_superior(db_path: Path, payload: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_key(payload.get("nombre_normalizado") or payload.get("nombre_display"))
    if not normalized:
        raise ValueError("Falta nombre_normalizado")
    now = utc_now()
    clasificacion_tasa = str(payload.get("clasificacion_tasa") or "").strip().upper()
    if not clasificacion_tasa:
        if payload.get("tasa_sin_garantia_real"):
            clasificacion_tasa = "SIN_GARANTIA_REAL"
        elif payload.get("tasa_con_garantia_real"):
            clasificacion_tasa = "CON_GARANTIA_REAL"
        else:
            clasificacion_tasa = DEFAULT_TASA_CLASSIFICATION
    if clasificacion_tasa not in TASA_CLASSIFICATIONS:
        raise ValueError("Clasificación TASA inválida")
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        existing = connection.execute(
            "SELECT * FROM superiores WHERE nombre_normalizado = ?",
            (normalized,),
        ).fetchone()
        if existing is None:
            connection.execute(
                """
                INSERT INTO superiores (
                  nombre_api_original, nombre_normalizado, nombre_display,
                  first_seen_at, last_seen_at, updated_at, actualizado_en,
                  actualizado_por_panel
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
                """,
                (
                    str(payload.get("nombre_display") or normalized),
                    normalized,
                    str(payload.get("nombre_display") or normalized),
                    now,
                    now,
                    now,
                    now,
                ),
            )
        fields = {
            "excluir": int(bool(payload.get("excluir", False))),
            "situacion_01_hasta_66": int(bool(payload.get("situacion_01_hasta_66", False))),
            "clasificacion_tasa": clasificacion_tasa,
            "activo": int(bool(payload.get("activo", True))),
            "notas": str(payload.get("notas", "")),
            "alias_usuario": str(payload.get("alias_usuario", "")),
            "last_seen_at": now,
        }
        connection.execute(
            """
            UPDATE superiores
            SET excluir = ?, situacion_01_hasta_66 = ?, clasificacion_tasa = ?,
                activo = ?, notas = ?, alias_usuario = ?, last_seen_at = ?,
                updated_at = ?, actualizado_en = ?, actualizado_por_panel = 1
            WHERE nombre_normalizado = ?
            """,
            (
                fields["excluir"],
                fields["situacion_01_hasta_66"],
                fields["clasificacion_tasa"],
                fields["activo"],
                fields["notas"],
                fields["alias_usuario"],
                fields["last_seen_at"],
                now,
                now,
                normalized,
            ),
        )
        connection.commit()
        return dict(connection.execute(
            """
            SELECT *,
                   CASE WHEN clasificacion_tasa = 'SIN_GARANTIA_REAL' THEN 1 ELSE 0 END
                     AS tasa_sin_garantia_real,
                   CASE WHEN clasificacion_tasa = 'CON_GARANTIA_REAL' THEN 1 ELSE 0 END
                     AS tasa_con_garantia_real,
                   CASE
                     WHEN alias_usuario <> '' THEN alias_usuario
                     ELSE nombre_display
                   END AS nombre_visible
            FROM superiores
            WHERE nombre_normalizado = ?
            """,
            (normalized,),
        ).fetchone())


def get_superior_detail(db_path: Path, superior_id: int) -> dict[str, Any] | None:
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            """
            SELECT *,
                   CASE WHEN alias_usuario <> '' THEN alias_usuario ELSE nombre_display END
                     AS nombre_visible
            FROM superiores
            WHERE id = ?
            """,
            (superior_id,),
        ).fetchone()
        if row is None:
            return None
        detail = dict(row)
        lineas_excluidas = dict_rows(
            connection,
            """
            SELECT superior_display, linea_display
            FROM lineas_prestamo
            WHERE superior_normalizado = ? AND excluir = 1
            ORDER BY linea_display COLLATE NOCASE
            """,
            (detail["nombre_normalizado"],),
        )
        config_impact = {
            "lineas_excluidas": [detail["nombre_api_original"]]
            if detail["excluir"]
            else [],
            "lineas_prestamo_excluidas": [
                {"superior": row["superior_display"], "linea": row["linea_display"]}
                for row in lineas_excluidas
            ],
            "lineas_situacion_01_hasta_66_dias": [detail["nombre_api_original"]]
            if detail["situacion_01_hasta_66"]
            else [],
            "tasa": detail["clasificacion_tasa"],
        }
        detail["config_generada"] = config_impact
        return detail


def get_lineas_prestamo_for_superior(
    db_path: Path,
    superior_id: int,
) -> list[dict[str, Any]]:
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        superior = connection.execute(
            "SELECT nombre_normalizado FROM superiores WHERE id = ?",
            (superior_id,),
        ).fetchone()
        if superior is None:
            raise ValueError("Superior no encontrado")
        return dict_rows(
            connection,
            """
            SELECT *
            FROM lineas_prestamo
            WHERE superior_normalizado = ?
            ORDER BY cantidad_prestamos DESC, linea_display COLLATE NOCASE
            """,
            (superior["nombre_normalizado"],),
        )


def escape_api_literal(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


def sync_lineas_prestamo_from_api(
    db_path: Path,
    base_config_path: Path,
    superior_id: int,
) -> dict[str, Any]:
    detail = get_superior_detail(db_path, superior_id)
    if detail is None:
        raise ValueError("Superior no encontrado")
    superior_display = str(
        detail.get("nombre_api_original")
        or detail.get("nombre_display")
        or detail.get("nombre_normalizado")
        or ""
    ).strip()
    if not superior_display:
        raise ValueError("El superior no tiene nombre API para consultar")

    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        config = process_config_from_settings(connection, base_config_path)

    payload = {
        "cmd": (
            f"({config.cmd}) and "
            f"{SUPERIOR_CAMPO} = '{escape_api_literal(superior_display)}'"
        ),
        "tipo": config.tipo,
        "campos": ensure_linea_prestamo_campo(config.campos),
        "max": config.max,
    }
    rows = process.fetch_api_payload(config, payload)
    controls = process.ControlContext()
    parsed = process.parse_rows(rows, controls)
    loans = process.build_unique_loans(parsed, controls)
    superior_normalized = normalize_key(superior_display)
    matching_loans = [
        loan for loan in loans.values()
        if normalize_key(loan.linea_descripcion) == superior_normalized
    ]

    line_counts: dict[str, tuple[str, int]] = {}
    for loan in matching_loans:
        line_display = str(loan.linea_prestamo_descripcion or "").strip()
        if not line_display:
            continue
        line_normalized = normalize_key(line_display)
        current_display, current_count = line_counts.get(line_normalized, (line_display, 0))
        line_counts[line_normalized] = (current_display, current_count + 1)

    now = utc_now()
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        for line_normalized, (line_display, count) in line_counts.items():
            connection.execute(
                """
                INSERT INTO lineas_prestamo (
                  superior_normalizado, linea_normalizada, superior_display,
                  linea_display, cantidad_prestamos, first_seen_at, last_seen_at,
                  updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(superior_normalizado, linea_normalizada) DO UPDATE SET
                  superior_display = excluded.superior_display,
                  linea_display = excluded.linea_display,
                  cantidad_prestamos = excluded.cantidad_prestamos,
                  last_seen_at = excluded.last_seen_at,
                  updated_at = excluded.updated_at
                """,
                (
                    superior_normalized,
                    line_normalized,
                    superior_display,
                    line_display,
                    count,
                    now,
                    now,
                    now,
                ),
            )
        connection.execute(
            """
            UPDATE superiores
            SET cantidad_prestamos = ?, last_seen_at = ?, updated_at = ?,
                actualizado_en = ?
            WHERE id = ?
            """,
            (len(matching_loans), now, now, now, superior_id),
        )
        connection.commit()

    return {
        "superior_id": superior_id,
        "superior": superior_display,
        "filas_api": len(rows),
        "prestamos_unicos": len(loans),
        "prestamos_superior": len(matching_loans),
        "lineas_detectadas": len(line_counts),
        "posible_truncamiento": len(rows) == config.max,
        "errores": [issue.to_dict() for issue in controls.errors],
        "advertencias": [issue.to_dict() for issue in controls.warnings],
        "lineas": get_lineas_prestamo_for_superior(db_path, superior_id),
    }


def update_linea_prestamo(db_path: Path, payload: dict[str, Any]) -> dict[str, Any]:
    line_id = int(payload.get("id") or 0)
    if line_id <= 0:
        raise ValueError("Falta id de linea")
    now = utc_now()
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        existing = connection.execute(
            "SELECT * FROM lineas_prestamo WHERE id = ?",
            (line_id,),
        ).fetchone()
        if existing is None:
            raise ValueError("Linea de prestamo no encontrada")
        connection.execute(
            """
            UPDATE lineas_prestamo
            SET excluir = ?, notas = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                int(bool(payload.get("excluir", False))),
                str(payload.get("notas", "")),
                now,
                line_id,
            ),
        )
        connection.commit()
        return dict(
            connection.execute(
                "SELECT * FROM lineas_prestamo WHERE id = ?",
                (line_id,),
            ).fetchone()
        )


def update_superior_alias(db_path: Path, superior_id: int, alias: str) -> dict[str, Any]:
    alias = str(alias or "").strip()
    if not alias:
        raise ValueError("alias_usuario no puede estar vacío")
    now = utc_now()
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute(
            """
            UPDATE superiores
            SET alias_usuario = ?, updated_at = ?, actualizado_en = ?,
                actualizado_por_panel = 1
            WHERE id = ?
            """,
            (alias, now, now, superior_id),
        )
        connection.commit()
    detail = get_superior_detail(db_path, superior_id)
    if detail is None:
        raise ValueError("Superior no encontrado")
    return detail


def get_exclusiones(db_path: Path) -> dict[str, list[dict[str, Any]]]:
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        return {
            "cuits": dict_rows(connection, "SELECT * FROM exclusiones_cuit ORDER BY cuit"),
            "nro_cuentas": dict_rows(
                connection,
                "SELECT * FROM exclusiones_nro_cuenta ORDER BY nro_cuenta",
            ),
        }


def update_exclusion(db_path: Path, payload: dict[str, Any]) -> dict[str, Any]:
    tipo = str(payload.get("tipo", "")).lower()
    valor = str(payload.get("valor", "")).strip()
    motivo = str(payload.get("motivo", "")).strip()
    activo = int(bool(payload.get("activo", True)))
    if tipo not in {"cuit", "nro_cuenta"}:
        raise ValueError("tipo debe ser cuit o nro_cuenta")
    if not valor:
        raise ValueError("valor es obligatorio")
    if activo and not motivo:
        raise ValueError("motivo es obligatorio")
    if tipo == "cuit":
        valor = process.normalize_cuit_value(valor)
        if not (valor.isdigit() and len(valor) == 11):
            raise ValueError("CUIT debe ser numerico de 11 digitos")
        table = "exclusiones_cuit"
        key = "cuit"
        insert_columns = f"{key}, motivo, activo, created_at, updated_at"
        placeholders = "?, ?, ?, ?, ?"
        cuit_asociado = ""
        extra_update = ""
    else:
        valor = process.normalize_nro_cuenta(valor)
        if not valor:
            raise ValueError("NroCuenta es obligatorio")
        table = "exclusiones_nro_cuenta"
        key = "nro_cuenta"
        insert_columns = f"{key}, cuit_asociado, motivo, activo, created_at, updated_at"
        placeholders = "?, ?, ?, ?, ?, ?"
        cuit_asociado = process.normalize_cuit_value(payload.get("cuit_asociado"))
        extra_update = ", cuit_asociado = excluded.cuit_asociado"
    now = utc_now()
    if tipo == "cuit":
        values: tuple[Any, ...] = (valor, motivo, activo, now, now)
    else:
        values = (valor, cuit_asociado, motivo, activo, now, now)
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute(
            f"""
            INSERT INTO {table}({insert_columns})
            VALUES ({placeholders})
            ON CONFLICT({key}) DO UPDATE SET
              motivo = excluded.motivo,
              activo = excluded.activo,
              updated_at = excluded.updated_at
              {extra_update}
            """,
            values,
        )
        connection.commit()
        return dict(connection.execute(
            f"SELECT * FROM {table} WHERE {key} = ?",
            (valor,),
        ).fetchone())


def issue_matches_ignore(issue: dict[str, Any], rule: dict[str, Any]) -> bool:
    if int(rule.get("activo", 0)) != 1:
        return False
    if str(issue.get("code") or "") != str(rule.get("code") or ""):
        return False
    rule_nro = str(rule.get("nro_cuenta") or "")
    rule_cuit = str(rule.get("cuit") or "")
    issue_nro = str(issue.get("nro_cuenta") or "")
    issue_cuit = str(issue.get("cuit") or "")
    return (not rule_nro or rule_nro == issue_nro) and (
        not rule_cuit or rule_cuit == issue_cuit
    )


def split_ignored_errors(
    errors: list[dict[str, Any]], ignored_rules: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    visible: list[dict[str, Any]] = []
    ignored: list[dict[str, Any]] = []
    for issue in errors:
        matching_rule = next(
            (rule for rule in ignored_rules if issue_matches_ignore(issue, rule)),
            None,
        )
        if matching_rule:
            enriched = dict(issue)
            enriched["ignored_by"] = matching_rule
            ignored.append(enriched)
        else:
            visible.append(issue)
    return visible, ignored


def get_ignored_error_rules(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    return dict_rows(
        connection,
        "SELECT * FROM errores_ignorados WHERE activo = 1 ORDER BY id DESC",
    )


def visible_error_count(connection: sqlite3.Connection, report: dict[str, Any]) -> int:
    visible, _ = split_ignored_errors(
        report.get("errores", []),
        get_ignored_error_rules(connection),
    )
    return len(visible)


def get_current_errors(db_path: Path, workspace: Path) -> dict[str, Any]:
    report = read_json_if_exists(workspace / "control" / "reporte_control.json") or {}
    errors = report.get("errores", [])
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        ignored_rules = get_ignored_error_rules(connection)
    visible, ignored = split_ignored_errors(errors, ignored_rules)
    return {
        "visibles": visible,
        "ignorados": ignored,
        "reglas": ignored_rules,
        "total_original": len(errors),
    }


def ignore_error(db_path: Path, payload: dict[str, Any]) -> dict[str, Any]:
    code = str(payload.get("code") or "").strip()
    if not code:
        raise ValueError("code es obligatorio")
    nro_cuenta = process.normalize_nro_cuenta(payload.get("nro_cuenta"))
    cuit = process.normalize_cuit_value(payload.get("cuit"))
    message = str(payload.get("message") or "").strip()
    motivo = str(payload.get("motivo") or "Ignorado desde panel").strip()
    now = utc_now()
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        cursor = connection.execute(
            """
            INSERT INTO errores_ignorados(
              code, nro_cuenta, cuit, message, motivo, activo, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (code, nro_cuenta, cuit, message, motivo, now, now),
        )
        connection.commit()
        return dict(connection.execute(
            "SELECT * FROM errores_ignorados WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone())


def update_ignored_error(db_path: Path, payload: dict[str, Any]) -> dict[str, Any]:
    rule_id = int(payload.get("id"))
    activo = int(bool(payload.get("activo", True)))
    now = utc_now()
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute(
            """
            UPDATE errores_ignorados
            SET activo = ?, updated_at = ?
            WHERE id = ?
            """,
            (activo, now, rule_id),
        )
        connection.commit()
        row = connection.execute(
            "SELECT * FROM errores_ignorados WHERE id = ?",
            (rule_id,),
        ).fetchone()
        if row is None:
            raise ValueError("Regla de error ignorado no encontrada")
        return dict(row)


def enrich_control_error(issue: dict[str, Any]) -> dict[str, Any]:
    code = str(issue.get("code") or issue.get("tipo_error") or "")
    enriched = dict(issue)
    bloqueantes = {
        "POSSIBLE_TRUNCATION",
        "MISSING_INFORMACION_ZIP",
        "INVALID_ZIP",
        "INVALID_ZIP_CONTENTS",
        "GLOBAL_AMOUNT_MISMATCH",
        "AMOUNT_MISMATCH_BY_CUIT",
        "MISSING_TASA_TXT",
        "INVALID_DETALLE_XML",
    }
    if code in bloqueantes:
        enriched.update(
            {
                "severidad": "Bloqueante",
                "impacto": "No permite considerar definitivo el ZIP final.",
                "accion_sugerida": "Corregir configuracion o datos y reejecutar.",
                "acciones_disponibles": ["MARCAR_REVISADO"],
            }
        )
    elif code == "INVALID_LOAN_FOR_OUTPUT":
        enriched.update(
            {
                "severidad": "Revisar",
                "impacto": "El prestamo queda fuera de la salida por datos esenciales incompletos.",
                "accion_sugerida": "Excluir NroCuenta o revisar la base.",
                "acciones_disponibles": ["EXCLUIR_NRO_CUENTA", "MARCAR_REVISADO"],
            }
        )
    elif code == "INCONSISTENT_DEBTOR_NAME":
        enriched.update(
            {
                "severidad": "Revisar",
                "impacto": "Puede afectar la denominacion consolidada del deudor.",
                "accion_sugerida": "Excluir CUIT, revisar base o marcar revisado.",
                "acciones_disponibles": ["EXCLUIR_CUIT", "MARCAR_REVISADO"],
            }
        )
    elif code == "INVALID_DATE":
        enriched.update(
            {
                "severidad": "Revisar",
                "impacto": "Si el error trae CUIT, conviene excluir ese CUIT y reejecutar.",
                "accion_sugerida": "Excluir CUIT y revisar luego en reportes.",
                "acciones_disponibles": (
                    ["EXCLUIR_CUIT", "EXCLUIR_NRO_CUENTA", "IGNORADO_CON_JUSTIFICACION", "MARCAR_REVISADO"]
                    if issue.get("cuit")
                    else ["EXCLUIR_NRO_CUENTA", "IGNORADO_CON_JUSTIFICACION", "MARCAR_REVISADO"]
                ),
            }
        )
    else:
        enriched.update(
            {
                "severidad": "Revisar",
                "impacto": "Requiere control antes de considerar definitiva la presentacion.",
                "accion_sugerida": "Revisar detalle y reejecutar si cambia la configuracion.",
                "acciones_disponibles": ["MARCAR_REVISADO"],
            }
        )
    return enriched


def get_run_errors(db_path: Path, run_id: int) -> dict[str, Any]:
    presentation = get_presentation(db_path, run_id)
    if not presentation:
        raise ValueError("Corrida no encontrada")
    report = read_json_if_exists(Path(presentation["control_dir"]) / "reporte_control.json") or {}
    errors = [enrich_control_error(issue) for issue in report.get("errores", [])]
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        ignored_rules = get_ignored_error_rules(connection)
        resoluciones = dict_rows(
            connection,
            """
            SELECT * FROM errores_resoluciones
            WHERE run_id = ? OR run_id IS NULL
            ORDER BY id DESC
            """,
            (run_id,),
        )
    visible, ignored = split_ignored_errors(errors, ignored_rules)
    return {
        "visibles": visible,
        "ignorados": ignored,
        "resoluciones": resoluciones,
        "total_original": len(errors),
    }


def resolve_error(db_path: Path, payload: dict[str, Any]) -> dict[str, Any]:
    action = process.normalize_text(payload.get("accion") or payload.get("action") or "")
    motivo = str(payload.get("motivo") or "").strip()
    if not action:
        raise ValueError("accion es obligatoria")
    if not motivo:
        raise ValueError("motivo es obligatorio")
    run_id_raw = payload.get("run_id")
    run_id = int(run_id_raw) if run_id_raw not in (None, "") else None
    tipo_error = str(payload.get("tipo_error") or payload.get("code") or "").strip()
    nro_cuenta = process.normalize_nro_cuenta(payload.get("nro_cuenta"))
    cuit = process.normalize_cuit_value(payload.get("cuit"))

    if action == "EXCLUIR_CUIT":
        if not cuit:
            raise ValueError("CUIT es obligatorio para excluir CUIT")
        update_exclusion(
            db_path,
            {"tipo": "cuit", "valor": cuit, "motivo": motivo, "activo": True},
        )
    elif action == "EXCLUIR_NRO_CUENTA":
        if not nro_cuenta:
            raise ValueError("NroCuenta es obligatorio para excluir prestamo")
        update_exclusion(
            db_path,
            {
                "tipo": "nro_cuenta",
                "valor": nro_cuenta,
                "cuit_asociado": cuit,
                "motivo": motivo,
                "activo": True,
            },
        )
    elif action == "IGNORADO_CON_JUSTIFICACION":
        ignore_error(
            db_path,
            {
                "code": tipo_error,
                "nro_cuenta": nro_cuenta,
                "cuit": cuit,
                "message": payload.get("message", ""),
                "motivo": motivo,
            },
        )
    elif action != "MARCAR_REVISADO":
        raise ValueError("accion no reconocida")

    now = utc_now()
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        cursor = connection.execute(
            """
            INSERT INTO errores_resoluciones(
              run_id, tipo_error, nro_cuenta, cuit, accion, motivo, activo, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
            """,
            (run_id, tipo_error, nro_cuenta, cuit, action, motivo, now),
        )
        connection.commit()
        return dict(connection.execute(
            "SELECT * FROM errores_resoluciones WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone())


def active_list(connection: sqlite3.Connection, table: str, field: str) -> list[str]:
    rows = dict_rows(
        connection,
        f"SELECT {field} FROM {table} WHERE activo = 1 ORDER BY {field}",
    )
    return [str(row[field]) for row in rows]


def build_config_json(
    db_path: Path,
    base_config_path: Path,
    *,
    month: str,
    output_dir: Path,
    control_dir: Path,
    tipo_presentacion: str = "NORMAL",
    tasa_modo: str = "MANUAL",
    tasa_otorgadas: int = 1,
    tasa_manual: str = "000,00",
) -> dict[str, Any]:
    if not base_config_path.exists():
        base_config_path = Path("config.example.json")
    raw = json.loads(base_config_path.read_text(encoding="utf-8"))
    cutoff = month_to_cutoff(month)

    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        settings = get_settings(connection)
        superiores = dict_rows(
            connection,
            "SELECT * FROM superiores WHERE activo = 1",
        )
        lineas_prestamo_excluidas = dict_rows(
            connection,
            """
            SELECT superior_display, linea_display
            FROM lineas_prestamo
            WHERE excluir = 1
            ORDER BY superior_display COLLATE NOCASE, linea_display COLLATE NOCASE
            """,
        )
        raw["max"] = int(settings.get("max", raw.get("max", 1000000)))
        raw["api_url"] = settings.get("api_url", raw.get("api_url", process.API_URL))
        raw["cmd"] = settings.get("cmd", raw.get("cmd", process.DEFAULT_CMD))
        raw["tipo"] = settings.get("tipo", raw.get("tipo", process.DEFAULT_TIPO))
        raw["campos"] = ensure_linea_prestamo_campo(
            settings.get("campos", raw.get("campos", process.DEFAULT_CAMPOS))
        )
        raw["timeout_seconds"] = int(
            settings.get("timeout_seconds", raw.get("timeout_seconds", 1800))
        )
        raw["retries"] = int(settings.get("retries", raw.get("retries", 3)))
        raw["backoff_seconds"] = int(
            settings.get("backoff_seconds", raw.get("backoff_seconds", 5))
        )
        raw["verify_tls"] = json.loads(settings.get("verify_tls", "true"))
        raw["nombre_zip"] = settings.get("nombre_zip", raw.get("nombre_zip", "informacion.zip"))

        raw["fecha_corte"] = cutoff
        raw["output_dir"] = str(output_dir)
        raw["control_dir"] = str(control_dir)
        raw["tipo_presentacion"] = process.normalize_text(tipo_presentacion or "NORMAL")
        raw["lineas_excluidas"] = [
            row["nombre_api_original"] or row["nombre_display"]
            for row in superiores
            if int(row["excluir"]) == 1
        ]
        raw["lineas_prestamo_excluidas"] = [
            {"superior": row["superior_display"], "linea": row["linea_display"]}
            for row in lineas_prestamo_excluidas
        ]
        raw["lineas_situacion_01_hasta_66_dias"] = [
            row["nombre_api_original"] or row["nombre_display"]
            for row in superiores
            if int(row["situacion_01_hasta_66"]) == 1
        ]
        raw["cuits_excluidos"] = active_list(connection, "exclusiones_cuit", "cuit")
        raw["nro_cuentas_excluidas"] = active_list(
            connection, "exclusiones_nro_cuenta", "nro_cuenta"
        )

        tasa = dict(raw.get("tasa", {}))
        tasa["modo"] = process.normalize_text(tasa_modo or "MANUAL")
        tasa["otorgadas_sin_garantia_real_mes"] = int(tasa_otorgadas)
        tasa["tasa_promedio_manual"] = tasa_manual or "000,00"
        tasa["lineas_sin_garantia_real"] = [
            row["nombre_api_original"] or row["nombre_display"]
            for row in superiores
            if row["clasificacion_tasa"] == "SIN_GARANTIA_REAL"
        ]
        tasa["lineas_con_garantia_real"] = [
            row["nombre_api_original"] or row["nombre_display"]
            for row in superiores
            if row["clasificacion_tasa"] == "CON_GARANTIA_REAL"
        ]
        raw["tasa"] = tasa

    return raw


def save_current_config(
    db_path: Path,
    base_config_path: Path,
    workspace: Path,
    payload: dict[str, Any],
) -> dict[str, Any]:
    month = str(payload.get("mes") or datetime.now().strftime("%Y-%m"))
    tipo_presentacion = process.normalize_text(payload.get("tipo_presentacion", "NORMAL"))
    tasa_modo = process.normalize_text(payload.get("tasa_modo", "MANUAL"))
    tasa_otorgadas = 1
    tasa_manual = str(payload.get("tasa_promedio_manual", "000,00"))
    config_json = build_config_json(
        db_path,
        base_config_path,
        month=month,
        output_dir=workspace / "output",
        control_dir=workspace / "control",
        tipo_presentacion=tipo_presentacion,
        tasa_modo=tasa_modo,
        tasa_otorgadas=tasa_otorgadas,
        tasa_manual=tasa_manual,
    )
    target = workspace / "data" / "config_guardada.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(config_json, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    remember_tasa_manual_default(db_path, tasa_manual)
    return {"path": str(target), "config": config_json}


def validate_panel_config(
    db_path: Path,
    base_config_path: Path,
    workspace: Path,
    payload: dict[str, Any],
) -> dict[str, Any]:
    errors: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    month = str(payload.get("mes") or "").strip()
    cutoff = ""
    if not month:
        errors.append({"code": "MES_REQUERIDO", "message": "Debe seleccionar un mes."})
    else:
        try:
            cutoff = month_to_cutoff(month)
        except ValueError as exc:
            errors.append({"code": "MES_INVALIDO", "message": str(exc)})

    tasa_otorgadas = 1
    tasa_manual = str(payload.get("tasa_promedio_manual", "000,00"))
    tasa_preview = f"1;{tasa_manual}"
    if not process.validate_tasa_manual_value(tasa_manual):
        errors.append(
            {
                "code": "TASA_MANUAL_INVALIDA",
                "message": "La tasa manual debe tener formato EEE,DD con coma decimal.",
            }
        )

    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        settings = get_settings(connection)
        superiores = dict_rows(connection, "SELECT * FROM superiores WHERE activo = 1")
        lineas_prestamo_excluidas = dict_rows(
            connection,
            "SELECT * FROM lineas_prestamo WHERE excluir = 1",
        )
        exclusiones_cuit = active_list(connection, "exclusiones_cuit", "cuit")
        exclusiones_cuenta = active_list(
            connection, "exclusiones_nro_cuenta", "nro_cuenta"
        )
        previous_runs = dict_rows(
            connection,
            "SELECT id, estado, started_at FROM presentaciones WHERE mes = ? ORDER BY id DESC",
            (month,),
        ) if month else []

    max_value = int(settings.get("max", 0) or 0)
    min_api_max = int(settings.get("min_api_max", 1000000) or 1000000)
    if max_value < min_api_max:
        errors.append(
            {
                "code": "MAX_API_INVALIDO",
                "message": f"max debe ser al menos {min_api_max}.",
            }
        )
    nombre_zip = settings.get("nombre_zip", "informacion.zip")
    if nombre_zip != "informacion.zip":
        errors.append(
            {
                "code": "NOMBRE_ZIP_INVALIDO",
                "message": "El ZIP final debe llamarse informacion.zip.",
            }
        )

    sin_clasificar = [
        row for row in superiores if row["clasificacion_tasa"] == "SIN_DEFINIR"
    ]
    excluidos = [row for row in superiores if int(row["excluir"]) == 1]
    regla_66 = [row for row in superiores if int(row["situacion_01_hasta_66"]) == 1]
    if sin_clasificar:
        warnings.append(
            {
                "code": "SUPERIORES_SIN_CLASIFICACION_TASA",
                "message": f"Hay {len(sin_clasificar)} superiores sin clasificación TASA.",
            }
        )
    if str(payload.get("tasa_modo", "MANUAL")).upper() == "MANUAL":
        warnings.append(
            {"code": "TASA_MANUAL", "message": "TASA está configurada en modo manual."}
        )
    if exclusiones_cuit or exclusiones_cuenta or lineas_prestamo_excluidas:
        warnings.append(
            {
                "code": "EXCLUSIONES_ACTIVAS",
                "message": (
                    f"Hay {len(exclusiones_cuit)} CUIT y "
                    f"{len(exclusiones_cuenta)} NroCuenta y "
                    f"{len(lineas_prestamo_excluidas)} lineas de prestamo excluidas."
                ),
            }
        )
    if previous_runs:
        warnings.append(
            {
                "code": "MES_CON_CORRIDAS_PREVIAS",
                "message": f"El mes ya tiene {len(previous_runs)} corrida(s) previa(s).",
            }
        )

    summary = {
        "mes": month,
        "fecha_corte": cutoff,
        "tipo_presentacion": process.normalize_text(
            payload.get("tipo_presentacion", "NORMAL")
        ),
        "tasa_modo": process.normalize_text(payload.get("tasa_modo", "MANUAL")),
        "tasa_txt_esperado": tasa_preview,
        "superiores_totales": len(superiores),
        "superiores_excluidos": len(excluidos),
        "superiores_01_hasta_66": len(regla_66),
        "superiores_sin_clasificacion_tasa": len(sin_clasificar),
        "lineas_prestamo_excluidas": len(lineas_prestamo_excluidas),
        "cuits_excluidos_activos": len(exclusiones_cuit),
        "nro_cuentas_excluidas_activas": len(exclusiones_cuenta),
        "max_api_configurado": max_value,
        "nombre_zip_final": nombre_zip,
        "archivos_esperados_zip": expected_zip_contents_for_cutoff(cutoff),
        "corridas_previas_mes": len(previous_runs),
    }
    status = (
        "errores"
        if errors
        else ("advertencias" if warnings else "lista")
    )
    return {
        "status": status,
        "ejecutable": not errors,
        "errores": errors,
        "advertencias": warnings,
        "resumen": summary,
    }


def write_dicts_csv(path: Path, rows: list[dict[str, Any]], headers: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers, delimiter=";")
        writer.writeheader()
        for row in rows:
            writer.writerow({header: row.get(header, "") for header in headers})


def write_run_snapshots(
    db_path: Path,
    run_root: Path,
    run_id: int,
    config_json: dict[str, Any],
    prevalidation: dict[str, Any],
) -> dict[str, Path]:
    now = utc_now()
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        superiores = dict_rows(
            connection,
            """
            SELECT id, nombre_api_original, nombre_normalizado, nombre_display,
                   alias_usuario, excluir, situacion_01_hasta_66,
                   clasificacion_tasa, notas, activo, cantidad_prestamos,
                   first_seen_at, last_seen_at, updated_at
            FROM superiores
            ORDER BY nombre_display
            """,
        )
        cuits = dict_rows(
            connection,
            "SELECT id, cuit, motivo, activo, created_at, updated_at FROM exclusiones_cuit ORDER BY cuit",
        )
        cuentas = dict_rows(
            connection,
            """
            SELECT id, nro_cuenta, cuit_asociado, motivo, activo, created_at, updated_at
            FROM exclusiones_nro_cuenta ORDER BY nro_cuenta
            """,
        )
        lineas_prestamo = dict_rows(
            connection,
            """
            SELECT id, superior_display, superior_normalizado, linea_display,
                   linea_normalizada, excluir, cantidad_prestamos, notas,
                   first_seen_at, last_seen_at, updated_at
            FROM lineas_prestamo
            ORDER BY superior_display COLLATE NOCASE, linea_display COLLATE NOCASE
            """,
        )

    config_path = run_root / APPLIED_CONFIG_FILE_NAME
    config_path.write_text(
        json.dumps(config_json, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    prevalidation_path = run_root / "prevalidacion.json"
    prevalidation_path.write_text(
        json.dumps(prevalidation, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_dicts_csv(
        run_root / "snapshot_superiores.csv",
        superiores,
        [
            "id",
            "nombre_api_original",
            "nombre_normalizado",
            "nombre_display",
            "alias_usuario",
            "excluir",
            "situacion_01_hasta_66",
            "clasificacion_tasa",
            "notas",
            "activo",
            "cantidad_prestamos",
            "first_seen_at",
            "last_seen_at",
            "updated_at",
        ],
    )
    write_dicts_csv(
        run_root / "snapshot_exclusiones_cuit.csv",
        cuits,
        ["id", "cuit", "motivo", "activo", "created_at", "updated_at"],
    )
    write_dicts_csv(
        run_root / "snapshot_exclusiones_nro_cuenta.csv",
        cuentas,
        [
            "id",
            "nro_cuenta",
            "cuit_asociado",
            "motivo",
            "activo",
            "created_at",
            "updated_at",
        ],
    )
    write_dicts_csv(
        run_root / "snapshot_lineas_prestamo.csv",
        lineas_prestamo,
        [
            "id",
            "superior_display",
            "superior_normalizado",
            "linea_display",
            "linea_normalizada",
            "excluir",
            "cantidad_prestamos",
            "notas",
            "first_seen_at",
            "last_seen_at",
            "updated_at",
        ],
    )
    resumen = [
        f"Run ID: {run_id}",
        f"Mes: {prevalidation['resumen'].get('mes')}",
        f"Fecha de corte: {prevalidation['resumen'].get('fecha_corte')}",
        f"Tipo de presentación: {prevalidation['resumen'].get('tipo_presentacion')}",
        f"TASA configurada: {prevalidation['resumen'].get('tasa_txt_esperado')}",
        f"Superiores excluidos: {prevalidation['resumen'].get('superiores_excluidos')}",
        f"Lineas de prestamo excluidas: {prevalidation['resumen'].get('lineas_prestamo_excluidas')}",
        f"Superiores 01 hasta 66: {prevalidation['resumen'].get('superiores_01_hasta_66')}",
        f"CUIT excluidos: {prevalidation['resumen'].get('cuits_excluidos_activos')}",
        f"NroCuenta excluidas: {prevalidation['resumen'].get('nro_cuentas_excluidas_activas')}",
        f"Max API: {prevalidation['resumen'].get('max_api_configurado')}",
        f"Nombre ZIP final: {prevalidation['resumen'].get('nombre_zip_final')}",
        f"Snapshot generado: {now}",
    ]
    (run_root / "config_aplicada_resumen.txt").write_text(
        "\n".join(resumen) + "\n",
        encoding="utf-8",
    )
    manifest_path = run_root / MANIFEST_FILE_NAME
    manifest = build_manifest(
        run_id=run_id,
        config_json=config_json,
        run_root=run_root,
        estado="running",
        report={},
        errors=[],
        warnings=prevalidation.get("advertencias", []),
    )
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {
        "config": config_path,
        "prevalidation": prevalidation_path,
        "manifest": manifest_path,
    }


def build_manifest(
    *,
    run_id: int,
    config_json: dict[str, Any],
    run_root: Path,
    estado: str,
    report: dict[str, Any],
    errors: list[Any],
    warnings: list[Any],
) -> dict[str, Any]:
    zip_path = run_root / "output" / "informacion.zip"
    zip_info: dict[str, Any] = {"path": str(zip_path), "exists": zip_path.exists()}
    if zip_path.exists():
        zip_info["size_bytes"] = zip_path.stat().st_size
    return {
        "run_id": run_id,
        "mes": config_json.get("fecha_corte", "")[:7],
        "fecha_corte": config_json.get("fecha_corte"),
        "tipo_presentacion": config_json.get("tipo_presentacion"),
        "estado": estado,
        "zip_final": zip_info,
        "archivos_esperados_zip": expected_zip_contents_for_cutoff(
            str(config_json.get("fecha_corte") or "")
        ),
        "rutas_output": str(run_root / "output"),
        "rutas_control": str(run_root / "control"),
        "cantidad_deudores": report.get("cantidad_deudores_informados"),
        "total_miles": report.get("total_proveedores_miles"),
        "errores": errors,
        "advertencias": warnings,
        "updated_at": utc_now(),
    }


def create_presentation(
    db_path: Path,
    *,
    month: str,
    tipo_presentacion: str,
    tasa_modo: str,
    tasa_otorgadas: int,
    tasa_manual: str,
    output_dir: Path,
    control_dir: Path,
    config_path: Path,
    zip_path: Path,
) -> int:
    now = utc_now()
    with closing(sqlite3.connect(db_path)) as connection:
        cursor = connection.execute(
            """
            INSERT INTO presentaciones (
              mes, fecha_corte, tipo_presentacion, tasa_modo, tasa_manual, estado,
              tasa_otorgadas_sin_garantia_real, output_dir, control_dir,
              config_path, ruta_config_aplicada, ruta_manifest, zip_path,
              ruta_zip, created_at, started_at
            ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                month,
                month_to_cutoff(month),
                tipo_presentacion,
                tasa_modo,
                tasa_manual,
                tasa_otorgadas,
                str(output_dir),
                str(control_dir),
                str(config_path),
                str(config_path),
                str(config_path.parent / MANIFEST_FILE_NAME),
                str(zip_path),
                str(zip_path),
                now,
                now,
            ),
        )
        connection.commit()
        return int(cursor.lastrowid)


def update_presentation_from_report(
    db_path: Path,
    run_id: int,
    *,
    estado: str,
    report: dict[str, Any] | None = None,
    error_message: str = "",
) -> None:
    report = report or {}
    now = utc_now()
    with closing(sqlite3.connect(db_path)) as connection:
        connection.execute(
            """
            UPDATE presentaciones
            SET estado = ?,
                resultado = ?,
                cantidad_filas_api = ?,
                filas_api = ?,
                cantidad_prestamos_unicos = ?,
                cantidad_prestamos_incluidos = ?,
                cantidad_deudores_informados = ?,
                deudores = ?,
                total_proveedores_miles = ?,
                total_importes_miles = ?,
                total_miles = ?,
                errores_count = ?,
                errores = ?,
                advertencias_count = ?,
                advertencias = ?,
                error_message = ?,
                finished_at = ?
            WHERE id = ?
            """,
            (
                estado,
                classify_run_result(estado, report),
                report.get("cantidad_filas_api"),
                report.get("cantidad_filas_api"),
                report.get("cantidad_prestamos_unicos"),
                report.get("cantidad_prestamos_incluidos"),
                report.get("cantidad_deudores_informados"),
                report.get("cantidad_deudores_informados"),
                report.get("total_proveedores_miles"),
                report.get("total_importes_miles"),
                report.get("total_proveedores_miles"),
                visible_error_count(connection, report),
                visible_error_count(connection, report),
                len(report.get("advertencias", [])),
                len(report.get("advertencias", [])),
                error_message,
                now,
                run_id,
            ),
        )
        connection.commit()


def classify_run_result(estado: str, report: dict[str, Any]) -> str:
    if estado == "error":
        return "Fallida"
    if report.get("advertencia_posible_truncamiento"):
        return "No definitiva"
    if report.get("errores"):
        return "Con errores"
    if report.get("advertencias"):
        return "Con advertencias"
    if estado == "success":
        return "Lista para presentar"
    return "Ejecutando"


def get_presentations(db_path: Path, limit: int = 50) -> list[dict[str, Any]]:
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        return dict_rows(
            connection,
            """
            SELECT * FROM presentaciones
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        )


def get_presentation(db_path: Path, run_id: int) -> dict[str, Any] | None:
    with closing(sqlite3.connect(db_path)) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            "SELECT * FROM presentaciones WHERE id = ?",
            (run_id,),
        ).fetchone()
        return dict(row) if row else None


def delete_presentation(
    db_path: Path,
    run_id: int,
    *,
    workspace: Path,
    coordinator: Any = None,
) -> dict[str, Any]:
    presentation = get_presentation(db_path, run_id)
    if not presentation:
        raise ValueError("Corrida no encontrada")
    if presentation.get("estado") == "running" or (
        coordinator is not None and coordinator.active_run_id == run_id
    ):
        raise RuntimeError("No se puede borrar una corrida en ejecucion")

    workspace = Path(workspace).resolve()
    runs_root = (workspace / "runs").resolve()
    run_root = Path(presentation["output_dir"]).parent.resolve()
    deleted_files = False
    try:
        run_root.relative_to(runs_root)
        if run_root != runs_root and run_root.exists():
            shutil.rmtree(run_root)
            deleted_files = True
    except ValueError:
        deleted_files = False

    with closing(sqlite3.connect(db_path)) as connection:
        connection.execute("DELETE FROM errores_resoluciones WHERE run_id = ?", (run_id,))
        connection.execute("DELETE FROM presentaciones WHERE id = ?", (run_id,))
        connection.commit()

    return {
        "deleted": True,
        "run_id": run_id,
        "deleted_files": deleted_files,
        "run_root": str(run_root),
    }


def read_json_if_exists(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def copy_latest_run_outputs(output_dir: Path, control_dir: Path, workspace: Path) -> None:
    latest_output = workspace / "output"
    latest_control = workspace / "control"
    latest_output.mkdir(parents=True, exist_ok=True)
    latest_control.mkdir(parents=True, exist_ok=True)
    for source in output_dir.glob("*"):
        if source.is_file():
            shutil.copy2(source, latest_output / source.name)
    for source in control_dir.glob("*"):
        if source.is_file():
            shutil.copy2(source, latest_control / source.name)


class RunCoordinator:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.active_run_id: int | None = None

    def reserve(self, run_id: int) -> bool:
        with self._lock:
            if self.active_run_id is not None:
                return False
            self.active_run_id = run_id
            return True

    def release(self, run_id: int) -> None:
        with self._lock:
            if self.active_run_id == run_id:
                self.active_run_id = None

    def state(self) -> dict[str, Any]:
        with self._lock:
            return {
                "active": self.active_run_id is not None,
                "run_id": self.active_run_id,
            }


def run_presentation_job(
    *,
    run_id: int,
    db_path: Path,
    base_config_path: Path,
    workspace: Path,
    month: str,
    timestamp: str,
    tipo_presentacion: str,
    tasa_modo: str,
    tasa_otorgadas: int,
    tasa_manual: str,
    coordinator: RunCoordinator,
) -> None:
    run_root = workspace / "runs" / month / timestamp
    output_dir = run_root / "output"
    control_dir = run_root / "control"
    config_path = run_root / APPLIED_CONFIG_FILE_NAME
    config_json: dict[str, Any] = {}
    prevalidation: dict[str, Any] = {}
    try:
        run_root.mkdir(parents=True, exist_ok=True)
        output_dir.mkdir(parents=True, exist_ok=True)
        control_dir.mkdir(parents=True, exist_ok=True)
        prevalidation = validate_panel_config(
            db_path,
            base_config_path,
            workspace,
            {
                "mes": month,
                "tipo_presentacion": tipo_presentacion,
                "tasa_modo": tasa_modo,
                "tasa_otorgadas_sin_garantia_real_mes": tasa_otorgadas,
                "tasa_promedio_manual": tasa_manual,
            },
        )
        if not prevalidation["ejecutable"]:
            raise ValueError(
                "Configuracion invalida: "
                + "; ".join(error["message"] for error in prevalidation["errores"])
            )
        config_json = build_config_json(
            db_path,
            base_config_path,
            month=month,
            output_dir=output_dir,
            control_dir=control_dir,
            tipo_presentacion=tipo_presentacion,
            tasa_modo=tasa_modo,
            tasa_otorgadas=tasa_otorgadas,
            tasa_manual=tasa_manual,
        )
        snapshot_paths = write_run_snapshots(
            db_path,
            run_root,
            run_id,
            config_json,
            prevalidation,
        )
        config_path = snapshot_paths["config"]
        config = process.load_config(config_path)
        process.run(config)
        report = read_json_if_exists(control_dir / "reporte_control.json") or {}
        sync_superiores_from_csv(db_path, control_dir / "prestamos_unicos.csv")
        copy_latest_run_outputs(output_dir, control_dir, workspace)
        update_presentation_from_report(db_path, run_id, estado="success", report=report)
        manifest = build_manifest(
            run_id=run_id,
            config_json=config_json,
            run_root=run_root,
            estado="success",
            report=report,
            errors=report.get("errores", []),
            warnings=report.get("advertencias", []),
        )
        (run_root / MANIFEST_FILE_NAME).write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as exc:
        error_text = f"{exc}\n{traceback.format_exc()}"
        report = read_json_if_exists(control_dir / "reporte_control.json") or {}
        update_presentation_from_report(
            db_path,
            run_id,
            estado="error",
            report=report,
            error_message=error_text,
        )
        try:
            manifest = build_manifest(
                run_id=run_id,
                config_json=config_json or {"fecha_corte": month_to_cutoff(month)},
                run_root=run_root,
                estado="error",
                report=report,
                errors=report.get("errores", []) or [{"message": str(exc)}],
                warnings=(prevalidation or {}).get("advertencias", []),
            )
            (run_root / MANIFEST_FILE_NAME).write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception:
            pass
    finally:
        coordinator.release(run_id)


def start_presentation(
    db_path: Path,
    base_config_path: Path,
    workspace: Path,
    payload: dict[str, Any],
    coordinator: RunCoordinator,
) -> dict[str, Any]:
    validation = validate_panel_config(db_path, base_config_path, workspace, payload)
    if not validation["ejecutable"]:
        raise ValueError(json.dumps(validation, ensure_ascii=False))
    remember_tasa_manual_default(db_path, payload.get("tasa_promedio_manual"))
    month = str(payload.get("mes") or datetime.now().strftime("%Y-%m"))
    month_to_cutoff(month)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    tipo_presentacion = process.normalize_text(payload.get("tipo_presentacion", "NORMAL"))
    tasa_modo = process.normalize_text(payload.get("tasa_modo", "MANUAL"))
    tasa_otorgadas = 1
    tasa_manual = str(payload.get("tasa_promedio_manual", "000,00"))
    run_root = workspace / "runs" / month / timestamp
    output_dir = run_root / "output"
    control_dir = run_root / "control"
    config_path = run_root / APPLIED_CONFIG_FILE_NAME
    zip_path = output_dir / "informacion.zip"
    run_id = create_presentation(
        db_path,
        month=month,
        tipo_presentacion=tipo_presentacion,
        tasa_modo=tasa_modo,
        tasa_otorgadas=tasa_otorgadas,
        tasa_manual=tasa_manual,
        output_dir=output_dir,
        control_dir=control_dir,
        config_path=config_path,
        zip_path=zip_path,
    )
    if not coordinator.reserve(run_id):
        update_presentation_from_report(
            db_path,
            run_id,
            estado="error",
            error_message="Ya hay una presentación en ejecución",
        )
        raise RuntimeError("Ya hay una presentación en ejecución")

    thread = threading.Thread(
        target=run_presentation_job,
        kwargs={
            "run_id": run_id,
            "db_path": db_path,
            "base_config_path": base_config_path,
            "workspace": workspace,
            "month": month,
            "timestamp": timestamp,
            "tipo_presentacion": tipo_presentacion,
            "tasa_modo": tasa_modo,
            "tasa_otorgadas": tasa_otorgadas,
            "tasa_manual": tasa_manual,
            "coordinator": coordinator,
        },
        daemon=True,
    )
    thread.start()
    return {"id": run_id, "estado": "running", "mes": month}


PANEL_HTML = r"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BCRA PNFC</title>
  <style>
    :root {
      --bg: #f6f7f9;
      --panel: #ffffff;
      --line: #d9dee7;
      --text: #1f2937;
      --muted: #64748b;
      --accent: #155e75;
      --danger: #b91c1c;
      --ok: #166534;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Segoe UI, Arial, sans-serif;
      font-size: 14px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 22px;
      background: #ffffff;
      border-bottom: 1px solid var(--line);
    }
    h1 { font-size: 20px; margin: 0; }
    main { padding: 18px 22px 36px; display: grid; gap: 16px; }
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 14px;
    }
    h2 { font-size: 16px; margin: 0 0 12px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 12px;
      align-items: end;
    }
    label { display: grid; gap: 5px; font-size: 12px; color: var(--muted); }
    input, select, textarea {
      width: 100%;
      min-height: 34px;
      border: 1px solid var(--line);
      border-radius: 5px;
      padding: 7px 9px;
      background: #fff;
      color: var(--text);
      font: inherit;
    }
    textarea { min-height: 34px; resize: vertical; }
    button {
      min-height: 34px;
      border: 1px solid var(--accent);
      border-radius: 5px;
      background: var(--accent);
      color: #fff;
      padding: 7px 11px;
      cursor: pointer;
      font: inherit;
    }
    button.secondary { background: #fff; color: var(--accent); }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .status { font-size: 13px; color: var(--muted); }
    .status strong { color: var(--text); }
    table { width: 100%; border-collapse: collapse; }
    th, td {
      text-align: left;
      border-bottom: 1px solid var(--line);
      padding: 7px;
      vertical-align: middle;
    }
    th { font-size: 12px; color: var(--muted); font-weight: 600; }
    td.number { text-align: right; font-variant-numeric: tabular-nums; }
    .table-wrap { max-height: 430px; overflow: auto; border: 1px solid var(--line); border-radius: 5px; }
    .pill {
      display: inline-block;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 12px;
      border: 1px solid var(--line);
      color: var(--muted);
      background: #fff;
    }
    .pill.success { color: var(--ok); border-color: #bbf7d0; background: #f0fdf4; }
    .pill.error { color: var(--danger); border-color: #fecaca; background: #fef2f2; }
    .links a { display: inline-block; margin: 0 8px 4px 0; color: var(--accent); }
    .muted { color: var(--muted); }
    .danger { color: var(--danger); }
    @media (max-width: 720px) {
      header { align-items: flex-start; gap: 8px; flex-direction: column; }
      main { padding: 12px; }
      th, td { padding: 6px 4px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>BCRA Central de Deudores PNFC</h1>
    <div class="status" id="state">Cargando...</div>
  </header>
  <main>
    <section>
      <h2>Presentación</h2>
      <div class="grid">
        <label>Mes
          <input id="mes" type="month">
        </label>
        <label>Tipo
          <select id="tipo">
            <option>NORMAL</option>
            <option>RECTIFICATIVA</option>
          </select>
        </label>
        <label>TASA
          <select id="tasaModo">
            <option>MANUAL</option>
          </select>
        </label>
        <label>Otorgadas sin garantía real
          <select id="tasaOtorgadas">
            <option value="0">0</option>
            <option value="1">1</option>
          </select>
        </label>
        <label>Tasa manual
          <input id="tasaManual" value="000,00" pattern="[0-9]{3},[0-9]{2}">
        </label>
        <button id="runBtn" onclick="startRun()">Ejecutar</button>
        <button class="secondary" onclick="saveConfig()">Guardar configuración</button>
      </div>
      <div id="savedConfig" class="status" style="margin-top:10px;"></div>
    </section>

    <section>
      <h2>Último resultado</h2>
      <div class="grid" id="summaryCards"></div>
    </section>

    <section>
      <h2>Errores de control</h2>
      <div id="errorsStatus" class="status"></div>
      <div class="table-wrap" style="margin-top:10px;">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Mensaje</th>
              <th>Fila</th>
              <th>NroCuenta</th>
              <th>CUIT</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody id="errorsBody"></tbody>
        </table>
      </div>
    </section>

    <section>
      <div class="row" style="justify-content: space-between;">
        <h2>Superiores</h2>
        <div class="row">
          <input id="searchSup" placeholder="Buscar superior" oninput="renderSuperiores()">
          <button class="secondary" onclick="syncSuperiores()">Sincronizar</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Superior</th>
              <th>Préstamos</th>
              <th>Excluir</th>
              <th>01 hasta 66</th>
              <th>Sin garantía</th>
              <th>Con garantía</th>
              <th>Notas</th>
            </tr>
          </thead>
          <tbody id="superioresBody"></tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>Exclusiones</h2>
      <div class="grid">
        <label>Tipo
          <select id="exTipo">
            <option value="cuit">CUIT</option>
            <option value="nro_cuenta">NroCuenta</option>
          </select>
        </label>
        <label>Valor
          <input id="exValor">
        </label>
        <label>Motivo
          <input id="exMotivo">
        </label>
        <button onclick="saveExclusion()">Guardar exclusión</button>
      </div>
      <div class="grid" style="margin-top:12px;">
        <div>
          <h2>CUIT</h2>
          <div id="cuitsList" class="links"></div>
        </div>
        <div>
          <h2>NroCuenta</h2>
          <div id="cuentasList" class="links"></div>
        </div>
      </div>
    </section>

    <section>
      <h2>Corridas</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Mes</th>
              <th>Estado</th>
              <th>Filas API</th>
              <th>Deudores</th>
              <th>Total miles</th>
              <th>Errores</th>
              <th>Archivos</th>
            </tr>
          </thead>
          <tbody id="runsBody"></tbody>
        </table>
      </div>
    </section>
  </main>

  <script>
    let superiores = [];
    let runs = [];
    let controlErrors = {visibles: [], ignorados: [], reglas: [], total_original: 0};
    let active = false;

    function currentMonth() {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      return `${y}-${m}`;
    }

    async function api(path, opts = {}) {
      const res = await fetch(path, {
        headers: {'Content-Type': 'application/json'},
        ...opts
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    }

    async function loadAll() {
      if (!document.getElementById('mes').value) {
        document.getElementById('mes').value = currentMonth();
      }
      const state = await api('/api/state');
      active = state.active.active;
      document.getElementById('state').innerHTML =
        active ? `<strong>Ejecutando corrida #${state.active.run_id}</strong>` : 'Sin corrida activa';
      document.getElementById('runBtn').disabled = active;
      superiores = await api('/api/superiores');
      const exclusiones = await api('/api/exclusiones');
      controlErrors = await api('/api/errores');
      runs = await api('/api/runs');
      renderSummary(state.current_report);
      renderSuperiores();
      renderExclusiones(exclusiones);
      renderErrors();
      renderRuns();
    }

    function formatNumber(value) {
      if (value === null || value === undefined || value === '') return '';
      return Number(value).toLocaleString('es-AR');
    }

    function renderSummary(report) {
      const el = document.getElementById('summaryCards');
      if (!report) {
        el.innerHTML = '<span class="muted">Todavía no hay reporte de control.</span>';
        return;
      }
      const cards = [
        ['Filas API', report.cantidad_filas_api],
        ['Préstamos únicos', report.cantidad_prestamos_unicos],
        ['Deudores', report.cantidad_deudores_informados],
        ['Total proveedores miles', report.total_proveedores_miles],
        ['Total importes miles', report.total_importes_miles]
      ];
      el.innerHTML = cards.map(([label, value]) => `
        <div>
          <div class="muted">${label}</div>
          <strong>${formatNumber(value)}</strong>
        </div>
      `).join('');
    }

    function flagCell(index, row, field) {
      const checked = Number(row[field]) === 1 ? 'checked' : '';
      return `<input type="checkbox" ${checked} onchange="updateSuperiorIndex(${index}, '${field}', this.checked)">`;
    }

    function renderSuperiores() {
      const term = (document.getElementById('searchSup').value || '').toUpperCase();
      const body = document.getElementById('superioresBody');
      body.innerHTML = superiores
        .filter(row => !term || row.nombre_display.toUpperCase().includes(term))
        .map(row => {
          const index = superiores.findIndex(item => item.nombre_normalizado === row.nombre_normalizado);
          return `
            <tr>
              <td>${escapeHtml(row.nombre_display)}</td>
              <td class="number">${row.cantidad_prestamos || 0}</td>
              <td>${flagCell(index, row, 'excluir')}</td>
              <td>${flagCell(index, row, 'situacion_01_hasta_66')}</td>
              <td>${flagCell(index, row, 'tasa_sin_garantia_real')}</td>
              <td>${flagCell(index, row, 'tasa_con_garantia_real')}</td>
              <td><input value="${escapeAttr(row.notas || '')}" onchange="updateSuperiorIndex(${index}, 'notas', this.value)"></td>
            </tr>
          `;
        }).join('');
    }

    async function updateSuperiorIndex(index, field, value) {
      const row = superiores[index];
      row[field] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
      const updated = await api('/api/superiores/update', {
        method: 'POST',
        body: JSON.stringify(row)
      });
      Object.assign(row, updated);
      renderSuperiores();
    }

    async function syncSuperiores() {
      await api('/api/superiores/sync', {method: 'POST', body: '{}'});
      await loadAll();
    }

    async function saveExclusion() {
      await api('/api/exclusiones/update', {
        method: 'POST',
        body: JSON.stringify({
          tipo: document.getElementById('exTipo').value,
          valor: document.getElementById('exValor').value,
          motivo: document.getElementById('exMotivo').value,
          activo: true
        })
      });
      document.getElementById('exValor').value = '';
      document.getElementById('exMotivo').value = '';
      await loadAll();
    }

    async function deactivateExclusion(tipo, valor) {
      await api('/api/exclusiones/update', {
        method: 'POST',
        body: JSON.stringify({tipo, valor, activo: false})
      });
      await loadAll();
    }

    function renderExclusiones(data) {
      document.getElementById('cuitsList').innerHTML = data.cuits.map(row =>
        `<span class="pill ${row.activo ? '' : 'error'}">${row.cuit}</span>
         <button class="secondary" onclick="deactivateExclusion('cuit','${row.cuit}')">Desactivar</button>`
      ).join(' ');
      document.getElementById('cuentasList').innerHTML = data.nro_cuentas.map(row =>
        `<span class="pill ${row.activo ? '' : 'error'}">${row.nro_cuenta}</span>
         <button class="secondary" onclick="deactivateExclusion('nro_cuenta','${row.nro_cuenta}')">Desactivar</button>`
      ).join(' ');
    }

    async function startRun() {
      const payload = {
        mes: document.getElementById('mes').value,
        tipo_presentacion: document.getElementById('tipo').value,
        tasa_modo: document.getElementById('tasaModo').value,
        tasa_otorgadas_sin_garantia_real_mes: Number(document.getElementById('tasaOtorgadas').value),
        tasa_promedio_manual: document.getElementById('tasaManual').value
      };
      await api('/api/runs', {method: 'POST', body: JSON.stringify(payload)});
      await loadAll();
    }

    async function saveConfig() {
      const payload = {
        mes: document.getElementById('mes').value,
        tipo_presentacion: document.getElementById('tipo').value,
        tasa_modo: document.getElementById('tasaModo').value,
        tasa_otorgadas_sin_garantia_real_mes: Number(document.getElementById('tasaOtorgadas').value),
        tasa_promedio_manual: document.getElementById('tasaManual').value
      };
      const result = await api('/api/config/save', {method: 'POST', body: JSON.stringify(payload)});
      document.getElementById('savedConfig').textContent = `Configuración guardada en ${result.path}`;
    }

    async function ignoreError(index) {
      const issue = controlErrors.visibles[index];
      const motivo = prompt('Motivo para eliminar/ignorar este error', 'Revisado desde panel') || 'Revisado desde panel';
      await api('/api/errores/ignore', {
        method: 'POST',
        body: JSON.stringify({...issue, motivo})
      });
      await loadAll();
    }

    async function reactivateIgnoredError(id) {
      await api('/api/errores/update', {
        method: 'POST',
        body: JSON.stringify({id, activo: false})
      });
      await loadAll();
    }

    function renderErrors() {
      const status = document.getElementById('errorsStatus');
      const body = document.getElementById('errorsBody');
      status.innerHTML = `${controlErrors.visibles.length} visibles, ${controlErrors.ignorados.length} ignorados, ${controlErrors.total_original} originales.`;
      const visibleRows = controlErrors.visibles.map((issue, index) => `
        <tr>
          <td>${escapeHtml(issue.code || '')}</td>
          <td>${escapeHtml(issue.message || '')}</td>
          <td class="number">${issue.row || ''}</td>
          <td>${escapeHtml(issue.nro_cuenta || '')}</td>
          <td>${escapeHtml(issue.cuit || '')}</td>
          <td><button class="secondary" onclick="ignoreError(${index})">Eliminar de vista</button></td>
        </tr>
      `).join('');
      const ignoredRows = controlErrors.ignorados.map(issue => `
        <tr>
          <td><span class="pill">${escapeHtml(issue.code || '')}</span></td>
          <td>${escapeHtml(issue.message || '')}</td>
          <td class="number">${issue.row || ''}</td>
          <td>${escapeHtml(issue.nro_cuenta || '')}</td>
          <td>${escapeHtml(issue.cuit || '')}</td>
          <td><button class="secondary" onclick="reactivateIgnoredError(${issue.ignored_by.id})">Restaurar</button></td>
        </tr>
      `).join('');
      body.innerHTML = visibleRows + ignoredRows || '<tr><td colspan="6" class="muted">Sin errores visibles.</td></tr>';
    }

    function renderRuns() {
      const body = document.getElementById('runsBody');
      body.innerHTML = runs.map(row => {
        const cls = row.estado === 'success' ? 'success' : (row.estado === 'error' ? 'error' : '');
        const files = row.estado === 'success' ? [
          ['ZIP', 'informacion.zip'], ['PROV', 'PROVEEDORES.TXT'], ['IMP', 'IMPORTES.TXT'],
          ['TASA', 'TASA.TXT'], ['XML', 'detalle.xml'], ['Excel', 'deudores_por_superior.xlsx'],
          ['Errores', 'errores.csv'], ['Config', 'config.json']
        ].map(([label, file]) => `<a href="/files/${row.id}/${file}" target="_blank">${label}</a>`).join('') : '';
        return `
          <tr>
            <td>${row.id}</td>
            <td>${row.mes}</td>
            <td><span class="pill ${cls}">${row.estado}</span></td>
            <td class="number">${formatNumber(row.cantidad_filas_api)}</td>
            <td class="number">${formatNumber(row.cantidad_deudores_informados)}</td>
            <td class="number">${formatNumber(row.total_proveedores_miles)}</td>
            <td class="number ${row.errores_count ? 'danger' : ''}">${row.errores_count || 0}</td>
            <td class="links">${files}</td>
          </tr>
        `;
      }).join('');
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[ch]));
    }
    function escapeAttr(value) { return escapeHtml(value).replace(/"/g, '&quot;'); }

    loadAll();
    setInterval(loadAll, 8000);
  </script>
</body>
</html>
"""

PANEL_HTML = r"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BCRA PNFC - Panel</title>
  <style>
    :root {
      --bg: #f4f6f8; --panel: #fff; --line: #d7dde5; --text: #1f2937;
      --muted: #637083; --accent: #155e75; --accent-soft: #e8f4f7;
      --danger: #b91c1c; --danger-soft: #fef2f2; --ok: #166534;
      --ok-soft: #f0fdf4; --warn: #92400e; --warn-soft: #fffbeb;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 Segoe UI, Arial, sans-serif; }
    header { background: #fff; border-bottom: 1px solid var(--line); padding: 14px 22px; display: flex; justify-content: space-between; gap: 12px; align-items: center; }
    h1 { margin: 0; font-size: 20px; }
    h2 { margin: 0 0 10px; font-size: 16px; }
    h3 { margin: 0 0 8px; font-size: 14px; }
    main { padding: 18px 22px 38px; display: grid; gap: 14px; }
    section, .card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
    .top-grid { display: grid; grid-template-columns: minmax(240px, 1.05fr) repeat(4, minmax(130px, .45fr)); gap: 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; align-items: end; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .between { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
    label { display: grid; gap: 5px; color: var(--muted); font-size: 12px; }
    input, select, textarea { width: 100%; min-height: 34px; border: 1px solid var(--line); border-radius: 6px; padding: 7px 9px; font: inherit; background: #fff; color: var(--text); }
    textarea { resize: vertical; }
    button { min-height: 34px; border: 1px solid var(--accent); border-radius: 6px; padding: 7px 12px; color: #fff; background: var(--accent); cursor: pointer; font: inherit; }
    button.secondary { background: #fff; color: var(--accent); }
    button.danger { background: var(--danger); border-color: var(--danger); }
    button:disabled { opacity: .55; cursor: not-allowed; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; border-bottom: 1px solid var(--line); padding: 7px; vertical-align: middle; }
    th { font-size: 12px; color: var(--muted); font-weight: 600; }
    td.number { text-align: right; font-variant-numeric: tabular-nums; }
    .table-wrap { max-height: 440px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; }
    .badge { display: inline-block; border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px; font-size: 12px; background: #fff; color: var(--muted); white-space: nowrap; }
    .badge.ok { color: var(--ok); background: var(--ok-soft); border-color: #bbf7d0; }
    .badge.warn { color: var(--warn); background: var(--warn-soft); border-color: #fde68a; }
    .badge.err { color: var(--danger); background: var(--danger-soft); border-color: #fecaca; }
    .muted { color: var(--muted); }
    .danger-text { color: var(--danger); }
    .strong { font-weight: 700; }
    .zip-card { border-color: #94d5e3; background: #f8fdff; padding: 12px; }
    .zip-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .zip-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .zip-title h2 { margin: 0; }
    .zip-files { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
    .file-chip { display: inline-block; border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 2px 8px; font-size: 12px; color: var(--muted); }
    .zip-path { margin-top: 6px; font-size: 12px; color: var(--muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .field-help { margin-top: -6px; color: var(--muted); font-size: 12px; }
    .primary-link { display: inline-block; text-decoration: none; color: #fff; background: var(--accent); border-radius: 6px; padding: 8px 12px; }
    .link-list a { display: inline-block; margin: 0 9px 5px 0; color: var(--accent); }
    .link-list button { margin: 0 6px 5px 0; min-height: 28px; padding: 4px 8px; }
    .filters button { background: #fff; color: var(--accent); padding-inline: 9px; }
    .filters button.active { background: var(--accent); color: #fff; }
    .status-line { min-height: 20px; color: var(--muted); }
    .section-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .modal-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, .42); display: none; align-items: center; justify-content: center; padding: 18px; z-index: 20; }
    .modal-backdrop.open { display: flex; }
    .analysis-modal { width: min(1100px, 96vw); height: min(760px, 90vh); background: #fff; border-radius: 8px; border: 1px solid var(--line); display: grid; grid-template-rows: auto 1fr; box-shadow: 0 20px 60px rgba(15, 23, 42, .25); }
    .analysis-modal header { padding: 12px 14px; border-bottom: 1px solid var(--line); }
    .analysis-content { overflow: auto; padding: 12px 14px; }
    .analysis-content pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 12px/1.45 Consolas, monospace; }
    .analysis-content table { font-size: 12px; }
    .analysis-content th { position: sticky; top: 0; background: #fff; z-index: 1; }
    @media (max-width: 900px) { .top-grid { grid-template-columns: 1fr; } header { align-items: flex-start; flex-direction: column; } main { padding: 12px; } }
  </style>
</head>
<body>
  <header>
    <h1>BCRA Central de Deudores PNFC</h1>
    <div id="state" class="status-line">Cargando...</div>
  </header>

  <main>
    <div class="top-grid">
      <section class="zip-card">
        <div class="zip-head">
          <div class="zip-title">
            <h2>Archivo final de presentacion</h2>
            <div id="zipStatus"><span class="badge">No generado</span></div>
          </div>
          <a id="zipDownload" class="primary-link" href="#" target="_blank" style="display:none;">Descargar informacion.zip</a>
        </div>
        <div class="zip-files">
          <span class="file-chip">informacion.zip</span>
          <span class="file-chip">detalle.xml</span>
          <span class="file-chip">YYYYMMDD/IMPORTES.TXT</span>
          <span class="file-chip">YYYYMMDD/PROVEEDORES.TXT</span>
          <span class="file-chip">YYYYMMDD/TASA.TXT</span>
        </div>
        <div class="zip-path" id="zipPath">La ruta completa queda en Historial.</div>
      </section>
      <div class="card"><div class="muted">Filas API</div><strong id="cardFilas">-</strong></div>
      <div class="card"><div class="muted">Créditos únicos</div><strong id="cardCreditos">-</strong><div class="field-help" id="cardCreditosDetalle"></div></div>
      <div class="card"><div class="muted">Deudores</div><strong id="cardDeudores">-</strong></div>
      <div class="card"><div class="muted">Total miles</div><strong id="cardTotal">-</strong></div>
    </div>

    <section>
      <div class="section-title">
        <h2>1. Presentacion</h2>
        <span id="presentacionEstado" class="badge warn">Pendiente</span>
      </div>
      <div class="grid">
        <label>Mes a presentar
          <input id="mes" type="month" onchange="onPresentationChange()">
        </label>
        <label>Fecha de corte
          <input id="fechaCorte" disabled>
        </label>
        <label>Tipo
          <select id="tipo" onchange="onPresentationChange()">
            <option>NORMAL</option>
            <option>RECTIFICATIVA</option>
          </select>
        </label>
        <label>Modo TASA
          <select id="tasaModo" onchange="onPresentationChange()">
            <option>MANUAL</option>
          </select>
        </label>
        <label>Tasa manual EEE,DD
          <input id="tasaManual" value="000,00" pattern="[0-9]{3},[0-9]{2}" oninput="onTasaManualInput()">
        </label>
      </div>
      <div class="field-help">Usar coma decimal y dos decimales, por ejemplo 112,00.</div>
      <div class="row" style="margin-top:10px;">
        <span class="badge" id="tasaPreview">TASA.TXT esperado: 1;000,00</span>
        <span id="monthWarning" class="badge warn" style="display:none;"></span>
      </div>
    </section>

    <section>
      <div class="section-title">
        <h2>2. Validacion previa</h2>
        <span id="preEstado" class="badge warn">Pendiente</span>
      </div>
      <div class="row">
        <button onclick="prevalidate()">Validar configuracion</button>
        <button id="runBtn" onclick="startRun()" disabled>Ejecutar presentacion</button>
        <button class="secondary" onclick="saveConfig()">Guardar configuracion actual</button>
      </div>
      <div id="prevalidationBox" class="status-line" style="margin-top:10px;">La ejecucion se habilita despues de validar sin errores bloqueantes.</div>
    </section>

    <section>
      <div class="section-title">
        <h2>3. Superiores y reglas</h2>
        <span id="superioresEstado" class="badge">Pendiente</span>
      </div>
      <p class="muted">Superiores = Prestamo.LineaPrestamo.Superior.Descripcion. El proceso usa el nombre real de API; el alias solo mejora la lectura del panel.</p>
      <div class="between" style="margin-bottom:10px;">
        <div class="row">
          <input id="searchSup" placeholder="Buscar superior" oninput="renderSuperiores()">
          <div class="filters" id="supFilters"></div>
        </div>
        <button class="secondary" onclick="syncSuperiores()">Sincronizar desde prestamos_unicos.csv</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Superior</th><th>Prestamos</th><th>Lineas</th><th>Estado</th><th>Excluir</th>
              <th>01 hasta 66</th><th>Clasificacion TASA</th><th>Notas</th><th>Detalle</th>
            </tr>
          </thead>
          <tbody id="superioresBody"></tbody>
        </table>
      </div>
      <div id="superiorDetail" class="card" style="display:none; margin-top:10px;"></div>
    </section>

    <section>
      <div class="section-title">
        <h2>4. Exclusiones</h2>
        <span id="exclusionesEstado" class="badge">Pendiente</span>
      </div>
      <p class="muted">No se editan TXT finales. Las exclusiones se guardan en SQLite y pasan al config de la proxima corrida.</p>
      <div class="grid">
        <div>
          <h3>CUIT excluidos</h3>
          <div class="grid">
            <label>CUIT <input id="cuitValor"></label>
            <label>Motivo <input id="cuitMotivo"></label>
            <button onclick="saveExclusion('cuit')">Agregar CUIT</button>
          </div>
          <div id="cuitsList" class="table-wrap" style="margin-top:10px;"></div>
        </div>
        <div>
          <h3>NroCuenta excluidas</h3>
          <div class="grid">
            <label>NroCuenta <input id="cuentaValor"></label>
            <label>CUIT asociado <input id="cuentaCuit"></label>
            <label>Motivo <input id="cuentaMotivo"></label>
            <button onclick="saveExclusion('nro_cuenta')">Agregar NroCuenta</button>
          </div>
          <div id="cuentasList" class="table-wrap" style="margin-top:10px;"></div>
        </div>
      </div>
    </section>

    <section>
      <div class="section-title">
        <h2>5. Errores y acciones sugeridas</h2>
        <span id="errorsEstado" class="badge">Pendiente</span>
      </div>
      <div id="errorsStatus" class="status-line"></div>
      <div class="table-wrap" style="margin-top:10px;">
        <table>
          <thead><tr><th>Tipo</th><th>Severidad</th><th>Descripcion</th><th>NroCuenta</th><th>CUIT</th><th>Accion sugerida</th><th>Accion</th></tr></thead>
          <tbody id="errorsBody"></tbody>
        </table>
      </div>
    </section>

    <section>
      <div class="section-title">
        <h2>6. Historial y archivos</h2>
        <span id="historialEstado" class="badge">Pendiente</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Mes</th><th>Fecha corte</th><th>Tipo</th><th>Estado</th><th>Resultado</th>
              <th>Filas API</th><th>Deudores</th><th>Total miles</th><th>Errores</th><th>Advertencias</th><th>Archivos</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody id="runsBody"></tbody>
        </table>
      </div>
    </section>
  </main>

  <div class="modal-backdrop" id="analysisModal">
    <div class="analysis-modal">
      <header>
        <div class="between">
          <h2 id="analysisTitle">Analisis</h2>
          <div class="row">
            <a id="analysisDownload" class="primary-link" href="#" target="_blank">Descargar</a>
            <button class="secondary" onclick="closeAnalysis()">Cerrar</button>
          </div>
        </div>
      </header>
      <div class="analysis-content" id="analysisContent"></div>
    </div>
  </div>

  <script>
    let superiores = [], runs = [], exclusions = {cuits: [], nro_cuentas: []};
    let currentErrors = {visibles: [], ignorados: [], total_original: 0};
    let prevalidation = null, active = false, supFilter = 'Todos';
    let selectedSuperiorDetail = null, selectedSuperiorLines = [];
    const lineasAutoSyncTried = new Set();
    let tasaInputTouched = false;

    const filters = ['Todos', 'Excluidos', 'Incluidos', 'Con lineas excluidas', '01 hasta 66', 'Sin garantia real', 'Sin clasificar', 'Con notas', 'Con mas prestamos'];

    function currentMonth() {
      const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    function cutoffFromMonth(month) {
      if (!month) return '';
      const [y, m] = month.split('-').map(Number);
      return new Date(y, m, 0).toLocaleDateString('es-AR');
    }
    function cutoffIso(month) {
      if (!month) return '';
      const [y, m] = month.split('-').map(Number);
      const d = new Date(y, m, 0);
      return `${y}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    async function api(path, opts = {}) {
      const res = await fetch(path, {headers: {'Content-Type': 'application/json'}, ...opts});
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || res.statusText);
      return data;
    }
    function payload() {
      return {
        mes: document.getElementById('mes').value,
        tipo_presentacion: document.getElementById('tipo').value,
        tasa_modo: document.getElementById('tasaModo').value,
        tasa_otorgadas_sin_garantia_real_mes: 1,
        tasa_promedio_manual: document.getElementById('tasaManual').value
      };
    }
    function onTasaManualInput() {
      tasaInputTouched = true;
      localStorage.setItem('bcra_tasa_manual', document.getElementById('tasaManual').value);
      onPresentationChange();
    }
    function formatNumber(value) {
      if (value === null || value === undefined || value === '') return '-';
      return Number(value).toLocaleString('es-AR');
    }
    function badge(text, cls='') { return `<span class="badge ${cls}">${escapeHtml(text)}</span>`; }
    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    }
    function escapeAttr(value) { return escapeHtml(value).replace(/"/g, '&quot;'); }
    function csvToTable(text) {
      const lines = text.trim().split(/\r?\n/).filter(Boolean);
      if (!lines.length) return '<span class="muted">Archivo vacio.</span>';
      const rows = lines.map(line => line.split(';'));
      const header = rows.shift();
      return `<table><thead><tr>${header.map(cell => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
    async function openAnalysis(label, href) {
      const modal = document.getElementById('analysisModal');
      document.getElementById('analysisTitle').textContent = label;
      document.getElementById('analysisDownload').href = href;
      document.getElementById('analysisContent').innerHTML = '<span class="muted">Cargando...</span>';
      modal.classList.add('open');
      const res = await fetch(href);
      const text = await res.text();
      const content = document.getElementById('analysisContent');
      try {
        const parsed = JSON.parse(text);
        content.innerHTML = `<pre>${escapeHtml(JSON.stringify(parsed, null, 2))}</pre>`;
      } catch {
        content.innerHTML = href.toLowerCase().endsWith('.csv')
          ? csvToTable(text)
          : `<pre>${escapeHtml(text)}</pre>`;
      }
    }
    function closeAnalysis() {
      document.getElementById('analysisModal').classList.remove('open');
    }
    function downloadFile(href) {
      const link = document.createElement('a');
      link.href = href;
      link.download = href.split('/').pop() || 'archivo';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => { window.location.href = href; }, 150);
    }

    function onPresentationChange() {
      const p = payload();
      document.getElementById('fechaCorte').value = cutoffFromMonth(p.mes);
      const tasaManual = document.getElementById('tasaManual');
      tasaManual.disabled = false;
      const tasaTxt = `1;${p.tasa_promedio_manual}`;
      document.getElementById('tasaPreview').textContent = `TASA.TXT esperado: ${tasaTxt}`;
      prevalidation = null;
      document.getElementById('runBtn').disabled = true;
      document.getElementById('preEstado').className = 'badge warn';
      document.getElementById('preEstado').textContent = 'Pendiente';
      document.getElementById('presentacionEstado').className = p.mes ? 'badge ok' : 'badge warn';
      document.getElementById('presentacionEstado').textContent = p.mes ? 'Completa' : 'Pendiente';
      const prev = runs.filter(r => r.mes === p.mes).length;
      const warn = document.getElementById('monthWarning');
      warn.style.display = prev ? '' : 'none';
      warn.textContent = prev ? `Este mes ya tiene ${prev} corrida(s). Se creara una nueva.` : '';
    }

    async function loadAll() {
      if (!document.getElementById('mes').value) document.getElementById('mes').value = currentMonth();
      const state = await api('/api/state');
      active = state.active.active;
      document.getElementById('state').innerHTML = active ? `<strong>Ejecutando corrida #${state.active.run_id}</strong>` : 'Sin corrida activa';
      const defaultTasa = localStorage.getItem('bcra_tasa_manual')
        || state.settings?.tasa_manual_default
        || state.latest?.tasa_manual
        || '000,00';
      const tasaInput = document.getElementById('tasaManual');
      if (!tasaInputTouched) tasaInput.value = defaultTasa;
      superiores = await api('/api/superiores');
      exclusions = await api('/api/exclusiones');
      runs = await api('/api/runs');
      currentErrors = await api('/api/errores');
      renderFinalCard(state.latest, state.current_report);
      renderCards(state.current_report, state.panel_totals);
      renderFilters();
      renderSuperiores();
      renderExclusiones();
      renderErrors();
      renderRuns();
      onPresentationChange();
    }

    function renderFinalCard(latest, report) {
      const zipRoute = latest ? (latest.ruta_zip || latest.zip_path || '') : '';
      const ok = latest && latest.estado === 'success' && zipRoute;
      const visibleErrors = Array.isArray(currentErrors.visibles)
        ? currentErrors.visibles.length
        : Number(latest?.errores || latest?.errores_count || 0);
      const hasErrors = latest && visibleErrors > 0;
      const status = !latest ? badge('No generado') : (ok && !hasErrors ? badge('Generado', 'ok') : badge('No definitivo', hasErrors ? 'err' : 'warn'));
      document.getElementById('zipStatus').innerHTML = status;
      document.getElementById('zipPath').textContent = ok
        ? 'Ruta disponible en Historial y archivos'
        : 'La ruta completa queda en Historial cuando exista una corrida valida.';
      const link = document.getElementById('zipDownload');
      if (ok && !hasErrors) { link.href = `/api/files/final/${latest.id}`; link.style.display = ''; }
      else { link.style.display = 'none'; }
    }
    function renderCards(report, panelTotals = {}) {
      const creditosUnicos = report?.cantidad_prestamos_unicos ?? panelTotals?.creditos_por_superiores;
      const creditosIncluidos = report?.cantidad_prestamos_incluidos;
      document.getElementById('cardFilas').textContent = formatNumber(report && report.cantidad_filas_api);
      document.getElementById('cardCreditos').textContent = formatNumber(creditosUnicos);
      document.getElementById('cardCreditosDetalle').textContent = creditosIncluidos
        ? `Incluidos: ${formatNumber(creditosIncluidos)}`
        : (panelTotals?.creditos_por_superiores ? 'Según superiores sincronizados' : '');
      document.getElementById('cardDeudores').textContent = formatNumber(report && report.cantidad_deudores_informados);
      document.getElementById('cardTotal').textContent = formatNumber(report && report.total_proveedores_miles);
    }

    function renderFilters() {
      document.getElementById('supFilters').innerHTML = filters.map(f =>
        `<button class="${supFilter === f ? 'active' : ''}" onclick="supFilter='${f}'; renderFilters(); renderSuperiores();">${f}</button>`
      ).join('');
    }
    function superiorName(row) { return row.alias_usuario || row.nombre_display || row.nombre_api_original || row.nombre_normalizado; }
    function filterSuperior(row) {
      const term = (document.getElementById('searchSup').value || '').toUpperCase();
      const name = `${superiorName(row)} ${row.nombre_api_original || ''} ${row.notas || ''}`.toUpperCase();
      if (term && !name.includes(term)) return false;
      if (supFilter === 'Excluidos') return Number(row.excluir) === 1;
      if (supFilter === 'Incluidos') return Number(row.excluir) !== 1;
      if (supFilter === 'Con lineas excluidas') return Number(row.cantidad_lineas_excluidas || 0) > 0;
      if (supFilter === '01 hasta 66') return Number(row.situacion_01_hasta_66) === 1;
      if (supFilter === 'Sin garantia real') return row.clasificacion_tasa === 'SIN_GARANTIA_REAL';
      if (supFilter === 'Sin clasificar') return row.clasificacion_tasa === 'SIN_DEFINIR';
      if (supFilter === 'Con notas') return !!row.notas;
      return true;
    }
    function renderSuperiores() {
      let rows = superiores.filter(filterSuperior);
      if (supFilter === 'Con mas prestamos') rows = rows.sort((a,b) => Number(b.cantidad_prestamos || 0) - Number(a.cantidad_prestamos || 0));
      document.getElementById('superioresEstado').textContent = superiores.length ? 'Completa' : 'Pendiente';
      document.getElementById('superioresEstado').className = superiores.length ? 'badge ok' : 'badge warn';
      document.getElementById('superioresBody').innerHTML = rows.map(row => {
        const index = superiores.findIndex(item => item.id === row.id);
        const tags = [
          Number(row.excluir) === 1 ? badge('Excluido', 'warn') : badge('Incluido', 'ok'),
          Number(row.cantidad_lineas_excluidas || 0) ? badge(`${formatNumber(row.cantidad_lineas_excluidas)} lineas excluidas`, 'warn') : '',
          Number(row.situacion_01_hasta_66) === 1 ? badge('01 hasta 66', 'ok') : '',
          row.clasificacion_tasa === 'SIN_DEFINIR' ? badge('Sin clasificar') : badge(row.clasificacion_tasa.replaceAll('_', ' '))
        ].join(' ');
        return `<tr ondblclick="showSuperiorDetail(${row.id})" title="Doble click para ver lineas de este superior">
          <td><strong>${escapeHtml(superiorName(row))}</strong><br><span class="muted">${escapeHtml(row.nombre_api_original || '')}</span></td>
          <td class="number">${formatNumber(row.cantidad_prestamos || 0)}</td>
          <td class="number">${formatNumber(row.cantidad_lineas || 0)}</td>
          <td>${tags}</td>
          <td><input type="checkbox" ${Number(row.excluir) === 1 ? 'checked' : ''} onchange="updateSuperior(${index}, 'excluir', this.checked)"></td>
          <td><input type="checkbox" ${Number(row.situacion_01_hasta_66) === 1 ? 'checked' : ''} onchange="updateSuperior(${index}, 'situacion_01_hasta_66', this.checked)"></td>
          <td><select onchange="updateSuperior(${index}, 'clasificacion_tasa', this.value)">
            ${['SIN_GARANTIA_REAL','NO_APLICA'].map(v => `<option value="${v}" ${row.clasificacion_tasa === v ? 'selected' : ''}>${v.replaceAll('_',' ')}</option>`).join('')}
          </select></td>
          <td><input value="${escapeAttr(row.notas || '')}" onchange="updateSuperior(${index}, 'notas', this.value)"></td>
          <td><button class="secondary" onclick="showSuperiorDetail(${row.id})">Ver detalle</button></td>
        </tr>`;
      }).join('') || '<tr><td colspan="9" class="muted">Sin superiores para mostrar.</td></tr>';
    }
    async function updateSuperior(index, field, value) {
      const row = superiores[index];
      row[field] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
      const updated = await api('/api/superiores/update', {method: 'POST', body: JSON.stringify(row)});
      Object.assign(row, updated);
      prevalidation = null;
      renderSuperiores();
    }
    async function showSuperiorDetail(id) {
      const detail = await api(`/api/superiores/${id}`);
      const lines = await api(`/api/superiores/${id}/lineas`);
      selectedSuperiorDetail = detail;
      selectedSuperiorLines = lines;
      document.getElementById('superiorDetail').style.display = '';
      document.getElementById('superiorDetail').innerHTML = `
        <div class="between"><h3>${escapeHtml(detail.nombre_visible)}</h3><button class="secondary" onclick="document.getElementById('superiorDetail').style.display='none'">Cerrar</button></div>
        <div class="grid">
          <div><div class="muted">Nombre API original</div>${escapeHtml(detail.nombre_api_original)}</div>
          <div><div class="muted">Nombre normalizado</div>${escapeHtml(detail.nombre_normalizado)}</div>
          <label>Alias usuario <input value="${escapeAttr(detail.alias_usuario || '')}" onchange="saveAlias(${detail.id}, this.value)"></label>
          <div><div class="muted">Prestamos</div>${formatNumber(detail.cantidad_prestamos)}</div>
          <div><div class="muted">Lineas detectadas</div>${formatNumber(lines.length)}</div>
          <div><div class="muted">Impacto config</div><pre>${escapeHtml(JSON.stringify(detail.config_generada, null, 2))}</pre></div>
          <div><div class="muted">Notas</div>${escapeHtml(detail.notas || '-')}</div>
        </div>
        <div class="between" style="margin-top:12px;">
          <h3>Lineas dentro del superior</h3>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="searchLineas" placeholder="Filtrar lineas" oninput="renderSelectedSuperiorLines()" style="max-width:280px;">
            <button class="secondary" onclick="syncLineasSuperior(${detail.id})">Actualizar lineas de este superior</button>
          </div>
        </div>
        <div id="lineasSyncStatus" class="muted" style="margin-top:8px;"></div>
        <div id="lineasSuperiorBox" class="table-wrap" style="margin-top:8px;"></div>`;
      renderSelectedSuperiorLines();
      if (!lines.length && Number(detail.cantidad_prestamos || 0) > 0 && !lineasAutoSyncTried.has(id)) {
        lineasAutoSyncTried.add(id);
        syncLineasSuperior(id);
      }
    }
    function renderSelectedSuperiorLines() {
      const box = document.getElementById('lineasSuperiorBox');
      if (!box) return;
      const term = (document.getElementById('searchLineas')?.value || '').toUpperCase();
      const rows = selectedSuperiorLines.filter(row => {
        const text = `${row.linea_display || ''} ${row.linea_normalizada || ''} ${row.notas || ''}`.toUpperCase();
        return !term || text.includes(term);
      });
      box.innerHTML = `<table>
        <thead><tr><th>Linea prestamo</th><th>Prestamos</th><th>Excluir</th><th>Notas</th><th>Nombre normalizado</th></tr></thead>
        <tbody>${rows.map(row => `<tr>
          <td><strong>${escapeHtml(row.linea_display || '')}</strong>${Number(row.excluir) ? '<br>' + badge('Excluida', 'warn') : ''}</td>
          <td class="number">${formatNumber(row.cantidad_prestamos || 0)}</td>
          <td><input type="checkbox" ${Number(row.excluir) === 1 ? 'checked' : ''} onchange="updateLineaPrestamo(${row.id}, 'excluir', this.checked)"></td>
          <td><input value="${escapeAttr(row.notas || '')}" onchange="updateLineaPrestamo(${row.id}, 'notas', this.value)"></td>
          <td class="muted">${escapeHtml(row.linea_normalizada || '')}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">Sin lineas sincronizadas para este superior. Usa Actualizar lineas de este superior para consultar la API solo para este superior.</td></tr>'}</tbody>
      </table>`;
    }
    async function syncLineasSuperior(id) {
      const status = document.getElementById('lineasSyncStatus');
      if (status) status.textContent = 'Consultando API para este superior...';
      try {
        const result = await api(`/api/superiores/${id}/lineas/sync-api`, {method: 'POST', body: '{}'});
        selectedSuperiorLines = result.lineas || [];
        if (status) {
          status.textContent = `Listo: ${formatNumber(result.lineas_detectadas)} lineas detectadas sobre ${formatNumber(result.prestamos_superior)} prestamos del superior.`;
        }
        await loadAll();
        await showSuperiorDetail(id);
      } catch (error) {
        if (status) status.textContent = error.message || 'No se pudieron actualizar las lineas.';
        else alert(error.message || 'No se pudieron actualizar las lineas.');
      }
    }
    async function updateLineaPrestamo(id, field, value) {
      const row = selectedSuperiorLines.find(item => Number(item.id) === Number(id));
      if (!row) return;
      row[field] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
      const updated = await api('/api/lineas-prestamo/update', {method: 'POST', body: JSON.stringify(row)});
      Object.assign(row, updated);
      prevalidation = null;
      await loadAll();
      if (selectedSuperiorDetail) {
        await showSuperiorDetail(selectedSuperiorDetail.id);
      }
    }
    async function saveAlias(id, alias) {
      await api(`/api/superiores/${id}/alias`, {method: 'POST', body: JSON.stringify({alias_usuario: alias})});
      await loadAll();
    }
    async function syncSuperiores() { await api('/api/superiores/sync', {method: 'POST', body: '{}'}); await loadAll(); }

    function renderExclusiones() {
      const renderTable = (rows, tipo) => `<table><tbody>${rows.map(row => {
        const value = tipo === 'cuit' ? row.cuit : row.nro_cuenta;
        return `<tr><td>${escapeHtml(value)}</td><td>${tipo === 'nro_cuenta' ? escapeHtml(row.cuit_asociado || '') : ''}</td><td>${escapeHtml(row.motivo || '')}</td><td>${Number(row.activo) ? badge('Activo','warn') : badge('Inactivo')}</td><td><button class="secondary" onclick="toggleExclusion('${tipo}','${value}',${Number(row.activo) ? 0 : 1})">${Number(row.activo) ? 'Desactivar' : 'Reactivar'}</button></td></tr>`;
      }).join('') || '<tr><td class="muted">Sin registros.</td></tr>'}</tbody></table>`;
      document.getElementById('cuitsList').innerHTML = renderTable(exclusions.cuits, 'cuit');
      document.getElementById('cuentasList').innerHTML = renderTable(exclusions.nro_cuentas, 'nro_cuenta');
      const activeCount = exclusions.cuits.filter(x => Number(x.activo)).length + exclusions.nro_cuentas.filter(x => Number(x.activo)).length;
      document.getElementById('exclusionesEstado').textContent = activeCount ? 'Con advertencias' : 'Completa';
      document.getElementById('exclusionesEstado').className = activeCount ? 'badge warn' : 'badge ok';
    }
    async function saveExclusion(tipo) {
      const body = tipo === 'cuit'
        ? {tipo, valor: document.getElementById('cuitValor').value, motivo: document.getElementById('cuitMotivo').value, activo: true}
        : {tipo, valor: document.getElementById('cuentaValor').value, cuit_asociado: document.getElementById('cuentaCuit').value, motivo: document.getElementById('cuentaMotivo').value, activo: true};
      await api('/api/exclusiones/update', {method: 'POST', body: JSON.stringify(body)});
      ['cuitValor','cuitMotivo','cuentaValor','cuentaCuit','cuentaMotivo'].forEach(id => document.getElementById(id).value = '');
      await loadAll();
    }
    async function toggleExclusion(tipo, valor, activo) {
      if (!activo && !confirm('Desactivar esta exclusion?')) return;
      const motivo = activo ? prompt('Motivo para reactivar', 'Reactivado desde panel') : 'Desactivado desde panel';
      await api('/api/exclusiones/update', {method:'POST', body: JSON.stringify({tipo, valor, activo: Boolean(activo), motivo})});
      await loadAll();
    }

    async function prevalidate() {
      prevalidation = await api('/api/prevalidar', {method: 'POST', body: JSON.stringify(payload())});
      const cls = prevalidation.errores.length ? 'err' : (prevalidation.advertencias.length ? 'warn' : 'ok');
      document.getElementById('preEstado').className = `badge ${cls}`;
      document.getElementById('preEstado').textContent = prevalidation.errores.length ? 'Con errores' : (prevalidation.advertencias.length ? 'Con advertencias' : 'Completa');
      document.getElementById('runBtn').disabled = active || !prevalidation.ejecutable;
      const s = prevalidation.resumen;
      document.getElementById('prevalidationBox').innerHTML = `
        <div class="grid">
          <div><div class="muted">Mes</div><strong>${escapeHtml(s.mes)}</strong></div>
          <div><div class="muted">Fecha corte</div><strong>${escapeHtml(s.fecha_corte)}</strong></div>
          <div><div class="muted">TASA.TXT</div><strong>${escapeHtml(s.tasa_txt_esperado)}</strong></div>
          <div><div class="muted">Superiores excluidos</div><strong>${formatNumber(s.superiores_excluidos)}</strong></div>
          <div><div class="muted">Lineas excluidas</div><strong>${formatNumber(s.lineas_prestamo_excluidas)}</strong></div>
          <div><div class="muted">CUIT excluidos</div><strong>${formatNumber(s.cuits_excluidos_activos)}</strong></div>
          <div><div class="muted">NroCuenta excluidas</div><strong>${formatNumber(s.nro_cuentas_excluidas_activas)}</strong></div>
          <div><div class="muted">Max API</div><strong>${formatNumber(s.max_api_configurado)}</strong></div>
          <div><div class="muted">ZIP</div><strong>${escapeHtml(s.nombre_zip_final)}</strong></div>
        </div>
        <div style="margin-top:10px;">${prevalidation.errores.map(e => badge(e.message, 'err')).join(' ')} ${prevalidation.advertencias.map(w => badge(w.message, 'warn')).join(' ')}</div>`;
    }
    async function startRun() {
      if (!prevalidation || !prevalidation.ejecutable) return alert('Primero valide la configuracion.');
      await api('/api/runs', {method: 'POST', body: JSON.stringify(payload())});
      await loadAll();
    }
    async function deleteRun(runId, mes, estado) {
      if (estado === 'running') {
        alert('No se puede borrar una corrida en ejecucion.');
        return;
      }
      const label = `corrida #${runId}${mes ? ' de ' + mes : ''}`;
      const warning = estado === 'success'
        ? `La ${label} figura como exitosa. Borrar solo si no fue presentada.`
        : `Se borrara la ${label} del historial y su carpeta de corrida.`;
      if (!confirm(`${warning}\n\nEsta accion no edita los TXT finales ni modifica la configuracion actual. ¿Continuar?`)) return;
      await api(`/api/runs/${runId}`, {method: 'DELETE'});
      await loadAll();
    }
    async function saveConfig() {
      const result = await api('/api/config/save', {method: 'POST', body: JSON.stringify(payload())});
      document.getElementById('prevalidationBox').innerHTML = `Configuracion guardada en ${escapeHtml(result.path)}`;
    }

    function renderErrors() {
      const status = document.getElementById('errorsStatus');
      const body = document.getElementById('errorsBody');
      status.innerHTML = `${currentErrors.visibles.length} visibles, ${currentErrors.ignorados.length} ignorados, ${currentErrors.total_original} originales.`;
      document.getElementById('errorsEstado').textContent = currentErrors.visibles.length ? 'Con errores' : 'Completa';
      document.getElementById('errorsEstado').className = currentErrors.visibles.length ? 'badge err' : 'badge ok';
      body.innerHTML = currentErrors.visibles.map((issue, index) => {
        const enriched = enrichClientError(issue);
        const actions = enriched.acciones_disponibles.map(a => `<option value="${a}">${a.replaceAll('_',' ')}</option>`).join('');
        return `<tr>
          <td>${escapeHtml(issue.code || '')}</td><td>${badge(enriched.severidad, enriched.severidad === 'Bloqueante' ? 'err' : 'warn')}</td>
          <td>${escapeHtml(issue.message || '')}<br><span class="muted">${escapeHtml(enriched.impacto)}</span></td>
          <td>${escapeHtml(issue.nro_cuenta || '')}</td><td>${escapeHtml(issue.cuit || '')}</td>
          <td>${escapeHtml(enriched.accion_sugerida)}</td>
          <td><select id="errAction${index}">${actions}</select><button class="secondary" onclick="resolveCurrentError(${index})">Aplicar</button></td>
        </tr>`;
      }).join('') || '<tr><td colspan="7" class="muted">Sin errores visibles.</td></tr>';
    }
    function enrichClientError(issue) {
      if (issue.cuit) {
        const actions = ['EXCLUIR_CUIT'];
        if (issue.nro_cuenta) actions.push('EXCLUIR_NRO_CUENTA');
        actions.push('MARCAR_REVISADO');
        if ((issue.code || '') === 'INVALID_DATE') actions.splice(actions.length - 1, 0, 'IGNORADO_CON_JUSTIFICACION');
        return {
          severidad:'Revisar',
          impacto:'El CUIT queda fuera de la proxima corrida si se aplica la exclusion.',
          accion_sugerida:'Excluir CUIT y reejecutar la presentacion.',
          acciones_disponibles: actions
        };
      }
      const code = issue.code || '';
      if (code === 'INVALID_LOAN_FOR_OUTPUT') return {severidad:'Revisar', impacto:'Prestamo fuera de salida por datos incompletos.', accion_sugerida:'Excluir NroCuenta o revisar base.', acciones_disponibles:['EXCLUIR_NRO_CUENTA','MARCAR_REVISADO']};
      if (code === 'INCONSISTENT_DEBTOR_NAME') return {severidad:'Revisar', impacto:'Puede afectar denominacion del deudor.', accion_sugerida:'Excluir CUIT, revisar base o marcar revisado.', acciones_disponibles:['EXCLUIR_CUIT','MARCAR_REVISADO']};
      if (code === 'INVALID_DATE') return {severidad:'Ignorable con justificacion', impacto:'Ignorar solo si no afecta mora ni salida final.', accion_sugerida:'Marcar ignorado con justificacion.', acciones_disponibles:['IGNORADO_CON_JUSTIFICACION','EXCLUIR_NRO_CUENTA','MARCAR_REVISADO']};
      return {severidad:'Revisar', impacto:'Requiere control.', accion_sugerida:'Revisar y documentar.', acciones_disponibles:['MARCAR_REVISADO']};
    }
    async function resolveCurrentError(index) {
      const issue = currentErrors.visibles[index];
      const accion = document.getElementById(`errAction${index}`).value;
      const motivo = prompt('Motivo obligatorio', 'Resuelto desde panel');
      if (!motivo) return;
      await api('/api/errors/resolve', {method:'POST', body: JSON.stringify({...issue, tipo_error: issue.code, accion, motivo})});
      await loadAll();
    }

    function renderRuns() {
      document.getElementById('historialEstado').textContent = runs.length ? 'Completa' : 'Pendiente';
      document.getElementById('historialEstado').className = runs.length ? 'badge ok' : 'badge warn';
      document.getElementById('runsBody').innerHTML = runs.map(row => {
        const cls = row.estado === 'success' ? (Number(row.errores || row.errores_count || 0) ? 'warn' : 'ok') : (row.estado === 'error' ? 'err' : 'warn');
        const presentationFiles = [
          ['Descargar informacion.zip', `/api/files/final/${row.id}`, true],
          ['PROVEEDORES', `/files/${row.id}/PROVEEDORES.TXT`],
          ['IMPORTES', `/files/${row.id}/IMPORTES.TXT`],
          ['TASA', `/files/${row.id}/TASA.TXT`],
          ['XML', `/files/${row.id}/detalle.xml`]
        ].map(([label, href, primary]) => `<a ${primary ? 'class="strong"' : ''} href="${href}" target="_blank">${label}</a>`).join('');
        const excelFile = `<button class="secondary strong" onclick="downloadFile('/files/${row.id}/deudores_por_superior.xlsx')">Excel deudores</button>`;
        const analysisFiles = [
          ['Ver errores', `/files/${row.id}/errores.csv`],
          ['Ver reporte', `/files/${row.id}/reporte_control.json`],
          ['Ver config', `/api/runs/${row.id}/config`],
          ['Ver manifest', `/api/runs/${row.id}/manifest`]
        ].map(([label, href]) => `<button class="secondary" onclick="openAnalysis(${JSON.stringify(label)}, ${JSON.stringify(href)})">${label}</button>`).join('');
        const files = presentationFiles + '<br>' + excelFile + analysisFiles;
        const actions = row.estado === 'running'
          ? '<span class="muted">En ejecucion</span>'
          : `<button class="danger" onclick="deleteRun(${Number(row.id)}, ${JSON.stringify(row.mes || '')}, ${JSON.stringify(row.estado || '')})">Borrar historial</button>`;
        return `<tr>
          <td>${row.id}</td><td>${escapeHtml(row.mes)}</td><td>${escapeHtml(row.fecha_corte)}</td><td>${escapeHtml(row.tipo_presentacion)}</td>
          <td>${badge(row.estado, cls)}</td><td>${escapeHtml(row.resultado || '')}</td>
          <td class="number">${formatNumber(row.filas_api ?? row.cantidad_filas_api)}</td>
          <td class="number">${formatNumber(row.deudores ?? row.cantidad_deudores_informados)}</td>
          <td class="number">${formatNumber(row.total_miles ?? row.total_proveedores_miles)}</td>
          <td class="number ${Number(row.errores || row.errores_count || 0) ? 'danger-text' : ''}">${formatNumber(row.errores ?? row.errores_count ?? 0)}</td>
          <td class="number">${formatNumber(row.advertencias ?? row.advertencias_count ?? 0)}</td>
          <td class="link-list">${files}</td>
          <td>${actions}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="13" class="muted">Sin corridas registradas.</td></tr>';
    }

    loadAll().catch(err => alert(err.message));
    setInterval(() => loadAll().catch(() => {}), 9000);
  </script>
</body>
</html>
"""


def parse_json_body(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    return json.loads(raw.decode("utf-8"))


def create_handler(
    *,
    db_path: Path = DEFAULT_DB_PATH,
    base_config_path: Path = DEFAULT_BASE_CONFIG,
    workspace: Path = Path("."),
    coordinator: RunCoordinator | None = None,
) -> type[BaseHTTPRequestHandler]:
    db_path = Path(db_path)
    base_config_path = Path(base_config_path)
    workspace = Path(workspace)
    coordinator = coordinator or RunCoordinator()

    class PanelHandler(BaseHTTPRequestHandler):
        server_version = "BCRAPanel/1.0"

        def log_message(self, fmt: str, *args: Any) -> None:
            return

        def send_json(self, data: Any, status: int = 200) -> None:
            payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def send_error_json(self, message: str, status: int = 400) -> None:
            self.send_json({"error": message}, status)

        def do_GET(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            try:
                if path == "/":
                    payload = PANEL_HTML.encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                    return
                if path == "/api/state":
                    with closing(sqlite3.connect(db_path)) as connection:
                        connection.row_factory = sqlite3.Row
                        self.send_json({
                            "active": coordinator.state(),
                            "settings": get_settings(connection),
                            "panel_totals": get_panel_totals(db_path),
                            "latest": (get_presentations(db_path, 1) or [None])[0],
                            "current_report": read_json_if_exists(
                                workspace / "control" / "reporte_control.json"
                            ),
                        })
                    return
                if path == "/api/superiores":
                    self.send_json(get_superiores(db_path))
                    return
                if path.startswith("/api/superiores/"):
                    parts = path.strip("/").split("/")
                    if len(parts) == 4 and parts[3] == "lineas":
                        try:
                            self.send_json(get_lineas_prestamo_for_superior(db_path, int(parts[2])))
                        except ValueError as exc:
                            self.send_error_json(str(exc), 404)
                        return
                    if len(parts) == 3:
                        detail = get_superior_detail(db_path, int(parts[2]))
                        if detail is None:
                            self.send_error_json("Superior no encontrado", 404)
                        else:
                            self.send_json(detail)
                        return
                if path == "/api/exclusiones":
                    self.send_json(get_exclusiones(db_path))
                    return
                if path == "/api/errores":
                    self.send_json(get_current_errors(db_path, workspace))
                    return
                if path == "/api/runs":
                    self.send_json(get_presentations(db_path))
                    return
                if path.startswith("/api/runs/"):
                    parts = path.strip("/").split("/")
                    if len(parts) < 3:
                        self.send_error_json("Ruta invalida", 404)
                        return
                    run_id = int(parts[2])
                    presentation = get_presentation(db_path, run_id)
                    if not presentation:
                        self.send_error_json("Corrida no encontrada", 404)
                        return
                    if len(parts) == 4 and parts[3] == "config":
                        run_root = Path(presentation["output_dir"]).parent
                        configured_value = (
                            presentation.get("ruta_config_aplicada")
                            or presentation.get("config_path")
                            or ""
                        )
                        if configured_value:
                            configured_path = Path(configured_value)
                        else:
                            configured_path = (
                                run_root / APPLIED_CONFIG_FILE_NAME
                                if (run_root / APPLIED_CONFIG_FILE_NAME).exists()
                                else run_root / CONFIG_FILE_NAME
                            )
                        self.serve_named_run_file(
                            presentation,
                            APPLIED_CONFIG_FILE_NAME,
                            configured_path,
                        )
                        return
                    if len(parts) == 4 and parts[3] == "manifest":
                        self.serve_named_run_file(
                            presentation,
                            MANIFEST_FILE_NAME,
                            Path(presentation.get("ruta_manifest") or Path(presentation["output_dir"]).parent / MANIFEST_FILE_NAME),
                        )
                        return
                    if len(parts) == 4 and parts[3] == "errors":
                        self.send_json(get_run_errors(db_path, run_id))
                        return
                    report = read_json_if_exists(
                        Path(presentation["control_dir"]) / "reporte_control.json"
                    )
                    self.send_json({"presentation": presentation, "report": report})
                    return
                if path.startswith("/api/files/final/"):
                    run_id = int(path.strip("/").split("/")[-1])
                    self.serve_final_zip(run_id)
                    return
                if path.startswith("/files/"):
                    self.serve_file(path)
                    return
                self.send_error_json("No encontrado", 404)
            except Exception as exc:
                self.send_error_json(str(exc), 500)

        def do_POST(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            try:
                payload = parse_json_body(self)
                if path == "/api/superiores/sync":
                    count = sync_superiores_from_csv(
                        db_path,
                        workspace / "control" / "prestamos_unicos.csv",
                    )
                    self.send_json({"sincronizados": count})
                    return
                if path == "/api/superiores/update":
                    self.send_json(update_superior(db_path, payload))
                    return
                if path.startswith("/api/superiores/") and path.endswith("/lineas/sync-api"):
                    parts = path.strip("/").split("/")
                    if len(parts) == 5:
                        try:
                            self.send_json(
                                sync_lineas_prestamo_from_api(
                                    db_path,
                                    base_config_path,
                                    int(parts[2]),
                                )
                            )
                        except ValueError as exc:
                            self.send_error_json(str(exc), HTTPStatus.BAD_REQUEST)
                        return
                if path.startswith("/api/superiores/") and path.endswith("/alias"):
                    parts = path.strip("/").split("/")
                    if len(parts) == 4:
                        self.send_json(
                            update_superior_alias(
                                db_path,
                                int(parts[2]),
                                str(payload.get("alias_usuario") or payload.get("alias") or ""),
                            )
                        )
                        return
                if path == "/api/exclusiones/update":
                    self.send_json(update_exclusion(db_path, payload))
                    return
                if path == "/api/lineas-prestamo/update":
                    try:
                        self.send_json(update_linea_prestamo(db_path, payload))
                    except ValueError as exc:
                        self.send_error_json(str(exc), HTTPStatus.BAD_REQUEST)
                    return
                if path == "/api/errores/ignore":
                    self.send_json(ignore_error(db_path, payload))
                    return
                if path == "/api/errores/update":
                    self.send_json(update_ignored_error(db_path, payload))
                    return
                if path == "/api/config/save":
                    self.send_json(
                        save_current_config(
                            db_path,
                            base_config_path,
                            workspace,
                            payload,
                        )
                    )
                    return
                if path == "/api/prevalidar":
                    result = validate_panel_config(
                        db_path,
                        base_config_path,
                        workspace,
                        payload,
                    )
                    if result.get("ejecutable"):
                        remember_tasa_manual_default(
                            db_path,
                            payload.get("tasa_promedio_manual"),
                        )
                    self.send_json(result)
                    return
                if path == "/api/errors/resolve":
                    self.send_json(resolve_error(db_path, payload))
                    return
                if path == "/api/runs":
                    try:
                        result = start_presentation(
                            db_path,
                            base_config_path,
                            workspace,
                            payload,
                            coordinator,
                        )
                    except RuntimeError as exc:
                        self.send_error_json(str(exc), HTTPStatus.CONFLICT)
                        return
                    except ValueError as exc:
                        try:
                            self.send_json(json.loads(str(exc)), HTTPStatus.BAD_REQUEST)
                        except json.JSONDecodeError:
                            self.send_error_json(str(exc), HTTPStatus.BAD_REQUEST)
                        return
                    self.send_json(result, 202)
                    return
                if path.startswith("/api/runs/") and path.endswith("/delete"):
                    parts = path.strip("/").split("/")
                    if len(parts) == 4:
                        try:
                            self.send_json(
                                delete_presentation(
                                    db_path,
                                    int(parts[2]),
                                    workspace=workspace,
                                    coordinator=coordinator,
                                )
                            )
                        except RuntimeError as exc:
                            self.send_error_json(str(exc), HTTPStatus.CONFLICT)
                        except ValueError as exc:
                            self.send_error_json(str(exc), HTTPStatus.NOT_FOUND)
                        return
                self.send_error_json("No encontrado", 404)
            except Exception as exc:
                self.send_error_json(str(exc), 500)

        def do_DELETE(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            try:
                if path.startswith("/api/runs/"):
                    parts = path.strip("/").split("/")
                    if len(parts) == 3:
                        try:
                            self.send_json(
                                delete_presentation(
                                    db_path,
                                    int(parts[2]),
                                    workspace=workspace,
                                    coordinator=coordinator,
                                )
                            )
                        except RuntimeError as exc:
                            self.send_error_json(str(exc), HTTPStatus.CONFLICT)
                        except ValueError as exc:
                            self.send_error_json(str(exc), HTTPStatus.NOT_FOUND)
                        return
                self.send_error_json("No encontrado", 404)
            except Exception as exc:
                self.send_error_json(str(exc), 500)

        def serve_file(self, path: str) -> None:
            parts = path.strip("/").split("/")
            if len(parts) != 3:
                self.send_error_json("Ruta inválida", 404)
                return
            _, run_id_text, file_name = parts
            run_id = int(run_id_text)
            presentation = get_presentation(db_path, run_id)
            if not presentation:
                self.send_error_json("Corrida no encontrada", 404)
                return
            if file_name in ALLOWED_OUTPUT_FILES:
                file_path = Path(presentation["output_dir"]) / file_name
            elif file_name in ALLOWED_CONTROL_FILES:
                file_path = Path(presentation["control_dir"]) / file_name
            elif file_name == CONFIG_FILE_NAME:
                run_root = Path(presentation["output_dir"]).parent
                configured_value = (
                    presentation.get("ruta_config_aplicada")
                    or presentation.get("config_path")
                    or ""
                )
                if configured_value:
                    file_path = Path(configured_value)
                else:
                    file_path = (
                        run_root / APPLIED_CONFIG_FILE_NAME
                        if (run_root / APPLIED_CONFIG_FILE_NAME).exists()
                        else run_root / CONFIG_FILE_NAME
                    )
            elif file_name in {
                APPLIED_CONFIG_FILE_NAME,
                MANIFEST_FILE_NAME,
                "config_aplicada_resumen.txt",
                "snapshot_superiores.csv",
                "snapshot_lineas_prestamo.csv",
                "snapshot_exclusiones_cuit.csv",
                "snapshot_exclusiones_nro_cuenta.csv",
                "prevalidacion.json",
            }:
                file_path = Path(presentation["output_dir"]).parent / file_name
            else:
                self.send_error_json("Archivo no permitido", 403)
                return
            self.serve_path(file_path)

        def serve_named_run_file(
            self,
            presentation: dict[str, Any],
            file_name: str,
            file_path: Path,
        ) -> None:
            allowed_root = Path(presentation["output_dir"]).parent.resolve()
            candidate = Path(file_path)
            if not str(candidate):
                candidate = allowed_root / file_name
            try:
                resolved = candidate.resolve()
                resolved.relative_to(allowed_root)
            except Exception:
                self.send_error_json("Archivo no permitido", 403)
                return
            self.serve_path(resolved)

        def serve_final_zip(self, run_id: int) -> None:
            presentation = get_presentation(db_path, run_id)
            if not presentation:
                self.send_error_json("Corrida no encontrada", 404)
                return
            if presentation.get("estado") != "success":
                self.send_error_json("ZIP no definitivo para una corrida no exitosa", 409)
                return
            zip_path = Path(presentation["zip_path"])
            if not zip_path.exists():
                self.send_error_json("informacion.zip no encontrado", 404)
                return
            self.serve_path(zip_path)

        def serve_path(self, file_path: Path) -> None:
            if not file_path.exists() or not file_path.is_file():
                self.send_error_json("Archivo no encontrado", 404)
                return
            content = file_path.read_bytes()
            content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            if file_path.suffix.lower() in {".zip", ".xlsx"}:
                self.send_header(
                    "Content-Disposition",
                    f'attachment; filename="{file_path.name}"',
                )
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)

    return PanelHandler


def run_server(
    host: str = "127.0.0.1",
    port: int = 8080,
    *,
    db_path: Path = DEFAULT_DB_PATH,
    base_config_path: Path = DEFAULT_BASE_CONFIG,
    workspace: Path = Path("."),
) -> ThreadingHTTPServer:
    workspace = Path(workspace).resolve()
    db_path = (workspace / db_path).resolve() if not db_path.is_absolute() else db_path
    base_config_path = (
        workspace / base_config_path
        if not base_config_path.is_absolute()
        else base_config_path
    )
    init_db(db_path, base_config_path)
    sync_superiores_from_csv(db_path, workspace / "control" / "prestamos_unicos.csv")
    handler = create_handler(
        db_path=db_path,
        base_config_path=base_config_path,
        workspace=workspace,
    )
    server = ThreadingHTTPServer((host, port), handler)
    return server
