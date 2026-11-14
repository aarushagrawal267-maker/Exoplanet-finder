"""Fixtures for exofinder.data unit tests.

Every test runs against a temporary data directory and a temporary SQLite database (never the real
``data/app.db``). The catalogue CSV snapshots come from ``exof_data_testdata.py`` and are
HAND-MADE TEST DATA (see that module), never real catalogue data.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from exof_data_testdata import CONFIRMED_CSV, KOI_CSV, STELLAR_CSV, TCE_CSV


def _clear_caches() -> None:
    from exofinder.config import get_settings
    from exofinder.db import session as db_session

    get_settings.cache_clear()
    for fn in (db_session.get_engine, db_session._session_factory):
        fn.cache_clear()


@pytest.fixture()
def tmp_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Point settings at a temporary data dir + SQLite DB and create the schema."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setenv("EXOF_DATA_DIR", str(data_dir))
    monkeypatch.setenv("EXOF_ARTIFACTS_DIR", str(tmp_path / "artifacts"))
    monkeypatch.setenv("EXOF_DB_URL", f"sqlite:///{(data_dir / 'test.db').as_posix()}")
    monkeypatch.setenv("EXOF_KEEP_RAW_FITS", "false")
    _clear_caches()
    from exofinder.config import get_settings
    from exofinder.db.session import get_engine, init_db

    settings = get_settings()
    assert settings.data_path == data_dir.resolve() or settings.data_path == data_dir
    settings.ensure_dirs()
    init_db()
    yield data_dir
    get_engine().dispose()
    _clear_caches()


@pytest.fixture()
def db_session(tmp_env: Path):
    from exofinder.db.session import session_scope

    with session_scope() as s:
        yield s


@pytest.fixture()
def catalog_files(tmp_path: Path) -> dict[str, Path]:
    """Write the hand-made test snapshots to disk; file names follow the snapshot naming scheme."""
    d = tmp_path / "testdata_catalogs"
    d.mkdir()
    out = {}
    for source, text in (
        ("dr24_tce", TCE_CSV),
        ("koi_cumulative", KOI_CSV),
        ("confirmed", CONFIRMED_CSV),
        ("stellar", STELLAR_CSV),
    ):
        p = d / f"{source}_TESTDATA.csv"
        p.write_text(text, encoding="utf-8")
        out[source] = p
    return out
