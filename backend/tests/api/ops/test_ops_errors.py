"""Error paths of the operations API: every error body is ``{detail, code, hint}`` with a useful code.

Uses an empty temporary database or the SYNTHETIC TEST DATA catalogue (ops_testdata.py).
"""

from __future__ import annotations

import pytest
from ops_helpers import FAST_LOGREG, build_dataset, train


def _err(r, status: int, code: str) -> dict:
    assert r.status_code == status, r.text
    body = r.json()
    assert body["code"] == code and body["detail"], body
    return body


def test_empty_install(client):
    """Fresh install: no catalogue, no datasets, no models."""
    c = client
    assert c.get("/api/datasets/tiers").json() == []
    assert c.get("/api/datasets").json() == []
    assert c.get("/api/models").json() == []
    assert c.get("/api/experiments").json() == []
    assert c.get("/api/evaluation").json() == []
    body = _err(c.post("/api/datasets", json={"name": "x"}), 409, "catalog_empty")
    assert "refresh" in body["hint"].lower()
    cards = c.get("/api/training/model-types").json()
    assert [m["type"] for m in cards] == ["logreg", "random_forest", "cnn_single", "cnn_two_view"]
    assert cards[3]["n_params"] > 1_000_000 and cards[0]["n_params"] is None


@pytest.mark.parametrize(
    ("method", "url", "code"),
    [
        ("get", "/api/datasets/999", "dataset_not_found"),
        ("get", "/api/datasets/999/examples", "dataset_not_found"),
        ("get", "/api/datasets/999/examples/1/views", "dataset_not_found"),
        ("get", "/api/datasets/999/gallery", "dataset_not_found"),
        ("delete", "/api/datasets/999", "dataset_not_found"),
        ("get", "/api/models/999", "model_not_found"),
        ("post", "/api/models/999/activate", "model_not_found"),
        ("delete", "/api/models/999", "model_not_found"),
        ("get", "/api/evaluation/999", "evaluation_not_found"),
        ("get", "/api/evaluation/999/examples", "evaluation_not_found"),
        ("get", "/api/evaluation/999/feature-importance", "evaluation_not_found"),
        ("get", "/api/evaluation/compare?ids=998,999", "evaluation_not_found"),
        ("get", "/api/experiments/999", "experiment_not_found"),
        ("delete", "/api/experiments/999", "experiment_not_found"),
        ("get", "/api/experiments/compare?ids=1,2", "experiment_not_found"),
        ("get", "/api/reports/experiments/999", "experiment_not_found"),
        ("get", "/api/training/estimate?model_type=logreg&dataset_id=999", "dataset_not_found"),
    ],
)
def test_not_found(client, method, url, code):
    _err(getattr(client, method)(url), 404, code)


def test_validation_errors(client):
    c = client
    _err(c.get("/api/evaluation/compare", params={"ids": "1,x"}), 400, "invalid_ids")
    _err(c.get("/api/experiments/compare", params={"ids": ","}), 400, "invalid_ids")
    _err(c.patch("/api/experiments/1", json={"bogus": 1}), 422, "validation_error")
    _err(
        c.post("/api/evaluation/runs", json={"model_version_id": 1, "split": "train"}),
        422,
        "validation_error",
    )
    _err(
        c.post("/api/evaluation/runs", json={"model_version_id": 999, "split": "val"}), 404, "model_not_found"
    )
    _err(c.get("/api/reports/experiments/1", params={"format": "pdf"}), 422, "validation_error")
    _err(c.get("/api/datasets/tiers", params={"label_mode": "nope"}), 422, "validation_error")
    _err(c.post("/api/training/runs", json={"model_type": "svm", "dataset_id": 1}), 422, "validation_error")
    _err(
        c.post("/api/training/runs", json={"model_type": "logreg", "dataset_id": 1, "config": {"nope": 1}}),
        422,
        "validation_error",
    )
    _err(
        c.post(
            "/api/training/runs", json={"model_type": "logreg", "dataset_id": 1, "config": {"dropout": 1.5}}
        ),
        422,
        "validation_error",
    )
    _err(
        c.post("/api/training/runs", json={"model_type": "logreg", "dataset_id": 999}),
        404,
        "dataset_not_found",
    )


def test_dataset_request_errors(ops_client):
    c = ops_client
    _err(c.post("/api/datasets", json={"name": "x", "tier": "custom"}), 400, "invalid_tier")
    _err(c.post("/api/datasets", json={"name": "x", "parent_id": 999}), 404, "dataset_not_found")
    _err(
        c.post("/api/datasets", json={"name": "x", "pipeline": {"detrend_method": "fft"}}),
        422,
        "validation_error",
    )
    _err(c.post("/api/datasets", json={"name": ""}), 422, "validation_error")
    _err(c.post("/api/datasets", json={"name": "x", "workers": 3}), 422, "validation_error")


def test_dataset_custom_tier_parent_and_model_rules(ops_client):
    """Custom size, expansion from a parent (stars keep their split), and model/evaluation conflicts."""
    c = ops_client
    small = build_dataset(c, "TEST small", tier="custom", max_signals=10, exclude_conflicts=False)
    assert small["tier"] == "custom" and small["config"]["max_signals"] == 10
    assert "label_conflict" not in small["stats"]["exclusions_by_reason"]
    child = build_dataset(c, "TEST expanded", parent_id=small["id"])
    assert child["parent_id"] == small["id"]

    def split_by_star(ds_id):
        items = c.get(f"/api/datasets/{ds_id}/examples", params={"included": True, "limit": 500}).json()[
            "items"
        ]
        return {e["kepid"]: e["split"] for e in items}

    parent_splits, child_splits = split_by_star(small["id"]), split_by_star(child["id"])
    assert parent_splits and all(child_splits[k] == v for k, v in parent_splits.items())

    exp = train(c, small["id"], "logreg", FAST_LOGREG)
    mv_id = exp["model_version"]["id"]
    _err(c.delete(f"/api/datasets/{small['id']}"), 409, "dataset_in_use")
    _err(c.delete(f"/api/models/{mv_id}"), 409, "model_is_active")  # the only model
    _err(c.get("/api/evaluation/compare", params={"ids": "1"}), 404, "evaluation_not_found")
    est = c.get("/api/training/estimate", params={"model_type": "logreg", "dataset_id": small["id"]}).json()
    assert est["seconds_per_epoch"] is None and "Baselines" in est["note"]
    r = c.post("/api/evaluation/runs", json={"model_version_id": mv_id, "split": "val", "n_boot": 20})
    assert r.status_code == 202
    # forced delete of the only model is allowed
    from ops_helpers import wait_for_job

    assert wait_for_job(c, r.json()["id"])["status"] == "succeeded"
    d = c.delete(f"/api/models/{mv_id}", params={"force": True}).json()
    assert d["deleted"] and d["evaluations"] == 1 and d["active_model_id"] is None
    _err(c.delete(f"/api/datasets/{small['id']}"), 409, "dataset_in_use")  # the experiment row remains
    assert c.delete(f"/api/experiments/{exp['id']}").json()["models"] == 0
    assert c.delete(f"/api/datasets/{small['id']}").json()["deleted"]


def test_failed_dataset_build_is_reported(ops_client, monkeypatch):
    """A build in which no signal is usable fails cleanly with an explanation."""
    c = ops_client
    from exofinder.services import ops_dataset_worker

    monkeypatch.setattr(
        ops_dataset_worker,
        "process_signal_task",
        lambda task: {
            "signal_id": task["signal_id"],
            "status": "error",
            "error_kind": "processing_error",
            "message": "TEST",
            "elapsed_s": 0.0,
        },
    )
    from ops_helpers import wait_for_job

    r = c.post("/api/datasets", json={"name": "TEST failing", "tier": "full"})
    job = wait_for_job(c, r.json()["id"])
    assert job["status"] == "failed" and "No usable examples" in job["error"]
    ds = c.get(f"/api/datasets/{r.json()['params']['dataset_id']}").json()
    assert ds["status"] == "failed" and "processing_error" in ds["error"]
    _err(c.get(f"/api/datasets/{ds['id']}/gallery"), 409, "dataset_not_ready")
