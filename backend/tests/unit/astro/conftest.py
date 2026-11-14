"""Shared fixtures for the astronomy pipeline tests.

Synthetic light curves built here are for testing only and always carry ``meta["synthetic"] = True``.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import numpy as np
import pytest

from exofinder.astro.io_fits import read_kepler_fits
from exofinder.astro.normalize import stitch
from exofinder.astro.types import Ephemeris, LightCurve

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
KEPLER2_Q2 = FIXTURES / "kplr010666592-2009259160929_llc.fits"
KEPLER2_Q3 = FIXTURES / "kplr010666592-2009350155506_llc.fits"
KEPLER90_Q3 = FIXTURES / "kplr011442793-2009350155506_llc.fits"

# Catalogue ephemerides: NASA Exoplanet Archive TAP, table "cumulative" (Kepler KOI cumulative list),
# columns koi_period [d], koi_time0bk [BKJD], koi_duration [h], koi_depth [ppm]; retrieved 2026-11-14 via
# https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=select+...+from+cumulative+where+kepid=<kepid>
KEPLER2_KEPID = 10666592
KEPLER2_B = {
    "period": 2.204735417,
    "epoch": 121.3585417,
    "duration_h": 3.88864,
    "depth_ppm": 6674.7,
}  # K00002.01
KEPLER90_KEPID = 11442793
KEPLER90 = {  # K00351.xx, same query with kepid=11442793
    "c": {"period": 8.71980135, "epoch": 139.52134, "duration_h": 3.7454, "depth_ppm": 160.4},
    "d": {"period": 59.7371443, "epoch": 158.95974, "duration_h": 8.0006, "depth_ppm": 566.4},
    "h": {"period": 331.5972732, "epoch": 140.498929, "duration_h": 14.404, "depth_ppm": 8322.1},
}

KEPLER_LC_CADENCE = 0.02043359821692  # days (TIMEDEL of Kepler long-cadence files)


def catalogue_ephemeris(entry: dict[str, float]) -> Ephemeris:
    return Ephemeris(
        period_days=entry["period"],
        epoch=entry["epoch"],
        duration_hours=entry["duration_h"],
        depth_ppm=entry["depth_ppm"],
        source="catalogue",
        label="KOI cumulative",
    )


def make_kepler_like_lc(
    seed: int = 0,
    n_quarters: int = 2,
    quarter_days: float = 89.0,
    t_start: float = 131.5,
    noise_ppm: float = 250.0,
    var_amp: float = 0.004,
    var_period: float = 9.0,
    n_random_gaps: int = 4,
    spike_frac: float = 0.002,
    flag_frac: float = 0.01,
    nan_frac: float = 0.002,
) -> LightCurve:
    """Synthetic Kepler-like raw light curve (seeded, deterministic).

    Per quarter: 29.4-min cadence, two ~1-day data-downlink gaps plus random short gaps, a different
    flux level (CCD module changes), quasi-periodic spot modulation (amplitude ``var_amp``, period
    ``var_period`` days, slowly modulated), a quadratic instrumental drift, white noise
    (``noise_ppm`` per cadence), quality-flagged corrupted cadences (bit 32, in the default bitmask),
    unflagged upward cosmic-ray spikes and a few NaN fluxes. Quarters are separated by ~1-day gaps.
    """
    rng = np.random.default_rng(seed)
    times, fluxes, errs, quals, segs = [], [], [], [], []
    t0 = t_start
    for q in range(n_quarters):
        tq = np.arange(t0, t0 + quarter_days, KEPLER_LC_CADENCE)
        keep = np.ones(tq.size, dtype=bool)
        for g in (t0 + quarter_days / 3, t0 + 2 * quarter_days / 3):
            keep &= ~((tq >= g) & (tq < g + 1.0))
        for _ in range(n_random_gaps):
            g = rng.uniform(t0, t0 + quarter_days)
            keep &= ~((tq >= g) & (tq < g + rng.uniform(0.1, 0.6)))
        tq = tq[keep]
        level = 1.0e5 * rng.uniform(0.9, 1.1)
        phi = rng.uniform(0.0, 2.0 * np.pi, 2)
        var = (
            var_amp
            * (1.0 + 0.3 * np.sin(2 * np.pi * tq / 45.0))
            * np.sin(2 * np.pi * tq / var_period + phi[0])
        )
        var += 0.3 * var_amp * np.sin(4 * np.pi * tq / var_period + phi[1])
        x = (tq - tq.mean()) / (0.5 * quarter_days)
        drift = rng.uniform(-1.5e-3, 1.5e-3) * x + rng.uniform(-1.5e-3, 1.5e-3) * x**2
        white = noise_ppm * 1e-6 * rng.standard_normal(tq.size)
        f = level * (1.0 + var + drift) * (1.0 + white)
        qual = np.zeros(tq.size, dtype=np.int64)
        flagged = rng.random(tq.size) < flag_frac
        qual[flagged] = 32
        f[flagged] *= 1.0 + rng.uniform(-0.01, 0.01, flagged.sum())
        spikes = (rng.random(tq.size) < spike_frac) & ~flagged
        f[spikes] *= 1.0 + rng.uniform(10, 30, spikes.sum()) * noise_ppm * 1e-6
        nans = (rng.random(tq.size) < nan_frac) & ~flagged & ~spikes
        f[nans] = np.nan
        times.append(tq)
        fluxes.append(f)
        errs.append(np.full(tq.size, noise_ppm * 1e-6 * level))
        quals.append(qual)
        segs.append(np.full(tq.size, q + 1, dtype=np.int64))
        t0 = tq[-1] + 1.0
    return LightCurve(
        time=np.concatenate(times),
        flux=np.concatenate(fluxes),
        flux_err=np.concatenate(errs),
        quality=np.concatenate(quals),
        segment=np.concatenate(segs),
        meta={
            "synthetic": True,
            "mission": "Kepler",
            "time_system": "BKJD",
            "cadence_days": KEPLER_LC_CADENCE,
            "source": "synthetic-test",
        },
    )


@pytest.fixture(scope="session")
def synthetic_lc() -> Callable[..., LightCurve]:
    """Factory for synthetic Kepler-like light curves (see :func:`make_kepler_like_lc`)."""
    return make_kepler_like_lc


@pytest.fixture(scope="session")
def kepler2_quarters() -> list[LightCurve]:
    return [read_kepler_fits(KEPLER2_Q2), read_kepler_fits(KEPLER2_Q3)]


@pytest.fixture(scope="session")
def kepler2_stitched(kepler2_quarters: list[LightCurve]) -> LightCurve:
    return stitch(kepler2_quarters)


@pytest.fixture(scope="session")
def kepler2_ephemeris() -> Ephemeris:
    return catalogue_ephemeris(KEPLER2_B)


@pytest.fixture(scope="session")
def kepler2_catalogue() -> dict[str, float]:
    """Kepler-2 b catalogue values (see KEPLER2_B for the source)."""
    return dict(KEPLER2_B)


@pytest.fixture(scope="session")
def kepler90_q3() -> LightCurve:
    return read_kepler_fits(KEPLER90_Q3)


@pytest.fixture(scope="session")
def kepler90_ephemerides() -> dict[str, Ephemeris]:
    """Kepler-90 c, d and h catalogue ephemerides (see KEPLER90 for the source)."""
    return {name: catalogue_ephemeris(entry) for name, entry in KEPLER90.items()}


@pytest.fixture(scope="session")
def fixture_paths() -> dict[str, Path]:
    return {"kepler2_q2": KEPLER2_Q2, "kepler2_q3": KEPLER2_Q3, "kepler90_q3": KEPLER90_Q3}
