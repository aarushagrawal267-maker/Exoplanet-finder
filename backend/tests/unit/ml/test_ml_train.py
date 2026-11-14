"""Training engine: overfitting sanity check, determinism, callbacks, early stopping, cancellation,
ensembles, baselines and guards. All data here is synthetic test infrastructure (see
``exof_ml_testdata.py``); no number from these tests is a scientific result."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pytest
import torch
from exof_ml_testdata import make_toy_arrays, small_cnn_config

from exofinder.ml.dataset_arrays import DatasetArrays
from exofinder.ml.inference import IncompatiblePipelineError, Predictor
from exofinder.ml.train import (
    TrainConfig,
    TrainingCancelled,
    TrainResult,
    _BestTracker,
    _is_improvement,
    estimate_epoch_seconds,
    train,
)

EPOCH_KEYS = {
    "member",
    "epoch",
    "train_loss",
    "val_loss",
    "val_pr_auc",
    "val_roc_auc",
    "val_accuracy",
    "lr",
    "elapsed_s",
    "best_epoch",
    "best_val_pr_auc",
    "improved",
    "progress",
}


def test_overfits_tiny_separable_set(tmp_path: Path) -> None:
    """A correct training loop must be able to drive the training loss to ~0 on a tiny easy set."""
    arrays = make_toy_arrays(n_stars=30, seed=11)
    cfg = small_cnn_config(lr=3e-3, max_epochs=25, patience=25, dropout=0.0, batch_size=8)
    result = train(cfg, arrays, tmp_path)
    assert result.history[-1]["train_loss"] < 0.05 < result.history[0]["train_loss"]
    tr = arrays.subset("train")
    out = Predictor.from_dir(tmp_path).predict(tr.global_view, tr.local_view)
    assert np.mean((out.raw_prob >= 0.5) == (tr.labels == 1)) == 1.0
    assert result.val_metrics["pr_auc"] == pytest.approx(1.0)


def test_training_is_deterministic(tmp_path: Path) -> None:
    arrays = make_toy_arrays(n_stars=20, seed=5)
    cfg = small_cnn_config("cnn_single", max_epochs=3)
    a = train(cfg, arrays, tmp_path / "a")
    b = train(cfg, arrays, tmp_path / "b")
    assert [h["train_loss"] for h in a.history] == [h["train_loss"] for h in b.history]
    assert [h["val_loss"] for h in a.history] == [h["val_loss"] for h in b.history]
    for name in ("best.pt", "last.pt"):
        sa = torch.load(tmp_path / "a" / "member_00" / name, weights_only=True)
        sb = torch.load(tmp_path / "b" / "member_00" / name, weights_only=True)
        assert sa.keys() == sb.keys()
        assert all(torch.equal(sa[k], sb[k]) for k in sa)
    assert a.threshold == b.threshold and a.temperature == b.temperature
    c = train(small_cnn_config("cnn_single", max_epochs=3, seed=8), arrays, tmp_path / "c")
    assert [h["train_loss"] for h in c.history] != [h["train_loss"] for h in a.history]


def test_result_and_callback_structure(trained_two_view: TrainResult) -> None:
    r = trained_two_view
    assert r.epochs_run == len(r.history) and 1 <= r.best_epoch <= r.epochs_run
    for rec in r.history:
        assert EPOCH_KEYS <= rec.keys()
        assert math.isfinite(rec["train_loss"]) and math.isfinite(rec["val_loss"])
    for k in ("accuracy", "precision", "recall", "specificity", "f1", "roc_auc", "pr_auc", "brier", "ece"):
        assert k in r.val_metrics
    assert r.val_metrics["threshold"] == r.threshold and r.val_metrics_at_0_5["threshold"] == 0.5
    assert 0.0 < r.threshold < 1.0
    # Regression: without the prior correction the toy CNN's logits (all > 0 while most val
    # examples are negative) drove T to the 20.0 clamp and every calibrated probability to ~0.5.
    assert 0.05 < r.temperature < 20.0
    tr = r.meta["train_counts"]
    assert r.logit_offset == pytest.approx(math.log(tr["neg"] / tr["pos"]))
    assert r.meta["logit_offset"] == pytest.approx(r.logit_offset)
    assert r.meta["logit_offset"] == pytest.approx(math.log(r.meta["pos_weight"]))
    assert r.n_params > 0 and r.duration_s > 0 and r.device == "cpu"
    d = Path(r.model_dir)
    for f in ("meta.json", "history.json", "member_00/best.pt", "member_00/last.pt"):
        assert (d / f).exists(), f
    assert r.meta["dataset_id"] == "toy-test" and r.meta["feature_names"]
    assert r.to_dict()["model_dir"] == str(d)


def test_on_epoch_called_every_epoch(tmp_path: Path) -> None:
    arrays = make_toy_arrays(n_stars=16, seed=2)
    seen: list[dict] = []
    r = train(small_cnn_config(max_epochs=3), arrays, tmp_path, on_epoch=seen.append)
    assert [s["epoch"] for s in seen] == [h["epoch"] for h in r.history]
    assert seen[-1]["progress"] <= 1.0 and all(EPOCH_KEYS <= s.keys() for s in seen)


def test_early_stopping_criterion() -> None:
    inf = math.inf
    assert _is_improvement(0.5, 1.0, -inf, inf, 1e-4)  # first epoch
    assert _is_improvement(0.61, 2.0, 0.6, 1.0, 1e-4)  # higher PR-AUC wins even with higher loss
    assert not _is_improvement(0.59, 0.1, 0.6, 1.0, 1e-4)  # lower PR-AUC never improves
    assert _is_improvement(1.0, 0.4, 1.0, 0.5, 1e-4)  # saturated PR-AUC: lower loss breaks the tie
    assert not _is_improvement(1.0, 0.6, 1.0, 0.5, 1e-4)
    assert _is_improvement(None, 0.4, -inf, 0.5, 1e-4)  # single-class validation: monitor loss
    assert not _is_improvement(None, 0.49995, -inf, 0.5, 1e-4)


def test_best_tracker_reference_does_not_ratchet_down() -> None:
    t = _BestTracker(min_delta=0.01, use_pr=True)
    assert t.update(0.90, 1.0)
    assert t.update(0.895, 0.9)  # PR-AUC tie within min_delta, lower loss: selected
    assert t.best_pr == 0.90  # ...but the reference stays at the best PR-AUC seen
    assert not t.update(0.889, 0.8)  # 0.011 below the best: not an improvement
    assert t.update(0.92, 5.0)
    single = _BestTracker(min_delta=0.01, use_pr=False)
    assert single.update(None, 1.0)
    assert not single.update(0.5, 0.995)  # PR-AUC ignored; loss drop below min_delta
    assert single.update(None, 0.9)


def test_patience_stops_training(tmp_path: Path) -> None:
    arrays = make_toy_arrays(n_stars=16, seed=9)
    r = train(small_cnn_config(max_epochs=12, patience=1, lr=1e-5), arrays, tmp_path)
    # the loop stops exactly when `patience` epochs pass without improvement
    for rec in r.history[:-1]:
        assert rec["epochs_since_improvement"] < 1
    if r.epochs_run < 12:
        assert r.history[-1]["epochs_since_improvement"] == 1


def test_cancellation_cnn(tmp_path: Path) -> None:
    arrays = make_toy_arrays(n_stars=16, seed=3)
    calls = {"n": 0}

    def should_stop() -> bool:
        calls["n"] += 1
        return calls["n"] > 3

    threads = torch.get_num_threads()
    with pytest.raises(TrainingCancelled):
        train(small_cnn_config(max_epochs=50), arrays, tmp_path, should_stop=should_stop)
    assert calls["n"] == 4  # polled before every mini-batch, stopped on the first True
    assert torch.get_num_threads() == threads  # thread setting restored
    assert not (tmp_path / "meta.json").exists()  # no bundle written


@pytest.mark.parametrize("model_type", ["logreg", "random_forest"])
def test_cancellation_baselines(tmp_path: Path, model_type: str) -> None:
    arrays = make_toy_arrays(n_stars=16, seed=3)
    with pytest.raises(TrainingCancelled):
        train(
            TrainConfig(model_type=model_type, rf_n_estimators=5), arrays, tmp_path, should_stop=lambda: True
        )


def test_ensemble_members(tmp_path: Path) -> None:
    arrays = make_toy_arrays(n_stars=16, seed=4)
    r = train(small_cnn_config("cnn_single", max_epochs=2, ensemble_size=2), arrays, tmp_path)
    assert sorted({h["member"] for h in r.history}) == [0, 1]
    assert len(r.member_best_epochs) == 2 and r.meta["ensemble_size"] == 2
    for k in (0, 1):
        assert (tmp_path / f"member_{k:02d}" / "best.pt").exists()
        assert (tmp_path / f"member_{k:02d}" / "last.pt").exists()
    out = Predictor.from_dir(tmp_path).predict(arrays.global_view[:5])
    assert out.member_probs is not None and out.member_probs.shape == (5, 2)
    assert out.uncertainty_method == "ensemble_std"


def test_baselines_train(trained_rf: TrainResult, trained_logreg: TrainResult) -> None:
    for r, n_grid in ((trained_rf, 4), (trained_logreg, 4)):
        assert len(r.history) == 1 and r.epochs_run == 1
        assert r.val_metrics["pr_auc"] is not None and r.n_params > 0
        assert len(r.meta["cv_results"]) == n_grid and r.meta["cv_folds"] == 3
        assert r.meta["n_input_features"] == 201 + 61 + 4
        assert len(r.meta["top_features"]) > 0
        assert (Path(r.model_dir) / "model.joblib").exists()
    assert trained_rf.meta["best_params"]["n_estimators"] == 40


def test_guards(tmp_path: Path) -> None:
    arrays = make_toy_arrays(n_stars=12, seed=1)
    old = DatasetArrays(**{**arrays.__dict__, "meta": {**arrays.meta, "pipeline_version": "0.0"}})
    with pytest.raises(IncompatiblePipelineError):
        train(small_cnn_config(max_epochs=1), old, tmp_path / "a")
    no_val = arrays.select(arrays.splits != "val")
    with pytest.raises(ValueError, match="validation"):
        train(small_cnn_config(max_epochs=1), no_val, tmp_path / "b")
    one_class = arrays.select((arrays.labels == 0) | (arrays.splits != "train"))
    with pytest.raises(ValueError, match="both classes"):
        train(small_cnn_config(max_epochs=1), one_class, tmp_path / "c")
    with pytest.raises(ValueError):
        TrainConfig(model_type="svm")
    with pytest.raises(ValueError):
        TrainConfig(dropout=1.5)
    with pytest.raises(ValueError, match="rf_max_depth_grid"):
        TrainConfig(model_type="random_forest", rf_max_depth_grid=())
    with pytest.raises(ValueError, match="min_delta"):
        TrainConfig(min_delta=-0.1)


@pytest.mark.parametrize("bad_name", ["koi_score", "koi_pdisposition", "fpflag_ss", "av_training_set"])
def test_catalogue_features_refused(tmp_path: Path, bad_name: str) -> None:
    """Honesty rule: catalogue vetting scores/dispositions/flags must never become model inputs."""
    arrays = make_toy_arrays(n_stars=12, seed=1)
    names = list(arrays.feature_names)
    names[1] = bad_name
    leaky = DatasetArrays(**{**arrays.__dict__, "feature_names": names})
    for cfg in (TrainConfig(model_type="logreg"), small_cnn_config(max_epochs=1)):
        with pytest.raises(ValueError, match="catalogue"):
            train(cfg, leaky, tmp_path / cfg.model_type)
        assert not (tmp_path / cfg.model_type / "meta.json").exists()


def test_config_roundtrip() -> None:
    cfg = TrainConfig(model_type="random_forest", rf_max_depth_grid=(None, 8), num_threads=3)
    d = cfg.to_dict()
    assert d["rf_max_depth_grid"] == [None, 8]
    again = TrainConfig.from_dict({**d, "unknown_future_key": 1})
    assert again == cfg


def test_estimate_epoch_seconds(toy_arrays: DatasetArrays) -> None:
    est = estimate_epoch_seconds(small_cnn_config(), toy_arrays, n_batches=1)
    assert est["seconds_per_epoch"] > 0 and est["batches_per_epoch"] >= 1
    assert estimate_epoch_seconds(TrainConfig(model_type="logreg"), toy_arrays)["seconds_per_epoch"] is None


def test_divergence_is_reported(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import exofinder.ml.train as train_mod
    from exofinder.ml.models.cnn import build_cnn

    def nan_model(model_type: str, **kw):  # a network whose output is NaN, as after a blow-up
        model = build_cnn(model_type, **kw)
        with torch.no_grad():
            model.head[-1].bias.fill_(float("nan"))
        return model

    monkeypatch.setattr(train_mod, "build_cnn", nan_model)
    with pytest.raises(train_mod.TrainingDiverged, match="learning rate"):
        train(small_cnn_config(max_epochs=2), make_toy_arrays(n_stars=12, seed=6), tmp_path)
    assert not (tmp_path / "meta.json").exists()


def test_meta_json_is_written_last(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """meta.json marks a complete bundle, so a failure while writing history.json must not leave one."""
    import exofinder.ml.train as train_mod

    def failing_history(out: Path, history: list) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(train_mod, "_write_history", failing_history)
    with pytest.raises(OSError):
        train(TrainConfig(model_type="logreg", num_threads=1), make_toy_arrays(n_stars=12, seed=1), tmp_path)
    assert not (tmp_path / "meta.json").exists()
