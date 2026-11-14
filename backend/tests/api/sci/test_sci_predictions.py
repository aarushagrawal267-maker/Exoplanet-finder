"""Prediction endpoint tests.

The model is a TEST FIXTURE (logistic regression trained on SYNTHETIC toy views, is_fixture=True);
its probabilities are meaningless and the tests only check plumbing and labelling. Light curves are
the REAL Kepler FITS fixtures; catalogue rows are TEST DATA.
"""

from __future__ import annotations

import pytest
from sci_testlib import KEPLER2, KEPLER2_FITS, KEPLER90, wait_job


def test_no_model_is_409(client, sci_catalog):
    sid = sci_catalog["signals"]["TCE-010666592-01"]
    r = client.post(
        "/api/predictions", json={"source": {"type": "catalog", "kepid": KEPLER2, "signal_id": sid}}
    )
    assert r.status_code == 409
    assert r.json()["code"] == "no_model" and "Train a model first" in r.json()["hint"]
    r = client.post("/api/predictions/batch", json={})
    assert r.status_code == 409 and r.json()["code"] == "no_model"


def test_predict_catalog_signal(client, fixture_model):
    sid = fixture_model["signals"]["TCE-010666592-01"]
    r = client.post(
        "/api/predictions", json={"source": {"type": "catalog", "kepid": KEPLER2, "signal_id": sid}}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    (res,) = body["results"]
    assert res["model_version_id"] == fixture_model["model_id"] and res["is_fixture_model"] is True
    assert 0.0 <= res["probability"] <= 1.0 and 0.0 <= res["raw_probability"] <= 1.0
    assert res["predicted_label"] == int(res["probability"] >= res["threshold"])
    assert res["threshold_mode"] == "validation_f1"
    assert res["seen_in_split"] == "train"  # Kepler-2 is in the fixture dataset's TRAIN split
    assert (
        res["catalog_labels"]["av_training_set"] == "PC" and res["catalog_labels"]["category"] == "confirmed"
    )
    assert res["source_type"] == "catalog" and res["signal_key"] == "TCE-010666592-01"
    assert res["inference_ms"] >= 0
    assert any("TRAINING set" in w for w in body["warnings"])
    assert any("TEST FIXTURE" in w for w in body["warnings"])
    assert "research leads" in body["disclaimer"]
    v = body["views"]
    assert len(v["global"]) == 2001 and len(v["local"]) == 201 and len(v["global_phase"]) == 2001
    assert body["ephemeris"]["source"] == "catalogue" and body["quality"]["grade"] in ("A", "B", "C", "D")
    assert len(body["features"]) == 15 and body["signal"]["signal_key"] == "TCE-010666592-01"

    # detail + history
    d = client.get(f"/api/predictions/{res['id']}")
    assert d.status_code == 200, d.text
    detail = d.json()
    assert detail["views"]["global"] == v["global"] and detail["views_source"].startswith("stored")
    assert detail["seen_in_split"] == "train" and any("TRAINING" in w for w in detail["warnings"])
    hist = client.get("/api/predictions", params={"kepid": KEPLER2}).json()
    assert hist["total"] == 1 and hist["items"][0]["id"] == res["id"]
    assert client.get("/api/predictions", params={"kepid": KEPLER90}).json()["total"] == 0
    assert client.get("/api/predictions/999999").status_code == 404


def test_predict_threshold_mode_and_test_split(client, fixture_model):
    r = client.put("/api/settings", json={"default_threshold_mode": "fixed_0.5"})
    assert r.status_code == 200
    sid = fixture_model["signals"]["PL-Kepler-90_i"]
    r = client.post(
        "/api/predictions", json={"source": {"type": "catalog", "kepid": KEPLER90, "signal_id": sid}}
    )
    assert r.status_code == 200, r.text
    res = r.json()["results"][0]
    assert res["threshold"] == 0.5 and res["threshold_mode"] == "fixed_0.5"
    assert res["seen_in_split"] == "test"
    assert not any("TRAINING" in w for w in r.json()["warnings"])


def test_predict_bls_and_manual_and_upload(client, fixture_model):
    mid = fixture_model["model_id"]
    r = client.post(
        "/api/predictions",
        json={
            "model_version_ids": [mid],
            "source": {"type": "catalog", "kepid": KEPLER2},
            "ephemeris_source": "bls",
        },
    )
    assert r.status_code == 200, r.text
    assert (
        r.json()["ephemeris"]["source"] == "measured"
        and abs(r.json()["ephemeris"]["period_days"] / 2.20474 - 1) < 1e-3
    )
    assert any("BLS" in w for w in r.json()["warnings"])

    r = client.post(
        "/api/predictions",
        json={
            "source": {"type": "catalog", "kepid": KEPLER2},
            "ephemeris_source": "manual",
            "ephemeris": {"period_days": 2.20474, "epoch": 132.381, "duration_hours": 3.86},
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["ephemeris"]["source"] == "manual" and r.json()["results"][0]["signal_id"] is None

    up = client.post(
        "/api/uploads", files={"file": ("q3.fits", KEPLER2_FITS[1].read_bytes(), "application/fits")}
    ).json()
    client.post(f"/api/uploads/{up['upload_id']}/parse", json={})
    r = client.post(
        "/api/predictions",
        json={
            "source": {"type": "upload", "upload_id": up["upload_id"]},
            "ephemeris_source": "manual",
            "ephemeris": {"period_days": 2.20474, "epoch": 132.381, "duration_hours": 3.86},
        },
    )
    assert r.status_code == 200, r.text
    res = r.json()["results"][0]
    assert res["source_type"] == "fits" and res["seen_in_split"] == "train"  # KEPLERID header -> Kepler-2
    assert r.json()["source"]["type"] == "upload"
    hist = client.get("/api/predictions", params={"source_type": "fits"}).json()
    assert hist["total"] == 1


def test_predict_errors(client, fixture_model):
    sigs = fixture_model["signals"]
    r = client.post("/api/predictions", json={"source": {"type": "catalog", "kepid": KEPLER2}})
    assert r.status_code == 400 and r.json()["code"] == "signal_required"
    r = client.post(
        "/api/predictions",
        json={
            "source": {"type": "catalog", "kepid": 1000006, "signal_id": sigs["KOI-K90006.01"]},
            "download_if_missing": False,
        },
    )
    assert r.status_code == 409 and r.json()["code"] == "not_downloaded"
    r = client.post(
        "/api/predictions",
        json={"source": {"type": "catalog", "kepid": KEPLER2, "signal_id": sigs["TCE-011442793-01"]}},
    )
    assert r.status_code == 400 and r.json()["code"] == "signal_mismatch"
    r = client.post(
        "/api/predictions",
        json={
            "model_version_ids": [12345],
            "source": {"type": "catalog", "kepid": KEPLER2, "signal_id": sigs["TCE-010666592-01"]},
        },
    )
    assert r.status_code == 404 and r.json()["code"] == "model_not_found"
    r = client.post(
        "/api/predictions",
        json={"source": {"type": "catalog", "kepid": KEPLER2}, "ephemeris_source": "manual"},
    )
    assert r.status_code == 400 and r.json()["code"] == "invalid_ephemeris"
    # Kepler-90 h (P = 331 d) has no transit in the single cached Kepler-90 quarter
    r = client.post(
        "/api/predictions",
        json={"source": {"type": "catalog", "kepid": KEPLER90, "signal_id": sigs["TCE-011442793-01"]}},
    )
    assert r.status_code == 400 and r.json()["code"] in ("unscorable_signal", "insufficient_data"), r.text


def test_predict_downloads_missing_star_synchronously(client, fixture_model, monkeypatch: pytest.MonkeyPatch):
    """download_if_missing=true calls ensure_lightcurve (patched: no network in tests)."""
    from exofinder.data import acquire

    calls = []

    def fake_ensure(session, kepid, cancel=None, **kw):
        calls.append(kepid)
        raise acquire.LightCurveUnavailableError(
            kepid, "no_data", "MAST has no Kepler long-cadence light curve"
        )

    monkeypatch.setattr(acquire, "ensure_lightcurve", fake_ensure)
    sid = fixture_model["signals"]["KOI-K90006.01"]
    r = client.post(
        "/api/predictions", json={"source": {"type": "catalog", "kepid": 1000006, "signal_id": sid}}
    )
    assert calls == [1000006]
    assert r.status_code == 409 and r.json()["code"] == "lightcurve_unavailable"


def test_batch_and_candidates(client, fixture_model):
    r = client.post("/api/predictions/batch", json={"category": "candidate"})
    assert r.status_code == 409 and r.json()["code"] == "nothing_to_score"  # no candidate star has data
    r = client.post("/api/predictions/batch", json={"category": "all", "only_downloaded": True})
    assert r.status_code == 202, r.text
    job = r.json()
    assert job["kind"] == "batch_predict"
    done = wait_job(job["id"])
    assert done["status"] == "succeeded", done
    res = done["result"]
    assert res["is_fixture_model"] is True and res["n_signals"] >= 5
    assert res["n_scored"] + res["n_failed"] == res["n_signals"] and res["n_scored"] >= 2
    # e.g. Kepler-90 h has no transit in the single Kepler-90 quarter: counted, not scored
    assert set(res["failures_by_reason"]) <= {
        "nan_in_views",
        "insufficient_data",
        "no_ephemeris",
        "processing_error",
    }
    hist = client.get("/api/predictions", params={"batch_job_id": job["id"], "limit": 500}).json()
    assert hist["total"] == res["n_scored"]

    c = client.get("/api/predictions/candidates", params={"category": "all"})
    assert c.status_code == 200, c.text
    page = c.json()
    assert page["total"] == res["n_scored"] and "research leads" in page["disclaimer"]
    items = page["items"]
    probs = [it["mean_probability"] for it in items]
    assert probs == sorted(probs, reverse=True) and items[0]["rank"] == 1
    it = items[0]
    assert it["agreement"]["n_models"] == 1 and it["has_fixture_model_scores"] is True
    assert it["scores"][0]["is_fixture_model"] is True
    assert page["models"][0]["is_fixture"] is True
    kepler2 = [x for x in items if x["kepid"] == KEPLER2]
    assert kepler2 and all(x["seen_in_training"] for x in kepler2)
    # default category=candidate: no candidate signal has been scored
    assert client.get("/api/predictions/candidates").json()["total"] == 0
    # skip_existing: only the signals that could not be scored are attempted again
    r = client.post("/api/predictions/batch", json={"category": "all", "skip_existing": True})
    again = wait_job(r.json()["id"])
    assert again["status"] == "succeeded" and again["result"]["n_signals"] == res["n_failed"]
    assert again["result"]["n_scored"] == 0
