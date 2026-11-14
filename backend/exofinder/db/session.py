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
    """Create all tables (idempotent)."""
    Base.metadata.create_all(get_engine(url))


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
