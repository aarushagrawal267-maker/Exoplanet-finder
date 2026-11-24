"""Hosted mode: the backend serves the built web app (``EXOF_FRONTEND_DIST``) on the same origin.

The ``index.html`` and asset written here are TEST DATA in a temporary folder.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def hosted_client(api_env: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>TEST APP</title>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log('test')", encoding="utf-8")
    monkeypatch.setenv("EXOF_FRONTEND_DIST", str(dist))
    from exofinder.api.main import create_app

    with TestClient(create_app()) as c:
        yield c


def test_spa_routes_fall_back_to_index(hosted_client):
    for path in ("/", "/signals", "/targets/11442793", "/docs", "/docs/methodology"):
        r = hosted_client.get(path)
        assert r.status_code == 200, path
        assert "TEST APP" in r.text, path


def test_static_assets_are_served(hosted_client):
    r = hosted_client.get("/assets/app.js")
    assert r.status_code == 200
    assert "console.log" in r.text


def test_api_docs_move_under_api_prefix(hosted_client):
    assert hosted_client.get("/api/health").json()["status"] == "ok"
    assert hosted_client.get("/api/openapi.json").json()["info"]["title"] == "Exoplanet Finder API"
    assert "swagger" in hosted_client.get("/api/docs").text.lower()


def test_unknown_api_path_is_a_json_404(hosted_client):
    r = hosted_client.get("/api/does-not-exist")
    assert r.status_code == 404
    assert r.json()["code"] == "not_found"


def test_path_traversal_is_not_served(hosted_client, tmp_path: Path):
    (tmp_path / "secret.txt").write_text("SECRET", encoding="utf-8")
    r = hosted_client.get("/../secret.txt")
    assert "SECRET" not in r.text


def test_local_mode_keeps_docs_at_root(client):
    assert client.get("/openapi.json").status_code == 200
    assert "swagger" in client.get("/docs").text.lower()
