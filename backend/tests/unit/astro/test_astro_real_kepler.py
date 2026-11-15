"""Real NASA Kepler data: Kepler-2 (HAT-P-7) quarters 2+3 and Kepler-90 quarter 3.

Catalogue ephemerides come from the NASA Exoplanet Archive cumulative KOI table (see conftest.py).
Kepler-2 b: P = 2.204735417 d, T0 = 121.3585417 BKJD, T14 = 3.88864 h, depth = 6674.7 ppm.
"""

from __future__ import annotations

import numpy as np
import pytest

from exofinder.astro.bls import run_bls
from exofinder.astro.pipeline import preprocess_for_display, process_lightcurve


@pytest.fixture(scope="module")
def kepler2_processed(kepler2_stitched, kepler2_ephemeris, kepler2_catalogue):
    return process_lightcurve(
        kepler2_stitched, kepler2_ephemeris, catalogue_depth_ppm=kepler2_catalogue["depth_ppm"]
    )


def test_kepler2_quality_ok(kepler2_processed):
    q = kepler2_processed.quality
    assert q.ok, q.messages
    assert q.grade in ("A", "B")
    assert q.n_transits_observed >= 70  # ~82 predicted in Q2+Q3, a few fall in gaps
    assert q.local_empty_frac == 0.0 and q.global_empty_frac < 0.05


def test_kepler2_local_view_minimum_at_phase_zero(kepler2_processed, kepler2_ephemeris):
    v = kepler2_processed.views
    phase_min = v.local_phase[int(np.argmin(v.local_view))]
    assert abs(phase_min) < 0.1 * kepler2_ephemeris.duration_days
    assert v.local_view.min() == pytest.approx(-1.0) and abs(np.median(v.local_view)) < 1e-6
    assert kepler2_processed.quality.alignment_offset_durations < 0.05
    assert abs(v.global_phase[int(np.argmin(v.global_view))]) < 0.1 * kepler2_ephemeris.duration_days


def test_kepler2_depth_matches_catalogue(kepler2_processed, kepler2_catalogue):
    diag = kepler2_processed.stages["diagnostics"]
    cat = kepler2_catalogue["depth_ppm"]
    assert diag["snr"]["depth_ppm"] == pytest.approx(cat, rel=0.20)
    assert diag["transit_fit"]["depth_ppm"] == pytest.approx(cat, rel=0.20)
    assert kepler2_processed.quality.depth_ratio_vs_catalogue == pytest.approx(1.0, abs=0.2)
    assert diag["transit_fit"]["duration_hours"] == pytest.approx(kepler2_catalogue["duration_h"], rel=0.15)
    assert abs(diag["transit_fit"]["epoch"] - kepler2_catalogue["epoch"]) * 1440 < 10.0  # minutes


def test_kepler2_odd_even_consistent_and_secondary_eclipse(kepler2_processed):
    diag = kepler2_processed.stages["diagnostics"]
    oe = diag["odd_even"]
    assert oe["diff_sigma"] < 3.0
    assert oe["depth_odd_ppm"] == pytest.approx(oe["depth_even_ppm"], rel=0.02)
    # Kepler-2 b (HAT-P-7 b) has a known weak occultation at phase 0.5; it is measured, not asserted deep
    sec = diag["secondary"]
    assert sec["phase"] == pytest.approx(0.5, abs=0.02)
    assert sec["significance_sigma"] > 5.0
    assert 0 < sec["depth_ppm"] < 150.0


def test_kepler2_bls_recovers_period(kepler2_stitched, kepler2_catalogue):
    """Blind search: flattened without the catalogue ephemeris, then BLS."""
    flat = preprocess_for_display(kepler2_stitched)["flat"]
    res = run_bls(flat)
    p = kepler2_catalogue["period"]
    # period error accumulated over Q2+Q3 (~80 orbits) stays below T14/4 (measured ~0.08 T14)
    drift_hours = abs(res["period"] - p) * res["baseline_days"] / p * 24.0
    assert drift_hours < 0.25 * kepler2_catalogue["duration_h"]
    dt = (res["epoch"] - kepler2_catalogue["epoch"] + p / 2) % p - p / 2
    assert abs(dt) * 24 < 0.5 * kepler2_catalogue["duration_h"]
    assert res["n_transits"] >= 70


def test_kepler90_quality_gating(kepler90_q3, kepler90_ephemerides):
    """One quarter of Kepler-90: c (8.7 d) is usable, d (59.7 d) and h (331.6 d) are not."""
    c = process_lightcurve(kepler90_q3, kepler90_ephemerides["c"], catalogue_depth_ppm=160.4)
    assert c.quality.ok and c.quality.n_transits_observed >= 8
    assert c.features["snr"] > 5
    assert c.features["depth_ppm"] == pytest.approx(160.4, rel=0.5)
    d = process_lightcurve(kepler90_q3, kepler90_ephemerides["d"])
    assert "period_too_long" in d.quality.issues and not d.quality.ok
    h = process_lightcurve(kepler90_q3, kepler90_ephemerides["h"])
    assert {"too_few_transits", "nan_in_views"} <= set(h.quality.issues)
    assert not h.quality.ok and h.quality.grade == "D"
    assert all(np.isfinite(v) for v in h.features.values())
