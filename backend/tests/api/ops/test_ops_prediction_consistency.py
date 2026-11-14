"""Predictions must score inputs processed exactly like the model's training examples.

All data are SYNTHETIC TEST DATA (see ``ops_testdata``); the models are TEST FIXTURES.
"""

from __future__ import annotations

import numpy as np
from ops_helpers import FAST_LOGREG, build_dataset, train, wait_for_job


def _dataset_probability(ds: dict, model_dir: str, signal_id: int) -> float:
    """Calibrated probability of the model on the dataset's own arrays row for ``signal_id``."""
    from exofinder.ml.inference import Predictor
    from exofinder.services.ops_common import load_arrays_cached

    arrays = load_arrays_cached(ds["path"])
    i = int(np.flatnonzero(arrays.signal_ids == signal_id)[0])
    out = Predictor.from_dir(model_dir).predict(
        arrays.global_view[i], arrays.local_view[i], arrays.features[i], with_uncertainty=False
    )
    return float(out.prob[0])


def test_predictions_use_the_training_dataset_preprocessing(ops_client):
    """A model trained on a savgol-detrended dataset is served savgol views (not the spline default),
    in single predictions and in batch predictions; models with different preprocessing cannot share
    one request."""
    c = ops_client
    ds = build_dataset(c, "TEST savgol", pipeline={"detrend_method": "savgol"})
    mv = train(c, ds["id"], "logreg", FAST_LOGREG)["model_version"]
    ex = c.get(f"/api/datasets/{ds['id']}/examples", params={"included": True, "limit": 1}).json()["items"][0]
    sid, kepid = ex["signal_id"], ex["kepid"]

    train_views = c.get(f"/api/datasets/{ds['id']}/examples/{sid}/views").json()
    r = c.post(
        "/api/predictions",
        json={
            "model_version_ids": [mv["id"]],
            "source": {"type": "catalog", "kepid": kepid, "signal_id": sid},
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("global", "local"):
        np.testing.assert_allclose(body["views"][key], train_views[key], atol=1e-4)
    expected = _dataset_probability(ds, mv["checkpoint_path"], sid)
    assert abs(body["results"][0]["probability"] - expected) < 1e-6

    r = c.post("/api/predictions/batch", json={"model_version_id": mv["id"], "category": "all"})
    assert r.status_code == 202, r.text
    job = wait_for_job(c, r.json()["id"])
    assert job["status"] == "succeeded", job
    hist = c.get("/api/predictions", params={"batch_job_id": job["id"], "signal_id": sid}).json()
    assert hist["total"] == 1 and abs(hist["items"][0]["probability"] - expected) < 1e-6

    spline = build_dataset(c, "TEST spline")
    mv2 = train(c, spline["id"], "logreg", FAST_LOGREG)["model_version"]
    r = c.post(
        "/api/predictions",
        json={
            "model_version_ids": [mv["id"], mv2["id"]],
            "source": {"type": "catalog", "kepid": kepid, "signal_id": sid},
        },
    )
    assert r.status_code == 400 and r.json()["code"] == "mixed_pipeline_configs", r.text


def test_batch_survives_an_unexpected_error_on_one_signal(ops_client, monkeypatch):
    """One signal failing with an unexpected exception is counted as a processing error; the batch
    still scores the others (the dataset build already behaves this way)."""
    c = ops_client
    ds = build_dataset(c, "TEST batch")
    mv = train(c, ds["id"], "logreg", FAST_LOGREG)["model_version"]

    from exofinder.services import predictions as pred_svc

    real = pred_svc.compute_signal_views
    bad: list[str] = []

    def flaky(session, sig, **kw):
        if not bad:
            bad.append(sig.signal_key)
            raise RuntimeError("TEST: unexpected failure inside the pipeline")
        return real(session, sig, **kw)

    monkeypatch.setattr(pred_svc, "compute_signal_views", flaky)
    r = c.post("/api/predictions/batch", json={"model_version_id": mv["id"], "category": "all"})
    assert r.status_code == 202, r.text
    job = wait_for_job(c, r.json()["id"])
    assert job["status"] == "succeeded", job
    res = job["result"]
    assert res["failures_by_reason"].get("processing_error", 0) >= 1
    assert res["n_scored"] >= 10 and res["n_scored"] + res["n_failed"] == res["n_signals"]
