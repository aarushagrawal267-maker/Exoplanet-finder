"""Astronomical signal processing for Kepler-style transit light curves.

Pure numpy/scipy/astropy; no imports from ``data``, ``ml``, ``services`` or ``api``. Submodules are
imported explicitly (``from exofinder.astro.pipeline import process_lightcurve``) so that importing
:mod:`exofinder.astro.types` stays lightweight.

Conventions (shared by every module)
------------------------------------
* **Time** is float64 days. Kepler data use BKJD = BJD_TDB - 2454833.0 (``meta["time_system"]``).
* **Epoch** is the time of a transit *centre* (mid-transit), in the light curve's time system.
* **Duration** is the *total* transit duration T14 (first to fourth contact); ``Ephemeris`` stores it
  in hours, functions taking ``duration_days`` expect days.
* **Phase** is in **days** relative to the nearest transit centre, in ``[-P/2, P/2)`` (transit at 0),
  see :func:`exofinder.astro.fold.phase_fold`. The only exception is
  ``secondary_eclipse()["phase"]``, an orbital phase fraction (0.5 = half an orbit after transit).
* **Flux** after normalisation/detrending is relative with baseline 1.0; depths are reported in ppm.
* Transits are preserved: in-transit cadences are masked from trend fits and only *upward* outliers
  are clipped.
* Synthetic light curves (tests and :mod:`exofinder.astro.inject`) carry ``meta["synthetic"] = True``.

Modules: ``io_fits``, ``io_csv``, ``errors``, ``cleaning``, ``normalize``, ``transit_mask``,
``detrend``, ``outliers``, ``fold``, ``views``, ``bls``, ``transit_fit``, ``diagnostics``, ``quality``,
``features``, ``pipeline``, ``inject`` (see docs/dev/CONTRACTS.md section 1).
"""
