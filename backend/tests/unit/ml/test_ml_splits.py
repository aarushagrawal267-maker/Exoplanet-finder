"""Star-level split: determinism, grouping (no star in two splits), forced test stars, stratification."""

from __future__ import annotations

import numpy as np
import pytest

from exofinder.ml.splits import (
    LeakageError,
    assert_no_leakage,
    split_summary,
    star_level_labels,
    star_level_split,
)


def _toy_ids(n_stars: int = 400, seed: int = 1) -> tuple[np.ndarray, np.ndarray]:
    """Kepler-like id/label layout: 1-4 signals per star, ~30 % planet-like stars (test data)."""
    rng = np.random.default_rng(seed)
    kepids, labels = [], []
    for s in range(n_stars):
        lab = int(rng.random() < 0.3)
        for _ in range(int(rng.integers(1, 5))):
            kepids.append(10_000_000 + 13 * s)
            labels.append(lab if rng.random() > 0.1 else 1 - lab)  # some mixed-label stars
    return np.asarray(kepids), np.asarray(labels)


def test_deterministic_and_order_independent() -> None:
    kepids, labels = _toy_ids()
    a = star_level_split(kepids, labels, seed=42)
    b = star_level_split(kepids, labels, seed=42)
    np.testing.assert_array_equal(a, b)
    perm = np.random.default_rng(5).permutation(kepids.size)
    c = star_level_split(kepids[perm], labels[perm], seed=42)
    np.testing.assert_array_equal(a[perm], c)
    d = star_level_split(kepids, labels, seed=43)
    assert not np.array_equal(a, d)


def test_no_star_overlap_and_fractions() -> None:
    kepids, labels = _toy_ids()
    splits = star_level_split(kepids, labels, fractions=(0.8, 0.1, 0.1), seed=0)
    assert_no_leakage(kepids, splits)
    sets = {s: set(kepids[splits == s].tolist()) for s in ("train", "val", "test")}
    assert (
        not (sets["train"] & sets["val"])
        and not (sets["train"] & sets["test"])
        and not (sets["val"] & sets["test"])
    )
    n = kepids.size
    for name, frac in (("train", 0.8), ("val", 0.1), ("test", 0.1)):
        assert abs((splits == name).sum() / n - frac) < 0.03, name


def test_stratified_class_balance() -> None:
    kepids, labels = _toy_ids()
    splits = star_level_split(kepids, labels, seed=0)
    summary = split_summary(kepids, labels, splits)
    overall = labels.mean()
    for name in ("train", "val", "test"):
        s = summary[name]
        assert s["n_pos"] > 0 and s["n_neg"] > 0
        assert abs(s["n_pos"] / s["n"] - overall) < 0.08


def test_forced_test_kepids() -> None:
    kepids, labels = _toy_ids()
    forced = [int(kepids[0]), int(kepids[-1]), 99_999_999]  # last id is absent and ignored
    for seed in (0, 1, 2):
        splits = star_level_split(kepids, labels, seed=seed, forced_test=forced)
        for k in forced[:2]:
            assert set(splits[kepids == k]) == {"test"}
        assert_no_leakage(kepids, splits)


def test_star_majority_label() -> None:
    labels = star_level_labels(np.array([1, 1, 1, 2, 2, 3]), np.array([1, 0, 0, 1, 0, 0]))
    assert labels == {1: 0, 2: 1, 3: 0}  # tie (star 2) counts as planet-like


def test_small_dataset_gets_nonempty_val_and_test() -> None:
    kepids = np.arange(10) + 100
    labels = np.array([0, 1] * 5)
    splits = star_level_split(kepids, labels, fractions=(0.8, 0.1, 0.1), seed=3)
    for name in ("train", "val", "test"):
        assert (splits == name).any()


def test_assert_no_leakage_detects_overlap() -> None:
    with pytest.raises(LeakageError):
        assert_no_leakage(np.array([1, 1, 2]), np.array(["train", "test", "val"]))
    assert_no_leakage(np.array([1, 1, 2]), np.array(["train", "train", "val"]))


def test_invalid_inputs() -> None:
    with pytest.raises(ValueError):
        star_level_split([1, 2], [0, 1], fractions=(0.5, 0.5, 0.5))
    with pytest.raises(ValueError):
        star_level_split([1, 2], [0, 2])
    assert star_level_split([], []).size == 0


def test_forced_test_stars_do_not_consume_the_test_quota():
    """Regression: forced (showcase) stars must be added on top of a normal split, otherwise the test
    positives of a small dataset come almost entirely from the forced multi-planet systems."""
    rng = np.random.default_rng(0)
    # 150 ordinary stars with one signal each (half planet-like) + 4 forced stars with 6 planets each.
    kepids = list(range(1000, 1150))
    labels = [int(x) for x in rng.integers(0, 2, size=150)]
    forced = [1, 2, 3, 4]
    for k in forced:
        kepids += [k] * 6
        labels += [1] * 6
    splits = star_level_split(kepids, labels, seed=42, forced_test=forced)
    kep = np.asarray(kepids)
    lab = np.asarray(labels)
    free = ~np.isin(kep, forced)
    assert (splits[~free] == "test").all()
    free_test = (splits == "test") & free
    # the free stars alone are split ~80/10/10
    assert 0.07 <= free_test.sum() / free.sum() <= 0.13
    # ordinary planet-like stars still reach the test split
    assert (free_test & (lab == 1)).sum() >= 5
