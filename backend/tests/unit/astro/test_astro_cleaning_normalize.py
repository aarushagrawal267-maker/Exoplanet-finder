"""Cleaning (quality bitmasks, NaNs, sorting), segments, normalisation and stitching."""

from __future__ import annotations

import numpy as np
import pytest

from exofinder.astro.cleaning import KEPLER_BITMASKS, TESS_BITMASKS, assign_segments, clean, resolve_bitmask
from exofinder.astro.errors import LightCurveFormatError
from exofinder.astro.normalize import normalize_segments, stitch
from exofinder.astro.types import LightCurve


def test_bitmasks_match_lightkurve():
    lk = pytest.importorskip("lightkurve.utils")
    k, t = lk.KeplerQualityFlags, lk.TessQualityFlags
    assert KEPLER_BITMASKS == {
        "none": 0,
        "default": k.DEFAULT_BITMASK,
        "hard": k.HARD_BITMASK,
        "hardest": k.HARDEST_BITMASK,
    }
    assert TESS_BITMASKS == {
        "none": 0,
        "default": t.DEFAULT_BITMASK,
        "hard": t.HARD_BITMASK,
        "hardest": t.HARDEST_BITMASK,
    }


def _toy() -> LightCurve:
    t = np.array([5.0, 1.0, 2.0, 3.0, 4.0, 6.0, np.nan, 7.0, 7.0, 8.0])
    f = np.array([1.0, 1.0, np.nan, 1.0, 1.0, 1.0, 1.0, 1.0, 1.1, 1.0])
    q = np.array([0, 0, 0, 32, 128, 0, 0, 0, 0, 0])  # 32 = desaturation (default), 128 = cosmic ray (hard)
    return LightCurve(t, f, flux_err=np.full(10, 1e-3), quality=q, meta={"mission": "Kepler"})


def test_clean_default_hard_none():
    out, rep = clean(_toy(), "default")
    assert rep["n_nan_time"] == 1 and rep["n_quality_flagged"] == 1 and rep["n_nan_flux"] == 1
    assert rep["n_duplicate_time"] == 1 and rep["n_output"] == len(out) == 6
    assert rep["quality_bitmask"] == 1130799 and rep["was_sorted"] is False
    assert np.all(np.diff(out.time) > 0) and np.isfinite(out.flux).all()
    assert 4.0 in out.time  # cosmic-ray flag (128) is not in the default mask
    hard, rep_h = clean(_toy(), "hard")
    assert 4.0 not in hard.time and rep_h["n_quality_flagged"] == 2
    none, rep_n = clean(_toy(), "none")
    assert rep_n["n_quality_flagged"] == 0 and 3.0 in none.time
    as_int, _ = clean(_toy(), 128)
    assert 4.0 not in as_int.time and 3.0 in as_int.time
    with pytest.raises(ValueError):
        resolve_bitmask("bogus")


def test_clean_real_kepler_quarter(kepler2_quarters):
    raw = kepler2_quarters[0]
    out, rep = clean(raw)
    removed = (
        rep["n_nan_time"]
        + rep["n_quality_flagged"]
        + rep["n_nan_flux"]
        + rep["n_nan_flux_err"]
        + rep["n_duplicate_time"]
    )
    assert rep["n_input"] == len(raw) and rep["n_output"] + removed == rep["n_input"]
    assert np.all((out.quality & KEPLER_BITMASKS["default"]) == 0)
    assert np.isfinite(out.flux).all() and np.all(np.diff(out.time) > 0)
    assert len(out) > 0.9 * len(raw)


def test_assign_segments():
    t = np.concatenate([np.arange(0, 5, 0.02), np.arange(6, 10, 0.02), np.arange(10.5, 12, 0.02)])
    lc = assign_segments(LightCurve(t, np.ones_like(t)), gap_days=0.75)
    assert sorted(np.unique(lc.segment).tolist()) == [0, 1]  # 1-day gap splits, 0.5-day gap does not
    assert lc.meta["segments_from_gaps"] is True
    with_seg = LightCurve(t, np.ones_like(t), segment=np.full(t.size, 7))
    assert np.all(assign_segments(with_seg).segment == 7)


def test_normalize_segments_and_errors():
    t = np.arange(200.0)
    seg = np.repeat([1, 2], 100)
    f = np.where(seg == 1, 1000.0, 3000.0) * (1 + 1e-3 * np.sin(t))
    lc = normalize_segments(LightCurve(t, f, flux_err=f * 1e-3, segment=seg))
    for s in (1, 2):
        assert np.median(lc.flux[seg == s]) == pytest.approx(1.0, abs=1e-12)
    np.testing.assert_allclose(lc.flux_err, lc.flux * 1e-3)
    assert set(lc.meta["segment_medians"]) == {"1", "2"}
    with pytest.raises(LightCurveFormatError, match="median flux"):
        normalize_segments(LightCurve(t, -np.ones(200)))


def test_stitch_kepler2_quarters(kepler2_quarters):
    q2, q3 = kepler2_quarters
    st = stitch([q3, q2])  # order of inputs does not matter
    assert len(st) == len(q2) + len(q3)
    assert np.all(np.diff(st.time) > 0)
    assert st.meta["kepid"] == 10666592 and st.meta["quarters"] == [2, 3]
    assert st.meta["time_system"] == "BKJD" and st.meta["stitched"] is True
    for q in (2, 3):
        sel = st.segment == q
        assert np.nanmedian(st.flux[sel]) == pytest.approx(1.0, abs=1e-12)
    assert st.quality is not None and st.flux_err is not None
    # gap between Q2 and Q3 is preserved, not closed
    jump = np.diff(st.time).max()
    assert jump > 1.0


def test_stitch_validation_and_duplicates(kepler2_quarters, kepler90_q3):
    with pytest.raises(ValueError, match="different targets"):
        stitch([kepler2_quarters[0], kepler90_q3])
    other = kepler2_quarters[0].copy()
    other.meta = dict(other.meta, time_system="BTJD")
    with pytest.raises(ValueError, match="time systems"):
        stitch([kepler2_quarters[1], other])
    twice = stitch([kepler2_quarters[0], kepler2_quarters[0]])
    assert len(twice) == len(kepler2_quarters[0])
    assert twice.meta["n_duplicate_cadences_dropped"] == len(kepler2_quarters[0])
    with pytest.raises(ValueError):
        stitch([])
