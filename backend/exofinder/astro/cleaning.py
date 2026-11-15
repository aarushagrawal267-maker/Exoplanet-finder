"""Removal of unusable cadences and segment assignment.

Kepler quality flags (``SAP_QUALITY``, Kepler Archive Manual, Table 2.3) mark cadences affected by
spacecraft events. The ``"default"`` bitmask removes the cadences that are definitely unusable and
equals lightkurve's ``KeplerQualityFlags.DEFAULT_BITMASK`` (1130799): attitude tweak (1), safe mode
(2), coarse point (4), Earth point (8), reaction-wheel desaturation (32), manual exclude (256),
detector anomaly (16384), no data (65536) and thruster firing (1048576). ``"hard"`` (1664431) also
removes cosmic rays in the aperture/collateral data, sudden sensitivity dropouts and possible thruster
firings; ``"hardest"`` removes any flagged cadence; ``"none"`` keeps all. TESS light curves use the
TESS equivalents (lightkurve ``TessQualityFlags``). An integer bitmask may be passed directly.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from .types import LightCurve

#: Kepler bitmasks (identical to lightkurve.utils.KeplerQualityFlags; verified in the unit tests).
KEPLER_BITMASKS: dict[str, int] = {"none": 0, "default": 1130799, "hard": 1664431, "hardest": 2096639}
#: TESS bitmasks (identical to lightkurve.utils.TessQualityFlags).
TESS_BITMASKS: dict[str, int] = {"none": 0, "default": 17087, "hard": 24319, "hardest": 65535}

#: Default gap length (days) that starts a new segment; AstroNet splits Kepler data at 0.75 d gaps.
DEFAULT_GAP_DAYS = 0.75


def resolve_bitmask(quality_bitmask: str | int, mission: str | None = None) -> int:
    """Integer bitmask for a name (``none``/``default``/``hard``/``hardest``) or an int."""
    if isinstance(quality_bitmask, (int, np.integer)) and not isinstance(quality_bitmask, bool):
        if quality_bitmask < 0:
            raise ValueError("quality_bitmask must be non-negative")
        return int(quality_bitmask)
    table = TESS_BITMASKS if (mission or "").upper() == "TESS" else KEPLER_BITMASKS
    key = str(quality_bitmask).lower()
    if key not in table:
        raise ValueError(
            f"Unknown quality_bitmask {quality_bitmask!r}; use one of {', '.join(table)} or an integer."
        )
    return table[key]


def clean(lc: LightCurve, quality_bitmask: str | int = "default") -> tuple[LightCurve, dict[str, Any]]:
    """Drop unusable cadences and sort by time.

    Removal reasons are evaluated in this order and each cadence is counted once, under the first
    reason that applies: non-finite time, quality flag matching the bitmask, non-finite flux,
    non-finite flux error (only when errors are present), duplicate time stamp (keeping the first
    after a stable sort).

    Returns ``(cleaned, report)`` where ``report`` holds the counts, the integer bitmask applied, and
    ``n_input``/``n_output``.
    """
    n = len(lc)
    bitmask = resolve_bitmask(quality_bitmask, lc.meta.get("mission"))
    remaining = np.ones(n, dtype=bool)

    def take(bad: np.ndarray) -> int:
        hit = remaining & bad
        remaining[hit] = False
        return int(hit.sum())

    n_nan_time = take(~np.isfinite(lc.time))
    n_quality = 0
    if lc.quality is not None and bitmask:
        n_quality = take((lc.quality & bitmask) != 0)
    n_nan_flux = take(~np.isfinite(lc.flux))
    n_nan_err = take(~np.isfinite(lc.flux_err)) if lc.flux_err is not None else 0

    kept = lc.select(remaining)
    order = np.argsort(kept.time, kind="stable")
    was_sorted = bool(np.all(order == np.arange(order.size)))
    kept = kept.select(order) if not was_sorted else kept
    dup = np.concatenate([[False], np.diff(kept.time) == 0]) if len(kept) else np.zeros(0, dtype=bool)
    n_dup = int(dup.sum())
    if n_dup:
        kept = kept.select(~dup)

    kept.meta = dict(kept.meta)
    kept.meta["cleaned"] = True
    kept.meta["quality_bitmask"] = bitmask
    report: dict[str, Any] = {
        "n_input": n,
        "n_nan_time": n_nan_time,
        "n_quality_flagged": n_quality,
        "n_nan_flux": n_nan_flux,
        "n_nan_flux_err": n_nan_err,
        "n_duplicate_time": n_dup,
        "n_output": len(kept),
        "quality_bitmask": bitmask,
        "quality_bitmask_name": str(quality_bitmask) if isinstance(quality_bitmask, str) else None,
        "was_sorted": was_sorted,
    }
    return kept, report


def assign_segments(lc: LightCurve, gap_days: float = DEFAULT_GAP_DAYS) -> LightCurve:
    """Give every cadence a segment id, starting a new segment after each gap > ``gap_days``.

    Light curves that already carry segments (e.g. Kepler quarters) are returned unchanged (as a
    copy). Ids are 0, 1, 2, ... in time order. Non-finite times get segment -1.
    """
    out = lc.copy()
    if lc.segment is not None:
        return out
    seg = np.full(len(lc), -1, dtype=np.int64)
    ok = np.isfinite(lc.time)
    idx = np.nonzero(ok)[0]
    if idx.size:
        order = idx[np.argsort(lc.time[idx], kind="stable")]
        breaks = np.concatenate([[0], (np.diff(lc.time[order]) > gap_days).astype(np.int64)])
        seg[order] = np.cumsum(breaks)
    out.segment = seg
    out.meta = dict(out.meta)
    out.meta["segments_from_gaps"] = True
    out.meta["segment_gap_days"] = float(gap_days)
    return out


__all__ = [
    "DEFAULT_GAP_DAYS",
    "KEPLER_BITMASKS",
    "TESS_BITMASKS",
    "assign_segments",
    "clean",
    "resolve_bitmask",
]
