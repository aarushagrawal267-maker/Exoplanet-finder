"""Database engine / session management (SQLite)."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from exofinder.config import get_settings
from exofinder.db.models import Base


@lru_cache
def get_engine(url: str | None = None) -> Engine:
    settings = get_settings()
    url = url or settings.database_url
    if url.startswith("sqlite:///"):
        settings.data_path.mkdir(parents=True, exist_ok=True)
    engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30}, future=True)

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _):  # pragma: no cover - trivial
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.close()

    return engine


@lru_cache
def _session_factory(url: str | None = None) -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(url), expire_on_commit=False, future=True)


def init_db(url: str | None = None) -> None:
    """Create all tables and add any columns missing from an older database (idempotent)."""
    engine = get_engine(url)
    Base.metadata.create_all(engine)
    _add_missing_columns(engine)


def _add_missing_columns(engine: Engine) -> list[str]:
    """Additive schema migration: ``ALTER TABLE ... ADD COLUMN`` for nullable model columns that an
    existing database lacks (databases created by an earlier version). Never drops or changes data."""
    from sqlalchemy import inspect, text

    added: list[str] = []
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing or not col.nullable or col.primary_key:
                    continue
                ddl = col.type.compile(dialect=engine.dialect)
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl}'))
                added.append(f"{table.name}.{col.name}")
    return added


@contextmanager
def session_scope(url: str | None = None) -> Iterator[Session]:
    """Transactional scope: commits on success, rolls back on error."""
    session = _session_factory(url)()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db() -> Iterator[Session]:
    """FastAPI dependency."""
    session = _session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
