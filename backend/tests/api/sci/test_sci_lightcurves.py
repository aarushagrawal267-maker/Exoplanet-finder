"""Light-curve endpoint tests. TEST DATA catalogue + REAL Kepler FITS fixtures (see conftest.py)."""

from __future__ import annotations

from sci_testlib import KEPLER2, KEPLER90, signal_id


def test_lightcurve_without_ephemeris(client, sci_catalog):
    r = client.get(f"/api/lightcurves/{KEPLER2}", params={"max_points": 2000})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kepid"] == KEPLER2 and body["time_system"] == "BKJD" and body["mission"] == "Kepler"
    assert body["quarters"] == [2, 3]
    assert [s["id"] for s in body["segments"]] == [2, 3]
    assert body["segments"][0]["n_used"] <= body["segments"][0]["n_cadences"]
    for name in ("raw", "normalized", "trend", "flat"):
        st = body["stages"][name]
        assert 0 < len(st["time"]) == len(st["flux"]) <= 2000
        assert st["n_original"] >= len(st["time"])
    assert body["folded"] is None and body["ephemeris"] is None and body["transit_times"] is None
    assert body["cleaning"]["clean"]["n_input"] == body["n_cadences"]
    assert body["cached"] is False
    again = client.get(f"/api/lightcurves/{KEPLER2}", params={"max_points": 2000}).json()
    assert again["cached"] is True


def test_lightcurve_with_catalogue_signal(client, sci_catalog):
    sid = signal_id(sci_catalog, "TCE-010666592-01")
    r = client.get(f"/api/lightcurves/{KEPLER2}", params={"signal_id": sid, "max_points": 3000})
    assert r.status_code == 200, r.text
    body = r.json()
    eph = body["ephemeris"]
    assert eph["source"] == "catalogue" and abs(eph["period_days"] - 2.20474) < 1e-6
    tt = body["transit_times"]
    span = (body["segments"][0]["t_start"], body["segments"][-1]["t_end"])
    assert len(tt) > 70 and all(span[0] <= t <= span[1] for t in tt)
    folded = body["folded"]
    assert len(folded["phase"]) == len(folded["flux"]) > 0
    binned = folded["binned"]
    assert len(binned["phase"]) > 50
    # the binned curve shows the (real) Kepler-2 b transit at phase 0
    i0 = min(range(len(binned["phase"])), key=lambda i: abs(binned["phase"][i]))
    assert binned["flux"][i0] < 0.996
    assert body["quality"]["grade"] in ("A", "B", "C", "D")
    assert body["signal_id"] == sid


def test_lightcurve_manual_ephemeris_and_errors(client, sci_catalog):
    ok = client.get(
        f"/api/lightcurves/{KEPLER2}",
        params={
            "period": 2.20474,
            "epoch": 132.381,
            "duration_hours": 3.86,
            "detrend": "savgol",
            "max_points": 1000,
        },
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["ephemeris"]["source"] == "manual" and ok.json()["detrend"] == "savgol"

    partial = client.get(f"/api/lightcurves/{KEPLER2}", params={"period": 2.2})
    assert partial.status_code == 400 and partial.json()["code"] == "invalid_ephemeris"
    too_long = client.get(
        f"/api/lightcurves/{KEPLER2}", params={"period": 0.1, "epoch": 1, "duration_hours": 5}
    )
    assert too_long.status_code == 400 and too_long.json()["code"] == "invalid_ephemeris"
    missing = client.get("/api/lightcurves/1000001")
    assert missing.status_code == 404
    assert missing.json()["code"] == "not_downloaded" and "download" in missing.json()["hint"].lower()
    other = signal_id(sci_catalog, "TCE-011442793-01")
    mismatch = client.get(f"/api/lightcurves/{KEPLER2}", params={"signal_id": other})
    assert mismatch.status_code == 400 and mismatch.json()["code"] == "signal_mismatch"
    assert client.get(f"/api/lightcurves/{KEPLER2}", params={"signal_id": 999999}).status_code == 404
    assert client.get(f"/api/lightcurves/{KEPLER2}", params={"detrend": "nope"}).status_code == 422


def test_lightcurve_multi_planet_star_masks_siblings(client, sci_catalog):
    sid = signal_id(sci_catalog, "PL-Kepler-90_i")
    r = client.get(f"/api/lightcurves/{KEPLER90}", params={"signal_id": sid, "max_points": 1500})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["quarters"] == [3]
    detrend = body["cleaning"]["detrend"]
    assert detrend["transit_masked"] is True
    assert detrend["n_excluded_extra"] >= 0  # other Kepler-90 planets masked from the trend fit
    assert body["ephemeris"]["label"] == "PL-Kepler-90_i"
