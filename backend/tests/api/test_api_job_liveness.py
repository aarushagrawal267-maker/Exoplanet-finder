"""Job liveness: a server start must only mark jobs whose owning process died (stale heartbeat),
never jobs that another live process (e.g. a CLI dataset build) is still running."""

from __future__ import annotations

from datetime import timedelta


def _add_job(db, job_id: str, heartbeat_age_s: float | None):
    from exofinder.db.models import Job, utcnow

    hb = None if heartbeat_age_s is None else utcnow() - timedelta(seconds=heartbeat_age_s)
    db.add(Job(id=job_id, kind="build_dataset", title=job_id, status="running", params={}, heartbeat_at=hb))
    db.commit()


def test_mark_interrupted_only_marks_stale_jobs(db):
    from exofinder.db.models import Job
    from exofinder.jobs.runner import mark_interrupted_jobs

    _add_job(db, "fresh", heartbeat_age_s=5)  # live owner (e.g. CLI process)
    _add_job(db, "stale", heartbeat_age_s=600)  # owner died long ago
    _add_job(db, "legacy", heartbeat_age_s=None)  # no heartbeat at all
    assert mark_interrupted_jobs() == 2
    db.expire_all()
    assert db.get(Job, "fresh").status == "running"
    assert db.get(Job, "stale").status == "failed"
    assert db.get(Job, "legacy").status == "failed"


def test_heartbeat_register_writes_owner_and_timestamp(db):
    from exofinder.db.models import Job
    from exofinder.jobs.runner import heartbeat_register, heartbeat_unregister

    _add_job(db, "hb", heartbeat_age_s=None)
    heartbeat_register("hb", "cli")
    try:
        db.expire_all()
        job = db.get(Job, "hb")
        assert job.heartbeat_at is not None
        assert job.owner and job.owner.startswith("cli:")
    finally:
        heartbeat_unregister("hb")


def test_init_db_adds_missing_columns_to_old_database(tmp_path):
    import sqlalchemy as sa

    from exofinder.db.session import _add_missing_columns

    engine = sa.create_engine(f"sqlite:///{(tmp_path / 'old.db').as_posix()}")
    with engine.begin() as conn:  # a 'jobs' table as created by version 1.0 (no liveness columns)
        conn.execute(
            sa.text("CREATE TABLE jobs (id VARCHAR(36) PRIMARY KEY, kind VARCHAR(32), title VARCHAR(256))")
        )
        conn.execute(sa.text("INSERT INTO jobs (id, kind, title) VALUES ('a', 'train', 't')"))
    added = _add_missing_columns(engine)
    assert "jobs.heartbeat_at" in added and "jobs.owner" in added
    cols = {c["name"] for c in sa.inspect(engine).get_columns("jobs")}
    assert {"heartbeat_at", "owner"} <= cols
    with engine.begin() as conn:  # existing data untouched
        assert conn.execute(sa.text("SELECT title FROM jobs WHERE id='a'")).scalar() == "t"
    assert _add_missing_columns(engine) == []  # idempotent


def test_dead_owner_is_detected_while_the_server_runs(client, db):
    """A command-line build whose process died (terminal closed) must not stay 'running'/'building'
    until the next server restart: listing jobs/datasets marks it interrupted. Jobs owned by this
    process are never touched, however old their heartbeat."""
    from exofinder.db.models import Dataset, Job
    from exofinder.jobs.runner import heartbeat_register, heartbeat_unregister

    _add_job(db, "dead-cli", heartbeat_age_s=600)
    _add_job(db, "live-cli", heartbeat_age_s=5)
    _add_job(db, "mine", heartbeat_age_s=None)
    db.add(
        Dataset(
            name="TEST dead CLI build",
            label_mode="astronet_dr24",
            tier="pilot",
            status="building",
            pipeline_version="1.0",
            job_id="dead-cli",
        )
    )
    db.commit()
    heartbeat_register("mine", "api")
    try:
        db.expire_all()
        db.get(Job, "mine").heartbeat_at = None  # simulate a missed beat of a job this process runs
        db.commit()
        jobs = {j["id"]: j for j in client.get("/api/jobs").json()}
        assert jobs["dead-cli"]["status"] == "failed" and "Interrupted" in jobs["dead-cli"]["error"]
        assert jobs["live-cli"]["status"] == "running"
        assert jobs["mine"]["status"] == "running"
        ds = {d["name"]: d for d in client.get("/api/datasets").json()}["TEST dead CLI build"]
        assert ds["status"] == "failed" and "Interrupted" in ds["error"]
    finally:
        heartbeat_unregister("mine")
