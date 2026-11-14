"""SQLAlchemy ORM models.

SQLite stores metadata, provenance, history and settings. Large arrays (light curves, views,
checkpoints) live on disk; rows only hold their paths.

Conventions
-----------
* Times are UTC ``datetime``.
* JSON columns hold plain dicts/lists (no numpy types).
* Astronomical ephemerides for Kepler signals are stored in BKJD (BJD - 2454833.0) days.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


# --------------------------------------------------------------------------------------------------
# Catalogue / provenance
# --------------------------------------------------------------------------------------------------
class CatalogSnapshot(Base):
    """One retrieval of a NASA Exoplanet Archive table, saved verbatim to data/catalogs/."""

    __tablename__ = "catalog_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(64), index=True)  # dr24_tce | koi_cumulative | confirmed | stellar
    table_name: Mapped[str] = mapped_column(String(64))
    query: Mapped[str] = mapped_column(Text)
    url: Mapped[str] = mapped_column(Text)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    row_count: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    file_path: Mapped[str] = mapped_column(Text)
    validation: Mapped[dict] = mapped_column(JSON, default=dict)


class Target(Base):
    """A Kepler star (KIC target)."""

    __tablename__ = "targets"

    kepid: Mapped[int] = mapped_column(Integer, primary_key=True)
    ra: Mapped[float | None] = mapped_column(Float)
    dec: Mapped[float | None] = mapped_column(Float)
    kepmag: Mapped[float | None] = mapped_column(Float)
    teff: Mapped[float | None] = mapped_column(Float)
    logg: Mapped[float | None] = mapped_column(Float)
    radius: Mapped[float | None] = mapped_column(Float)  # stellar radius, solar radii
    mass: Mapped[float | None] = mapped_column(Float)
    kepler_host_name: Mapped[str | None] = mapped_column(String(64), index=True)  # e.g. "Kepler-90"
    # light-curve availability: none | queued | downloading | available | no_data | error
    lc_status: Mapped[str] = mapped_column(String(16), default="none", index=True)
    lc_quarters: Mapped[list] = mapped_column(JSON, default=list)
    lc_n_cadences: Mapped[int | None] = mapped_column(Integer)
    lc_path: Mapped[str | None] = mapped_column(Text)
    lc_error: Mapped[str | None] = mapped_column(Text)
    lc_updated_at: Mapped[datetime | None] = mapped_column(DateTime)

    signals: Mapped[list[Signal]] = relationship(back_populates="target")


class Signal(Base):
    """A transit-like signal on a target.

    One row per DR24 TCE; KOI fields are merged in when the KOI's TCE link is verified. KOIs with no
    DR24 TCE, and confirmed planets in neither list (e.g. Kepler-90 i), get their own rows.
    """

    __tablename__ = "signals"
    __table_args__ = (Index("ix_signals_kepid_category", "kepid", "category"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    signal_key: Mapped[str] = mapped_column(String(64), unique=True)  # TCE-011442793-01 | KOI-K00351.08 | PL-Kepler-90_i
    kepid: Mapped[int] = mapped_column(ForeignKey("targets.kepid"), index=True)
    primary_source: Mapped[str] = mapped_column(String(16))  # dr24_tce | koi | confirmed

    # identifiers
    tce_plnt_num: Mapped[int | None] = mapped_column(Integer)
    kepoi_name: Mapped[str | None] = mapped_column(String(16), index=True)
    kepler_name: Mapped[str | None] = mapped_column(String(64), index=True)

    # ephemeris (catalogue values, BKJD)
    period_days: Mapped[float] = mapped_column(Float)
    epoch_bkjd: Mapped[float] = mapped_column(Float)
    duration_hours: Mapped[float] = mapped_column(Float)
    depth_ppm: Mapped[float | None] = mapped_column(Float)
    model_snr: Mapped[float | None] = mapped_column(Float)
    planet_radius_re: Mapped[float | None] = mapped_column(Float)

    # labels — raw values exactly as published
    av_training_set: Mapped[str | None] = mapped_column(String(8), index=True)  # PC | AFP | NTP | UNK
    koi_disposition: Mapped[str | None] = mapped_column(String(24), index=True)  # CONFIRMED | CANDIDATE | FALSE POSITIVE
    koi_pdisposition: Mapped[str | None] = mapped_column(String(24))
    koi_score: Mapped[float | None] = mapped_column(Float)  # display only — NEVER a model feature
    fpflag_nt: Mapped[int | None] = mapped_column(Integer)
    fpflag_ss: Mapped[int | None] = mapped_column(Integer)
    fpflag_co: Mapped[int | None] = mapped_column(Integer)
    fpflag_ec: Mapped[int | None] = mapped_column(Integer)

    # derived
    category: Mapped[str] = mapped_column(String(16), index=True)  # confirmed | false_positive | candidate | unknown
    label_conflict: Mapped[bool] = mapped_column(Boolean, default=False)
    match_status: Mapped[str | None] = mapped_column(String(24))  # tce_only | koi_matched | koi_only | match_conflict | confirmed_only
    provenance: Mapped[dict] = mapped_column(JSON, default=dict)  # {field: {table, column, snapshot_id, value}}

    target: Mapped[Target] = relationship(back_populates="signals")


# --------------------------------------------------------------------------------------------------
# Datasets
# --------------------------------------------------------------------------------------------------
class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    label_mode: Mapped[str] = mapped_column(String(32))  # astronet_dr24 | koi_disposition
    tier: Mapped[str] = mapped_column(String(16))  # pilot | standard | full | custom
    status: Mapped[str] = mapped_column(String(16), default="building")  # building | ready | failed
    pipeline_version: Mapped[str] = mapped_column(String(16))
    split_seed: Mapped[int] = mapped_column(Integer, default=42)
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
    content_hash: Mapped[str | None] = mapped_column(String(64))
    path: Mapped[str | None] = mapped_column(Text)  # data/datasets/<id>/
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("datasets.id"))  # when expanded from another
    n_examples: Mapped[int] = mapped_column(Integer, default=0)
    n_train: Mapped[int] = mapped_column(Integer, default=0)
    n_val: Mapped[int] = mapped_column(Integer, default=0)
    n_test: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    job_id: Mapped[str | None] = mapped_column(String(36))


class DatasetExample(Base):
    __tablename__ = "dataset_examples"
    __table_args__ = (UniqueConstraint("dataset_id", "signal_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id"), index=True)
    signal_id: Mapped[int] = mapped_column(ForeignKey("signals.id"), index=True)
    kepid: Mapped[int] = mapped_column(Integer, index=True)
    label: Mapped[int | None] = mapped_column(Integer)  # 1 planet-like, 0 false-positive-like
    split: Mapped[str | None] = mapped_column(String(8), index=True)  # train | val | test (None if excluded)
    included: Mapped[bool] = mapped_column(Boolean, default=True)
    exclusion_reason: Mapped[str | None] = mapped_column(String(64))
    quality: Mapped[dict] = mapped_column(JSON, default=dict)
    array_index: Mapped[int | None] = mapped_column(Integer)  # row in arrays.npz


# --------------------------------------------------------------------------------------------------
# Jobs
# --------------------------------------------------------------------------------------------------
class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)  # uuid4 hex
    kind: Mapped[str] = mapped_column(String(32), index=True)  # catalog_refresh | download | build_dataset | train | evaluate | batch_predict
    title: Mapped[str] = mapped_column(String(256))
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)  # queued | running | succeeded | failed | cancelled
    progress: Mapped[float] = mapped_column(Float, default=0.0)  # 0..1
    message: Mapped[str | None] = mapped_column(Text)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)
    log: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)


# --------------------------------------------------------------------------------------------------
# Experiments / models
# --------------------------------------------------------------------------------------------------
class Experiment(Base):
    __tablename__ = "experiments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    model_type: Mapped[str] = mapped_column(String(32))  # logreg | random_forest | cnn_single | cnn_two_view
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="queued")  # queued | running | succeeded | failed | cancelled
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    seed: Mapped[int] = mapped_column(Integer, default=42)
    device: Mapped[str | None] = mapped_column(String(16))
    environment: Mapped[dict] = mapped_column(JSON, default=dict)  # python/torch/sklearn versions, git commit, cpu
    val_metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    best_epoch: Mapped[int | None] = mapped_column(Integer)
    epochs_run: Mapped[int | None] = mapped_column(Integer)
    duration_s: Mapped[float | None] = mapped_column(Float)
    notes: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    job_id: Mapped[str | None] = mapped_column(String(36))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)

    epochs: Mapped[list[EpochMetric]] = relationship(back_populates="experiment", order_by="EpochMetric.epoch")


class EpochMetric(Base):
    __tablename__ = "epoch_metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    experiment_id: Mapped[int] = mapped_column(ForeignKey("experiments.id"), index=True)
    epoch: Mapped[int] = mapped_column(Integer)
    train_loss: Mapped[float | None] = mapped_column(Float)
    val_loss: Mapped[float | None] = mapped_column(Float)
    val_pr_auc: Mapped[float | None] = mapped_column(Float)
    val_roc_auc: Mapped[float | None] = mapped_column(Float)
    val_accuracy: Mapped[float | None] = mapped_column(Float)
    lr: Mapped[float | None] = mapped_column(Float)
    elapsed_s: Mapped[float | None] = mapped_column(Float)

    experiment: Mapped[Experiment] = relationship(back_populates="epochs")


class ModelVersion(Base):
    __tablename__ = "model_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    model_type: Mapped[str] = mapped_column(String(32))
    experiment_id: Mapped[int | None] = mapped_column(ForeignKey("experiments.id"))
    dataset_id: Mapped[int | None] = mapped_column(ForeignKey("datasets.id"))
    pipeline_version: Mapped[str] = mapped_column(String(16))
    checkpoint_path: Mapped[str] = mapped_column(Text)  # directory under artifacts/models/
    threshold: Mapped[float] = mapped_column(Float, default=0.5)
    temperature: Mapped[float] = mapped_column(Float, default=1.0)
    ensemble_size: Mapped[int] = mapped_column(Integer, default=1)
    n_params: Mapped[int | None] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    #: True ONLY for deterministic test fixtures. Fixture models must never be presented as real results.
    is_fixture: Mapped[bool] = mapped_column(Boolean, default=False)
    val_metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    test_metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Evaluation(Base):
    __tablename__ = "evaluations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    model_version_id: Mapped[int] = mapped_column(ForeignKey("model_versions.id"), index=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id"))
    split: Mapped[str] = mapped_column(String(8))  # val | test
    threshold: Mapped[float] = mapped_column(Float)
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)  # point estimates
    ci: Mapped[dict] = mapped_column(JSON, default=dict)  # {metric: [lo, hi]} 95% bootstrap
    curves: Mapped[dict] = mapped_column(JSON, default=dict)  # roc, pr, calibration (downsampled)
    confusion: Mapped[dict] = mapped_column(JSON, default=dict)  # {tn, fp, fn, tp}
    timing: Mapped[dict] = mapped_column(JSON, default=dict)  # ms per sample batch1/batch64, device
    per_example_path: Mapped[str | None] = mapped_column(Text)  # CSV of signal_id, label, prob
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Prediction(Base):
    __tablename__ = "predictions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    model_version_id: Mapped[int] = mapped_column(ForeignKey("model_versions.id"), index=True)
    source_type: Mapped[str] = mapped_column(String(16))  # catalog | fits | csv
    kepid: Mapped[int | None] = mapped_column(Integer, index=True)
    signal_id: Mapped[int | None] = mapped_column(ForeignKey("signals.id"))
    input_name: Mapped[str] = mapped_column(String(256))
    ephemeris: Mapped[dict] = mapped_column(JSON, default=dict)  # period, epoch, duration + provenance
    probability: Mapped[float] = mapped_column(Float)  # calibrated P(planet-like)
    raw_probability: Mapped[float] = mapped_column(Float)
    predicted_label: Mapped[int] = mapped_column(Integer)
    uncertainty: Mapped[float | None] = mapped_column(Float)
    member_probabilities: Mapped[list] = mapped_column(JSON, default=list)
    quality: Mapped[dict] = mapped_column(JSON, default=dict)
    seen_in_split: Mapped[str] = mapped_column(String(8), default="none")  # train | val | test | none
    catalog_labels: Mapped[dict] = mapped_column(JSON, default=dict)
    inference_ms: Mapped[float | None] = mapped_column(Float)
    batch_job_id: Mapped[str | None] = mapped_column(String(36), index=True)
    artifacts_path: Mapped[str | None] = mapped_column(Text)  # npz with views used


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
