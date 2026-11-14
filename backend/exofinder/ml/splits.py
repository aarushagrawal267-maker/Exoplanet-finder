"""Star-level train / validation / test splitting.

Why split by star?
------------------
A Kepler star can host several transit-like signals (multi-planet systems, or an eclipsing binary
that produces TCEs at the true period and at aliases). Those signals share the same photometry,
noise properties, stellar variability and often the same false-positive mechanism. If one signal of
a star is in the training set and another in the test set, a model can score well by recognising
the *star* rather than learning what a planet transit looks like. All signals of a star (``kepid``)
therefore always go to the same split (a *grouped* split).

Stratification
--------------
Stars are stratified by their **star-level majority label** (mean label >= 0.5 -> class 1, so a
tie counts as planet-like, the rarer and more valuable class). Within each stratum the stars are
shuffled with a seeded generator and assigned to splits so that the number of *examples* (not
stars) in each split approximates the requested fractions. This keeps the class balance of the
three splits close to that of the whole dataset.

Forced test stars
-----------------
Famous showcase systems (e.g. Kepler-90) are forced into the test split so that demonstrations in
the UI are made on genuinely unseen stars. Forced stars are added **on top of** a normal split:
the fractions are applied to the free (non-forced) stars only, so the test split still contains a
representative random sample of ordinary stars. (If forced stars counted towards the test quota,
a small dataset's test positives could come almost entirely from a few famous multi-planet systems.)
The test split is therefore slightly larger than ``fractions[2]``.

Determinism
-----------
The result depends only on ``(kepids, labels, fractions, seed, forced_test)``. Stars are visited in
sorted order before the seeded permutation, so the input row order does not matter.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence

import numpy as np

SPLIT_NAMES: tuple[str, str, str] = ("train", "val", "test")


class LeakageError(AssertionError):
    """Raised when the same star appears in more than one split."""


def _validate_fractions(fractions: Sequence[float]) -> tuple[float, float, float]:
    if len(fractions) != 3:
        raise ValueError("fractions must have three entries (train, val, test)")
    f = tuple(float(x) for x in fractions)
    if any(x < 0 for x in f):
        raise ValueError("fractions must be non-negative")
    if abs(sum(f) - 1.0) > 1e-6:
        raise ValueError(f"fractions must sum to 1, got {sum(f):.6f}")
    if f[0] <= 0:
        raise ValueError("the training fraction must be positive")
    return f  # type: ignore[return-value]


def star_level_labels(kepids: np.ndarray, labels: np.ndarray) -> dict[int, int]:
    """Majority label per star (mean label >= 0.5 -> 1)."""
    kepids = np.asarray(kepids, dtype=np.int64)
    labels = np.asarray(labels, dtype=np.int64)
    stars, inverse = np.unique(kepids, return_inverse=True)
    sums = np.bincount(inverse, weights=labels.astype(np.float64), minlength=stars.size)
    counts = np.bincount(inverse, minlength=stars.size)
    frac = sums / np.maximum(counts, 1)
    return {int(s): int(fr >= 0.5) for s, fr in zip(stars, frac, strict=True)}


def star_level_split(
    kepids: Sequence[int] | np.ndarray,
    labels: Sequence[int] | np.ndarray,
    fractions: Sequence[float] = (0.8, 0.1, 0.1),
    seed: int = 42,
    forced_test: Iterable[int] = (),
) -> np.ndarray:
    """Assign every example to ``"train"``, ``"val"`` or ``"test"``, grouped by star.

    Parameters
    ----------
    kepids, labels
        One entry per example (signal). ``labels`` must be 0/1.
    fractions
        Target fractions of *examples* in (train, val, test); must sum to 1.
    seed
        Seed of the star permutation; the split is a pure function of the inputs.
    forced_test
        Kepler IDs whose examples must all be in the test split (ids absent from ``kepids`` are
        ignored).

    Returns
    -------
    numpy.ndarray of str, shape (N,)
        Split name per example.

    Notes
    -----
    Allocation within a stratum: stars are visited in seeded-random order and each star is placed
    by the *midpoint* of its example block on the cumulative example count, i.e. into ``test`` while
    the midpoint is below the test quota, then ``val``, then ``train``. If a stratum has at least
    three free stars, at least one star is guaranteed in each split whose fraction is positive (so
    small datasets still get a usable validation set), taking stars from ``train``.
    """
    kepids_arr = np.asarray(kepids, dtype=np.int64)
    labels_arr = np.asarray(labels, dtype=np.int64)
    if kepids_arr.ndim != 1 or labels_arr.shape != kepids_arr.shape:
        raise ValueError("kepids and labels must be 1-D arrays of equal length")
    if labels_arr.size and not np.isin(labels_arr, (0, 1)).all():
        raise ValueError("labels must be 0 or 1")
    f_train, f_val, f_test = _validate_fractions(fractions)
    del f_train
    out = np.full(kepids_arr.shape, "train", dtype="<U5")
    if kepids_arr.size == 0:
        return out

    star_label = star_level_labels(kepids_arr, labels_arr)
    stars, counts = np.unique(kepids_arr, return_counts=True)
    size_of = {int(s): int(c) for s, c in zip(stars, counts, strict=True)}
    forced = {int(k) for k in forced_test} & set(size_of)

    assignment: dict[int, str] = {k: "test" for k in forced}
    for stratum in (0, 1):
        members = [int(s) for s in stars if star_label[int(s)] == stratum]
        if not members:
            continue
        free = np.array([s for s in members if s not in forced], dtype=np.int64)
        if free.size == 0:
            continue
        # Quotas are computed over the free stars only: forced test stars come on top.
        total = sum(size_of[int(s)] for s in free)
        rng = np.random.default_rng(np.random.SeedSequence([int(seed), stratum]))
        order = free[rng.permutation(free.size)]
        test_quota = f_test * total
        val_quota = f_val * total
        cum = 0.0
        chosen: dict[str, list[int]] = {"train": [], "val": [], "test": []}
        for s in order.tolist():
            mid = cum + size_of[s] / 2.0
            if mid < test_quota:
                split = "test"
            elif mid < test_quota + val_quota:
                split = "val"
            else:
                split = "train"
            chosen[split].append(s)
            cum += size_of[s]
        # Guarantee non-empty val/test per stratum for small datasets (taken from train).
        if order.size >= 3:
            for split, frac in (("val", f_val), ("test", f_test)):
                if frac > 0 and not chosen[split] and len(chosen["train"]) > 1:
                    chosen[split].append(chosen["train"].pop(0))
        for split, ss in chosen.items():
            for s in ss:
                assignment[s] = split

    star_split = np.array([assignment.get(int(s), "train") for s in stars], dtype="<U5")
    out = star_split[np.searchsorted(stars, kepids_arr)]
    assert_no_leakage(kepids_arr, out)
    return out


def assert_no_leakage(kepids: Sequence[int] | np.ndarray, splits: Sequence[str] | np.ndarray) -> None:
    """Raise :class:`LeakageError` if any star has examples in more than one split.

    Examples whose split is empty/None (excluded rows) are ignored.
    """
    kepids_arr = np.asarray(kepids, dtype=np.int64)
    splits_arr = np.asarray(splits).astype(str)
    if kepids_arr.shape != splits_arr.shape:
        raise ValueError("kepids and splits must have the same shape")
    keep = np.isin(splits_arr, SPLIT_NAMES)
    seen: dict[int, str] = {}
    bad: dict[int, set[str]] = {}
    for k, s in zip(kepids_arr[keep].tolist(), splits_arr[keep].tolist(), strict=True):
        prev = seen.setdefault(k, s)
        if prev != s:
            bad.setdefault(k, {prev}).add(s)
    if bad:
        sample = ", ".join(f"KIC {k}: {sorted(v)}" for k, v in list(bad.items())[:5])
        raise LeakageError(f"{len(bad)} star(s) appear in more than one split ({sample})")


def split_summary(
    kepids: Sequence[int] | np.ndarray, labels: Sequence[int] | np.ndarray, splits: Sequence[str] | np.ndarray
) -> dict[str, dict[str, int]]:
    """Per-split counts ``{split: {n, n_pos, n_neg, n_stars}}`` (for dataset statistics)."""
    kepids_arr = np.asarray(kepids, dtype=np.int64)
    labels_arr = np.asarray(labels, dtype=np.int64)
    splits_arr = np.asarray(splits).astype(str)
    out: dict[str, dict[str, int]] = {}
    for name in SPLIT_NAMES:
        m = splits_arr == name
        out[name] = {
            "n": int(m.sum()),
            "n_pos": int((labels_arr[m] == 1).sum()),
            "n_neg": int((labels_arr[m] == 0).sum()),
            "n_stars": int(np.unique(kepids_arr[m]).size),
        }
    return out


__all__ = [
    "SPLIT_NAMES",
    "LeakageError",
    "assert_no_leakage",
    "split_summary",
    "star_level_labels",
    "star_level_split",
]
