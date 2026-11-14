"""Fixtures for the operations API tests (datasets, jobs, training, models, evaluation, experiments,
reports, CLI). They build on ``tests/api/conftest.py`` (temporary data dir + database, fresh job
runner, TestClient) and add a small SYNTHETIC TEST DATA catalogue with synthetic light curves
(see :mod:`ops_testdata`). Nothing here touches the real ``data/app.db``.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from ops_testdata import build_catalogue


@pytest.fixture()
def ops_env(api_env: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Temporary environment with sequential dataset processing (tests override when needed)."""
    monkeypatch.setenv("EXOF_BUILD_WORKERS", "1")
    yield api_env


@pytest.fixture()
def catalogue(ops_env: Path) -> dict:
    """The synthetic TEST DATA catalogue + light curves in the temporary database."""
    from exofinder.db.session import session_scope

    with session_scope() as s:
        return build_catalogue(s)


@pytest.fixture()
def ops_client(catalogue: dict, client):
    """TestClient on an environment that already holds the synthetic catalogue."""
    return client
