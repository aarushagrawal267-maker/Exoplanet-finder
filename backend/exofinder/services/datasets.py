"""Training datasets: tier overview, dataset builds (job ``build_dataset``) and the Dataset Explorer.

Build protocol (docs/methodology.md, section 4)
-----------------------------------------------
1. **Select** whole stars for the tier (:func:`exofinder.data.tiers.select_signals_for_tier`, seeded
   with the split seed); reserved showcase stars are always included with all their signals.
2. **Label** each signal with the chosen label mode; undecided labels (and, on request, label
   conflicts) are excluded with the reason code from :mod:`exofinder.data.labels`.
3. **Download** missing light curves (MAST), cancellable. Stars whose last download attempt found no
   Kepler data are not retried.
4. **Process** each signal with the versioned pipeline (:func:`compute_signal_views`) in a spawn-safe
   process pool; every failure is recorded as an exclusion with a reason (``no_lightcurve``,
   ``no_ephemeris``, ``insufficient_data``, ``invalid_input``, ``processing_error``, or
   ``quality:<issue>`` when a blocking quality gate fails).
5. **Split** by star (:func:`exofinder.ml.splits.star_level_split`, 80/10/10, stratified, seeded), with
   reserved showcase stars forced into the test split; leakage is asserted.
6. **Write** ``arrays.npz`` + ``manifest.json`` (provenance: catalogue snapshot ids and SHA-256,
   light-curve cache digests, pipeline configuration) and one ``DatasetExample`` row per selected
   signal (included or not), plus statistics and a content hash.

Unlabelled signals of reserved stars are processed (quality is recorded and the view cache is warmed
for demonstrations) but are never part of the arrays.
"""

from __future__ import annotations

import hashlib
import json
import logging
import multiprocessing
import os
import sys
import time
from collections import Counter, defaultdict
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait
from concurrent.futures.process import BrokenProcessPool
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import partial
from pathlib import Path
from typing import Any

import numpy as np
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from exofinder.astro.pipeline import PipelineConfig
from exofinder.astro.quality import BLOCKING_ISSUES
from exofinder.config import PIPELINE_VERSION, get_settings
from exofinder.data.labels import EXCLUSION_REASONS, LABEL_MODES, label_for
from exofinder.data.labels import exclusion_reason as label_exclusion_reason
from exofinder.data.lightcurve_store import has_lightcurve
from exofinder.data.tiers import RESERVED_SHOWCASE_KEPIDS, select_signals_for_tier
from exofinder.db.models import (
    CatalogSnapshot,
    Dataset,
    DatasetExample,
    Evaluation,
    Experiment,
    Job,
    ModelVersion,
    Signal,
    Target,
)
from exofinder.db.session import session_scope
from exofinder.jobs.runner import JobCancelled, JobContext, get_runner
from exofinder.ml.dataset_arrays import DatasetArrays, save_dataset_arrays
from exofinder.ml.features import downsample_blocks
from exofinder.ml.splits import SPLIT_NAMES, assert_no_leakage, split_summary, star_level_split
from exofinder.services import ops_dataset_worker
from exofinder.services.jobs import JobSpec, ProgressRange, reconcile_orphans
from exofinder.services.jsonutil import to_jsonable
from exofinder.services.ops_common import (
    finite_or_none,
    forget_arrays,
    load_arrays_cached,
    log_histogram,
    remove_tree,
    view_phases,
)
from exofinder.services.ops_errors import bad_request, conflict, not_found

log = logging.getLogger("exofinder.services.datasets")

TIERS = ("pilot", "standard", "full", "custom")
DATASET_STATUSES = ("building", "ready", "failed", "cancelled")
SPLIT_FRACTIONS = (0.8, 0.1, 0.1)

TIER_DESCRIPTIONS = {
    "pilot": "About 300 labelled signals on whole stars, class-balanced: a quick end-to-end run.",
    "standard": "About 3,000 labelled signals, class-balanced: a solid first research dataset.",
    "full": "Every labelled signal in the catalogue (all stars): the most data, longest download.",
}

#: Download-size estimate: ~0.47 MB per Kepler long-cadence quarter file, up to 18 quarters (Q0-Q17).
BYTES_PER_QUARTER = 470_000
QUARTERS_PER_STAR = 18
#: Rough throughput figures for the "how long will this take?" hint, measured on the 4-core dev
#: container (2026-11-14): MAST downloads ~2.4 stars/s with 6 workers (~0.4 stars/s per worker);
#: pipeline ~1.3-1.8 s per signal for an 18-quarter light curve on one core.
DOWNLOAD_STARS_PER_SECOND_PER_WORKER = 0.4
PROCESS_SECONDS_PER_SIGNAL = 1.6

#: Exclusion reasons produced by the build (label reasons come from exofinder.data.labels).
BUILD_EXCLUSION_REASONS = {
    "no_lightcurve": "No light curve available (not downloaded, or MAST has no Kepler data for the star)",
    "no_ephemeris": "The catalogue ephemeris is incomplete or invalid (period, epoch or duration)",
    "insufficient_data": "Too little usable photometry after cleaning/detrending",
    "invalid_input": "The pipeline rejected the input (e.g. invalid ephemeris)",
    "processing_error": "Unexpected processing error (see the build log)",
    "nonfinite_values": "Views or features contain NaN/Inf values",
}
QUALITY_PREFIX = "quality:"
#: Priority order when several blocking quality issues apply.
BLOCKING_ORDER = ("nan_in_views", "too_few_transits", "period_too_long", "local_view_sparse")


def reason_label(code: str | None) -> str | None:
    """Human-readable explanation of an exclusion reason code."""
    if code is None:
        return None
    if code.startswith(QUALITY_PREFIX):
        return f"Failed quality gate: {code[len(QUALITY_PREFIX) :].replace('_', ' ')}"
    return EXCLUSION_REASONS.get(code) or BUILD_EXCLUSION_REASONS.get(code) or code


#: :class:`ProcessPoolExecutor` refuses more than 61 workers on Windows ("max_workers must be <= 61").
WINDOWS_MAX_WORKERS = 61


def cap_workers(n: int) -> int:
    """``n`` limited to what the process pool accepts on this platform."""
    return min(n, WINDOWS_MAX_WORKERS) if sys.platform == "win32" else n


def default_build_workers() -> int:
    """Worker processes for signal processing: ``EXOF_BUILD_WORKERS`` or ``max(1, cpu_count - 1)``."""
    env = os.environ.get("EXOF_BUILD_WORKERS", "").strip()
    if env.isdigit() and int(env) >= 1:
        return cap_workers(int(env))
    return cap_workers(max(1, (os.cpu_count() or 2) - 1))


# --------------------------------------------------------------------------------------------------
# Tiers
# --------------------------------------------------------------------------------------------------
_TIER_CACHE: dict[tuple, list[dict[str, Any]]] = {}


def _catalogue_fingerprint(session: Session) -> tuple:
    n = session.scalar(select(func.count()).select_from(Signal)) or 0
    snap = session.scalar(select(func.max(CatalogSnapshot.id))) or 0
    return int(n), int(snap)


def list_tiers(session: Session, label_mode: str = "astronet_dr24") -> list[dict[str, Any]]:
    """Signal/star/class counts per tier from the live catalogue, with download and time estimates."""
    if label_mode not in LABEL_MODES:
        raise bad_request(
            f"Unknown label mode {label_mode!r}", "invalid_label_mode", f"Use one of {sorted(LABEL_MODES)}."
        )
    fp = _catalogue_fingerprint(session)
    if fp[0] == 0:
        return []
    key = (label_mode, *fp)
    base = _TIER_CACHE.get(key)
    if base is None:
        base = []
        for tier in ("pilot", "standard", "full"):
            sigs = select_signals_for_tier(session, tier, label_mode, seed=42)
            labels = [label_for(s, label_mode) for s in sigs]
            base.append(
                {
                    "tier": tier,
                    "label_mode": label_mode,
                    "n_signals": sum(1 for y in labels if y is not None),
                    "n_unlabelled_reserved": sum(1 for y in labels if y is None),
                    "n_pos": sum(1 for y in labels if y == 1),
                    "n_neg": sum(1 for y in labels if y == 0),
                    "n_label_conflicts": sum(1 for s in sigs if s.label_conflict),
                    "kepids": sorted({s.kepid for s in sigs}),
                    "description": TIER_DESCRIPTIONS[tier],
                }
            )
        _TIER_CACHE.clear()
        _TIER_CACHE[key] = base
    settings = get_settings()
    workers = default_build_workers()
    out = []
    for row in base:
        kepids = row["kepids"]
        missing = sum(1 for k in kepids if not has_lightcurve(k))
        dl_s = missing / max(DOWNLOAD_STARS_PER_SECOND_PER_WORKER * settings.download_workers, 1e-6)
        proc_s = (row["n_signals"] + row["n_unlabelled_reserved"]) * PROCESS_SECONDS_PER_SIGNAL / workers
        out.append(
            {
                **{k: v for k, v in row.items() if k != "kepids"},
                "n_stars": len(kepids),
                "n_stars_downloaded": len(kepids) - missing,
                "n_stars_missing": missing,
                "est_download_bytes": int(missing * QUARTERS_PER_STAR * BYTES_PER_QUARTER),
                "est_download_minutes": round(dl_s / 60.0, 1),
                "est_process_minutes": round(proc_s / 60.0, 1),
                "est_minutes": round((dl_s + proc_s) / 60.0, 1),
                "estimate_basis": (
                    f"~{BYTES_PER_QUARTER / 1e6:.2f} MB per quarter x {QUARTERS_PER_STAR} quarters per missing star; "
                    f"~{DOWNLOAD_STARS_PER_SECOND_PER_WORKER} stars/s per download worker; "
                    f"~{PROCESS_SECONDS_PER_SIGNAL} s per signal over {workers} worker process(es)"
                ),
            }
        )
    return out


# --------------------------------------------------------------------------------------------------
# Create + build
# --------------------------------------------------------------------------------------------------
def create_dataset(
    session: Session,
    *,
    name: str,
    tier: str = "pilot",
    label_mode: str = "astronet_dr24",
    split_seed: int = 42,
    exclude_conflicts: bool = True,
    max_signals: int | None = None,
    pipeline: dict[str, Any] | None = None,
    parent_id: int | None = None,
    download_missing: bool = True,
    workers: int | None = None,
    downloader: Any = None,
) -> tuple[Dataset, JobSpec]:
    """Validate the request, create the ``Dataset`` row (status ``building``) and return its job.

    ``workers`` (process count) and ``downloader`` (MAST download function) are service-level
    options for the CLI and tests; the API uses the defaults.
    """
    name = (name or "").strip()
    if not name:
        raise bad_request("A dataset name is required", "invalid_name")
    if tier not in TIERS:
        raise bad_request(f"Unknown tier {tier!r}", "invalid_tier", f"Use one of {', '.join(TIERS)}.")
    if label_mode not in LABEL_MODES:
        raise bad_request(
            f"Unknown label mode {label_mode!r}", "invalid_label_mode", f"Use one of {sorted(LABEL_MODES)}."
        )
    if tier == "custom" and not max_signals:
        raise bad_request("Tier 'custom' needs max_signals", "invalid_tier", "Set max_signals (e.g. 1000).")
    if max_signals is not None and int(max_signals) < 1:
        raise bad_request("max_signals must be at least 1", "invalid_max_signals")
    try:
        cfg = PipelineConfig.from_dict(dict(pipeline or {}))
    except (TypeError, ValueError) as exc:
        raise bad_request(f"Invalid pipeline configuration: {exc}", "invalid_pipeline_config") from exc
    if (session.scalar(select(func.count()).select_from(Signal)) or 0) == 0:
        raise conflict(
            "The catalogue is empty",
            "catalog_empty",
            "Download the NASA catalogue first (Data page > Refresh catalogue, or `exofinder refresh-catalog`).",
        )
    if parent_id is not None:
        parent = session.get(Dataset, parent_id)
        if parent is None:
            raise not_found("Parent dataset", "dataset_not_found")
        if parent.status != "ready":
            raise conflict("The parent dataset is not ready", "dataset_not_ready")
        if parent.label_mode != label_mode:
            raise bad_request(
                "The parent dataset uses another label mode",
                "label_mode_mismatch",
                f"Use label_mode={parent.label_mode!r} to expand it.",
            )
    config = {
        "tier": tier,
        "label_mode": label_mode,
        "split_seed": int(split_seed),
        "split_fractions": list(SPLIT_FRACTIONS),
        "exclude_conflicts": bool(exclude_conflicts),
        "max_signals": int(max_signals) if max_signals else None,
        "pipeline": cfg.to_dict(),
        "parent_id": parent_id,
        "download_missing": bool(download_missing),
        "reserved_kepids": sorted(RESERVED_SHOWCASE_KEPIDS),
        "quality_gate": f"exclude signals with a blocking quality issue: {', '.join(BLOCKING_ORDER)}",
    }
    ds = Dataset(
        name=name[:128],
        label_mode=label_mode,
        tier=tier,
        status="building",
        pipeline_version=PIPELINE_VERSION,
        split_seed=int(split_seed),
        config=config,
        stats={},
        parent_id=parent_id,
    )
    session.add(ds)
    session.commit()  # the job thread reads the row with its own session
    dataset_id = ds.id

    def _link(job_id: str) -> None:
        with session_scope() as s:
            s.execute(update(Dataset).where(Dataset.id == dataset_id).values(job_id=job_id))

    spec = JobSpec(
        kind="build_dataset",
        title=f"Build dataset '{ds.name}' ({tier}, {label_mode})",
        fn=partial(run_build, dataset_id=dataset_id, workers=workers, downloader=downloader),
        params={"dataset_id": dataset_id, **{k: v for k, v in config.items() if k != "pipeline"}},
        on_created=_link,
    )
    return ds, spec


@dataclass
class _Candidate:
    signal_id: int
    signal_key: str
    kepid: int
    label: int | None
    label_reason: str | None
    reserved: bool
    period_days: float | None
    depth_ppm: float | None
    process: bool
    result: dict[str, Any] | None = None
    reason: str | None = None
    quality: dict[str, Any] = field(default_factory=dict)

    @property
    def included(self) -> bool:
        return self.reason is None and self.label is not None


def run_build(
    ctx: JobContext, dataset_id: int, workers: int | None = None, downloader: Any = None
) -> dict[str, Any]:
    """Job function of ``build_dataset`` (see the module docstring)."""
    t_start = time.perf_counter()
    with session_scope() as s:
        ds = s.get(Dataset, dataset_id)
        if ds is None:
            raise RuntimeError(f"dataset {dataset_id} was deleted before its build started")
        ds.job_id = ctx.job_id
        ds.status = "building"
        config = dict(ds.config)
        name = ds.name
    out_dir = get_settings().datasets_dir / str(dataset_id)
    try:
        result = _build(ctx, dataset_id, name, config, out_dir, workers, downloader, t_start)
    except BaseException as exc:
        cancelled = ctx.cancelled() or isinstance(exc, JobCancelled)
        _abandon_build(dataset_id, out_dir, "cancelled" if cancelled else "failed", exc)
        raise
    return result


def _abandon_build(dataset_id: int, out_dir: Path, status: str, exc: BaseException) -> None:
    remove_tree(out_dir)
    forget_arrays(out_dir)
    with session_scope() as s:
        s.execute(delete(DatasetExample).where(DatasetExample.dataset_id == dataset_id))
        ds = s.get(Dataset, dataset_id)
        if ds is not None:
            ds.status = status
            ds.stats = {
                "error": "Cancelled by user" if status == "cancelled" else f"{type(exc).__name__}: {exc}"
            }
            ds.path = None
            ds.n_examples = ds.n_train = ds.n_val = ds.n_test = 0


def _build(
    ctx: JobContext,
    dataset_id: int,
    name: str,
    config: dict[str, Any],
    out_dir: Path,
    workers: int | None,
    downloader: Any,
    t_start: float,
) -> dict[str, Any]:
    label_mode = config["label_mode"]
    seed = int(config["split_seed"])
    reserved = set(int(k) for k in config.get("reserved_kepids") or RESERVED_SHOWCASE_KEPIDS)
    timings: dict[str, float] = {}

    # ---- 1-2. select + label ------------------------------------------------------------------
    ctx.progress(0.0, "Selecting signals")
    t0 = time.perf_counter()
    with session_scope() as s:
        signals = select_signals_for_tier(
            s,
            config["tier"],
            label_mode,
            seed=seed,
            reserved_kepids=sorted(reserved),
            target_size=config.get("max_signals"),
        )
        cands = []
        for sig in signals:
            reason = label_exclusion_reason(
                sig, label_mode, exclude_label_conflicts=bool(config.get("exclude_conflicts"))
            )
            label = None if reason else label_for(sig, label_mode)
            is_reserved = sig.kepid in reserved
            cands.append(
                _Candidate(
                    signal_id=sig.id,
                    signal_key=sig.signal_key,
                    kepid=sig.kepid,
                    label=label,
                    label_reason=reason,
                    reserved=is_reserved,
                    period_days=finite_or_none(sig.period_days),
                    depth_ppm=finite_or_none(sig.depth_ppm),
                    process=label is not None or is_reserved,
                )
            )
        no_data_stars = {
            int(k)
            for k in s.scalars(
                select(Target.kepid).where(
                    Target.kepid.in_({c.kepid for c in cands}), Target.lc_status == "no_data"
                )
            )
        }
        snapshot_info = _snapshot_provenance(s, [c.signal_id for c in cands])
    if not cands:
        raise ValueError("No signals selected: the catalogue has no labelled signals for this label mode")
    n_lab = sum(1 for c in cands if c.label is not None)
    ctx.log(
        f"Selected {len(cands)} signals on {len({c.kepid for c in cands})} stars "
        f"({n_lab} labelled; tier={config['tier']}, label_mode={label_mode}, seed={seed})"
    )
    timings["select_s"] = time.perf_counter() - t0
    ctx.check_cancelled()

    # ---- 3. download ---------------------------------------------------------------------------
    t0 = time.perf_counter()
    stars_needed = sorted({c.kepid for c in cands if c.process})
    missing = [k for k in stars_needed if not has_lightcurve(k)]
    to_download = [k for k in missing if k not in no_data_stars]
    downloads: dict[str, Any] = {
        "stars_needed": len(stars_needed),
        "stars_missing": len(missing),
        "skipped_known_no_data": len(missing) - len(to_download),
        "attempted": 0,
    }
    process_lo = 0.02
    if to_download and config.get("download_missing", True):
        from exofinder.data.acquire import download_many

        process_lo = 0.4
        dl_progress = ProgressRange(ctx, 0.02, process_lo)
        ctx.log(f"Downloading light curves for {len(to_download)} star(s) from NASA MAST")

        def _dl(done: int, total: int, msg: str) -> None:
            dl_progress(done / max(total, 1), f"Downloading light curves {done}/{total} - {msg}")

        kwargs: dict[str, Any] = {"progress": _dl, "cancel": ctx.cancelled}
        if downloader is not None:
            kwargs["downloader"] = downloader
        res = download_many(to_download, get_settings().download_workers, **kwargs)
        downloads.update({k: res.get(k) for k in ("available", "no_data", "error", "cancelled", "cached")})
        downloads["attempted"] = len(to_download)
        ctx.log(
            f"Downloads: {res.get('available', 0)} available, {res.get('no_data', 0)} without Kepler data, "
            f"{res.get('error', 0)} failed"
        )
        ctx.check_cancelled()
    elif to_download:
        ctx.log(f"{len(to_download)} star(s) have no light curve and downloads are disabled for this build")
    timings["download_s"] = time.perf_counter() - t0

    # ---- 4. process ----------------------------------------------------------------------------
    t0 = time.perf_counter()
    pipeline_cfg = dict(config.get("pipeline") or {})
    to_process = [c for c in cands if c.process and has_lightcurve(c.kepid)]
    n_workers = cap_workers(max(1, int(workers or default_build_workers())))
    proc_progress = ProgressRange(ctx, process_lo, 0.93)
    results, processing = process_signals(
        ctx, [c.signal_id for c in to_process], pipeline_cfg, n_workers, proc_progress
    )
    timings["process_s"] = time.perf_counter() - t0

    # ---- classify ------------------------------------------------------------------------------
    for c in cands:
        r = results.get(c.signal_id)
        c.result = r
        if r is not None and r.get("status") == "ok":
            c.quality = dict(r.get("quality") or {})
        if c.label_reason is not None:
            c.reason = c.label_reason
        elif r is None:
            c.reason = "no_lightcurve"
        elif r["status"] != "ok":
            c.reason = r.get("error_kind") or "processing_error"
        elif not c.quality.get("ok", False):
            blocking = [i for i in BLOCKING_ORDER if i in (c.quality.get("issues") or [])]
            extra = [i for i in (c.quality.get("issues") or []) if i in BLOCKING_ISSUES and i not in blocking]
            c.reason = QUALITY_PREFIX + ((blocking + extra) or ["not_ok"])[0]
        elif not all(np.isfinite(r[k]).all() for k in ("global_view", "local_view", "features")):
            c.reason = "nonfinite_values"
        if c.reason is not None and r is not None and r.get("status") != "ok":
            c.quality = {"error": r.get("message")}
    included = [c for c in cands if c.included]
    if not included:
        reasons = Counter(c.reason for c in cands)
        raise ValueError(f"No usable examples remain after processing (exclusions: {dict(reasons)})")
    ctx.check_cancelled()

    # ---- 5. split ------------------------------------------------------------------------------
    ctx.progress(0.94, "Splitting by star")
    kepids = np.array([c.kepid for c in included], dtype=np.int64)
    labels = np.array([c.label for c in included], dtype=np.int64)
    forced = sorted({c.kepid for c in included if c.reserved})
    splits = _make_splits(kepids, labels, seed, forced, config.get("parent_id"))
    assert_no_leakage(kepids, splits)
    bad_reserved = sorted(
        {int(k) for k, sp in zip(kepids, splits, strict=True) if k in reserved and sp != "test"}
    )
    if bad_reserved:
        raise AssertionError(f"reserved showcase stars outside the test split: {bad_reserved}")

    # ---- 6. write ------------------------------------------------------------------------------
    t0 = time.perf_counter()
    ctx.progress(0.95, "Writing arrays")
    feature_names = list(included[0].result["feature_names"])
    for c in included:
        if list(c.result["feature_names"]) != feature_names:
            raise RuntimeError(f"{c.signal_key}: feature names differ from the rest of the dataset")
    G = np.stack([c.result["global_view"] for c in included]).astype(np.float32)
    L = np.stack([c.result["local_view"] for c in included]).astype(np.float32)
    F = np.stack([c.result["features"] for c in included]).astype(np.float32)
    sids = np.array([c.signal_id for c in included], dtype=np.int64)
    synthetic = any(bool((c.result or {}).get("synthetic")) for c in cands)
    lc_digests = {
        str(c.kepid): c.result.get("lc_digest")
        for c in cands
        if c.result is not None and c.result.get("status") == "ok" and c.result.get("lc_digest")
    }
    digest_blob = json.dumps(sorted(lc_digests.items())).encode()
    content_hash = _content_hash(
        G, L, F, labels, sids, kepids, splits, feature_names, label_mode, pipeline_cfg
    )
    meta = {
        "dataset_id": dataset_id,
        "name": name,
        "pipeline_version": PIPELINE_VERSION,
        "label_mode": label_mode,
        "tier": config["tier"],
        "split_seed": seed,
        "split_fractions": list(SPLIT_FRACTIONS),
        "feature_names": feature_names,
        "pipeline_config": pipeline_cfg,
        "exclude_conflicts": bool(config.get("exclude_conflicts")),
        "catalogue_snapshots": snapshot_info,
        "lightcurves": {
            "n_stars": len(lc_digests),
            "digests_sha256": hashlib.sha256(digest_blob).hexdigest(),
            "file": "lightcurves.json",
        },
        "reserved_kepids": sorted(reserved),
        "synthetic": synthetic,
        "content_hash": content_hash,
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    arrays = DatasetArrays(
        global_view=G,
        local_view=L,
        features=F,
        labels=labels,
        signal_ids=sids,
        kepids=kepids,
        splits=splits,
        feature_names=feature_names,
        meta=meta,
    )
    remove_tree(out_dir)  # ids can be re-used after a deletion: never mix files of two datasets
    forget_arrays(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = save_dataset_arrays(out_dir, arrays)
    (out_dir / "lightcurves.json").write_text(json.dumps(dict(sorted(lc_digests.items())), indent=0), "utf-8")

    split_of = {c.signal_id: str(sp) for c, sp in zip(included, splits, strict=True)}
    index_of = {c.signal_id: i for i, c in enumerate(included)}
    per_split = split_summary(kepids, labels, splits)
    stats = _stats(cands, included, per_split, processing, downloads, reserved, timings, synthetic)
    timings["write_s"] = time.perf_counter() - t0
    timings["total_s"] = time.perf_counter() - t_start
    stats["timings"] = {k: round(v, 2) for k, v in timings.items()}
    stats["manifest"] = {
        "arrays_sha256": manifest.get("arrays_sha256"),
        "path": str(out_dir),
        "n_features": len(feature_names),
    }
    with session_scope() as s:
        s.execute(delete(DatasetExample).where(DatasetExample.dataset_id == dataset_id))
        s.add_all(
            DatasetExample(
                dataset_id=dataset_id,
                signal_id=c.signal_id,
                kepid=c.kepid,
                label=c.label,
                split=split_of.get(c.signal_id),
                included=c.included,
                exclusion_reason=c.reason,
                quality=to_jsonable(c.quality),
                array_index=index_of.get(c.signal_id),
            )
            for c in cands
        )
        ds = s.get(Dataset, dataset_id)
        if ds is None:
            raise RuntimeError("the dataset was deleted while it was being built")
        cfg_new = dict(ds.config)
        cfg_new["synthetic"] = synthetic
        ds.config = cfg_new
        ds.status = "ready"
        ds.stats = to_jsonable(stats)
        ds.content_hash = content_hash
        ds.path = str(out_dir)
        ds.n_examples = len(included)
        ds.n_train = per_split["train"]["n"]
        ds.n_val = per_split["val"]["n"]
        ds.n_test = per_split["test"]["n"]
    ctx.progress(1.0, "Dataset ready")
    ctx.log(
        f"Dataset ready: {len(included)} examples (train {per_split['train']['n']}, val {per_split['val']['n']}, "
        f"test {per_split['test']['n']}); {len(cands) - len(included)} excluded; "
        f"processing {processing['wall_s']:.1f} s with {processing['workers']} worker(s) ({processing['mode']})"
    )
    return {
        "dataset_id": dataset_id,
        "n_examples": len(included),
        "n_excluded": len(cands) - len(included),
        "per_split": per_split,
        "exclusions_by_reason": stats["exclusions_by_reason"],
        "processing": processing,
        "content_hash": content_hash,
    }


def _make_splits(
    kepids: np.ndarray, labels: np.ndarray, seed: int, forced: list[int], parent_id: int | None
) -> np.ndarray:
    """Star-level split; stars already in the parent dataset keep their split."""
    if parent_id is None:
        return star_level_split(kepids, labels, SPLIT_FRACTIONS, seed=seed, forced_test=forced)
    with session_scope() as s:
        rows = s.execute(
            select(DatasetExample.kepid, DatasetExample.split).where(
                DatasetExample.dataset_id == parent_id, DatasetExample.included.is_(True)
            )
        ).all()
    parent_split = {int(k): str(sp) for k, sp in rows if sp in SPLIT_NAMES}
    out = np.empty(kepids.shape, dtype="<U5")
    known = np.array([int(k) in parent_split for k in kepids], dtype=bool)
    for i in np.flatnonzero(known):
        out[i] = parent_split[int(kepids[i])]
    free = ~known
    if free.any():
        out[free] = star_level_split(
            kepids[free], labels[free], SPLIT_FRACTIONS, seed=seed, forced_test=forced
        )
    return out


def _content_hash(
    G: np.ndarray,
    L: np.ndarray,
    F: np.ndarray,
    labels: np.ndarray,
    sids: np.ndarray,
    kepids: np.ndarray,
    splits: np.ndarray,
    feature_names: list[str],
    label_mode: str,
    pipeline_cfg: dict[str, Any],
) -> str:
    """Deterministic fingerprint of the dataset content (unlike the zip file, independent of write time)."""
    h = hashlib.sha256()
    for name, arr in (
        ("global", G),
        ("local", L),
        ("features", F),
        ("labels", labels),
        ("signal_ids", sids),
        ("kepids", kepids),
        ("splits", np.asarray(splits).astype("<U5")),
    ):
        a = np.ascontiguousarray(arr)
        h.update(f"{name}|{a.dtype.str}|{a.shape}|".encode())
        h.update(a.tobytes())
    h.update(
        json.dumps(
            {
                "feature_names": feature_names,
                "label_mode": label_mode,
                "pipeline_version": PIPELINE_VERSION,
                "pipeline": pipeline_cfg,
            },
            sort_keys=True,
            default=str,
        ).encode()
    )
    return h.hexdigest()


def _snapshot_provenance(session: Session, signal_ids: list[int]) -> list[dict[str, Any]]:
    """Catalogue snapshots referenced by the provenance of the selected signals."""
    ids: set[int] = set()
    for prov in session.scalars(select(Signal.provenance).where(Signal.id.in_(signal_ids))):
        for entry in (prov or {}).values():
            if isinstance(entry, dict) and entry.get("snapshot_id") is not None:
                try:
                    ids.add(int(entry["snapshot_id"]))
                except (TypeError, ValueError):
                    continue
    q = select(CatalogSnapshot)
    q = q.where(CatalogSnapshot.id.in_(ids)) if ids else q
    snaps = list(session.scalars(q.order_by(CatalogSnapshot.id)))
    if not ids:  # no per-field provenance: record the latest snapshot of each source
        latest: dict[str, CatalogSnapshot] = {}
        for snap in snaps:
            latest[snap.source] = snap
        snaps = list(latest.values())
    return [
        {
            "id": snap.id,
            "source": snap.source,
            "table": snap.table_name,
            "sha256": snap.sha256,
            "rows": snap.row_count,
            "retrieved_at": snap.retrieved_at.isoformat() if snap.retrieved_at else None,
            "file": Path(snap.file_path).name if snap.file_path else None,
        }
        for snap in snaps
    ]


def _stats(
    cands: list[_Candidate],
    included: list[_Candidate],
    per_split: dict[str, Any],
    processing: dict[str, Any],
    downloads: dict[str, Any],
    reserved: set[int],
    timings: dict[str, float],
    synthetic: bool,
) -> dict[str, Any]:
    excl = Counter(c.reason for c in cands if not c.included and c.reason is not None)
    processed = [c for c in cands if c.result is not None and c.result.get("status") == "ok"]
    grades = Counter(str(c.quality.get("grade")) for c in processed if c.quality.get("grade"))
    issues = Counter(i for c in processed for i in (c.quality.get("issues") or []))
    by_cls_p: dict[str, list[float]] = {"planet_like": [], "false_positive_like": []}
    by_cls_d: dict[str, list[float]] = {"planet_like": [], "false_positive_like": []}
    for c in included:
        key = "planet_like" if c.label == 1 else "false_positive_like"
        if c.period_days:
            by_cls_p[key].append(c.period_days)
        if c.depth_ppm:
            by_cls_d[key].append(c.depth_ppm)
    reserved_rows = []
    for kepid in sorted(reserved):
        mine = [c for c in cands if c.kepid == kepid]
        if mine:
            reserved_rows.append(
                {
                    "kepid": kepid,
                    "name": RESERVED_SHOWCASE_KEPIDS.get(kepid),
                    "n_signals": len(mine),
                    "n_included": sum(1 for c in mine if c.included),
                }
            )
    warnings = []
    for split, row in per_split.items():
        if row["n"] == 0:
            warnings.append(f"The {split} split is empty.")
        elif row["n_pos"] == 0 or row["n_neg"] == 0:
            warnings.append(f"The {split} split contains a single class.")
    if synthetic:
        warnings.append("Built from SYNTHETIC test light curves: not a scientific dataset.")
    examples_by_reason: dict[str, list[str]] = defaultdict(list)
    for c in cands:
        if c.reason and len(examples_by_reason[c.reason]) < 5:
            examples_by_reason[c.reason].append(c.signal_key)
    return {
        "per_split": per_split,
        "n_selected": len(cands),
        "n_included": len(included),
        "n_excluded": len(cands) - len(included),
        "n_stars": len({c.kepid for c in included}),
        "n_pos": sum(1 for c in included if c.label == 1),
        "n_neg": sum(1 for c in included if c.label == 0),
        "exclusions_by_reason": dict(sorted(excl.items(), key=lambda kv: (-kv[1], kv[0]))),
        "exclusion_examples": dict(examples_by_reason),
        "exclusion_reason_labels": {k: reason_label(k) for k in excl},
        "quality_grades": dict(sorted(grades.items())),
        "quality_issues": dict(sorted(issues.items(), key=lambda kv: (-kv[1], kv[0]))),
        "period_hist": log_histogram(by_cls_p, unit="days"),
        "depth_hist": log_histogram(by_cls_d, unit="ppm"),
        "processing": processing,
        "downloads": downloads,
        "reserved": reserved_rows,
        "warnings": warnings,
        "synthetic": synthetic,
    }


# --------------------------------------------------------------------------------------------------
# Signal processing (process pool with sequential fallback)
# --------------------------------------------------------------------------------------------------
def _worker_env() -> dict[str, str]:
    s = get_settings()
    return {
        "EXOF_DATA_DIR": str(s.data_path),
        "EXOF_ARTIFACTS_DIR": str(s.artifacts_path),
        "EXOF_DB_URL": s.database_url,
    }


def process_signals(
    ctx: JobContext,
    signal_ids: list[int],
    pipeline_cfg: dict[str, Any],
    workers: int,
    progress: ProgressRange,
) -> tuple[dict[int, dict[str, Any]], dict[str, Any]]:
    """Process ``signal_ids`` (parallel when ``workers > 1``); returns results by id and timing stats.

    Cancellation is checked between signals; at most ``2 x workers`` signals are in flight, and the
    pool is shut down (waiting for running tasks, dropping queued ones) before ``JobCancelled`` is raised.
    If the pool cannot start or breaks, the remaining signals are processed sequentially.
    """
    total = len(signal_ids)
    results: dict[int, dict[str, Any]] = {}
    t0 = time.perf_counter()
    mode = "sequential"
    fallback_reason = None
    last_report = [0.0]

    def report(force: bool = False) -> None:
        now = time.monotonic()
        if force or now - last_report[0] > 0.5:
            last_report[0] = now
            progress(
                len(results) / max(total, 1),
                f"Processing signals {len(results)}/{total} ({mode}, {workers} worker(s))",
            )

    if workers > 1 and total >= 2:
        mode = "process_pool"
        try:
            _process_parallel(ctx, signal_ids, pipeline_cfg, workers, results, report)
        except (BrokenProcessPool, OSError, RuntimeError) as exc:
            if ctx.cancelled():
                raise
            fallback_reason = f"{type(exc).__name__}: {exc}"
            ctx.log(f"Process pool failed ({fallback_reason}); continuing sequentially")
            mode = "process_pool+sequential_fallback"
    remaining = [sid for sid in signal_ids if sid not in results]
    for sid in remaining:
        ctx.check_cancelled()
        results[sid] = ops_dataset_worker.process_signal_task({"signal_id": sid, "pipeline": pipeline_cfg})
        report()
    ctx.check_cancelled()
    report(force=True)
    wall = time.perf_counter() - t0
    computed = [r for r in results.values() if not r.get("from_cache")]
    task_s = float(sum(r.get("elapsed_s", 0.0) for r in computed))
    n_err = sum(1 for r in results.values() if r.get("status") != "ok")
    processing = {
        "mode": mode,
        "workers": workers if mode != "sequential" else 1,
        "n_signals": total,
        "n_computed": len(computed),
        "n_from_cache": total - len(computed),
        "n_errors": n_err,
        "wall_s": round(wall, 2),
        "sum_task_s": round(task_s, 2),
        "mean_task_s": round(task_s / len(computed), 3) if computed else None,
        # sum of per-signal processing times / wall time: the effective parallel speed-up
        "effective_speedup": round(task_s / wall, 2) if computed and wall > 0 else None,
        "worker_pids": len({r.get("pid") for r in results.values() if r.get("pid")}),
        "fallback_reason": fallback_reason,
    }
    return results, processing


def _process_parallel(
    ctx: JobContext,
    signal_ids: list[int],
    pipeline_cfg: dict[str, Any],
    workers: int,
    results: dict[int, dict[str, Any]],
    report: Any,
) -> None:
    mp = multiprocessing.get_context("spawn")
    pool = ProcessPoolExecutor(
        max_workers=workers,
        mp_context=mp,
        initializer=ops_dataset_worker.init_worker,
        initargs=(_worker_env(),),
    )
    ctx.log(f"Processing {len(signal_ids)} signals with {workers} worker processes")
    try:
        queue = iter(signal_ids)
        pending: dict[Any, int] = {}

        def fill() -> None:
            while len(pending) < 2 * workers:
                sid = next(queue, None)
                if sid is None:
                    return
                fut = pool.submit(
                    ops_dataset_worker.process_signal_task, {"signal_id": sid, "pipeline": pipeline_cfg}
                )
                pending[fut] = sid

        fill()
        while pending:
            done, _ = wait(list(pending), timeout=0.5, return_when=FIRST_COMPLETED)
            for fut in done:
                sid = pending.pop(fut)
                results[sid] = fut.result()
            report()
            if ctx.cancelled():
                break
            fill()
    finally:
        pool.shutdown(wait=True, cancel_futures=True)
    ctx.check_cancelled()


# --------------------------------------------------------------------------------------------------
# Queries (Dataset Explorer)
# --------------------------------------------------------------------------------------------------
def get_dataset(session: Session, dataset_id: int) -> Dataset:
    ds = session.get(Dataset, dataset_id)
    if ds is None:
        raise not_found("Dataset", "dataset_not_found", "List datasets with GET /api/datasets.")
    return ds


def require_ready(ds: Dataset) -> None:
    if ds.status != "ready" or not ds.path:
        raise conflict(
            f"Dataset {ds.id} is {ds.status}, not ready",
            "dataset_not_ready",
            "Wait for the build job to finish, or build the dataset again.",
        )
    if not (Path(ds.path) / "arrays.npz").is_file():
        raise conflict(
            f"The files of dataset {ds.id} are missing ({ds.path})",
            "dataset_files_missing",
            "Delete the dataset and build it again.",
        )


def model_counts(session: Session) -> dict[int, int]:
    rows = session.execute(
        select(ModelVersion.dataset_id, func.count()).group_by(ModelVersion.dataset_id)
    ).all()
    return {int(k): int(v) for k, v in rows if k is not None}


def dataset_summary(ds: Dataset, n_models: int = 0) -> dict[str, Any]:
    """Plain dict for ``DatasetOut``."""
    stats = ds.stats or {}
    return {
        "id": ds.id,
        "name": ds.name,
        "label_mode": ds.label_mode,
        "tier": ds.tier,
        "status": ds.status,
        "pipeline_version": ds.pipeline_version,
        "split_seed": ds.split_seed,
        "config": ds.config or {},
        "content_hash": ds.content_hash,
        "path": ds.path,
        "parent_id": ds.parent_id,
        "n_examples": ds.n_examples,
        "n_train": ds.n_train,
        "n_val": ds.n_val,
        "n_test": ds.n_test,
        "n_excluded": stats.get("n_excluded"),
        "created_at": ds.created_at,
        "job_id": ds.job_id,
        "n_models": n_models,
        "error": stats.get("error"),
        "is_synthetic": bool((ds.config or {}).get("synthetic")),
        "compatible": ds.pipeline_version == PIPELINE_VERSION,
    }


def list_datasets(session: Session) -> list[dict[str, Any]]:
    reconcile_orphans(session)
    counts = model_counts(session)
    rows = session.scalars(select(Dataset).order_by(Dataset.created_at.desc(), Dataset.id.desc()))
    return [dataset_summary(ds, counts.get(ds.id, 0)) for ds in rows]


def dataset_detail(session: Session, dataset_id: int) -> dict[str, Any]:
    reconcile_orphans(session)
    ds = get_dataset(session, dataset_id)
    out = dataset_summary(ds, model_counts(session).get(ds.id, 0))
    out["stats"] = ds.stats if ds.status == "ready" else None
    out["provenance"] = _manifest_provenance(ds) if ds.status == "ready" else None
    return out


_PROVENANCE_KEYS = (
    "catalogue_snapshots",
    "lightcurves",
    "pipeline_version",
    "pipeline_config",
    "label_mode",
    "split_seed",
    "split_fractions",
    "exclude_conflicts",
    "reserved_kepids",
    "content_hash",
    "created_at",
)


def _manifest_provenance(ds: Dataset) -> dict[str, Any] | None:
    """Provenance block of the dataset's ``manifest.json`` (catalogue snapshots + SHA-256, etc.)."""
    path = Path(ds.path or get_settings().datasets_dir / str(ds.id)) / "manifest.json"
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    meta = manifest.get("meta", manifest) if isinstance(manifest, dict) else {}
    return {k: meta[k] for k in _PROVENANCE_KEYS if k in meta}


def dataset_examples(
    session: Session,
    dataset_id: int,
    *,
    split: str | None = None,
    label: int | None = None,
    included: bool | None = None,
    reason: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    """Paginated example rows joined with their catalogue signal."""
    get_dataset(session, dataset_id)
    q = (
        select(DatasetExample, Signal)
        .join(Signal, Signal.id == DatasetExample.signal_id)
        .where(DatasetExample.dataset_id == dataset_id)
    )
    if split:
        q = q.where(DatasetExample.split == split)
    if label is not None:
        q = q.where(DatasetExample.label == int(label))
    if included is not None:
        q = q.where(DatasetExample.included.is_(bool(included)))
    if reason:
        q = q.where(DatasetExample.exclusion_reason == reason)
    total = session.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = session.execute(
        q.order_by(DatasetExample.kepid, Signal.signal_key)
        .limit(max(1, min(limit, 500)))
        .offset(max(0, offset))
    ).all()
    return {"total": int(total), "items": [example_row(ex, sig) for ex, sig in rows]}


def example_row(ex: DatasetExample, sig: Signal) -> dict[str, Any]:
    q = ex.quality or {}
    return {
        "signal_id": sig.id,
        "signal_key": sig.signal_key,
        "kepid": ex.kepid,
        "label": ex.label,
        "split": ex.split,
        "included": bool(ex.included),
        "exclusion_reason": ex.exclusion_reason,
        "exclusion_label": reason_label(ex.exclusion_reason),
        "quality": q,
        "quality_grade": q.get("grade"),
        "array_index": ex.array_index,
        "period_days": finite_or_none(sig.period_days),
        "duration_hours": finite_or_none(sig.duration_hours),
        "depth_ppm": finite_or_none(sig.depth_ppm),
        "model_snr": finite_or_none(sig.model_snr),
        "kepoi_name": sig.kepoi_name,
        "kepler_name": sig.kepler_name,
        "category": sig.category,
        "av_training_set": sig.av_training_set,
        "koi_disposition": sig.koi_disposition,
        "label_conflict": bool(sig.label_conflict),
        "is_reserved": ex.kepid in RESERVED_SHOWCASE_KEPIDS,
    }


def example_views(session: Session, dataset_id: int, signal_id: int) -> dict[str, Any]:
    """Model views of one example: from ``arrays.npz`` when included, else from the view cache."""
    ds = get_dataset(session, dataset_id)
    ex = session.scalar(
        select(DatasetExample).where(
            DatasetExample.dataset_id == dataset_id, DatasetExample.signal_id == signal_id
        )
    )
    if ex is None:
        raise not_found("Example", "example_not_found", "This signal is not part of the dataset.")
    sig = session.get(Signal, signal_id)
    if sig is None:
        raise not_found("Signal", "signal_not_found")
    source = "dataset_arrays"
    if ex.included and ex.array_index is not None and ds.status == "ready" and ds.path:
        arrays = load_arrays_cached(ds.path)
        i = int(ex.array_index)
        if int(arrays.signal_ids[i]) != signal_id:
            raise conflict("Dataset arrays and examples disagree", "dataset_corrupt", "Rebuild the dataset.")
        gv, lv = arrays.global_view[i], arrays.local_view[i]
        gphase, lphase = view_phases(sig.period_days, sig.duration_hours, gv.size, lv.size)
        quality = ex.quality or {}
    else:
        from exofinder.services.signal_views import (
            SignalEphemerisError,
            SignalNotDownloadedError,
            compute_signal_views,
        )

        try:
            cfg = PipelineConfig.from_dict((ds.config or {}).get("pipeline") or {})
            sv = compute_signal_views(session, sig, config=cfg)
        except (SignalNotDownloadedError, SignalEphemerisError, ValueError) as exc:
            raise conflict(
                f"No views available for this excluded example: {exc}",
                "views_unavailable",
                f"Exclusion reason: {reason_label(ex.exclusion_reason)}",
            ) from exc
        gv, lv, gphase, lphase, quality = (
            sv.global_view,
            sv.local_view,
            sv.global_phase,
            sv.local_phase,
            sv.quality,
        )
        source = "view_cache"
    return to_jsonable(
        {
            "signal_id": signal_id,
            "signal_key": sig.signal_key,
            "kepid": ex.kepid,
            "label": ex.label,
            "split": ex.split,
            "included": bool(ex.included),
            "exclusion_reason": ex.exclusion_reason,
            "global": np.asarray(gv, dtype=np.float64),
            "local": np.asarray(lv, dtype=np.float64),
            "global_phase": np.asarray(gphase, dtype=np.float64),
            "local_phase": np.asarray(lphase, dtype=np.float64),
            "quality": quality,
            "source": source,
        },
        float_digits=6,
    )


def gallery(session: Session, dataset_id: int, per_class: int = 6, seed: int = 0) -> dict[str, Any]:
    """Random sample of included examples per class with their views (global downsampled to 401 bins)."""
    ds = get_dataset(session, dataset_id)
    require_ready(ds)
    per_class = max(1, min(int(per_class), 50))
    arrays = load_arrays_cached(ds.path)
    rng = np.random.default_rng(int(seed))
    sigs = {
        s.id: s
        for s in session.scalars(select(Signal).where(Signal.id.in_([int(x) for x in arrays.signal_ids])))
    }
    items: dict[str, list[dict[str, Any]]] = {}
    for cls, key in ((1, "planet_like"), (0, "false_positive_like")):
        idx = np.flatnonzero(arrays.labels == cls)
        pick = np.sort(rng.choice(idx, size=min(per_class, idx.size), replace=False)) if idx.size else idx
        rows = []
        for i in pick.tolist():
            sid = int(arrays.signal_ids[i])
            sig = sigs.get(sid)
            g401 = downsample_blocks(arrays.global_view[i][None, :], 401)[0]
            rows.append(
                {
                    "signal_id": sid,
                    "signal_key": sig.signal_key if sig else str(sid),
                    "kepid": int(arrays.kepids[i]),
                    "label": cls,
                    "split": str(arrays.splits[i]),
                    "period_days": finite_or_none(sig.period_days) if sig else None,
                    "depth_ppm": finite_or_none(sig.depth_ppm) if sig else None,
                    "kepler_name": sig.kepler_name if sig else None,
                    "global": g401,
                    "local": arrays.local_view[i],
                }
            )
        items[key] = rows
    return to_jsonable(
        {"dataset_id": dataset_id, "per_class": per_class, "seed": seed, "classes": items}, float_digits=5
    )


def delete_dataset(session: Session, dataset_id: int, force: bool = False) -> dict[str, Any]:
    """Delete a dataset, its examples and files.

    Refused (409 ``dataset_in_use``) when experiments/models were trained on it, unless ``force``: then
    those experiments, models (checkpoints), evaluations and their predictions are deleted too.
    """
    from exofinder.services.experiments import delete_experiment_rows

    ds = get_dataset(session, dataset_id)
    build_job = session.get(Job, ds.job_id) if ds.job_id else None
    building_elsewhere = build_job is not None and build_job.status in ("queued", "running")
    if ds.status == "building" and ds.job_id and (get_runner().is_active(ds.job_id) or building_elsewhere):
        raise conflict(
            "The dataset is still being built", "dataset_building", "Cancel the build job first, then delete."
        )
    exp_ids = list(session.scalars(select(Experiment.id).where(Experiment.dataset_id == dataset_id)))
    model_ids = list(session.scalars(select(ModelVersion.id).where(ModelVersion.dataset_id == dataset_id)))
    if (exp_ids or model_ids) and not force:
        raise conflict(
            f"{len(model_ids)} model(s) and {len(exp_ids)} experiment(s) depend on this dataset",
            "dataset_in_use",
            "Delete those experiments first, or repeat with ?force=true to delete them too.",
        )
    removed: dict[str, int] = {"experiments": 0, "models": 0, "evaluations": 0, "predictions": 0}
    for eid in exp_ids:
        for k, v in delete_experiment_rows(session, eid).items():
            removed[k] = removed.get(k, 0) + v
    # models without an experiment row (e.g. imported fixtures)
    for mid in session.scalars(select(ModelVersion.id).where(ModelVersion.dataset_id == dataset_id)).all():
        from exofinder.services.models import delete_model_rows

        for k, v in delete_model_rows(session, mid).items():
            removed[k] = removed.get(k, 0) + v
    for ev in session.scalars(select(Evaluation).where(Evaluation.dataset_id == dataset_id)).all():
        remove_tree(Path(ev.per_example_path).parent if ev.per_example_path else None)
        session.delete(ev)
        removed["evaluations"] += 1
    session.execute(update(Dataset).where(Dataset.parent_id == dataset_id).values(parent_id=None))
    n_examples = session.execute(
        delete(DatasetExample).where(DatasetExample.dataset_id == dataset_id)
    ).rowcount
    path = ds.path or str(get_settings().datasets_dir / str(dataset_id))
    session.delete(ds)
    session.flush()
    remove_tree(path)
    forget_arrays(path)
    session.commit()
    return {"deleted": True, "dataset_id": dataset_id, "examples": int(n_examples or 0), **removed}


__all__ = [
    "BUILD_EXCLUSION_REASONS",
    "create_dataset",
    "dataset_detail",
    "dataset_examples",
    "default_build_workers",
    "delete_dataset",
    "example_views",
    "gallery",
    "list_datasets",
    "list_tiers",
    "process_signals",
    "run_build",
]
