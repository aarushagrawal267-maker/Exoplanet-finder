"""DatasetArrays persistence/validation and the baseline feature matrix."""

from __future__ import annotations

import itertools
import json
from pathlib import Path

import numpy as np
import pytest
from exof_ml_testdata import make_toy_arrays

from exofinder.ml.dataset_arrays import DatasetArrays, load_dataset_arrays, save_dataset_arrays
from exofinder.ml.features import baseline_feature_matrix, downsample_blocks


def test_save_load_roundtrip(tmp_path: Path) -> None:
    arrays = make_toy_arrays(n_stars=12, seed=4)
    manifest = save_dataset_arrays(tmp_path / "ds", arrays)
    assert (tmp_path / "ds" / "arrays.npz").exists() and (tmp_path / "ds" / "manifest.json").exists()
    assert manifest["summary"]["n"] == len(arrays)
    loaded = load_dataset_arrays(tmp_path / "ds", verify_hash=True)
    for name in ("global_view", "local_view", "features", "labels", "signal_ids", "kepids", "splits"):
        np.testing.assert_array_equal(getattr(loaded, name), getattr(arrays, name))
    assert loaded.feature_names == arrays.feature_names
    assert loaded.meta["synthetic"] is True
    assert loaded.global_view.dtype == np.float32 and loaded.labels.dtype == np.int64


def test_hash_verification_detects_corruption(tmp_path: Path) -> None:
    arrays = make_toy_arrays(n_stars=6, seed=1)
    save_dataset_arrays(tmp_path, arrays)
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    manifest["arrays_sha256"] = "0" * 64
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="sha256"):
        load_dataset_arrays(tmp_path, verify_hash=True)


def test_subset_and_summary() -> None:
    arrays = make_toy_arrays(n_stars=20, seed=2)
    parts = [arrays.subset(s) for s in ("train", "val", "test")]
    assert sum(len(p) for p in parts) == len(arrays)
    assert set(parts[0].splits) == {"train"}
    assert len(arrays.subset("all")) == len(arrays)
    with pytest.raises(ValueError):
        arrays.subset("holdout")
    s = arrays.summary()
    assert s["splits"]["train"]["n"] == len(parts[0])


def test_validation_rejects_bad_arrays() -> None:
    arrays = make_toy_arrays(n_stars=5, seed=0)
    bad = arrays.global_view.copy()
    bad[0, 3] = np.nan
    kw = {
        "local_view": arrays.local_view,
        "features": arrays.features,
        "signal_ids": arrays.signal_ids,
        "kepids": arrays.kepids,
        "splits": arrays.splits,
        "feature_names": arrays.feature_names,
    }
    with pytest.raises(ValueError, match="NaN"):
        DatasetArrays(global_view=bad, labels=arrays.labels, **kw)
    labels = arrays.labels.copy()
    labels[0] = 2
    with pytest.raises(ValueError, match="labels"):
        DatasetArrays(global_view=arrays.global_view, labels=labels, **kw)


def test_split_names_are_checked_before_truncation() -> None:
    """Regression: splits were cast to <U5 first, so "trainval" silently became "train"."""
    arrays = make_toy_arrays(n_stars=5, seed=0)
    for bad in ("trainval", "testing", "None"):
        splits = arrays.splits.astype(object)
        splits[0] = bad
        with pytest.raises(ValueError, match="unknown split"):
            DatasetArrays(**{**arrays.__dict__, "splits": splits})


def test_duplicate_signal_ids_rejected() -> None:
    arrays = make_toy_arrays(n_stars=5, seed=0)
    ids = arrays.signal_ids.copy()
    ids[1] = ids[0]
    with pytest.raises(ValueError, match="unique"):
        DatasetArrays(**{**arrays.__dict__, "signal_ids": ids})


def test_downsample_blocks_2001_to_201() -> None:
    v = np.arange(2001, dtype=np.float64)[None, :].repeat(2, axis=0)
    out = downsample_blocks(v, 201)
    assert out.shape == (2, 201)
    edges = np.round(np.linspace(0, 2001, 202)).astype(int)
    assert set(np.diff(edges)) <= {9, 10}
    expected = np.array([v[0, a:b].mean() for a, b in itertools.pairwise(edges)])
    np.testing.assert_allclose(out[0], expected, rtol=1e-6)


def test_baseline_feature_matrix_layout() -> None:
    rng = np.random.default_rng(0)
    g = rng.normal(size=(3, 2001)).astype(np.float32)
    loc = rng.normal(size=(3, 201)).astype(np.float32)
    phys = rng.normal(size=(3, 15)).astype(np.float32)
    names_phys = [f"f{i}" for i in range(15)]
    X, names = baseline_feature_matrix(g, loc, phys, physical_names=names_phys)
    assert X.shape == (3, 201 + 201 + 15) and len(names) == X.shape[1]
    np.testing.assert_array_equal(X[:, 201:402], loc)
    np.testing.assert_array_equal(X[:, 402:], phys)
    assert names[0] == "global_000" and names[201] == "local_000" and names[-1] == "f14"
    X2, names2 = baseline_feature_matrix(g, loc, None)
    assert X2.shape == (3, 402) and len(names2) == 402
    with pytest.raises(ValueError):
        baseline_feature_matrix(g, loc, np.full((3, 15), np.nan))
