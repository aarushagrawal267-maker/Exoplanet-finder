"""Catalogue browsing and refresh (``/api/catalog``).

* :func:`start_refresh` runs :func:`exofinder.data.catalog.refresh_catalog` as a ``catalog_refresh``
  job (progress per step; NASA outages fail the job with a ``[nasa_unavailable]`` message and a hint).
* :func:`list_snapshots` exposes snapshot provenance (exact ADQL, URL, time, SHA-256, validation).
* :func:`list_signals` filters/sorts/paginates in SQL; :func:`stats` builds per-category histograms
  of log10 period, log10 depth and log10 SNR with numpy from one column query.
"""

from __future__ import annotations

import re
from typing import Any

import numpy as np
from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.orm import Session

from exofinder.db.models import CatalogSnapshot, Job, Signal, Target
from exofinder.jobs.runner import JobCancelled, JobContext, get_runner
from exofinder.services.sci_errors import bad_request, conflict

SORT_COLUMNS = {
    "signal_key": Signal.signal_key,
    "kepid": Signal.kepid,
    "period_days": Signal.period_days,
    "duration_hours": Signal.duration_hours,
    "depth_ppm": Signal.depth_ppm,
    "model_snr": Signal.model_snr,
    "planet_radius_re": Signal.planet_radius_re,
    "category": Signal.category,
    "kepoi_name": Signal.kepoi_name,
    "kepler_name": Signal.kepler_name,
    "av_training_set": Signal.av_training_set,
    "koi_disposition": Signal.koi_disposition,
    "koi_score": Signal.koi_score,
}
CATEGORIES = ("confirmed", "candidate", "false_positive", "unknown", "retired")
MAX_LIMIT = 500


# ------------------------------------------------------------------------------------------------
# refresh
# ------------------------------------------------------------------------------------------------
class NasaUnavailableError(RuntimeError):
    """The NASA Exoplanet Archive could not be reached (message carries code + hint for the UI)."""


def active_jobs(session: Session, kind: str) -> list[Job]:
    return list(session.scalars(select(Job).where(Job.kind == kind, Job.status.in_(("queued", "running")))))


def start_refresh(session: Session, sources: list[str] | None = None) -> str:
    """Submit a ``catalog_refresh`` job; 409 ``job_running`` if one is already active."""
    from exofinder.data.archive import ALL_SOURCES

    wanted = list(sources or ALL_SOURCES)
    unknown = [s for s in wanted if s not in ALL_SOURCES]
    if unknown:
        raise bad_request(
            f"Unknown catalogue source(s): {', '.join(unknown)}",
            "invalid_source",
            f"Valid sources: {', '.join(ALL_SOURCES)}.",
        )
    running = active_jobs(session, "catalog_refresh")
    if running:
        raise conflict(
            "A catalogue refresh is already running",
            "job_running",
            f"Follow job {running[0].id} in the job tray.",
        )

    def work(ctx: JobContext) -> dict[str, Any]:
        from exofinder.data.archive import ArchiveError, ArchiveUnavailableError
        from exofinder.data.catalog import refresh_catalog
        from exofinder.db.session import session_scope

        def progress(done: int, total: int, message: str) -> None:
            ctx.check_cancelled()
            ctx.progress(min(0.99, done / max(total, 1)), message)
            ctx.log(message)

        try:
            with session_scope() as s:
                result = refresh_catalog(s, progress=progress, sources=wanted)
        except JobCancelled:
            raise
        except ArchiveUnavailableError as exc:
            raise NasaUnavailableError(
                f"[nasa_unavailable] {exc}. Hint: check your internet connection and try again later; "
                "the NASA Exoplanet Archive may be down for maintenance."
            ) from exc
        except ArchiveError as exc:
            raise NasaUnavailableError(
                f"[nasa_error] {exc}. Hint: the archive rejected or garbled the request; try again later."
            ) from exc
        summary = result.get("summary", {})
        return {
            "snapshot_ids": result.get("snapshot_ids"),
            "snapshots": result.get("snapshots"),
            "written": result.get("written"),
            "summary": summary,
            "ingest_seconds": result.get("ingest_seconds"),
        }

    return get_runner().submit(
        "catalog_refresh",
        "Refresh NASA catalogue (" + ", ".join(wanted) + ")",
        work,
        params={"sources": wanted},
    )


# ------------------------------------------------------------------------------------------------
# snapshots
# ------------------------------------------------------------------------------------------------
def snapshot_dict(s: CatalogSnapshot) -> dict[str, Any]:
    return {
        "id": s.id,
        "source": s.source,
        "table_name": s.table_name,
        "query": s.query,
        "url": s.url,
        "retrieved_at": s.retrieved_at,
        "row_count": s.row_count,
        "sha256": s.sha256,
        "file_path": s.file_path,
        "validation": s.validation or {},
    }


def list_snapshots(session: Session, source: str | None = None) -> list[dict[str, Any]]:
    q = select(CatalogSnapshot).order_by(CatalogSnapshot.retrieved_at.desc(), CatalogSnapshot.id.desc())
    if source:
        q = q.where(CatalogSnapshot.source == source)
    return [snapshot_dict(s) for s in session.scalars(q)]


# ------------------------------------------------------------------------------------------------
# signals
# ------------------------------------------------------------------------------------------------
def signal_dict(
    sig: Signal, target: Target | None = None, *, with_provenance: bool = False
) -> dict[str, Any]:
    """JSON form of a catalogue signal (catalogue values exactly as published)."""
    out = {
        "id": sig.id,
        "signal_key": sig.signal_key,
        "kepid": sig.kepid,
        "primary_source": sig.primary_source,
        "tce_plnt_num": sig.tce_plnt_num,
        "kepoi_name": sig.kepoi_name,
        "kepler_name": sig.kepler_name,
        "period_days": sig.period_days,
        "epoch_bkjd": sig.epoch_bkjd,
        "duration_hours": sig.duration_hours,
        "depth_ppm": sig.depth_ppm,
        "model_snr": sig.model_snr,
        "planet_radius_re": sig.planet_radius_re,
        "av_training_set": sig.av_training_set,
        "koi_disposition": sig.koi_disposition,
        "koi_pdisposition": sig.koi_pdisposition,
        "koi_score": sig.koi_score,
        "fpflags": {"nt": sig.fpflag_nt, "ss": sig.fpflag_ss, "co": sig.fpflag_co, "ec": sig.fpflag_ec},
        "category": sig.category,
        "label_conflict": bool(sig.label_conflict),
        "match_status": sig.match_status,
        "kepler_host_name": target.kepler_host_name if target is not None else None,
        "lc_status": target.lc_status if target is not None else None,
    }
    if with_provenance:
        out["provenance"] = sig.provenance or {}
    return out


def _csv(value: str | None) -> list[str]:
    return [v.strip() for v in (value or "").split(",") if v.strip()]


def _search_clause(text: str):
    t = text.strip()
    if not t:
        return None
    digits = re.sub(r"^(kic|kplr)\s*", "", t, flags=re.I).strip()
    clauses = []
    if digits.isdigit():
        clauses.append(Signal.kepid == int(digits))
    like = f"%{t}%"
    clauses += [
        Signal.signal_key.ilike(like),
        Signal.kepoi_name.ilike(like),
        Signal.kepler_name.ilike(like),
        Target.kepler_host_name.ilike(like),
    ]
    return or_(*clauses)


def list_signals(
    session: Session,
    *,
    search: str | None = None,
    category: str | None = None,
    av_label: str | None = None,
    koi_disposition: str | None = None,
    has_lightcurve: bool | None = None,
    conflict: bool | None = None,
    min_period: float | None = None,
    max_period: float | None = None,
    min_snr: float | None = None,
    kepid: int | None = None,
    sort: str = "signal_key",
    order: str = "asc",
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """Filtered, sorted page of signals ``{total, items}``.

    ``category``, ``av_label`` and ``koi_disposition`` accept comma-separated lists; ``av_label=none``
    / ``koi_disposition=none`` select signals without that label.
    """
    if sort not in SORT_COLUMNS:
        raise bad_request(
            f"Cannot sort by '{sort}'", "invalid_sort", f"Sort by one of: {', '.join(SORT_COLUMNS)}."
        )
    if order not in ("asc", "desc"):
        raise bad_request("order must be 'asc' or 'desc'", "invalid_sort")
    limit = max(1, min(int(limit), MAX_LIMIT))
    offset = max(0, int(offset))
    conds = []
    cats = _csv(category)
    if cats:
        conds.append(Signal.category.in_(cats))
    for col, raw in ((Signal.av_training_set, av_label), (Signal.koi_disposition, koi_disposition)):
        values = _csv(raw)
        if values:
            named = [v.upper() for v in values if v.lower() != "none"]
            parts = []
            if named:
                parts.append(col.in_(named))
            if len(named) != len(values):
                parts.append(col.is_(None))
            conds.append(or_(*parts))
    if conflict is not None:
        conds.append(Signal.label_conflict.is_(bool(conflict)))
    if min_period is not None:
        conds.append(Signal.period_days >= float(min_period))
    if max_period is not None:
        conds.append(Signal.period_days <= float(max_period))
    if min_snr is not None:
        conds.append(Signal.model_snr >= float(min_snr))
    if kepid is not None:
        conds.append(Signal.kepid == int(kepid))
    if has_lightcurve is not None:
        conds.append(Target.lc_status == "available" if has_lightcurve else Target.lc_status != "available")
    if search:
        clause = _search_clause(search)
        if clause is not None:
            conds.append(clause)
    where = and_(*conds) if conds else None

    base: Select = select(Signal, Target).join(Target, Target.kepid == Signal.kepid)
    count_q = select(func.count()).select_from(Signal).join(Target, Target.kepid == Signal.kepid)
    if where is not None:
        base = base.where(where)
        count_q = count_q.where(where)
    col = SORT_COLUMNS[sort]
    primary = col.desc() if order == "desc" else col.asc()
    nulls_last = col.is_(None)  # False < True: rows with values first
    base = base.order_by(nulls_last, primary, Signal.id.asc()).limit(limit).offset(offset)
    total = int(session.scalar(count_q) or 0)
    items = [signal_dict(sig, tgt) for sig, tgt in session.execute(base).all()]
    return {"total": total, "limit": limit, "offset": offset, "items": items}


# ------------------------------------------------------------------------------------------------
# stats
# ------------------------------------------------------------------------------------------------
def _hist(values_by_cat: dict[str, np.ndarray], n_bins: int = 40) -> dict[str, Any]:
    allv = np.concatenate([v for v in values_by_cat.values() if v.size] or [np.zeros(0)])
    if allv.size == 0:
        return {"edges": [], "counts": {c: [] for c in values_by_cat}}
    lo, hi = float(np.floor(allv.min() * 10) / 10), float(np.ceil(allv.max() * 10) / 10)
    if hi <= lo:
        hi = lo + 1.0
    edges = np.linspace(lo, hi, n_bins + 1)
    counts = {c: np.histogram(v, bins=edges)[0].astype(int).tolist() for c, v in values_by_cat.items()}
    return {"edges": [round(float(e), 6) for e in edges], "counts": counts}


def stats(session: Session) -> dict[str, Any]:
    """Category counts and per-category histograms (log10 period, log10 depth, log10 SNR)."""
    rows = session.execute(
        select(Signal.category, Signal.period_days, Signal.depth_ppm, Signal.model_snr)
    ).all()
    total = len(rows)
    cats = np.array([r[0] or "unknown" for r in rows], dtype=object)
    data = np.array([[r[1], r[2], r[3]] for r in rows], dtype=np.float64).reshape(-1, 3)

    def by_cat(col: int) -> dict[str, np.ndarray]:
        out = {}
        for c in sorted(set(cats.tolist())):
            v = data[cats == c, col]
            v = v[np.isfinite(v) & (v > 0)]
            out[c] = np.log10(v)
        return out

    def counts(column) -> dict[str, int]:
        q = select(column, func.count()).group_by(column)
        return {("none" if k is None else str(k)): int(n) for k, n in session.execute(q).all()}

    histograms = []
    for col, key, label, unit in (
        (0, "log10_period", "log10 period", "log10(days)"),
        (1, "log10_depth", "log10 depth", "log10(ppm)"),
        (2, "log10_snr", "log10 SNR", "log10(catalogue model SNR)"),
    ):
        values = by_cat(col)
        h = _hist(values)
        histograms.append(
            {
                "key": key,
                "label": label,
                "unit": unit,
                "edges": h["edges"],
                "counts": h["counts"],
                "n_missing": {c: int(np.sum(cats == c)) - int(v.size) for c, v in values.items()},
            }
        )
    snaps = session.execute(
        select(CatalogSnapshot.source, func.max(CatalogSnapshot.retrieved_at)).group_by(
            CatalogSnapshot.source
        )
    ).all()
    return {
        "total": total,
        "categories": counts(Signal.category),
        "av_labels": counts(Signal.av_training_set),
        "koi_dispositions": counts(Signal.koi_disposition),
        "label_conflicts": int(
            session.scalar(select(func.count()).select_from(Signal).where(Signal.label_conflict.is_(True)))
            or 0
        ),
        "with_lightcurve": int(
            session.scalar(
                select(func.count())
                .select_from(Signal)
                .join(Target, Target.kepid == Signal.kepid)
                .where(Target.lc_status == "available")
            )
            or 0
        ),
        "histograms": histograms,
        "snapshots_retrieved_at": {s: t for s, t in snaps},
        "note": "Values are catalogue values (DR24 TCE / KOI / confirmed tables) exactly as published.",
    }
