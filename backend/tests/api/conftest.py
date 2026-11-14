"""Shared fixtures for API/service tests.

Every test gets a temporary data directory, artifacts directory and SQLite database (never the real
``data/app.db``), a fresh job runner and a FastAPI ``TestClient``. Any catalogue rows or light curves
a test creates are TEST DATA and must be labelled as such in the test module.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path

import pytest

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def _clear_caches() -> None:
    from exofinder.config import get_settings
    from exofinder.db import session as db_session

    get_settings.cache_clear()
    for fn in (db_session.get_engine, db_session._session_factory):
        fn.cache_clear()


@pytest.fixture()
def api_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Temporary data/artifacts dirs + SQLite DB with the schema created; fresh job runner."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setenv("EXOF_DATA_DIR", str(data_dir))
    monkeypatch.setenv("EXOF_ARTIFACTS_DIR", str(tmp_path / "artifacts"))
    monkeypatch.setenv("EXOF_DB_URL", f"sqlite:///{(data_dir / 'test.db').as_posix()}")
    monkeypatch.setenv("EXOF_KEEP_RAW_FITS", "false")
    monkeypatch.setenv("EXOF_DEVICE", "cpu")
    _clear_caches()
    from exofinder.config import get_settings
    from exofinder.db.session import get_engine, init_db
    from exofinder.jobs.runner import reset_runner_for_tests

    get_settings().ensure_dirs()
    init_db()
    reset_runner_for_tests()
    yield data_dir
    reset_runner_for_tests()
    get_engine().dispose()
    _clear_caches()


@pytest.fixture()
def client(api_env: Path) -> Iterator:
    """FastAPI TestClient running the real app (lifespan included) against the temporary env."""
    from fastapi.testclient import TestClient

    from exofinder.api.main import create_app

    with TestClient(create_app()) as c:
        yield c


@pytest.fixture()
def db(api_env: Path) -> Iterator:
    from exofinder.db.session import session_scope

    with session_scope() as s:
        yield s


def wait_for_job(client, job_id: str, timeout: float = 120.0) -> dict:
    """Poll ``GET /api/jobs/{id}`` until the job leaves queued/running; returns the final JobOut."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = client.get(f"/api/jobs/{job_id}")
        assert r.status_code == 200, r.text
        job = r.json()
        if job["status"] not in ("queued", "running"):
            return job
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish within {timeout}s")
