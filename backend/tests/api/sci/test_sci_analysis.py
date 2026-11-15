"""Analysis endpoint tests on REAL Kepler-2 data (Q2+Q3 fixtures) with the TEST DATA catalogue.

The injection–recovery test injects a SYNTHETIC transit (by design of the tool) into a copy of the
real light curve; nothing is stored.
"""

from __future__ import annotations

from sci_testlib import KEPLER2, KEPLER2_FITS, signal_id


def test_bls_on_catalog_star_finds_kepler2b(client, sci_catalog):
    r = client.post("/api/analysis/bls", json={"source": {"type": "catalog", "kepid": KEPLER2}})
    assert r.status_code == 200, r.text
    body = r.json()
    best = body["best"]
    assert abs(best["period"] / 2.20474 - 1) < 1e-3  # Kepler-2 b (HAT-P-7 b)
    assert best["provenance"] == "measured" and best["n_transits"] > 30 and best["snr"] > 50
    assert 0 < len(body["peaks"]) <= 5 and body["peaks"][0]["is_best"]
    assert len(body["periods"]) == len(body["power"]) > 100
    assert body["ephemeris"]["source"] == "measured" and body["ephemeris"]["label"] == "BLS"
    assert body["search"]["n_periods_searched"] > 1000
    assert any("alias" in w for w in body["warnings"])
    again = client.post("/api/analysis/bls", json={"source": {"type": "catalog", "kepid": KEPLER2}}).json()
    assert again["cached"] is True and again["best"] == best


def test_bls_errors(client, sci_catalog):
    r = client.post("/api/analysis/bls", json={"source": {"type": "catalog", "kepid": 1000001}})
    assert r.status_code == 409 and r.json()["code"] == "not_downloaded"
    r = client.post(
        "/api/analysis/bls",
        json={"source": {"type": "catalog", "kepid": KEPLER2}, "min_period": 5, "max_period": 2},
    )
    assert r.status_code == 400
    r = client.post("/api/analysis/bls", json={"source": {"type": "upload", "upload_id": "a" * 32}})
    assert r.status_code == 404 and r.json()["code"] == "upload_not_found"
    r = client.post("/api/analysis/bls", json={"source": {"type": "elsewhere"}})
    assert r.status_code == 422


def test_bls_on_upload(client, sci_catalog):
    up = client.post(
        "/api/uploads", files={"file": ("q3.fits", KEPLER2_FITS[1].read_bytes(), "application/fits")}
    ).json()
    r = client.post("/api/analysis/bls", json={"source": {"type": "upload", "upload_id": up["upload_id"]}})
    assert r.status_code == 409 and r.json()["code"] == "upload_not_parsed"
    client.post(f"/api/uploads/{up['upload_id']}/parse", json={})
    r = client.post(
        "/api/analysis/bls",
        json={"source": {"type": "upload", "upload_id": up["upload_id"]}, "max_period": 10},
    )
    assert r.status_code == 200, r.text
    assert abs(r.json()["best"]["period"] / 2.20474 - 1) < 2e-3
    assert r.json()["source"]["type"] == "upload"


def test_transit_analysis_with_catalogue_ephemeris(client, sci_catalog):
    sid = signal_id(sci_catalog, "TCE-010666592-01")
    req = {
        "source": {"type": "catalog", "kepid": KEPLER2},
        "ephemeris": {
            "period_days": 2.20474,
            "epoch": 132.381,
            "duration_hours": 3.86,
            "source": "catalogue",
        },
        "signal_id": sid,
    }
    r = client.post("/api/analysis/transit", json=req)
    assert r.status_code == 200, r.text
    body = r.json()
    fit = body["fit"]
    assert fit["converged"] and fit["provenance"] == "measured"
    assert 5000 < fit["depth_ppm"] < 9000  # real Kepler-2 b depth ~6700 ppm
    assert body["odd_even"]["provenance"] == "measured" and "diff_sigma" in body["odd_even"]
    assert body["secondary"]["provenance"] == "measured"
    assert len(body["individual_transits"]) > 10 and body["snr"]["snr"] > 50
    assert body["quality"]["grade"] in ("A", "B")
    assert body["model_curve"] is not None and len(body["model_curve"]["phase"]) == 801
    assert len(body["folded"]["binned"]["phase"]) > 50
    rows = {row["quantity"]: row for row in body["comparison"]}
    assert rows["Depth"]["catalogue"]["provenance"] == "catalogue"
    assert rows["Depth"]["catalogue"]["value"] == 6704
    assert rows["Depth"]["measured"]["provenance"] == "measured"
    assert rows["Planet radius"]["estimate"]["provenance"] == "estimate"
    assert rows["Planet radius"]["measured"] is None  # never presented as a measurement
    derived = body["derived"]
    assert derived["planet_radius_re"]["provenance"] == "estimate" and derived["planet_radius_re"]["note"]
    # Rp ~ sqrt(6700 ppm) x 1.952 R_sun (TEST DATA stellar row copies the published value) ~ 17-18 R_earth
    assert 14 < derived["planet_radius_re"]["value"] < 21
    assert derived["a_over_rstar"]["value"] > 1
    assert (
        body["stellar"]["radius"]["provenance"] == "catalogue" and body["stellar"]["radius"]["value"] == 1.952
    )
    # TCE 2 of Kepler-2 has the same period but sits half an orbit later (the secondary eclipse): it is
    # another signal and is masked from the trend fit; the analysed signal itself is not
    masked = {e["label"] for e in body["masked_other_signals"]}
    assert masked == {"TCE-010666592-02"}


def test_transit_analysis_errors(client, sci_catalog):
    base = {"source": {"type": "catalog", "kepid": KEPLER2}}
    r = client.post(
        "/api/analysis/transit",
        json={**base, "ephemeris": {"period_days": 0.1, "epoch": 132.0, "duration_hours": 5}},
    )
    assert r.status_code == 400 and r.json()["code"] == "invalid_ephemeris"
    r = client.post(
        "/api/analysis/transit",
        json={**base, "ephemeris": {"period_days": -1, "epoch": 132.0, "duration_hours": 5}},
    )
    assert r.status_code == 422
    other = signal_id(sci_catalog, "TCE-011442793-01")
    r = client.post(
        "/api/analysis/transit",
        json={
            **base,
            "ephemeris": {"period_days": 2.20474, "epoch": 132.381, "duration_hours": 3.86},
            "signal_id": other,
        },
    )
    assert r.status_code == 400 and r.json()["code"] == "signal_mismatch"


def test_injection_recovery_is_synthetic_and_recovers_a_clear_signal(client, sci_catalog):
    req = {"kepid": KEPLER2, "period_days": 5.37, "depth_ppm": 3000, "duration_hours": 4.0}
    r = client.post("/api/analysis/injection", json=req)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["synthetic"] is True and "SYNTHETIC" in body["label"]
    assert body["injected"]["period_days"] == 5.37
    # Kepler-2's catalogue signals are masked, so the blind search finds the injected transit
    assert {round(e["period_days"], 3) for e in body["masked_known_signals"]} >= {2.205}
    assert body["recovered_ok"] is True, body["recovered"]
    assert abs(body["recovered"]["period_days"] / 5.37 - 1) < 0.01
    assert body["criteria"]["period_match"] and body["criteria"]["epoch_match"]
    assert len(body["folded_injected"]["phase"]) > 20
    # nothing is stored: no prediction rows, the cached light curve is unchanged
    from exofinder.data.lightcurve_store import load_lightcurve

    assert not load_lightcurve(KEPLER2).meta.get("synthetic")


def test_injection_errors(client, sci_catalog):
    r = client.post(
        "/api/analysis/injection",
        json={"kepid": KEPLER2, "period_days": 150, "depth_ppm": 500, "duration_hours": 5},
    )
    assert r.status_code == 400 and r.json()["code"] == "invalid_parameters"
    r = client.post(
        "/api/analysis/injection",
        json={"kepid": 1000001, "period_days": 5, "depth_ppm": 500, "duration_hours": 5},
    )
    assert r.status_code == 409 and r.json()["code"] == "not_downloaded"
    r = client.post(
        "/api/analysis/injection",
        json={"kepid": KEPLER2, "period_days": 5, "depth_ppm": 0, "duration_hours": 5},
    )
    assert r.status_code == 422
