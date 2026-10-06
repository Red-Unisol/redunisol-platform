from __future__ import annotations

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool


def create_db_engine(database_url: str) -> Engine:
    engine_kwargs: dict = {"future": True}
    if database_url.startswith("sqlite"):
        engine_kwargs["connect_args"] = {
            "check_same_thread": False,
            "timeout": 10,
        }
        if ":memory:" in database_url:
            engine_kwargs["poolclass"] = StaticPool
    engine = create_engine(database_url, **engine_kwargs)
    if database_url.startswith("sqlite"):
        _configure_sqlite(engine, enable_wal=":memory:" not in database_url)
    return engine


def _configure_sqlite(engine: Engine, *, enable_wal: bool) -> None:
    @event.listens_for(engine, "connect")
    def set_sqlite_pragmas(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA busy_timeout=10000")
            cursor.execute("PRAGMA foreign_keys=ON")
            if enable_wal:
                cursor.execute("PRAGMA synchronous=NORMAL")
        finally:
            cursor.close()

    if enable_wal:
        # journal_mode is persistent. Set it once during startup instead of on every
        # pooled connection, where changing it would itself compete with live writes.
        with engine.connect() as connection:
            connection.exec_driver_sql("PRAGMA journal_mode=WAL")
