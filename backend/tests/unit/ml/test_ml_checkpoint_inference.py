"""Model bundles (save/load round trip, integrity) and the Predictor (calibration, uncertainty,
pipeline-version guard, input validation)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import torch

from exofinder.config import PIPELINE_VERSION
from exofinder.ml.calibration import logit, sigmoid
from exofinder.ml.checkpoint import BundleError, load_model_bundle, read_bundle_meta, save_model_bundle
from exofinder.ml.dataset_arrays import DatasetArrays
from exofinder.ml.inference import IncompatiblePipelineError, Predictor
from exofinder.ml.models.cnn import SingleViewCNN, TwoViewCNN
from exofinder.ml.train import TrainResult

CONTRACT_META_KEYS = {
    "model_type",
    "config",
    "pipeline_version",
    "dataset_id",
    "feature_names",
    "threshold",
    "temperature",
    "ensemble_size",
    "created_at",
    "library_versions",
}


def _small_two_view(seed: int = 0, dropout: float = 0.3) -> TwoViewCNN:
    torch.manual_seed(seed)
    return TwoViewCNN(global_bins=201, local_bins=61, fc_width=16, fc_layers=2, dropout=dropout).eval()


def _inputs(n: int = 6, seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    return rng.normal(size=(n, 201)).astype(np.float32), rng.normal(size=(n, 61)).astype(np.float32)


def _meta(model_type: str = "cnn_two_view", **kw) -> dict:
    return {"model_type": model_type, "pipeline_version": PIPELINE_VERSION, "dataset_id": None, **kw}


def test_cnn_roundtrip_identical_outputs(tmp_path: Path) -> None:
    model = _small_two_view()
    g, loc = _inputs()
    gt, lt = torch.from_numpy(g).unsqueeze(1), torch.from_numpy(loc).unsqueeze(1)
    with torch.no_grad():
        expected = model(gt, lt)
    save_model_bundle(tmp_path, model, _meta(threshold=0.4, temperature=2.0))
    loaded = load_model_bundle(tmp_path)
    assert loaded.is_cnn and len(loaded.torch_models) == 1
    with torch.no_grad():
        assert torch.equal(loaded.torch_models[0](gt, lt), expected)
    pred = Predictor.from_dir(tmp_path, device="cpu")
    out = pred.predict(g, loc, with_uncertainty=False)
    np.testing.assert_allclose(out.logits, expected.double().numpy(), rtol=0, atol=1e-6)
    np.testing.assert_allclose(out.raw_prob, sigmoid(out.logits))
    np.testing.assert_allclose(out.prob, sigmoid(out.logits / 2.0))
    assert out.threshold == 0.4
    np.testing.assert_array_equal(out.predicted_label, (out.prob >= 0.4).astype(int))


def test_weights_are_plain_state_dicts(tmp_path: Path) -> None:
    save_model_bundle(tmp_path, _small_two_view(), _meta())
    state = torch.load(tmp_path / "member_00" / "best.pt", weights_only=True)
    assert all(isinstance(v, torch.Tensor) for v in state.values())
    meta = read_bundle_meta(tmp_path)
    assert CONTRACT_META_KEYS <= meta.keys()
    assert meta["architecture"]["class"] == "TwoViewCNN"
    assert meta["architecture"]["kwargs"]["local_bins"] == 61


def test_tampered_weights_rejected(tmp_path: Path) -> None:
    save_model_bundle(tmp_path, _small_two_view(), _meta())
    w = tmp_path / "member_00" / "best.pt"
    data = bytearray(w.read_bytes())
    data[-10] ^= 0xFF
    w.write_bytes(bytes(data))
    with pytest.raises(BundleError, match="sha256"):
        load_model_bundle(tmp_path)
    with pytest.raises(BundleError):
        load_model_bundle(tmp_path / "missing")


def test_bundle_requires_pipeline_version(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        save_model_bundle(tmp_path, _small_two_view(), {"model_type": "cnn_two_view"})
    with pytest.raises(ValueError):
        save_model_bundle(tmp_path, _small_two_view(), _meta(model_type="svm"))


def test_pipeline_version_guard(tmp_path: Path) -> None:
    save_model_bundle(tmp_path, _small_two_view(), _meta(pipeline_version="0.9"))
    with pytest.raises(IncompatiblePipelineError, match="0.9"):
        Predictor.from_dir(tmp_path)
    pred = Predictor.from_dir(tmp_path, expected_pipeline_version="0.9")
    g, loc = _inputs(2)
    assert len(pred.predict(g, loc, pipeline_version="0.9")) == 2
    with pytest.raises(IncompatiblePipelineError):
        pred.predict(g, loc, pipeline_version=PIPELINE_VERSION)


def test_mc_dropout_uncertainty_reproducible_without_touching_rng(tmp_path: Path) -> None:
    save_model_bundle(tmp_path, _small_two_view(dropout=0.5), _meta())
    pred = Predictor.from_dir(tmp_path)
    g, loc = _inputs(8)
    state = torch.get_rng_state()
    a = pred.predict(g, loc)
    assert torch.equal(state, torch.get_rng_state())
    b = pred.predict(g, loc)
    assert a.uncertainty_method == "mc_dropout_std"
    assert a.uncertainty is not None and a.uncertainty.shape == (8,)
    assert (a.uncertainty >= 0).all() and (a.uncertainty > 0).any()
    np.testing.assert_array_equal(a.uncertainty, b.uncertainty)
    np.testing.assert_array_equal(a.prob, b.prob)  # deterministic point estimate (dropout off)
    assert pred.predict(g, loc, with_uncertainty=False).uncertainty is None


def test_no_dropout_means_no_mc_uncertainty(tmp_path: Path) -> None:
    save_model_bundle(tmp_path, _small_two_view(dropout=0.0), _meta())
    out = Predictor.from_dir(tmp_path).predict(*_inputs(3))
    assert out.uncertainty is None and out.uncertainty_method is None


def test_ensemble_pooling(tmp_path: Path) -> None:
    torch.manual_seed(0)
    members = [SingleViewCNN(global_bins=201, fc_width=8, fc_layers=1).eval() for _ in range(3)]
    save_model_bundle(tmp_path, members, _meta("cnn_single", temperature=1.5))
    g, _ = _inputs(4)
    with torch.no_grad():
        logits = np.stack([m(torch.from_numpy(g).unsqueeze(1)).double().numpy() for m in members], axis=1)
    out = Predictor.from_dir(tmp_path).predict(g)
    np.testing.assert_allclose(out.logits, logits.mean(axis=1), atol=1e-6)
    np.testing.assert_allclose(out.member_probs, sigmoid(logits / 1.5), atol=1e-6)
    np.testing.assert_allclose(out.uncertainty, sigmoid(logits / 1.5).std(axis=1), atol=1e-6)
    np.testing.assert_allclose(out.prob, sigmoid(logits.mean(axis=1) / 1.5), atol=1e-6)
    assert read_bundle_meta(tmp_path)["ensemble_size"] == 3


def test_trained_cnn_bundle_roundtrip(trained_two_view: TrainResult, toy_arrays: DatasetArrays) -> None:
    pred = Predictor.from_dir(trained_two_view.model_dir)
    assert pred.threshold == pytest.approx(trained_two_view.threshold)
    assert pred.temperature == pytest.approx(trained_two_view.temperature)
    assert pred.pipeline_version == PIPELINE_VERSION and pred.inputs == ("global", "local")
    val = toy_arrays.subset("val")
    out = pred.predict(val.global_view, val.local_view)
    # the bundle reproduces the validation metrics recorded at training time
    from exofinder.ml.metrics import classification_metrics

    m = classification_metrics(val.labels, out.prob, pred.threshold)
    assert m["f1"] == pytest.approx(trained_two_view.val_metrics["f1"])
    # training ran with 2 torch threads, this process may use more: float32 reduction order differs
    assert m["brier"] == pytest.approx(trained_two_view.val_metrics["brier"], abs=1e-6)
    assert pred.logit_offset == pytest.approx(trained_two_view.logit_offset)


def test_random_forest_tree_vote_uncertainty(trained_rf: TrainResult, toy_arrays: DatasetArrays) -> None:
    pred = Predictor.from_dir(trained_rf.model_dir)
    ds = toy_arrays.subset("test")
    out = pred.predict(ds.global_view, ds.local_view, ds.features)
    assert out.uncertainty_method == "tree_vote_std" and out.uncertainty is not None
    assert out.uncertainty.shape == (len(ds),) and (out.uncertainty >= 0).all()
    expected = sigmoid((logit(out.raw_prob) - pred.logit_offset) / pred.temperature)
    np.testing.assert_allclose(out.prob, expected)
    again = Predictor.from_dir(trained_rf.model_dir).predict(ds.global_view, ds.local_view, ds.features)
    np.testing.assert_array_equal(out.prob, again.prob)
    with pytest.raises(ValueError, match="physical features"):
        pred.predict(ds.global_view, ds.local_view, None)


def test_logreg_has_no_uncertainty(trained_logreg: TrainResult, toy_arrays: DatasetArrays) -> None:
    pred = Predictor.from_dir(trained_logreg.model_dir)
    ds = toy_arrays.subset("val")
    out = pred.predict(ds.global_view, ds.local_view, ds.features)
    assert out.uncertainty is None and out.member_probs is None
    assert pred.inputs == ("global", "local", "features")


def test_predict_input_validation(tmp_path: Path) -> None:
    save_model_bundle(tmp_path, _small_two_view(), _meta())
    pred = Predictor.from_dir(tmp_path)
    g, loc = _inputs(1)
    assert len(pred.predict(g[0], loc[0])) == 1  # 1-D input = batch of one
    with pytest.raises(ValueError, match="bins"):
        pred.predict(np.zeros((1, 200), np.float32), loc)
    bad = g.copy()
    bad[0, 5] = np.nan
    with pytest.raises(ValueError, match="NaN"):
        pred.predict(bad, loc)
    with pytest.raises(ValueError, match="local"):
        pred.predict(g, None)


def test_meta_json_is_strict_json(trained_two_view: TrainResult) -> None:
    text = (Path(trained_two_view.model_dir) / "meta.json").read_text()
    json.loads(text, parse_constant=lambda c: pytest.fail(f"non-standard JSON constant {c}"))


def test_mc_dropout_is_batch_invariant_and_leaves_model_in_eval(tmp_path: Path) -> None:
    """An example's MC-dropout uncertainty must not depend on the other examples in the call."""
    save_model_bundle(tmp_path, _small_two_view(dropout=0.5), _meta())
    pred = Predictor.from_dir(tmp_path)
    g, loc = _inputs(7)
    full = pred.predict(g, loc)
    small_batches = pred.predict(g, loc, batch_size=2)
    np.testing.assert_allclose(small_batches.uncertainty, full.uncertainty, rtol=0, atol=1e-6)
    np.testing.assert_allclose(small_batches.prob, full.prob, rtol=0, atol=1e-6)
    for i in (0, 3, 6):
        alone = pred.predict(g[i], loc[i])
        assert alone.uncertainty[0] == pytest.approx(full.uncertainty[i], abs=1e-6)
    assert not any(m.training for m in pred.models[0].modules())  # never switched to train mode


def test_concurrent_mc_dropout_does_not_corrupt_point_predictions(tmp_path: Path) -> None:
    """A shared Predictor (as cached by the API) must give exact point estimates under concurrency."""
    import threading

    save_model_bundle(tmp_path, _small_two_view(dropout=0.5), _meta())
    pred = Predictor.from_dir(tmp_path)
    g, loc = _inputs(32, seed=3)
    ref = pred.predict(g, loc, with_uncertainty=False).prob
    ref_unc = pred.predict(g, loc).uncertainty
    errors: list[str] = []

    def point() -> None:
        for _ in range(25):
            if not np.allclose(pred.predict(g, loc, with_uncertainty=False).prob, ref, rtol=0, atol=1e-6):
                errors.append("point estimate changed")

    def mc() -> None:
        for _ in range(25):
            if not np.allclose(pred.predict(g, loc).uncertainty, ref_unc, rtol=0, atol=1e-6):
                errors.append("uncertainty changed")

    threads = [threading.Thread(target=f) for f in (point, mc, mc, point)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []


def test_empty_batch_returns_empty_outputs(
    tmp_path: Path, trained_rf: TrainResult, trained_logreg: TrainResult, toy_arrays: DatasetArrays
) -> None:
    save_model_bundle(tmp_path, _small_two_view(dropout=0.5), _meta())
    g, loc = _inputs(1)
    out = Predictor.from_dir(tmp_path).predict(g[:0], loc[:0])
    assert len(out) == 0 and out.logits.shape == (0,) and out.uncertainty.shape == (0,)
    ds = toy_arrays.subset("test")
    for r in (trained_rf, trained_logreg):
        out = Predictor.from_dir(r.model_dir).predict(ds.global_view[:0], ds.local_view[:0], ds.features[:0])
        assert len(out) == 0 and out.raw_prob.shape == (0,)
    with pytest.raises(ValueError, match="batch_size"):
        Predictor.from_dir(tmp_path).predict(g, loc, batch_size=0)


def test_prior_correction_applied_by_predictor(tmp_path: Path) -> None:
    model = _small_two_view(dropout=0.0)
    save_model_bundle(tmp_path, model, _meta(temperature=1.5, logit_offset=0.8))
    g, loc = _inputs(5)
    out = Predictor.from_dir(tmp_path).predict(g, loc)
    np.testing.assert_allclose(out.prob, sigmoid((out.logits - 0.8) / 1.5))
    np.testing.assert_allclose(out.raw_prob, sigmoid(out.logits))  # raw stays uncorrected
    # bundles written before logit_offset existed behave as offset 0
    meta = json.loads((tmp_path / "meta.json").read_text())
    del meta["logit_offset"]
    (tmp_path / "meta.json").write_text(json.dumps(meta))
    old = Predictor.from_dir(tmp_path).predict(g, loc)
    np.testing.assert_allclose(old.prob, sigmoid(old.logits / 1.5))


def test_corrupt_meta_json_is_a_bundle_error(tmp_path: Path) -> None:
    save_model_bundle(tmp_path, _small_two_view(), _meta())
    (tmp_path / "meta.json").write_text("{not json")
    with pytest.raises(BundleError, match="corrupt"):
        load_model_bundle(tmp_path)
    (tmp_path / "meta.json").write_text(json.dumps({"model_type": "cnn_two_view", "weights": [{}]}))
    with pytest.raises(BundleError, match="malformed"):
        load_model_bundle(tmp_path)
