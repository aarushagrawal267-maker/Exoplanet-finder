"""Per-segment normalisation and stitching of quarters.

Each Kepler quarter is observed with a different CCD module (the spacecraft rolls every ~90 days),
so absolute flux levels jump between quarters. Dividing each segment by its median puts every
quarter on a common relative scale (baseline 1.0) before the quarters are concatenated.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np

from .errors import LightCurveFormatError
from .types import LightCurve


def normalize_segments(lc: LightCurve) -> LightCurve:
    """Divide the flux (and flux error) of each segment by that segment's median finite flux.

    A light curve without segments is treated as a single segment. The medians used are recorded in
    ``meta["segment_medians"]`` (keyed by segment id as a string). Raises
    :class:`LightCurveFormatError` if a segment's median flux is not positive.
    """
    out = lc.copy()
    seg = out.segment if out.segment is not None else np.zeros(len(out), dtype=np.int64)
    flux = out.flux.copy()
    err = None if out.flux_err is None else out.flux_err.copy()
    medians: dict[str, float] = {}
    for s in np.unique(seg):
        m = seg == s
        vals = flux[m]
        vals = vals[np.isfinite(vals)]
        if vals.size == 0:
            continue
        med = float(np.median(vals))
        if not (np.isfinite(med) and med > 0):
            raise LightCurveFormatError(
                f"Cannot normalise segment {int(s)}: its median flux is {med:.4g} (must be positive)."
            )
        flux[m] /= med
        if err is not None:
            err[m] /= med
        medians[str(int(s))] = med
    out.flux = flux
    out.flux_err = err
    out.meta = dict(out.meta)
    out.meta["normalized"] = True
    out.meta["segment_medians"] = medians
    return out


def stitch(lcs: Sequence[LightCurve]) -> LightCurve:
    """Normalise each light curve per segment and concatenate them, sorted by time.

    All inputs must share the same ``meta["time_system"]`` and (if present) ``kepid``. Inputs
    without segments get a new id per input (after the largest existing id). Cadences whose time
    stamp duplicates an earlier one (e.g. the same quarter passed twice) are dropped and counted in
    ``meta["n_duplicate_cadences_dropped"]``. ``flux_err``/``quality`` are kept only if every input
    has them. ``meta["quarters"]`` lists the sorted segment ids of Kepler inputs.
    """
    if not lcs:
        raise ValueError("stitch() needs at least one light curve")
    systems = {lc.meta.get("time_system") for lc in lcs}
    if len(systems) > 1:
        raise ValueError(f"Cannot stitch light curves in different time systems: {sorted(map(str, systems))}")
    kepids = {lc.meta.get("kepid") for lc in lcs if lc.meta.get("kepid") is not None}
    if len(kepids) > 1:
        raise ValueError(f"Cannot stitch light curves of different targets (kepids {sorted(kepids)})")

    normed = [normalize_segments(lc) for lc in lcs]
    existing = [int(lc.segment.max()) for lc in normed if lc.segment is not None and len(lc)]
    next_id = (max(existing) + 1) if existing else 0
    segments = []
    for lc in normed:
        if lc.segment is not None:
            segments.append(lc.segment)
        else:
            segments.append(np.full(len(lc), next_id, dtype=np.int64))
            next_id += 1

    time = np.concatenate([lc.time for lc in normed])
    flux = np.concatenate([lc.flux for lc in normed])
    seg = np.concatenate(segments)
    err = (
        np.concatenate([lc.flux_err for lc in normed])
        if all(lc.flux_err is not None for lc in normed)
        else None
    )
    qual = (
        np.concatenate([lc.quality for lc in normed])
        if all(lc.quality is not None for lc in normed)
        else None
    )
    order = np.argsort(time, kind="stable")
    time, flux, seg = time[order], flux[order], seg[order]
    err = None if err is None else err[order]
    qual = None if qual is None else qual[order]
    dup = np.concatenate([[False], np.diff(time) == 0]) if time.size else np.zeros(0, dtype=bool)
    if dup.any():
        keep = ~dup
        time, flux, seg = time[keep], flux[keep], seg[keep]
        err = None if err is None else err[keep]
        qual = None if qual is None else qual[keep]

    first = lcs[0].meta
    meta: dict[str, Any] = {
        "stitched": True,
        "normalized": True,
        "time_system": first.get("time_system"),
        "mission": first.get("mission") if len({lc.meta.get("mission") for lc in lcs}) == 1 else "mixed",
        "flux_column": first.get("flux_column"),
        "cadence_days": first.get("cadence_days"),
        "n_inputs": len(lcs),
        "n_segments": int(np.unique(seg).size),
        "n_duplicate_cadences_dropped": int(dup.sum()),
        "segment_medians": {k: v for lc in normed for k, v in lc.meta.get("segment_medians", {}).items()},
        "synthetic": any(bool(lc.meta.get("synthetic")) for lc in lcs),
    }
    if kepids:
        meta["kepid"] = next(iter(kepids))
    if all(lc.meta.get("mission") == "Kepler" for lc in lcs):
        meta["quarters"] = sorted({int(s) for s in np.unique(seg)})
    files = [lc.meta.get("filename") for lc in lcs if lc.meta.get("filename")]
    if files:
        meta["filenames"] = files
    if not meta["synthetic"]:
        meta.pop("synthetic")
    return LightCurve(time=time, flux=flux, flux_err=err, quality=qual, segment=seg, meta=meta)


__all__ = ["normalize_segments", "stitch"]
