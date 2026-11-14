"""Jobs API, Server-Sent Events and cancellation (dataset build + training) on SYNTHETIC TEST DATA."""

from __future__ import annotations

import json
import threading
import time

from ops_helpers import FAST_CNN, FAST_LOGREG, FAST_RF, build_dataset, wait_for_job


def _read_events(response, stop) -> list[tuple[str, dict]]:
    """Parse an SSE response until ``stop(events)`` is true or the stream ends."""
    events: list[tuple[str, dict]] = []
    name = None
    for line in response.iter_lines():
        if line.startswith("event: "):
            name = line[len("event: ") :]
        elif line.startswith("data: ") and name:
            events.append((name, json.loads(line[len("data: ") :])))
            name = None
            if stop(events):
                break
    return events


def _gate_heavy_pool():
    """Occupy the single heavy worker until the returned event is set (makes job ordering deterministic)."""
    from exofinder.jobs.runner import get_runner

    gate = threading.Event()

    def blocker(ctx):
        while not gate.wait(0.05):
            ctx.check_cancelled()
        return {}

    get_runner().submit("evaluate", "TEST gate job", blocker, {})
    return gate


def test_jobs_list_get_and_errors(ops_client):
    c = ops_client
    from exofinder.jobs.runner import get_runner

    job_id = get_runner().submit("download", "TEST quick job", lambda ctx: {"answer": 42}, {"x": 1})
    job = wait_for_job(c, job_id)
    assert job["status"] == "succeeded" and job["result"] == {"answer": 42} and "Started" in job["log_tail"]
    listed = c.get("/api/jobs", params={"kind": "download,train", "status": "succeeded"}).json()
    assert [j["id"] for j in listed] == [job_id]
    assert c.get("/api/jobs", params={"status": "running"}).json() == []
    r = c.get("/api/jobs/nope")
    assert r.status_code == 404 and r.json()["code"] == "job_not_found"
    r = c.post(f"/api/jobs/{job_id}/cancel")
    assert r.status_code == 409 and r.json()["code"] == "job_not_active"
    assert c.post("/api/jobs/nope/cancel").status_code == 404
    assert c.get("/api/jobs/nope/events").status_code == 404


def test_sse_finished_job_sends_snapshot_and_done(ops_client):
    c = ops_client
    from exofinder.jobs.runner import get_runner

    job_id = get_runner().submit("download", "TEST quick job", lambda ctx: {"ok": True}, {})
    wait_for_job(c, job_id)
    with c.stream("GET", f"/api/jobs/{job_id}/events") as r:
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
        events = _read_events(r, lambda ev: False)  # the stream closes by itself after "done"
    assert [e[0] for e in events] == ["snapshot", "done"]
    assert events[0][1]["status"] == "succeeded" and events[1][1]["status"] == "succeeded"


def test_sse_training_job_streams_epochs(ops_client):
    c = ops_client
    ds = build_dataset(c)
    gate = _gate_heavy_pool()
    r = c.post(
        "/api/training/runs",
        json={
            "model_type": "cnn_single",
            "dataset_id": ds["id"],
            "config": {**FAST_CNN, "max_epochs": 3, "patience": 3},
        },
    )
    assert r.status_code == 202
    job_id = r.json()["job"]["id"]
    assert r.json()["job"]["status"] == "queued"
    with c.stream("GET", f"/api/jobs/{job_id}/events") as resp:
        first: list = []

        def stop(ev):
            if len(ev) == 1:
                first.append(ev[0])
                gate.set()  # subscribed: let the training job run
            return ev[-1][0] == "done"

        events = _read_events(resp, stop)
    names = [e[0] for e in events]
    assert names[0] == "snapshot" and first[0][1]["status"] == "queued"
    assert names[-1] == "done" and events[-1][1]["status"] == "succeeded"
    epochs = [e[1] for e in events if e[0] == "epoch"]
    assert [e["epoch"] for e in epochs] == [1, 2, 3]
    assert all(e["job_id"] == job_id and "val_pr_auc" in e and e["experiment_id"] for e in epochs)
    assert "progress" in names and "log" in names


def test_global_stream_receives_job_events(ops_client):
    c = ops_client
    from exofinder.jobs.runner import get_runner

    with c.stream("GET", "/api/jobs/stream") as resp:
        submitted: dict = {}

        def stop(ev):
            if len(ev) == 1:
                assert ev[0][0] == "snapshot" and ev[0][1]["jobs"] == []
                submitted["id"] = get_runner().submit(
                    "download", "TEST streamed job", lambda ctx: {"v": 1}, {}
                )
            return ev[-1][0] == "done" and ev[-1][1].get("job_id") == submitted.get("id")

        events = _read_events(resp, stop)
    mine = [e for e in events if e[1].get("job_id") == submitted["id"]]
    assert {e[0] for e in mine} >= {"progress", "log", "done"}


def test_cancel_running_dataset_build(ops_client, monkeypatch):
    c = ops_client
    from exofinder.services import ops_dataset_worker

    real = ops_dataset_worker.process_signal_task

    def slow(task):
        time.sleep(0.25)
        return real(task)

    monkeypatch.setattr(ops_dataset_worker, "process_signal_task", slow)
    r = c.post("/api/datasets", json={"name": "TEST cancelled", "tier": "full"})
    job_id, ds_id = r.json()["id"], r.json()["params"]["dataset_id"]
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        j = c.get(f"/api/jobs/{job_id}").json()
        if j["status"] == "running" and "Processing signals" in (j["message"] or ""):
            break
        time.sleep(0.05)
    assert c.post(f"/api/jobs/{job_id}/cancel").status_code == 200
    job = wait_for_job(c, job_id, timeout=30)
    assert job["status"] == "cancelled"
    ds = c.get(f"/api/datasets/{ds_id}").json()
    assert ds["status"] == "cancelled" and ds["error"] == "Cancelled by user" and ds["stats"] is None
    assert c.get(f"/api/datasets/{ds_id}/examples").json()["total"] == 0
    from exofinder.config import get_settings

    assert not (get_settings().datasets_dir / str(ds_id)).exists()
    r = c.post("/api/training/runs", json={"model_type": "logreg", "dataset_id": ds_id})
    assert r.status_code == 409 and r.json()["code"] == "dataset_not_ready"
    assert c.delete(f"/api/datasets/{ds_id}").json()["deleted"]


def test_cancel_training_and_suite(ops_client):
    c = ops_client
    ds = build_dataset(c)
    r = c.post(
        "/api/training/runs",
        json={
            "model_type": "cnn_single",
            "dataset_id": ds["id"],
            "config": {**FAST_CNN, "max_epochs": 200, "patience": 200},
        },
    )
    exp_id, job_id = r.json()["experiment_id"], r.json()["job"]["id"]
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline and not c.get(f"/api/experiments/{exp_id}").json()["epochs"]:
        time.sleep(0.05)
    assert c.post(f"/api/jobs/{job_id}/cancel").status_code == 200
    assert wait_for_job(c, job_id, timeout=60)["status"] == "cancelled"
    exp = c.get(f"/api/experiments/{exp_id}").json()
    assert exp["status"] == "cancelled" and exp["model_version"] is None
    from exofinder.config import get_settings

    assert not list(get_settings().models_dir.glob("_training_*")) and c.get("/api/models").json() == []

    # suite: two baselines in one job, each its own experiment
    r = c.post(
        "/api/training/suite",
        json={
            "dataset_id": ds["id"],
            "name_prefix": "TEST suite",
            "model_types": ["logreg", "random_forest"],
            "configs": {"logreg": FAST_LOGREG, "random_forest": FAST_RF},
        },
    )
    assert r.status_code == 202, r.text
    body = r.json()
    job = wait_for_job(c, body["job"]["id"], timeout=120)
    assert job["status"] == "succeeded" and job["kind"] == "train_suite"
    assert [e["status"] for e in job["result"]["experiments"]] == ["succeeded", "succeeded"]
    exps = [c.get(f"/api/experiments/{i}").json() for i in body["experiment_ids"]]
    assert [e["model_type"] for e in exps] == ["logreg", "random_forest"]
    assert exps[0]["name"] == "TEST suite - Logistic regression" and all(e["model_version_id"] for e in exps)
    assert sum(m["is_active"] for m in c.get("/api/models").json()) == 1


def test_orphaned_rows_are_reconciled(ops_client):
    """A dataset/experiment whose job died with the server is shown as failed, not 'building' forever."""
    c = ops_client
    from exofinder.db.models import Dataset, Experiment, Job
    from exofinder.db.session import session_scope

    with session_scope() as s:
        s.add(
            Job(
                id="deadjob",
                kind="build_dataset",
                title="TEST",
                status="failed",
                error="Interrupted: TEST",
                params={},
            )
        )
        ds = Dataset(
            name="TEST orphan",
            label_mode="astronet_dr24",
            tier="pilot",
            status="building",
            pipeline_version="1.0",
            job_id="deadjob",
        )
        s.add(ds)
        s.flush()
        s.add(
            Experiment(
                name="TEST orphan exp",
                model_type="logreg",
                dataset_id=ds.id,
                status="running",
                job_id="deadjob",
            )
        )
        s.add(
            Experiment(
                name="TEST waiting exp", model_type="logreg", dataset_id=ds.id, status="queued", job_id=None
            )
        )
    listed = {d["name"]: d for d in c.get("/api/datasets").json()}
    assert (
        listed["TEST orphan"]["status"] == "failed" and listed["TEST orphan"]["error"] == "Interrupted: TEST"
    )
    exps = {e["name"]: e for e in c.get("/api/experiments").json()}
    assert (
        exps["TEST orphan exp"]["status"] == "failed"
        and exps["TEST orphan exp"]["error"] == "Interrupted: TEST"
    )
    assert exps["TEST waiting exp"]["status"] == "queued"  # no job linked yet: left alone
