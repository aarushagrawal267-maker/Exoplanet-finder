"""Feature matrix for the classical (non-deep) baseline classifiers.

The baselines see the same information as the CNNs plus the hand-crafted physical features:

* the **global view** downsampled from 2001 to 201 bins by averaging contiguous blocks (a 10x
  coarser fold of the whole orbit, enough to show a secondary eclipse or strong out-of-transit
  variability while keeping the feature count manageable for logistic regression);
* the **local view** (201 bins, the detailed transit shape) unchanged;
* the **physical features** measured from the light curve by
  :func:`exofinder.astro.features.physical_features` (depth, duration, SNR, odd/even and
  secondary-eclipse statistics, ...). Catalogue dispositions and scores are never included.

Block averaging: the ``G`` input bins are cut into ``out_bins`` contiguous blocks with integer
edges ``round(linspace(0, G, out_bins + 1))`` (block sizes differ by at most one bin when ``G`` is
not a multiple of ``out_bins``; for 2001 -> 201 the blocks hold 9 or 10 bins) and each block is
replaced by its mean.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

#: Number of bins of the downsampled global view used by the baselines.
BASELINE_GLOBAL_BINS = 201

#: Lower-case substrings that mark a column as catalogue-derived vetting output (KOI/Robovetter
#: scores and dispositions, false-positive flags, Autovetter training labels, our own labels).
#: Such values encode the answer the model is asked to predict, so they are never model inputs.
CATALOGUE_FEATURE_TOKENS: tuple[str, ...] = (
    "score",
    "disposition",
    "fpflag",
    "av_training",
    "av_pred",
    "label",
    "category",
)


def assert_no_catalogue_features(names: Sequence[str]) -> None:
    """Raise ``ValueError`` if a physical-feature name looks catalogue-derived (honesty rule).

    The physical features must be measured from the light curve
    (:func:`exofinder.astro.features.physical_features`); catalogue scores and dispositions
    (``koi_score``, ``koi_pdisposition``, ``fpflag_*``, ...) would leak the vetting result.
    """
    bad = [n for n in names if any(tok in str(n).lower() for tok in CATALOGUE_FEATURE_TOKENS)]
    if bad:
        raise ValueError(
            f"catalogue-derived columns cannot be model features: {bad}; physical features must be "
            "measured from the light curve"
        )


def downsample_blocks(views: np.ndarray, out_bins: int = BASELINE_GLOBAL_BINS) -> np.ndarray:
    """Mean of ``out_bins`` contiguous blocks along the last axis of a (N, G) array."""
    v = np.asarray(views, dtype=np.float64)
    if v.ndim == 1:
        v = v[None, :]
    g = v.shape[1]
    if out_bins <= 0:
        raise ValueError("out_bins must be positive")
    if g <= out_bins:
        return v.astype(np.float32)
    edges = np.round(np.linspace(0, g, out_bins + 1)).astype(np.int64)
    sums = np.add.reduceat(v, edges[:-1], axis=1)
    widths = np.diff(edges).astype(np.float64)
    return (sums / widths[None, :]).astype(np.float32)


def baseline_feature_names(
    local_bins: int,
    physical_names: Sequence[str] = (),
    global_bins_out: int = BASELINE_GLOBAL_BINS,
) -> list[str]:
    """Column names matching :func:`baseline_feature_matrix`."""
    return (
        [f"global_{i:03d}" for i in range(global_bins_out)]
        + [f"local_{i:03d}" for i in range(local_bins)]
        + [str(n) for n in physical_names]
    )


def baseline_feature_matrix(
    global_view: np.ndarray,
    local_view: np.ndarray,
    physical: np.ndarray | None,
    physical_names: Sequence[str] | None = None,
    global_bins_out: int = BASELINE_GLOBAL_BINS,
) -> tuple[np.ndarray, list[str]]:
    """Build the baseline design matrix ``X`` (N, 201 + local_bins + F) and its column names.

    ``physical`` may be ``None`` or have zero columns. ``physical_names`` defaults to
    ``physical_00 ...``; pass :data:`DatasetArrays.feature_names` to get readable names.
    Non-finite inputs raise ``ValueError`` (the dataset builder's quality gates must remove them).
    """
    g = np.asarray(global_view, dtype=np.float32)
    loc = np.asarray(local_view, dtype=np.float32)
    if g.ndim == 1:
        g = g[None, :]
    if loc.ndim == 1:
        loc = loc[None, :]
    n = g.shape[0]
    if loc.shape[0] != n:
        raise ValueError("global and local views have different numbers of rows")
    if physical is None:
        phys = np.zeros((n, 0), dtype=np.float32)
    else:
        phys = np.asarray(physical, dtype=np.float32)
        if phys.ndim == 1:
            if n != 1:
                raise ValueError("1-D physical features are only accepted for a single example")
            phys = phys[None, :]
        if phys.shape[0] != n:
            raise ValueError("physical features have a different number of rows than the views")
    names_phys = (
        list(physical_names)
        if physical_names is not None
        else [f"physical_{i:02d}" for i in range(phys.shape[1])]
    )
    if len(names_phys) != phys.shape[1]:
        raise ValueError("physical_names length does not match the number of physical feature columns")
    X = np.concatenate([downsample_blocks(g, global_bins_out), loc, phys], axis=1).astype(np.float32)
    if not np.isfinite(X).all():
        raise ValueError("baseline features contain NaN or Inf values")
    names = baseline_feature_names(loc.shape[1], names_phys, min(global_bins_out, g.shape[1]))
    return X, names


__all__ = [
    "BASELINE_GLOBAL_BINS",
    "CATALOGUE_FEATURE_TOKENS",
    "assert_no_catalogue_features",
    "baseline_feature_matrix",
    "baseline_feature_names",
    "downsample_blocks",
]
