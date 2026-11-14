"""Synthetic toy datasets and small configs for the ML-engine tests.

SYNTHETIC DATA — TEST INFRASTRUCTURE ONLY. The arrays built here are hand-made, clearly separable
toy "views" used to exercise code paths (shapes, gradients, checkpointing, metrics plumbing). They
are not light curves, carry ``meta["synthetic"] = True`` and no number derived from them is a
scientific result.
"""

from __future__ import annotations

import numpy as np

from exofinder.config import PIPELINE_VERSION
from exofinder.ml.dataset_arrays import DatasetArrays
from exofinder.ml.splits import star_level_split
from exofinder.ml.train import TrainConfig

SMALL_GLOBAL = 201  # smallest convenient length that survives the 5 global pooling blocks
SMALL_LOCAL = 61
FEATURE_NAMES = ["toy_depth", "toy_secondary", "toy_noise_a", "toy_noise_b"]


def _toy_views(label: int, rng: np.random.Generator, g_bins: int, l_bins: int, noise: float):
    xg = np.linspace(-0.5, 0.5, g_bins)
    xl = np.linspace(-2.0, 2.0, l_bins)
    depth = rng.uniform(0.8, 1.0)
    if label == 1:  # flat-bottomed "U" dip, no secondary
        local = -depth * (np.abs(xl) < 0.45)
        glob = -depth * (np.abs(xg) < 0.01)
        sec = 0.0
    else:  # "V" dip plus a secondary dip at phase +/-0.5
        local = -depth * np.clip(1.0 - np.abs(xl) / 0.6, 0.0, None)
        sec = rng.uniform(0.3, 0.6)
        glob = -depth * np.clip(1.0 - np.abs(xg) / 0.015, 0.0, None) - sec * (np.abs(xg) > 0.49)
    local = local + rng.normal(0, noise, l_bins)
    glob = glob + rng.normal(0, noise, g_bins)
    feats = [depth + rng.normal(0, 0.05), sec + rng.normal(0, 0.05), rng.normal(), rng.normal()]
    return glob.astype(np.float32), local.astype(np.float32), np.asarray(feats, dtype=np.float32)


def make_toy_arrays(
    n_stars: int = 60,
    seed: int = 0,
    g_bins: int = SMALL_GLOBAL,
    l_bins: int = SMALL_LOCAL,
    noise: float = 0.05,
    pos_frac: float = 0.4,
    fractions: tuple[float, float, float] = (0.6, 0.2, 0.2),
) -> DatasetArrays:
    """Separable synthetic dataset with 1-3 signals per star (test infrastructure only)."""
    rng = np.random.default_rng(seed)
    G, L, F, y, sid, kep = [], [], [], [], [], []
    next_id = 1
    for s in range(n_stars):
        kepid = 1_000_000 + 37 * s
        star_label = int(rng.random() < pos_frac)
        for _ in range(int(rng.integers(1, 4))):
            g, loc, f = _toy_views(star_label, rng, g_bins, l_bins, noise)
            G.append(g)
            L.append(loc)
            F.append(f)
            y.append(star_label)
            sid.append(next_id)
            kep.append(kepid)
            next_id += 1
    labels = np.asarray(y, dtype=np.int64)
    kepids = np.asarray(kep, dtype=np.int64)
    splits = star_level_split(kepids, labels, fractions=fractions, seed=seed)
    return DatasetArrays(
        global_view=np.stack(G),
        local_view=np.stack(L),
        features=np.stack(F),
        labels=labels,
        signal_ids=np.asarray(sid, dtype=np.int64),
        kepids=kepids,
        splits=splits,
        feature_names=list(FEATURE_NAMES),
        meta={"synthetic": True, "pipeline_version": PIPELINE_VERSION, "dataset_id": "toy-test"},
    )


def small_cnn_config(model_type: str = "cnn_two_view", **kw) -> TrainConfig:
    """A small, fast CNN configuration for tests (architecture blocks unchanged, small head)."""
    params: dict = {
        "model_type": model_type,
        "lr": 1e-3,
        "batch_size": 16,
        "max_epochs": 6,
        "patience": 6,
        "fc_width": 32,
        "fc_layers": 2,
        "dropout": 0.2,
        "seed": 7,
        "num_threads": 2,
    }
    params.update(kw)
    return TrainConfig(**params)
