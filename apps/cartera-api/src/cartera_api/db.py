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
CREATE INDEX IF NOT EXISTS ix_prestamos_actualizado ON prestamos (actualizado_en);
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
CREATE INDEX IF NOT EXISTS ix_cuotas_actualizado ON cuotas (actualizado_en);

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
CREATE INDEX IF NOT EXISTS ix_cobros_actualizado ON cobros (actualizado_en);
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


def connect(path: str) -> sqlite3.Connection:
    carpeta = os.path.dirname(path)
    if carpeta:
        os.makedirs(carpeta, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    return conn
