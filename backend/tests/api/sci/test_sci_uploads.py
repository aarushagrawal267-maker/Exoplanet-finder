"""Upload endpoint tests.

The FITS upload is a REAL Kepler fixture file (Kepler-2 Q3). The CSV upload is the same real
quarter re-expressed as a text table (TIME converted to full BJD) — no invented photometry.
"""

from __future__ import annotations

import io

import numpy as np
import pytest
from sci_testlib import KEPLER2_FITS


def _kepler2_csv_bjd() -> bytes:
    from exofinder.astro.io_fits import read_fits_lightcurve

    lc = read_fits_lightcurve(KEPLER2_FITS[1])
    ok = np.isfinite(lc.flux)
    buf = io.StringIO()
    buf.write("# Kepler-2 Q3 PDCSAP flux re-expressed as CSV for a test (real data)\n")
    buf.write("BJD_TDB,rel_flux,flux_unc\n")
    med = np.nanmedian(lc.flux)
    for t, f, e in zip(lc.time[ok] + 2454833.0, lc.flux[ok] / med, lc.flux_err[ok] / med, strict=True):
        buf.write(f"{t:.6f},{f:.7f},{e:.7f}\n")
    return buf.getvalue().encode()


def test_fits_upload_parse_and_lightcurve(client, api_env):
    data = KEPLER2_FITS[1].read_bytes()
    r = client.post("/api/uploads", files={"file": ("kplr010666592-q3_llc.fits", data, "application/fits")})
    assert r.status_code == 200, r.text
    up = r.json()
    assert up["kind"] == "fits" and up["n_rows"] > 4000 and up["meta"]["mission"] == "Kepler"
    assert up["meta"]["time_system"] == "BKJD" and len(up["preview_rows"]) == 10
    uid = up["upload_id"]
    assert (api_env / "uploads" / uid / "meta.json").is_file()

    early = client.get(f"/api/uploads/{uid}/lightcurve")
    assert early.status_code == 409 and early.json()["code"] == "upload_not_parsed"

    p = client.post(f"/api/uploads/{uid}/parse", json={"time_system": "BJD"})
    assert p.status_code == 200, p.text
    parsed = p.json()
    assert parsed["time_system"] == "BKJD"  # header wins over the request
    assert any("FITS header declares BKJD" in w for w in parsed["warnings"])
    assert any("one Kepler file" in w for w in parsed["warnings"])
    assert 80 < parsed["time_span_days"] < 100 and abs(parsed["cadence_days"] * 1440 - 29.4) < 0.5

    lc = client.get(
        f"/api/uploads/{uid}/lightcurve",
        params={"period": 2.20474, "epoch": 132.381, "duration_hours": 3.86, "max_points": 1500},
    )
    assert lc.status_code == 200, lc.text
    body = lc.json()
    assert body["upload_id"] == uid and body["source"]["type"] == "upload"
    assert body["kepid"] == 10666592  # KEPLERID from the FITS header (used for seen_in_split)
    assert body["folded"] is not None and len(body["transit_times"]) > 30
    assert client.get(f"/api/uploads/{uid}").json()["parsed"]["n_points"] == parsed["n_points"]


def test_csv_upload_mapping_and_bjd_conversion(client, api_env):
    r = client.post("/api/uploads", files={"file": ("kepler2_q3.csv", _kepler2_csv_bjd(), "text/csv")})
    assert r.status_code == 200, r.text
    up = r.json()
    assert up["kind"] == "csv" and up["columns"] == ["BJD_TDB", "rel_flux", "flux_unc"]
    assert up["suggested_mapping"]["time"] == "BJD_TDB" and up["suggested_mapping"]["flux"] == "rel_flux"
    assert up["suggested_time_system"] == "BJD"
    assert len(up["preview_rows"]) == 10 and up["preview_rows"][0]["BJD_TDB"] > 2.45e6
    uid = up["upload_id"]
    bad = client.post(
        f"/api/uploads/{uid}/parse",
        json={"mapping": {"time": "nope", "flux": "rel_flux"}, "time_system": "BJD"},
    )
    assert bad.status_code == 400 and bad.json()["code"] == "invalid_lightcurve"
    wrong_ts = client.post(f"/api/uploads/{uid}/parse", json={"time_system": "BKJD"})
    assert wrong_ts.status_code == 400
    p = client.post(
        f"/api/uploads/{uid}/parse",
        json={
            "mapping": {"time": "BJD_TDB", "flux": "rel_flux", "flux_err": "flux_unc"},
            "time_system": "BJD",
        },
    )
    assert p.status_code == 200, p.text
    parsed = p.json()
    assert parsed["time_system"] == "BKJD" and parsed["input_time_system"] == "BJD"
    assert 250 < parsed["time_start"] < 350  # BJD - 2454833 (Q3 is BKJD ~260-350)
    assert parsed["out_of_distribution"] is True
    lc = client.get(f"/api/uploads/{uid}/lightcurve", params={"max_points": 500}).json()
    assert lc["time_system"] == "BKJD" and lc["segments"] and lc["n_points_final"] > 4000


def test_upload_errors(client, api_env, monkeypatch: pytest.MonkeyPatch):
    r = client.post("/api/uploads", files={"file": ("notes.pdf", b"%PDF-1.4", "application/pdf")})
    assert r.status_code == 400 and r.json()["code"] == "unsupported_file_type"
    r = client.post("/api/uploads", files={"file": ("empty.csv", b"", "text/csv")})
    assert r.status_code == 400 and r.json()["code"] == "invalid_upload"
    r = client.post(
        "/api/uploads", files={"file": ("broken.fits", b"SIMPLE  =  T" + b" " * 100, "application/fits")}
    )
    assert r.status_code == 400 and r.json()["code"] == "invalid_file"
    assert not any((api_env / "uploads").iterdir())  # failed uploads leave nothing behind
    from exofinder.services import uploads

    monkeypatch.setattr(uploads, "MAX_UPLOAD_BYTES", 1000)
    r = client.post("/api/uploads", files={"file": ("big.csv", b"t,f\n" + b"1,1\n" * 1000, "text/csv")})
    assert r.status_code == 413 and r.json()["code"] == "file_too_large"
    assert client.get("/api/uploads/" + "0" * 32).status_code == 404
    assert client.get("/api/uploads/../../etc").status_code == 404
    r = client.post("/api/uploads/" + "f" * 32 + "/parse", json={})
    assert r.status_code == 404 and r.json()["code"] == "upload_not_found"
