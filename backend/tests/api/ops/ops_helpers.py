"""HTTP helpers for the operations API tests (all data involved is SYNTHETIC TEST DATA)."""

from __future__ import annotations

import time

#: Fast training options for tests (small grids / tiny CNN head, 2 epochs).
FAST_LOGREG = {"cv_folds": 2, "logreg_c_grid": [0.01, 1.0], "num_threads": 2}
FAST_RF = {
    "cv_folds": 2,
    "rf_n_estimators": 20,
    "rf_max_depth_grid": [8],
    "rf_min_samples_leaf_grid": [1],
    "num_threads": 2,
}
FAST_CNN = {
    "max_epochs": 2,
    "patience": 2,
    "batch_size": 8,
    "fc_width": 16,
    "fc_layers": 1,
    "lr": 1e-3,
    "num_threads": 2,
}


def wait_for_job(client, job_id: str, timeout: float = 120.0) -> dict:
    """Poll ``GET /api/jobs/{id}`` until the job leaves queued/running; returns the final JobOut."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = client.get(f"/api/jobs/{job_id}")
        assert r.status_code == 200, r.text
        job = r.json()
        if job["status"] not in ("queued", "running"):
            return job
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish within {timeout}s")


def build_dataset(client, name: str = "TEST synthetic", **body) -> dict:
    """Build a dataset through the API and wait for it; returns the dataset detail."""
    r = client.post("/api/datasets", json={"name": name, "tier": "full", **body})
    assert r.status_code == 202, r.text
    job = wait_for_job(client, r.json()["id"], timeout=120)
    assert job["status"] == "succeeded", job
    d = client.get(f"/api/datasets/{job['params']['dataset_id']}")
    assert d.status_code == 200, d.text
    return d.json()


def train(client, dataset_id: int, model_type: str, config: dict | None = None) -> dict:
    """Train one model through the API and wait; returns the experiment detail."""
    r = client.post(
        "/api/training/runs",
        json={"model_type": model_type, "dataset_id": dataset_id, "config": config or {}},
    )
    assert r.status_code == 202, r.text
    job = wait_for_job(client, r.json()["job"]["id"], timeout=180)
    assert job["status"] == "succeeded", job
    d = client.get(f"/api/experiments/{r.json()['experiment_id']}")
    assert d.status_code == 200, d.text
    return d.json()


def evaluate(client, model_id: int, split: str, n_boot: int = 100) -> dict:
    """Run an evaluation through the API and wait; returns the evaluation detail."""
    r = client.post(
        "/api/evaluation/runs", json={"model_version_id": model_id, "split": split, "n_boot": n_boot}
    )
    assert r.status_code == 202, r.text
    job = wait_for_job(client, r.json()["id"], timeout=120)
    assert job["status"] == "succeeded", job
    d = client.get(f"/api/evaluation/{job['result']['evaluation_id']}")
    assert d.status_code == 200, d.text
    return d.json()
