"""Light-curve cache round trip using the real Kepler-2 / Kepler-90 fixture FITS files."""

from __future__ import annotations

import numpy as np
import pytest
from astropy.io import fits
from exof_data_testdata import KEPLER2_Q2, KEPLER2_Q3, KEPLER90_Q3

from exofinder.data.lightcurve_store import (
    build_from_fits,
    delete_lightcurve,
    has_lightcurve,
    lightcurve_path,
    load_lightcurve,
    read_kepler_quarter,
    save_lightcurve,
)

# Kepler-2 b (KOI K00002.01) ephemeris from the NASA Exoplanet Archive cumulative KOI table
# (koi_period, koi_time0bk, koi_duration, koi_depth), retrieved 2026-11-14.
K2_PERIOD = 2.204735417
K2_T0_BKJD = 121.3585417
K2_DURATION_H = 3.88864
K2_DEPTH_PPM = 6674.7


def _raw(path):
    with fits.open(path) as h:
        d = h[1].data
        return (
            np.array(d["TIME"], float),
            np.array(d["PDCSAP_FLUX"], float),
            np.array(d["SAP_QUALITY"], int),
        )


def test_read_quarter_keeps_raw_values():
    q = read_kepler_quarter(KEPLER2_Q2)
    t, f, qual = _raw(KEPLER2_Q2)
    ok = np.isfinite(t)
    assert q["kepid"] == 10666592 and q["quarter"] == 2 and q["n_nan_time"] == int((~ok).sum())
    np.testing.assert_array_equal(q["time"], t[ok])
    np.testing.assert_array_equal(q["flux"], f[ok])  # e-/s, NaN flux kept
    np.testing.assert_array_equal(q["quality"], qual[ok])


def test_build_stitches_and_normalises_per_quarter():
    lc = build_from_fits(10666592, [KEPLER2_Q3, KEPLER2_Q2])  # order of inputs is irrelevant
    n2 = int(np.isfinite(_raw(KEPLER2_Q2)[0]).sum())
    n3 = int(np.isfinite(_raw(KEPLER2_Q3)[0]).sum())
    assert len(lc) == n2 + n3
    assert np.all(np.diff(lc.time) > 0)
    assert lc.meta["quarters"] == [2, 3] and lc.meta["time_system"] == "BKJD"
    assert lc.meta["cleaned"] is False and lc.meta["mission"] == "Kepler"
    assert lc.meta["cadence_days"] == pytest.approx(0.0204336, rel=1e-5)
    for q in (2, 3):
        m = (lc.segment == q) & (lc.quality == 0) & np.isfinite(lc.flux)
        assert np.median(lc.flux[m]) == pytest.approx(1.0, abs=1e-12)
    # un-cleaned: flagged cadences and NaN fluxes are still present
    assert (lc.quality != 0).sum() > 0 and np.isnan(lc.flux).sum() > 0
    # normalisation is a pure per-quarter scale
    t, f, _ = _raw(KEPLER2_Q2)
    med = lc.meta["quarter_medians"]["2"]
    sel = lc.segment == 2
    np.testing.assert_allclose(lc.flux[sel] * med, f[np.isfinite(t)], rtol=1e-12, equal_nan=True)


def test_round_trip(tmp_env):
    lc = build_from_fits(10666592, [KEPLER2_Q2, KEPLER2_Q3])
    assert not has_lightcurve(10666592)
    path = save_lightcurve(10666592, lc)
    assert path == lightcurve_path(10666592) and path.name == "010666592.npz" and has_lightcurve(10666592)
    with np.load(path, allow_pickle=False) as z:
        assert z["time"].dtype == np.float64 and z["flux"].dtype == np.float32
        assert (
            z["flux_err"].dtype == np.float32
            and z["quarter"].dtype == np.int8
            and z["quality"].dtype == np.int32
        )
    back = load_lightcurve(10666592)
    np.testing.assert_array_equal(back.time, lc.time)
    np.testing.assert_array_equal(back.quality, lc.quality)
    np.testing.assert_array_equal(back.segment, lc.segment)
    # float32 storage of ~1.0 values: < 1e-7 relative error (0.1 ppm)
    np.testing.assert_allclose(back.flux, lc.flux, rtol=1e-7, atol=0, equal_nan=True)
    np.testing.assert_allclose(back.flux_err, lc.flux_err, rtol=1e-6, equal_nan=True)
    assert back.meta["quarters"] == [2, 3] and back.meta["kepid"] == 10666592
    assert back.meta["cache_path"] == str(path)
    assert not list(path.parent.glob("*.part"))


def test_cached_curve_shows_kepler2b_transit_at_catalogue_ephemeris(tmp_env):
    """Science check: folding the stored (BKJD) data on the catalogue ephemeris recovers the transit."""
    save_lightcurve(10666592, build_from_fits(10666592, [KEPLER2_Q2, KEPLER2_Q3]))
    lc = load_lightcurve(10666592)
    good = (lc.quality == 0) & np.isfinite(lc.flux)
    phase = (lc.time - K2_T0_BKJD + 0.5 * K2_PERIOD) % K2_PERIOD - 0.5 * K2_PERIOD
    dur = K2_DURATION_H / 24
    in_tr = good & (np.abs(phase) < 0.25 * dur)
    out_tr = good & (np.abs(phase) > dur) & (np.abs(phase) < 3 * dur)
    depth_ppm = 1e6 * (np.median(lc.flux[out_tr]) - np.median(lc.flux[in_tr]))
    assert depth_ppm == pytest.approx(K2_DEPTH_PPM, rel=0.10)
    # a wrong time system (e.g. BJD vs BKJD mix-up) would put the dip elsewhere: shifted epoch sees none
    shifted = (lc.time - (K2_T0_BKJD + 0.5 * K2_PERIOD) + 0.5 * K2_PERIOD) % K2_PERIOD - 0.5 * K2_PERIOD
    in_wrong = good & (np.abs(shifted) < 0.25 * dur)
    assert 1e6 * (np.median(lc.flux[out_tr]) - np.median(lc.flux[in_wrong])) < 500


def test_kepid_mismatch_rejected():
    with pytest.raises(ValueError, match="KIC 11442793"):
        build_from_fits(10666592, [KEPLER2_Q2, KEPLER90_Q3])
    with pytest.raises(ValueError, match="no FITS"):
        build_from_fits(10666592, [])


def test_missing_and_corrupt_cache(tmp_env):
    assert load_lightcurve(11442793) is None
    p = lightcurve_path(11442793)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"not an npz")
    assert load_lightcurve(11442793) is None  # treated as absent, so it gets rebuilt
    assert delete_lightcurve(11442793) and not delete_lightcurve(11442793)


def test_optional_arrays_round_trip_as_none(tmp_env):
    """flux_err/quality that were None must come back as None, not as NaN/zero placeholders.

    Regression: an all-NaN flux_err placeholder made ``astro.cleaning.clean`` (which drops cadences
    with non-finite errors) discard every cadence of the light curve.
    """
    from exofinder.astro.cleaning import clean

    src = build_from_fits(11442793, [KEPLER90_Q3])
    lc = src.copy()
    lc.flux_err = None
    lc.quality = None
    save_lightcurve(11442793, lc)
    back = load_lightcurve(11442793)
    assert back.flux_err is None and back.quality is None
    assert "absent_arrays" not in back.meta
    cleaned, report = clean(back)
    assert report["n_nan_flux_err"] == 0
    assert len(cleaned) == int(np.isfinite(src.flux).sum()) > 4000
    # and a curve that has them keeps them
    save_lightcurve(11442793, src)
    again = load_lightcurve(11442793)
    assert again.flux_err is not None and again.quality is not None


def test_kepler90_single_quarter(tmp_env):
    lc = build_from_fits(11442793, [KEPLER90_Q3])
    save_lightcurve(11442793, lc)
    back = load_lightcurve(11442793)
    assert back.meta["quarters"] == [3] and set(np.unique(back.segment)) == {3}
    assert len(back) == len(lc)
