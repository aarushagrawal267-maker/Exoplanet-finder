"""Upward outlier clipping.

Transits, eclipses and other dimming events are *downward* excursions, so only *upward* outliers
(cosmic rays, flares, residual momentum-dump artefacts) are removed from the flattened light curve.
Clipping symmetrically would delete the in-transit points of deep transits, which is exactly the
signal we want to classify.
"""

from __future__ import annotations

import numpy as np

from ._utils import mad_std
from .types import LightCurve


def clip_upper(lc: LightCurve, sigma: float = 3.0) -> tuple[LightCurve, int]:
    """Remove cadences with ``flux > median + sigma * robust_std``; never removes low points.

    The robust standard deviation is 1.4826 x MAD of the finite fluxes, so the transit points
    themselves do not inflate the threshold. Non-finite fluxes are left untouched. Returns
    ``(clipped_lc, n_removed)``.
    """
    if not sigma > 0:
        raise ValueError(f"sigma must be positive (got {sigma!r})")
    f = lc.flux
    finite = np.isfinite(f)
    if finite.sum() < 3:
        return lc.copy(), 0
    med = float(np.median(f[finite]))
    s = mad_std(f[finite])
    if not (np.isfinite(s) and s > 0):
        return lc.copy(), 0
    with np.errstate(invalid="ignore"):
        high = finite & (f > med + float(sigma) * s)
    out = lc.select(~high)
    out.meta = dict(out.meta)
    out.meta["n_upper_outliers_clipped"] = int(high.sum())
    out.meta["upper_clip_sigma"] = float(sigma)
    return out, int(high.sum())


__all__ = ["clip_upper"]
