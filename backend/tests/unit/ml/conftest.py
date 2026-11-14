"""Fixtures for the ML-engine tests (session-scoped trained toy models, reused across modules).

SYNTHETIC DATA — TEST INFRASTRUCTURE ONLY; see ``exof_ml_testdata.py``.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from exof_ml_testdata import make_toy_arrays, small_cnn_config

from exofinder.ml.dataset_arrays import DatasetArrays
from exofinder.ml.train import TrainConfig, TrainResult, train


@pytest.fixture(scope="session")
def toy_arrays() -> DatasetArrays:
    return make_toy_arrays()


@pytest.fixture(scope="session")
def trained_two_view(toy_arrays: DatasetArrays, tmp_path_factory: pytest.TempPathFactory) -> TrainResult:
    out: Path = tmp_path_factory.mktemp("two_view")
    return train(small_cnn_config(), toy_arrays, out)


@pytest.fixture(scope="session")
def trained_rf(toy_arrays: DatasetArrays, tmp_path_factory: pytest.TempPathFactory) -> TrainResult:
    out: Path = tmp_path_factory.mktemp("rf")
    cfg = TrainConfig(model_type="random_forest", rf_n_estimators=40, seed=3, num_threads=2)
    return train(cfg, toy_arrays, out)


@pytest.fixture(scope="session")
def trained_logreg(toy_arrays: DatasetArrays, tmp_path_factory: pytest.TempPathFactory) -> TrainResult:
    out: Path = tmp_path_factory.mktemp("lr")
    return train(TrainConfig(model_type="logreg", seed=3, num_threads=2), toy_arrays, out)
