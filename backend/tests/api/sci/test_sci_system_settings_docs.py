"""System, settings, storage, backup and documentation endpoint tests (temporary env; TEST DATA)."""

from __future__ import annotations

import sqlite3

import pytest


# --------------------------------------------------------------------------------------------------
# system
# --------------------------------------------------------------------------------------------------
def test_summary_fresh_install(client):
    r = client.get("/api/system/summary")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["catalog"]["n_signals"] == 0 and body["catalog"]["last_refresh"] is None
    assert body["models"]["count"] == 0 and body["models"]["active"] is None
    assert body["predictions"] == {"count": 0, "recent": []}
    keys = [s["key"] for s in body["next_steps"]]
    assert keys[0] == "refresh_catalog" and "train_model" in keys and "build_dataset" in keys
    assert all(not s["done"] for s in body["checklist"])
    assert body["device"]["device"] == "cpu" and body["device"]["preference"] == "cpu"
    assert "research leads" in body["disclaimer"]


def test_summary_with_data(client, fixture_model):
    sid = fixture_model["signals"]["TCE-010666592-01"]
    client.post("/api/predictions", json={"source": {"type": "catalog", "kepid": 10666592, "signal_id": sid}})
    body = client.get("/api/system/summary").json()
    cat = body["catalog"]
    assert cat["n_signals"] > 10 and cat["by_category"]["confirmed"] >= 1 and cat["last_refresh"]
    assert set(cat["snapshot_ids"]) == {"dr24_tce", "koi_cumulative", "confirmed", "stellar"}
    lc = body["lightcurves"]
    assert lc["available"] == 2 and lc["disk_bytes"] > 0
    assert (
        body["datasets"]["count"] == 1 and body["datasets"]["latest"]["name"] == "TEST DATA fixture dataset"
    )
    m = body["models"]
    assert m["count"] == 1 and m["n_real"] == 0 and m["active"]["is_fixture"] is True
    assert body["predictions"]["count"] == 1 and body["predictions"]["recent"][0]["is_fixture_model"] is True
    done = {s["key"]: s["done"] for s in body["checklist"]}
    assert done["refresh_catalog"] and done["download_lightcurves"] and done["build_dataset"]
    assert done["train_model"] is False  # a fixture model is not a trained model
    assert body["running_jobs"] == []


def test_diagnostics(client, monkeypatch: pytest.MonkeyPatch):
    r = client.get("/api/system/diagnostics")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["versions"]["numpy"] and body["versions"]["pipeline"]
    assert body["paths"]["lightcurves_dir"]["exists"] is True
    assert body["network"] is None and body["network_checked"] is False
    assert any(c["key"] == "database" for c in body["storage"]["categories"])

    import requests

    def offline(*a, **kw):
        raise requests.ConnectionError("TEST: network disabled")

    monkeypatch.setattr(requests, "get", offline)
    body = client.get("/api/system/diagnostics", params={"check_network": True}).json()
    assert body["network_checked"] is True and len(body["network"]) == 2
    for check in body["network"]:
        assert check["ok"] is False and "network disabled" in check["error"]


# --------------------------------------------------------------------------------------------------
# settings
# --------------------------------------------------------------------------------------------------
def test_settings_get_put(client):
    r = client.get("/api/settings")
    assert r.status_code == 200
    body = r.json()
    assert body["values"]["device"] == "cpu" and "download_workers" in body["descriptions"]
    assert body["descriptions"]["device"]["choices"]
    r = client.put("/api/settings", json={"download_workers": 3, "ui_density": "compact"})
    assert r.status_code == 200 and r.json()["values"]["download_workers"] == 3
    assert client.get("/api/settings").json()["values"]["ui_density"] == "compact"
    bad = client.put("/api/settings", json={"download_workers": 0})
    assert (
        bad.status_code == 400
        and bad.json()["code"] == "invalid_setting"
        and "at least 1" in bad.json()["detail"]
    )
    unknown = client.put("/api/settings", json={"nope": 1})
    assert unknown.status_code == 400 and "Unknown setting" in unknown.json()["detail"]
    missing_model = client.put("/api/settings", json={"default_model_id": 99})
    assert missing_model.status_code == 400
    assert client.get("/api/settings").json()["values"]["download_workers"] == 3  # all-or-nothing


def test_storage_and_clear(client, sci_catalog, api_env):
    from exofinder.config import get_settings

    s = get_settings()
    raw = s.raw_dir / "000000001"
    raw.mkdir(parents=True)
    (raw / "TEST_DATA_placeholder.fits").write_bytes(b"0" * 1234)
    views = s.views_dir / "abc"
    views.mkdir(parents=True)
    (views / "TEST.npz").write_bytes(b"0" * 100)
    st = client.get("/api/settings/storage").json()
    cats = {c["key"]: c for c in st["categories"]}
    assert cats["raw_fits"]["bytes"] == 1234 and cats["raw_fits"]["clearable"]
    assert cats["lightcurves"]["bytes"] > 0 and not cats["lightcurves"]["clearable"]
    assert cats["database"]["bytes"] > 0 and st["disk"]["free"] > 0
    r = client.post("/api/settings/storage/clear", json={"target": "raw_fits"})
    assert r.status_code == 200 and r.json()["bytes_freed"] == 1234 and r.json()["files_removed"] == 1
    assert not raw.exists() and s.raw_dir.exists()
    r = client.post("/api/settings/storage/clear", json={"target": "views_cache"})
    assert r.status_code == 200 and r.json()["files_removed"] == 1 and s.views_dir.exists()
    assert client.post("/api/settings/storage/clear", json={"target": "lightcurves"}).status_code == 422
    assert client.post("/api/settings/storage/clear", json={"target": "../"}).status_code == 422
    assert (s.lightcurves_dir / "010666592.npz").exists()  # never touched


def test_clear_refuses_while_job_running(client, api_env):
    from exofinder.db.models import Job
    from exofinder.db.session import session_scope

    with session_scope() as s:
        s.add(Job(id="e" * 32, kind="download", title="TEST running download", status="running", params={}))
    r = client.post("/api/settings/storage/clear", json={"target": "raw_fits"})
    assert r.status_code == 409 and r.json()["code"] == "job_running"
    assert client.post("/api/settings/storage/clear", json={"target": "uploads"}).status_code == 200


def test_backup_is_a_consistent_sqlite_copy(client, sci_catalog, tmp_path):
    r = client.get("/api/settings/backup")
    assert r.status_code == 200
    assert "attachment" in r.headers["content-disposition"] and ".db" in r.headers["content-disposition"]
    out = tmp_path / "backup.db"
    out.write_bytes(r.content)
    con = sqlite3.connect(out)
    try:
        n = con.execute("select count(*) from signals").fetchone()[0]
        assert con.execute("pragma integrity_check").fetchone()[0] == "ok"
    finally:
        con.close()
    assert n > 10


# --------------------------------------------------------------------------------------------------
# docs
# --------------------------------------------------------------------------------------------------
def test_docs_pages(client):
    r = client.get("/api/docs/pages")
    assert r.status_code == 200
    pages = r.json()
    slugs = [p["slug"] for p in pages]
    assert slugs[:3] == ["methodology", "data-sources", "limitations"]
    assert "API" not in slugs and "CONTRACTS" not in slugs and "DEV_PROGRESS" not in slugs
    assert pages[0]["title"] == "Research methodology"
    page = client.get("/api/docs/pages/methodology").json()
    assert page["markdown"].startswith("# Research methodology") and page["title"] == "Research methodology"
    for bad in ("..%2FREADME", "dev", "API", "DEV_PROGRESS", "..", "%2E%2E"):
        assert client.get(f"/api/docs/pages/{bad}").status_code == 404, bad
