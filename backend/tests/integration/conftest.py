"""Fixtures for integration tests: temporary data dir + SQLite DB (never the real data/app.db)."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest


def _clear_caches() -> None:
    from exofinder.config import get_settings
    from exofinder.db import session as db_session

    get_settings.cache_clear()
    db_session.get_engine.cache_clear()
    db_session._session_factory.cache_clear()


@pytest.fixture()
def tmp_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setenv("EXOF_DATA_DIR", str(data_dir))
    monkeypatch.setenv("EXOF_ARTIFACTS_DIR", str(tmp_path / "artifacts"))
    monkeypatch.setenv("EXOF_DB_URL", f"sqlite:///{(data_dir / 'test.db').as_posix()}")
    monkeypatch.setenv("EXOF_KEEP_RAW_FITS", "false")
    _clear_caches()
    from exofinder.config import get_settings
    from exofinder.db.session import get_engine, init_db

    get_settings().ensure_dirs()
    init_db()
    yield data_dir
    get_engine().dispose()
    _clear_caches()


@pytest.fixture()
def db_session(tmp_env: Path):
    from exofinder.db.session import session_scope

    with session_scope() as s:
        yield s
