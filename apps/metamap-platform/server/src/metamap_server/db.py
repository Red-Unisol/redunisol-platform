from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool


def create_db_engine(database_url: str) -> Engine:
    engine_kwargs: dict = {"future": True}
    if database_url.startswith("sqlite"):
        engine_kwargs["connect_args"] = {"check_same_thread": False}
        if ":memory:" in database_url:
            engine_kwargs["poolclass"] = StaticPool
    return create_engine(database_url, **engine_kwargs)
