"""evaluate() result structure and the model cards."""

from __future__ import annotations

import json

import pytest

from exofinder.ml import MODEL_TYPES
from exofinder.ml.dataset_arrays import DatasetArrays
from exofinder.ml.device import environment_info, resolve_device
from exofinder.ml.evaluate import evaluate
from exofinder.ml.inference import IncompatiblePipelineError, Predictor
from exofinder.ml.model_cards import get_model_card, list_model_cards
from exofinder.ml.train import TrainResult


def test_evaluate_structure(trained_two_view: TrainResult, toy_arrays: DatasetArrays) -> None:
    pred = Predictor.from_dir(trained_two_view.model_dir)
    res = evaluate(pred, toy_arrays, split="test", n_boot=100)
    test = toy_arrays.subset("test")
    assert res.split == "test" and res.threshold == pred.threshold
    assert res.metrics["n"] == len(test)
    assert sum(res.confusion.values()) == len(test)
    assert set(res.confusion) == {"tn", "fp", "fn", "tp"}
    assert {"roc", "pr", "calibration"} == set(res.curves)
    assert len(res.curves["calibration"]) == 10 and len(res.curves["roc"]) <= 200
    assert set(res.ci) >= {
        "accuracy",
        "f1",
        "roc_auc",
        "pr_auc",
        "specificity",
        "sensitivity",
        "brier",
        "ece",
    }
    assert res.ci_method["resample"] == "star" and res.ci_method["n_boot"] == 100
    t = res.timing
    assert t["ms_per_sample_batch1"] > 0 and t["ms_per_sample_batch64"] > 0 and t["device"] == "cpu"
    assert [r["signal_id"] for r in res.per_example] == test.signal_ids.tolist()
    assert {"signal_id", "label", "prob"} <= res.per_example[0].keys()
    assert res.metrics_at_0_5["threshold"] == 0.5
    json.dumps(res.to_dict(), allow_nan=False)  # strictly JSON-serialisable


def test_evaluate_options_and_guards(trained_rf: TrainResult, toy_arrays: DatasetArrays) -> None:
    pred = Predictor.from_dir(trained_rf.model_dir)
    res = evaluate(
        pred, toy_arrays, split="val", threshold=0.3, n_boot=20, with_uncertainty=True, timing=False
    )
    assert res.threshold == 0.3 and res.metrics["threshold"] == 0.3
    assert "uncertainty" in res.per_example[0] and "ms_per_sample_batch1" not in res.timing
    stale = toy_arrays.select(slice(None))
    stale.meta["pipeline_version"] = "0.0"
    with pytest.raises(IncompatiblePipelineError):
        evaluate(pred, stale, n_boot=10)


def test_model_cards() -> None:
    cards = list_model_cards()
    assert [c["type"] for c in cards] == list(MODEL_TYPES)
    for c in cards:
        assert {
            "type",
            "name",
            "description",
            "inputs",
            "strengths",
            "limitations",
            "architecture",
            "default_config",
            "n_params",
            "reference",
        } <= c.keys()
        json.dumps(c, allow_nan=False)
    two = get_model_card("cnn_two_view")
    assert two["n_params"] == 9_940_193 and two["default_config"]["lr"] == 1e-4
    assert any("MaxPool(7, stride 2)" in line for line in two["architecture"])
    assert get_model_card("logreg")["uncertainty"] is None
    with pytest.raises(ValueError):
        get_model_card("transformer")


def test_device_helpers() -> None:
    assert str(resolve_device("cpu")) == "cpu"
    assert resolve_device("auto").type in {"cpu", "cuda", "mps"}
    with pytest.raises(ValueError):
        resolve_device("tpu")
    info = environment_info()
    assert {"python", "torch", "sklearn", "numpy", "cpu_count", "cuda_available"} <= info.keys()
