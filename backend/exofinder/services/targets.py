"""Targets (Kepler stars): search, dossier and light-curve download (``/api/targets``).

Search understands the usual ways of naming a Kepler system::

    "Kepler-90", "kepler 90", "Kepler-90 h"      Kepler host / planet names
    "KIC 11442793", "11442793", "kplr011442793"  Kepler Input Catalog ids
    "K00351", "K00351.01", "KOI-351", "KOI 351.01" KOI names

Exact identifier matches rank first, then exact names, prefixes and finally substrings of names
and signal keys; every result says what it ``matched_on``.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import String, cast, func, select
from sqlalchemy.orm import Session

from exofinder.data.lightcurve_store import has_lightcurve, lightcurve_path
from exofinder.db.models import CatalogSnapshot, Dataset, DatasetExample, Job, Prediction, Signal, Target
from exofinder.jobs.runner import JobCancelled, JobContext, get_runner
from exofinder.services.catalog import signal_dict
from exofinder.services.sci_common import pv
from exofinder.services.sci_errors import not_found

MAX_RESULTS = 20
_KIC_RE = re.compile(r"^(?:kic|kplr|kepid)?[\s\-_:]*0*(\d{1,9})$", re.I)
_KOI_RE = re.compile(r"^(?:koi|k)[\s\-_:]*0*(\d{1,5})(?:\.(\d{1,2}))?$", re.I)
_KEPLER_RE = re.compile(r"^kepler[\s\-_]*(\d{1,5})(?:[\s\-_]*([a-z]))?$", re.I)


def _label(kepid: int, host: str | None) -> str:
    return f"{host} (KIC {kepid})" if host else f"KIC {kepid}"


def search(session: Session, q: str, limit: int = MAX_RESULTS) -> list[dict[str, Any]]:
    """Ranked target matches for a free-text query (at most ``limit``, <= 20)."""
    text = (q or "").strip()
    limit = max(1, min(int(limit), MAX_RESULTS))
    if not text:
        return []
    hits: dict[int, tuple[int, str, Signal | None]] = {}

    def add(kepid: int, rank: int, matched_on: str, signal: Signal | None = None) -> None:
        cur = hits.get(kepid)
        if cur is None or rank < cur[0]:
            hits[kepid] = (rank, matched_on, signal)

    m = _KIC_RE.match(text)
    if m:
        digits = m.group(1)
        kepid = int(digits)
        if session.get(Target, kepid) is not None:
            add(kepid, 0, "kepid")
        if len(digits) >= 3:
            rows = session.scalars(
                select(Target.kepid).where(cast(Target.kepid, String).like(f"{int(digits)}%")).limit(limit)
            )
            for k in rows:
                add(int(k), 2, "kepid_prefix")
    m = _KOI_RE.match(text)
    if m:
        num, sub = int(m.group(1)), m.group(2)
        if sub is not None:
            name = f"K{num:05d}.{int(sub):02d}"
            for sig in session.scalars(select(Signal).where(Signal.kepoi_name == name)):
                add(sig.kepid, 0, "kepoi_name", sig)
        else:
            for sig in session.scalars(
                select(Signal).where(Signal.kepoi_name.like(f"K{num:05d}.%")).order_by(Signal.kepoi_name)
            ):
                add(sig.kepid, 0, "kepoi_name")
    m = _KEPLER_RE.match(text)
    if m:
        host = f"Kepler-{int(m.group(1))}"
        letter = m.group(2)
        if letter:
            pname = f"{host} {letter.lower()}"
            for sig in session.scalars(select(Signal).where(func.lower(Signal.kepler_name) == pname.lower())):
                add(sig.kepid, 0, "kepler_name", sig)
        for t in session.scalars(select(Target).where(func.lower(Target.kepler_host_name) == host.lower())):
            add(t.kepid, 1 if letter else 0, "kepler_host_name")
    # generic name / key matching (prefix before substring)
    if len(text) >= 2:
        like_prefix, like_any = f"{text}%", f"%{text}%"
        for t in session.scalars(
            select(Target)
            .where(Target.kepler_host_name.ilike(like_prefix))
            .order_by(Target.kepler_host_name)
            .limit(50)
        ):
            add(t.kepid, 2 if t.kepler_host_name.lower() == text.lower() else 3, "kepler_host_name")
        for sig in session.scalars(
            select(Signal)
            .where(
                Signal.kepler_name.ilike(like_any)
                | Signal.kepoi_name.ilike(like_any)
                | Signal.signal_key.ilike(like_any)
            )
            .order_by(Signal.kepler_name, Signal.signal_key)
            .limit(50)
        ):
            on = (
                "kepler_name"
                if sig.kepler_name and text.lower() in sig.kepler_name.lower()
                else (
                    "kepoi_name"
                    if sig.kepoi_name and text.lower() in sig.kepoi_name.lower()
                    else "signal_key"
                )
            )
            add(sig.kepid, 4 if on != "signal_key" else 5, on, sig)
        for t in session.scalars(select(Target).where(Target.kepler_host_name.ilike(like_any)).limit(50)):
            add(t.kepid, 5, "kepler_host_name")
    if not hits:
        return []
    ranked = sorted(hits.items(), key=lambda kv: (kv[1][0], kv[0]))[:limit]
    kepids = [k for k, _ in ranked]
    targets = {t.kepid: t for t in session.scalars(select(Target).where(Target.kepid.in_(kepids)))}
    counts = dict(
        session.execute(
            select(Signal.kepid, func.count()).where(Signal.kepid.in_(kepids)).group_by(Signal.kepid)
        ).all()
    )
    out = []
    for kepid, (rank, matched_on, sig) in ranked:
        t = targets.get(kepid)
        out.append(
            {
                "kepid": kepid,
                "label": _label(kepid, t.kepler_host_name if t else None),
                "kepler_host_name": t.kepler_host_name if t else None,
                "n_signals": int(counts.get(kepid, 0)),
                "lc_status": t.lc_status if t else "none",
                "matched_on": matched_on,
                "matched_signal_id": sig.id if sig is not None else None,
                "matched_signal_key": sig.signal_key if sig is not None else None,
                "matched_name": (sig.kepler_name or sig.kepoi_name) if sig is not None else None,
                "rank": rank,
            }
        )
    return out


# ------------------------------------------------------------------------------------------------
# detail
# ------------------------------------------------------------------------------------------------
def get_target(session: Session, kepid: int) -> Target:
    t = session.get(Target, int(kepid))
    if t is None:
        raise not_found(
            f"KIC {kepid}",
            "target_not_found",
            "This star is not in the local catalogue. Search by name/KIC, or refresh the NASA catalogue.",
        )
    return t


def target_dict(t: Target) -> dict[str, Any]:
    path = lightcurve_path(t.kepid)
    cache_bytes = path.stat().st_size if path.is_file() else None
    return {
        "kepid": t.kepid,
        "label": _label(t.kepid, t.kepler_host_name),
        "kepler_host_name": t.kepler_host_name,
        "ra": t.ra,
        "dec": t.dec,
        "kepmag": t.kepmag,
        "lc_status": t.lc_status,
        "lc_quarters": list(t.lc_quarters or []),
        "lc_n_cadences": t.lc_n_cadences,
        "lc_error": t.lc_error,
        "lc_updated_at": t.lc_updated_at,
        "lc_cached": cache_bytes is not None,
        "lc_cache_bytes": cache_bytes,
    }


def stellar_params(session: Session, t: Target | None) -> dict[str, Any] | None:
    """Stellar parameters with catalogue provenance (Kepler DR25 stellar table snapshot)."""
    if t is None:
        return None
    snap = session.scalars(
        select(CatalogSnapshot).where(CatalogSnapshot.source == "stellar").order_by(CatalogSnapshot.id.desc())
    ).first()
    src = "NASA Exoplanet Archive keplerstellar (q1_q17_dr25_stellar)"
    if snap is not None:
        src += f", snapshot #{snap.id} retrieved {snap.retrieved_at:%Y-%m-%d}"
    mag_src = "NASA Exoplanet Archive (keplerstellar, else cumulative KOI / confirmed-planet tables)"
    return {
        "teff": pv(t.teff, "K", "catalogue", src),
        "radius": pv(t.radius, "R_sun", "catalogue", src),
        "logg": pv(t.logg, "log10(cm s^-2)", "catalogue", src),
        "mass": pv(t.mass, "M_sun", "catalogue", src),
        "kepmag": pv(t.kepmag, "mag", "catalogue", mag_src),
    }


def dataset_memberships(session: Session, kepid: int) -> list[dict[str, Any]]:
    rows = session.execute(
        select(
            DatasetExample.dataset_id,
            Dataset.name,
            Dataset.status,
            DatasetExample.split,
            func.count(),
        )
        .join(Dataset, Dataset.id == DatasetExample.dataset_id)
        .where(DatasetExample.kepid == int(kepid))
        .group_by(DatasetExample.dataset_id, Dataset.name, Dataset.status, DatasetExample.split)
        .order_by(DatasetExample.dataset_id)
    ).all()
    return [
        {
            "dataset_id": int(r[0]),
            "dataset_name": r[1],
            "dataset_status": r[2],
            "split": r[3],
            "n_signals": int(r[4]),
        }
        for r in rows
    ]


def detail(session: Session, kepid: int) -> dict[str, Any]:
    from exofinder.services.predictions import prediction_summaries

    t = get_target(session, kepid)
    signals = list(
        session.scalars(select(Signal).where(Signal.kepid == t.kepid).order_by(Signal.period_days, Signal.id))
    )
    preds = list(
        session.scalars(
            select(Prediction).where(Prediction.kepid == t.kepid).order_by(Prediction.id.desc()).limit(10)
        )
    )
    return {
        "target": target_dict(t),
        "stellar": stellar_params(session, t),
        "signals": [signal_dict(s, t, with_provenance=True) for s in signals],
        "datasets": dataset_memberships(session, t.kepid),
        "recent_predictions": prediction_summaries(session, preds),
        "reserved_showcase": _is_showcase(t.kepid),
    }


def _is_showcase(kepid: int) -> bool:
    from exofinder.data.tiers import RESERVED_SHOWCASE_KEPIDS

    return int(kepid) in RESERVED_SHOWCASE_KEPIDS


# ------------------------------------------------------------------------------------------------
# download
# ------------------------------------------------------------------------------------------------
def _active_download_job(session: Session, kepid: int) -> Job | None:
    for job in session.scalars(
        select(Job).where(Job.kind == "download", Job.status.in_(("queued", "running")))
    ):
        if int((job.params or {}).get("kepid", -1)) == int(kepid) and get_runner().is_active(job.id):
            return job
    return None


def download(session: Session, kepid: int) -> tuple[str, Any]:
    """Idempotent light-curve download: ``("available", target_dict)`` or ``("job", job_id)``."""
    t = get_target(session, kepid)
    if has_lightcurve(t.kepid):
        if t.lc_status != "available" or not t.lc_path:
            from exofinder.data.acquire import ensure_lightcurve

            ensure_lightcurve(session, t.kepid)  # cache present: only updates the target bookkeeping
            session.refresh(t)
        return "available", target_dict(t)
    running = _active_download_job(session, t.kepid)
    if running is not None:
        return "job", running.id
    kepid = t.kepid
    label = _label(kepid, t.kepler_host_name)

    def work(ctx: JobContext) -> dict[str, Any]:
        from exofinder.data.acquire import AcquisitionCancelled, LightCurveUnavailableError, ensure_lightcurve
        from exofinder.db.session import session_scope

        ctx.progress(0.05, f"Downloading Kepler long-cadence light curves of {label} from NASA MAST")
        with session_scope() as s:
            try:
                lc = ensure_lightcurve(s, kepid, cancel=ctx.cancel_event)
            except AcquisitionCancelled as exc:
                raise JobCancelled() from exc
            except LightCurveUnavailableError as exc:
                hint = (
                    "MAST has no Kepler long-cadence data for this star."
                    if exc.status == "no_data"
                    else "Check the internet connection and retry; completed quarters are kept."
                )
                raise RuntimeError(f"[{exc.status}] {exc}. Hint: {hint}") from exc
            target = s.get(Target, kepid)
            quarters = list(target.lc_quarters or []) if target else []
            ctx.log(f"{label}: {len(lc)} cadences in quarters {quarters}")
            return {
                "kepid": kepid,
                "status": target.lc_status if target else "available",
                "quarters": quarters,
                "n_cadences": len(lc),
                "error": target.lc_error if target else None,
            }

    job_id = get_runner().submit("download", f"Download light curve: {label}", work, params={"kepid": kepid})
    return "job", job_id
