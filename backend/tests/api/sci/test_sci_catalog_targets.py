"""Catalogue and target endpoint tests on the HAND-MADE TEST DATA catalogue (see conftest.py).

NASA services are never contacted: refresh/download jobs run with patched data-layer functions.
"""

from __future__ import annotations

import pytest
from sci_testlib import KEPLER2, KEPLER90, wait_job


# --------------------------------------------------------------------------------------------------
# catalogue
# --------------------------------------------------------------------------------------------------
def test_snapshots_have_provenance(client, sci_catalog):
    r = client.get("/api/catalog/snapshots")
    assert r.status_code == 200
    snaps = r.json()
    assert {s["source"] for s in snaps} == {"dr24_tce", "koi_cumulative", "confirmed", "stellar"}
    for s in snaps:
        assert len(s["sha256"]) == 64 and s["row_count"] > 0 and s["retrieved_at"]
        assert "table_name" in s and "query" in s and "validation" in s
    assert len(client.get("/api/catalog/snapshots", params={"source": "stellar"}).json()) == 1


def test_signal_filters_sort_and_pagination(client, sci_catalog):
    r = client.get("/api/catalog/signals", params={"limit": 500})
    assert r.status_code == 200
    page = r.json()
    total = page["total"]
    assert total == len(page["items"]) >= 15
    first = page["items"][0]
    for key in (
        "signal_key",
        "kepid",
        "category",
        "av_training_set",
        "koi_disposition",
        "fpflags",
        "lc_status",
    ):
        assert key in first
    conf = client.get("/api/catalog/signals", params={"category": "confirmed"}).json()
    assert conf["total"] > 0 and all(s["category"] == "confirmed" for s in conf["items"])
    both = client.get("/api/catalog/signals", params={"category": "confirmed,candidate"}).json()
    assert both["total"] > conf["total"]
    pc = client.get("/api/catalog/signals", params={"av_label": "PC"}).json()
    assert all(s["av_training_set"] == "PC" for s in pc["items"])
    nolabel = client.get("/api/catalog/signals", params={"av_label": "none"}).json()
    assert all(s["av_training_set"] is None for s in nolabel["items"]) and nolabel["total"] > 0
    k2 = client.get("/api/catalog/signals", params={"kepid": KEPLER2}).json()
    assert {s["signal_key"] for s in k2["items"]} == {"TCE-010666592-01", "TCE-010666592-02"}
    with_lc = client.get("/api/catalog/signals", params={"has_lightcurve": True}).json()
    assert {s["kepid"] for s in with_lc["items"]} == {KEPLER2, KEPLER90}
    conflicts = client.get("/api/catalog/signals", params={"conflict": True}).json()
    assert all(s["label_conflict"] for s in conflicts["items"])
    by_period = client.get(
        "/api/catalog/signals", params={"sort": "period_days", "order": "desc", "limit": 3}
    ).json()
    periods = [s["period_days"] for s in by_period["items"]]
    assert periods == sorted(periods, reverse=True) and by_period["total"] == total
    window = client.get("/api/catalog/signals", params={"min_period": 5, "max_period": 20}).json()
    assert all(5 <= s["period_days"] <= 20 for s in window["items"])
    snr = client.get("/api/catalog/signals", params={"min_snr": 100}).json()
    assert all(s["model_snr"] >= 100 for s in snr["items"])
    p1 = client.get("/api/catalog/signals", params={"limit": 2, "offset": 0}).json()["items"]
    p2 = client.get("/api/catalog/signals", params={"limit": 2, "offset": 2}).json()["items"]
    assert {s["id"] for s in p1}.isdisjoint({s["id"] for s in p2})
    found = client.get("/api/catalog/signals", params={"search": "Kepler-90"}).json()
    assert found["total"] >= 3 and all(s["kepid"] == KEPLER90 for s in found["items"])
    assert client.get("/api/catalog/signals", params={"search": "KIC 10666592"}).json()["total"] == 2
    bad = client.get("/api/catalog/signals", params={"sort": "nope"})
    assert bad.status_code == 400 and bad.json()["code"] == "invalid_sort"
    assert client.get("/api/catalog/signals", params={"limit": 501}).status_code == 422


def test_stats_histograms(client, sci_catalog):
    r = client.get("/api/catalog/stats")
    assert r.status_code == 200
    st = r.json()
    assert st["total"] == sum(st["categories"].values())
    assert st["with_lightcurve"] >= 5
    keys = {h["key"] for h in st["histograms"]}
    assert keys == {"log10_period", "log10_depth", "log10_snr"}
    hp = next(h for h in st["histograms"] if h["key"] == "log10_period")
    assert len(hp["edges"]) == 41
    assert sum(sum(c) for c in hp["counts"].values()) + sum(hp["n_missing"].values()) == st["total"]


def test_refresh_job_success_and_nasa_unavailable(client, sci_catalog, monkeypatch: pytest.MonkeyPatch):
    from exofinder.data import archive, catalog

    def fake_refresh(session, progress=None, sources=(), **kw):
        progress(1, 5, "Downloading dr24_tce from the NASA Exoplanet Archive")
        return {
            "snapshot_ids": {},
            "snapshots": {},
            "written": {},
            "summary": {"n_signals": 0},
            "ingest_seconds": 0.0,
        }

    monkeypatch.setattr(catalog, "refresh_catalog", fake_refresh)
    r = client.post("/api/catalog/refresh", json={"sources": ["dr24_tce"]})
    assert r.status_code == 202, r.text
    assert r.json()["kind"] == "catalog_refresh" and r.json()["params"] == {"sources": ["dr24_tce"]}
    done = wait_job(r.json()["id"])
    assert done["status"] == "succeeded" and done["result"]["summary"] == {"n_signals": 0}

    def down(session, progress=None, sources=(), **kw):
        raise archive.ArchiveUnavailableError("NASA Exoplanet Archive unavailable after 5 attempts: HTTP 503")

    monkeypatch.setattr(catalog, "refresh_catalog", down)
    r = client.post("/api/catalog/refresh")
    assert r.status_code == 202
    failed = wait_job(r.json()["id"])
    assert (
        failed["status"] == "failed" and "[nasa_unavailable]" in failed["error"] and "Hint" in failed["error"]
    )
    assert client.post("/api/catalog/refresh", json={"sources": ["bogus"]}).status_code == 400


def test_refresh_refuses_while_running(client, sci_catalog):
    from exofinder.db.models import Job
    from exofinder.db.session import session_scope

    with session_scope() as s:
        s.add(
            Job(
                id="f" * 32, kind="catalog_refresh", title="TEST running refresh", status="running", params={}
            )
        )
    r = client.post("/api/catalog/refresh")
    assert r.status_code == 409 and r.json()["code"] == "job_running"


# --------------------------------------------------------------------------------------------------
# targets
# --------------------------------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("query", "kepid", "matched_on"),
    [
        ("Kepler-90", KEPLER90, "kepler_host_name"),
        ("kepler 90", KEPLER90, "kepler_host_name"),
        ("Kepler-90 h", KEPLER90, "kepler_name"),
        ("KIC 11442793", KEPLER90, "kepid"),
        ("11442793", KEPLER90, "kepid"),
        ("kplr011442793", KEPLER90, "kepid"),
        ("K00351", KEPLER90, "kepoi_name"),
        ("K00351.01", KEPLER90, "kepoi_name"),
        ("KOI-351.02", KEPLER90, "kepoi_name"),
        ("Kepler-2", KEPLER2, "kepler_host_name"),
    ],
)
def test_search_forms(client, sci_catalog, query, kepid, matched_on):
    r = client.get("/api/targets/search", params={"q": query})
    assert r.status_code == 200
    hits = r.json()
    assert hits and hits[0]["kepid"] == kepid and hits[0]["matched_on"] == matched_on, hits
    assert hits[0]["n_signals"] >= 1 and hits[0]["lc_status"] == "available"
    assert len(hits) <= 20


def test_search_details(client, sci_catalog):
    h = client.get("/api/targets/search", params={"q": "Kepler-90 h"}).json()[0]
    assert (
        h["matched_signal_key"] in ("TCE-011442793-01", "KOI-K00351.01")
        and h["label"] == "Kepler-90 (KIC 11442793)"
    )
    assert client.get("/api/targets/search", params={"q": "zzzz-nothing"}).json() == []
    assert client.get("/api/targets/search", params={"q": ""}).status_code == 422
    partial = client.get("/api/targets/search", params={"q": "1000"}).json()
    assert partial and all(str(x["kepid"]).startswith("1000") for x in partial)
    assert all(x["matched_on"] == "kepid_prefix" for x in partial)


def test_target_detail(client, fixture_model):
    r = client.get(f"/api/targets/{KEPLER2}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["target"]["kepid"] == KEPLER2 and body["target"]["lc_cached"] is True
    assert body["target"]["lc_quarters"] == [2, 3]
    st = body["stellar"]
    assert (
        st["teff"]["value"] == 6440
        and st["teff"]["provenance"] == "catalogue"
        and "keplerstellar" in st["teff"]["source"]
    )
    keys = {s["signal_key"] for s in body["signals"]}
    assert keys == {"TCE-010666592-01", "TCE-010666592-02"}
    assert all(s["provenance"] for s in body["signals"])
    assert body["datasets"] == [
        {
            "dataset_id": fixture_model["dataset_id"],
            "dataset_name": "TEST DATA fixture dataset",
            "dataset_status": "ready",
            "split": "train",
            "n_signals": 1,
        }
    ]
    assert body["recent_predictions"] == []
    assert body["reserved_showcase"] is False
    assert client.get(f"/api/targets/{KEPLER90}").json()["reserved_showcase"] is True
    missing = client.get("/api/targets/123")
    assert missing.status_code == 404 and missing.json()["code"] == "target_not_found"


def test_download_idempotent_and_job(client, sci_catalog, monkeypatch: pytest.MonkeyPatch):
    r = client.post(f"/api/targets/{KEPLER2}/download")
    assert r.status_code == 200 and r.json()["kepid"] == KEPLER2 and r.json()["lc_status"] == "available"

    from exofinder.data import acquire

    def fake_ensure(session, kepid, cancel=None, **kw):
        raise acquire.LightCurveUnavailableError(
            kepid, "no_data", "MAST has no Kepler long-cadence light curve"
        )

    monkeypatch.setattr(acquire, "ensure_lightcurve", fake_ensure)
    r = client.post("/api/targets/1000001/download")
    assert r.status_code == 202, r.text
    job = r.json()
    assert job["kind"] == "download" and job["params"] == {"kepid": 1000001}
    done = wait_job(job["id"])
    assert done["status"] == "failed" and "[no_data]" in done["error"]
    assert client.post("/api/targets/42/download").status_code == 404


def test_catalogue_refresh_is_refused_while_a_dataset_is_being_built(client, db):
    """A refresh replaces/retires catalogue rows; it must not run while a (CLI or API) build reads them."""
    from exofinder.db.models import Job, utcnow

    db.add(
        Job(
            id="build1",
            kind="build_dataset",
            title="Build dataset 'X'",
            status="running",
            params={},
            heartbeat_at=utcnow(),
            owner="cli:test:1",
        )
    )
    db.commit()
    r = client.post("/api/catalog/refresh")
    assert r.status_code == 409 and r.json()["code"] == "dataset_building"
