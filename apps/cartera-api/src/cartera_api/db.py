"""Base local (SQLite) con la copia de la cartera."""

from __future__ import annotations

import os
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS prestamos (
    prestamo_id     INTEGER PRIMARY KEY,
    proveedor       TEXT,
    datos           TEXT NOT NULL,
    hash            TEXT NOT NULL,
    eliminado       INTEGER NOT NULL DEFAULT 0,
    actualizado_en  TEXT NOT NULL
);
-- Índices en el mismo orden que el paginado (actualizado_en + clave): cada página es una lectura
-- directa del índice, sin ordenar la tabla entera.
DROP INDEX IF EXISTS ix_prestamos_actualizado;
CREATE INDEX IF NOT EXISTS ix_prestamos_orden ON prestamos (actualizado_en, prestamo_id);
CREATE INDEX IF NOT EXISTS ix_prestamos_proveedor ON prestamos (proveedor);

CREATE TABLE IF NOT EXISTS cuotas (
    prestamo_id     INTEGER NOT NULL,
    nro_cuota       INTEGER NOT NULL,
    datos           TEXT NOT NULL,
    hash            TEXT NOT NULL,
    eliminado       INTEGER NOT NULL DEFAULT 0,
    actualizado_en  TEXT NOT NULL,
    PRIMARY KEY (prestamo_id, nro_cuota)
);
DROP INDEX IF EXISTS ix_cuotas_actualizado;
CREATE INDEX IF NOT EXISTS ix_cuotas_orden ON cuotas (actualizado_en, prestamo_id, nro_cuota);

CREATE TABLE IF NOT EXISTS cobros (
    cobro_id        INTEGER NOT NULL,
    prestamo_id     INTEGER NOT NULL,
    nro_cuota       INTEGER NOT NULL,
    fecha           TEXT,
    datos           TEXT NOT NULL,
    hash            TEXT NOT NULL,
    eliminado       INTEGER NOT NULL DEFAULT 0,
    actualizado_en  TEXT NOT NULL,
    PRIMARY KEY (cobro_id, prestamo_id, nro_cuota)
);
DROP INDEX IF EXISTS ix_cobros_actualizado;
CREATE INDEX IF NOT EXISTS ix_cobros_orden ON cobros (actualizado_en, cobro_id, prestamo_id, nro_cuota);
CREATE INDEX IF NOT EXISTS ix_cobros_fecha ON cobros (fecha);

CREATE TABLE IF NOT EXISTS ips_vistas (
    ip           TEXT PRIMARY KEY,
    primera_vez  TEXT NOT NULL,
    ultima_vez   TEXT NOT NULL,
    consultas    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sincronizaciones (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    inicio      TEXT NOT NULL,
    fin         TEXT,
    estado      TEXT NOT NULL,
    prestamos   INTEGER,
    cuotas      INTEGER,
    cobros      INTEGER,
    cambios     INTEGER,
    error       TEXT
);
"""


_inicializadas: set[str] = set()


def connect(path: str) -> sqlite3.Connection:
    """Conexión de escritura. El esquema se aplica una sola vez por proceso y base."""
    carpeta = os.path.dirname(path)
    if carpeta:
        os.makedirs(carpeta, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    if path not in _inicializadas:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)
        _inicializadas.add(path)
    # En WAL, NORMAL es seguro ante caídas de la app y evita esperar al disco en cada commit.
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def connect_lectura(path: str) -> sqlite3.Connection:
    """Conexión de solo lectura para las consultas de la API: no escribe ni espera al disco."""
    if path not in _inicializadas:
        connect(path).close()
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn
