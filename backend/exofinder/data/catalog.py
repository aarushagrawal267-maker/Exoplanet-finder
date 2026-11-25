"""Catalogue ingestion: Kepler TCEs, KOIs, confirmed planets and stellar parameters → database.

Data model
----------
One :class:`~exofinder.db.models.Signal` row per *physical* transit-like signal:

* every DR24 Threshold-Crossing Event (``TCE-<kic9>-<nn>``; ephemeris from the TCE, because the
  AstroNet DR24 labels were assigned to TCE ephemerides);
* every KOI that could not be linked to a DR24 TCE (``KOI-<kepoi_name>``; KOI ephemeris);
* every transiting confirmed planet matched to neither (``PL-<Kepler name>``, e.g.
  ``PL-Kepler-90_i``; epoch converted from BJD to BKJD = BJD − 2454833.0).

TCE ↔ KOI linking
-----------------
``koi_tce_plnt_num`` names the TCE a KOI was promoted from, but in the TCE delivery given by
``koi_tce_delivname`` (most cumulative KOIs point at DR25 or Q1–Q16 numbering, not DR24), so the
planet number alone is not trustworthy. A link is accepted only when it is **verified**:

* periods agree: ``|P_tce − P_koi| / P_tce < 1 %`` (:data:`PERIOD_REL_TOL`), and
* epochs agree modulo the period: ``|Δt − round(Δt/P)·P| ≤ 0.5 × duration``
  (:data:`EPOCH_TOL_DURATIONS`; duration = the longer of the two catalogue durations).

Linking is one-to-one and deterministic. Pass 1 tries the TCE with the KOI's planet number; pass 2
(fallback) tries every still-unlinked DR24 TCE on the same star and accepts the best verified
ephemeris match (recorded as ``method="ephemeris"`` in provenance). A KOI whose numbered TCE exists
but fails verification (and has no fallback match) gets its own row with
``match_status="match_conflict"`` — its fields are *not* merged — and that TCE row is also marked
``match_conflict``. KOIs with no numbered DR24 TCE and no ephemeris match are ``koi_only``.
A secondary eclipse detected as its own TCE (same period, epoch offset by P/2, e.g. Kepler-2 TCE 2)
therefore never absorbs the planet's KOI.

Confirmed planets
-----------------
A confirmed planet is attached to an existing row via its archive KOI name (``keplernames``), or
else by same star + period within 1 % (+ epoch agreement when the planet has a transit midtime).
Non-transiting planets (``tran_flag = 0``, e.g. TTV/RV-only companions) never create rows.

Categories (``Signal.category``)
--------------------------------
``confirmed`` (KOI CONFIRMED or matched to the confirmed table) > ``false_positive`` (KOI FALSE
POSITIVE, or Autovetter AFP/NTP when there is no KOI) > ``candidate`` (KOI CANDIDATE, or Autovetter
PC when there is no KOI) > ``unknown`` (Autovetter UNK without KOI, anything else).

``label_conflict`` is True when the Autovetter label and the KOI/confirmed status disagree:
PC vs FALSE POSITIVE, or AFP/NTP vs CONFIRMED (KOI disposition or confirmed table).

Every catalogue-derived field carries provenance ``{field: {table, column, snapshot_id, value}}``.
Catalogue scores (``koi_score``, fp flags, ``koi_pdisposition``) are stored for display only.
"""

from __future__ import annotations

import logging
import math
import time
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from exofinder.config import BKJD_OFFSET, kic9
from exofinder.data.archive import (
    ALL_SOURCES,
    SOURCES,
    ArchiveClient,
    fetch_snapshot,
    latest_snapshot,
    load_snapshot_frame,
    register_snapshot_file,
)
from exofinder.data.labels import RETIRED_CATEGORY
from exofinder.db.models import DatasetExample, Prediction, Signal, Target

log = logging.getLogger(__name__)

#: Maximum relative period difference for a TCE↔KOI or catalogue↔confirmed match.
PERIOD_REL_TOL = 0.01
#: Maximum epoch difference (mod P) in units of the transit duration.
EPOCH_TOL_DURATIONS = 0.5

ProgressFn = Callable[[int, int, str], None]

#: Signal columns written by the ingester (everything except the primary key and relationships).
_SIGNAL_FIELDS = (
    "kepid",
    "primary_source",
    "tce_plnt_num",
    "kepoi_name",
    "kepler_name",
    "period_days",
    "epoch_bkjd",
    "duration_hours",
    "depth_ppm",
    "model_snr",
    "planet_radius_re",
    "av_training_set",
    "koi_disposition",
    "koi_pdisposition",
    "koi_score",
    "fpflag_nt",
    "fpflag_ss",
    "fpflag_co",
    "fpflag_ec",
    "category",
    "label_conflict",
    "match_status",
    "provenance",
)

_TARGET_FIELDS = ("ra", "dec", "kepmag", "teff", "logg", "radius", "mass", "kepler_host_name")


# ------------------------------------------------------------------------------------------------
# Value helpers (pandas → plain JSON-safe Python)
# ------------------------------------------------------------------------------------------------
def _f(x: Any) -> float | None:
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _i(x: Any) -> int | None:
    v = _f(x)
    return None if v is None else int(round(v))


def _s(x: Any) -> str | None:
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return None
    text = str(x).strip()
    return text or None


def _upper(x: Any) -> str | None:
    s = _s(x)
    return s.upper() if s else None


def _pos(x: Any) -> float | None:
    v = _f(x)
    return v if (v is not None and v > 0) else None


# ------------------------------------------------------------------------------------------------
# Ephemeris verification
# ------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class MatchCheck:
    """Result of comparing two ephemerides of (supposedly) the same transit signal."""

    ok: bool
    period_ok: bool
    epoch_ok: bool
    dp_rel: float
    epoch_offset_days: float | None
    epoch_offset_durations: float | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "period_ok": self.period_ok,
            "epoch_ok": self.epoch_ok,
            "dp_rel": round(self.dp_rel, 8),
            "epoch_offset_days": None if self.epoch_offset_days is None else round(self.epoch_offset_days, 6),
            "epoch_offset_durations": (
                None if self.epoch_offset_durations is None else round(self.epoch_offset_durations, 4)
            ),
        }

    @property
    def score(self) -> tuple[float, float]:
        """Sort key: smaller is a better match."""
        return (
            self.epoch_offset_durations if self.epoch_offset_durations is not None else math.inf,
            self.dp_rel,
        )


def verify_ephemeris_match(
    period_ref: float,
    epoch_ref: float,
    duration_ref_hours: float | None,
    period_other: float,
    epoch_other: float | None,
    duration_other_hours: float | None,
    *,
    period_tol: float = PERIOD_REL_TOL,
    epoch_tol_durations: float = EPOCH_TOL_DURATIONS,
    require_epoch: bool = True,
) -> MatchCheck:
    """Check whether two ephemerides describe the same periodic transit.

    The epoch difference is reduced modulo the reference period (``n = round(Δt / P_ref)``), so
    epochs quoted for different transits of the same signal agree. The tolerance is
    ``epoch_tol_durations`` × the longer of the two durations — transit centres of the same signal
    must fall well inside each other's transit window, whereas e.g. a secondary eclipse is offset by
    about half a period. If ``epoch_other`` is unknown and ``require_epoch`` is False, only the
    period is compared.
    """
    dp_rel = abs(period_ref - period_other) / period_ref
    period_ok = dp_rel < period_tol
    durations = [d for d in (duration_ref_hours, duration_other_hours) if d is not None and d > 0]
    if epoch_other is None or not durations:
        epoch_ok = not require_epoch
        return MatchCheck(period_ok and epoch_ok, period_ok, epoch_ok, dp_rel, None, None)
    dur_days = max(durations) / 24.0
    dt = epoch_other - epoch_ref
    resid = dt - round(dt / period_ref) * period_ref
    off = abs(resid)
    epoch_ok = off <= epoch_tol_durations * dur_days
    return MatchCheck(period_ok and epoch_ok, period_ok, epoch_ok, dp_rel, off, off / dur_days)


# ------------------------------------------------------------------------------------------------
# In-memory catalogue build
# ------------------------------------------------------------------------------------------------
@dataclass
class SignalRecord:
    """A signal row being assembled (mirrors :class:`Signal` columns)."""

    signal_key: str
    kepid: int
    primary_source: str
    period_days: float
    epoch_bkjd: float
    duration_hours: float
    depth_ppm: float | None = None
    model_snr: float | None = None
    planet_radius_re: float | None = None
    tce_plnt_num: int | None = None
    kepoi_name: str | None = None
    kepler_name: str | None = None
    av_training_set: str | None = None
    koi_disposition: str | None = None
    koi_pdisposition: str | None = None
    koi_score: float | None = None
    fpflag_nt: int | None = None
    fpflag_ss: int | None = None
    fpflag_co: int | None = None
    fpflag_ec: int | None = None
    match_status: str = "tce_only"
    category: str = "unknown"
    label_conflict: bool = False
    in_confirmed_table: bool = False
    provenance: dict[str, Any] = field(default_factory=dict)

    def as_row(self) -> dict[str, Any]:
        return {name: getattr(self, name) for name in _SIGNAL_FIELDS}


@dataclass
class CatalogBuild:
    """Result of :func:`build_catalog`: rows to write plus statistics."""

    records: list[SignalRecord]
    targets: dict[int, dict[str, Any]]
    stats: dict[str, Any]


def _prov(table: str, column: str, snapshot_id: int | None, value: Any, **extra: Any) -> dict[str, Any]:
    d = {"table": table, "column": column, "snapshot_id": snapshot_id, "value": value}
    d.update(extra)
    return d


def _host_from_planet_name(name: str | None) -> str | None:
    """'Kepler-90 i' → 'Kepler-90' (planet letter is the last whitespace-separated token)."""
    if not name or " " not in name:
        return None
    return name.rsplit(" ", 1)[0]


def _assign_category(rec: SignalRecord) -> None:
    disp = rec.koi_disposition
    av = rec.av_training_set
    confirmed = rec.in_confirmed_table or disp == "CONFIRMED"
    if confirmed:
        cat, rule = (
            "confirmed",
            "KOI CONFIRMED" if disp == "CONFIRMED" else "matched to confirmed-planet table",
        )
    elif disp == "FALSE POSITIVE":
        cat, rule = "false_positive", "KOI FALSE POSITIVE"
    elif disp == "CANDIDATE":
        cat, rule = "candidate", "KOI CANDIDATE"
    elif disp is None and av in ("AFP", "NTP"):
        cat, rule = "false_positive", f"Autovetter {av} (no KOI)"
    elif disp is None and av == "PC":
        cat, rule = "candidate", "Autovetter PC (no KOI)"
    else:
        cat, rule = "unknown", "no decisive disposition"
    rec.category = cat
    conflict = (av == "PC" and disp == "FALSE POSITIVE") or (av in ("AFP", "NTP") and confirmed)
    rec.label_conflict = bool(conflict)
    rec.provenance["category"] = {
        "derived": True,
        "rule": rule,
        "inputs": {
            "av_training_set": av,
            "koi_disposition": disp,
            "in_confirmed_table": rec.in_confirmed_table,
        },
    }
    if conflict:
        rec.provenance["label_conflict"] = {
            "derived": True,
            "av_training_set": av,
            "koi_disposition": disp,
            "in_confirmed_table": rec.in_confirmed_table,
        }
    if rec.in_confirmed_table and disp == "FALSE POSITIVE":
        rec.provenance.setdefault("notes", []).append(
            "KOI disposition FALSE POSITIVE but listed in the confirmed-planet table"
        )


def build_catalog(
    tce: pd.DataFrame | None,
    koi: pd.DataFrame | None,
    confirmed: pd.DataFrame | None = None,
    stellar: pd.DataFrame | None = None,
    snapshot_ids: Mapping[str, int | None] | None = None,
) -> CatalogBuild:
    """Merge the catalogue tables into signal records and target attributes (no database I/O).

    Deterministic: inputs are processed in sorted key order and ties are broken by name.
    """
    sid = dict(snapshot_ids or {})
    t_tce = SOURCES["dr24_tce"].table_name
    t_koi = SOURCES["koi_cumulative"].table_name
    t_conf = SOURCES["confirmed"].table_name
    t_st = SOURCES["stellar"].table_name
    stats: dict[str, Any] = {
        "input_rows": {},
        "skipped": Counter(),
        "tce_koi_link": Counter(),
        "confirmed_match": Counter(),
    }
    records: dict[str, SignalRecord] = {}
    target_info: dict[int, dict[str, Any]] = defaultdict(dict)

    def note_target(kepid: int, key: str, value: Any, priority: int) -> None:
        """Keep the value from the highest-priority source (lower number wins)."""
        if value is None:
            return
        cur = target_info[kepid].get(key)
        if cur is None or priority < cur[1]:
            target_info[kepid][key] = (value, priority)

    # ---- DR24 TCEs -------------------------------------------------------------------------------
    tce_by_key: dict[tuple[int, int], SignalRecord] = {}
    tces_by_kepid: dict[int, list[SignalRecord]] = defaultdict(list)
    if tce is not None:
        stats["input_rows"]["dr24_tce"] = int(len(tce))
        df = tce.sort_values(["kepid", "tce_plnt_num"], kind="mergesort")
        for row in df.itertuples(index=False):
            kepid, num = _i(row.kepid), _i(row.tce_plnt_num)
            period, epoch, dur = _pos(row.tce_period), _f(row.tce_time0bk), _pos(row.tce_duration)
            if kepid is None or num is None:
                stats["skipped"]["tce_missing_id"] += 1
                continue
            if period is None or epoch is None or dur is None:
                stats["skipped"]["tce_bad_ephemeris"] += 1
                continue
            key = f"TCE-{kic9(kepid)}-{num:02d}"
            if key in records:
                stats["skipped"]["tce_duplicate"] += 1
                continue
            s = sid.get("dr24_tce")
            av = _upper(row.av_training_set)
            rec = SignalRecord(
                signal_key=key,
                kepid=kepid,
                primary_source="dr24_tce",
                tce_plnt_num=num,
                period_days=period,
                epoch_bkjd=epoch,
                duration_hours=dur,
                depth_ppm=_f(row.tce_depth),
                model_snr=_f(row.tce_model_snr),
                planet_radius_re=_f(row.tce_prad),
                av_training_set=av,
                match_status="tce_only",
            )
            rec.provenance = {
                "period_days": _prov(t_tce, "tce_period", s, period),
                "epoch_bkjd": _prov(t_tce, "tce_time0bk", s, epoch, time_system="BKJD"),
                "duration_hours": _prov(t_tce, "tce_duration", s, dur),
                "depth_ppm": _prov(t_tce, "tce_depth", s, rec.depth_ppm),
                "model_snr": _prov(t_tce, "tce_model_snr", s, rec.model_snr),
                "planet_radius_re": _prov(t_tce, "tce_prad", s, rec.planet_radius_re),
                "av_training_set": _prov(t_tce, "av_training_set", s, av),
                "tce_plnt_num": _prov(t_tce, "tce_plnt_num", s, num),
            }
            records[key] = rec
            tce_by_key[(kepid, num)] = rec
            tces_by_kepid[kepid].append(rec)
            note_target(kepid, "ra", _f(row.ra), 3)
            note_target(kepid, "dec", _f(row.dec), 3)

    # ---- KOIs: verified linking to DR24 TCEs ---------------------------------------------------------
    koi_rows: list[dict[str, Any]] = []
    if koi is not None:
        stats["input_rows"]["koi_cumulative"] = int(len(koi))
        df = koi.sort_values("kepoi_name", kind="mergesort")
        for row in df.itertuples(index=False):
            kepid, name = _i(row.kepid), _s(row.kepoi_name)
            if kepid is None or name is None:
                stats["skipped"]["koi_missing_id"] += 1
                continue
            d = {
                "kepid": kepid,
                "kepoi_name": name,
                "kepler_name": _s(row.kepler_name),
                "koi_disposition": _upper(row.koi_disposition),
                "koi_pdisposition": _upper(row.koi_pdisposition),
                "koi_score": _f(row.koi_score),
                "fpflag_nt": _i(row.koi_fpflag_nt),
                "fpflag_ss": _i(row.koi_fpflag_ss),
                "fpflag_co": _i(row.koi_fpflag_co),
                "fpflag_ec": _i(row.koi_fpflag_ec),
                "period": _pos(row.koi_period),
                "epoch": _f(row.koi_time0bk),
                "duration": _pos(row.koi_duration),
                "depth": _f(row.koi_depth),
                "snr": _f(row.koi_model_snr),
                "prad": _f(row.koi_prad),
                "plnt": _i(row.koi_tce_plnt_num),
                "delivname": _s(row.koi_tce_delivname),
                "disp_prov": _s(getattr(row, "koi_disp_prov", None)),
            }
            koi_rows.append(d)
            note_target(kepid, "ra", _f(row.ra), 2)
            note_target(kepid, "dec", _f(row.dec), 2)
            note_target(kepid, "kepmag", _f(row.koi_kepmag), 2)
            if d["kepler_name"]:
                note_target(kepid, "kepler_host_name", _host_from_planet_name(d["kepler_name"]), 2)

    def check(tce_rec: SignalRecord, k: dict[str, Any]) -> MatchCheck | None:
        if k["period"] is None:
            return None
        return verify_ephemeris_match(
            tce_rec.period_days,
            tce_rec.epoch_bkjd,
            tce_rec.duration_hours,
            k["period"],
            k["epoch"],
            k["duration"],
        )

    linked: dict[str, tuple[SignalRecord, MatchCheck, str]] = {}  # kepoi_name -> (tce, check, method)
    tce_taken: set[str] = set()
    numbered: dict[str, tuple[SignalRecord, MatchCheck | None]] = {}
    proposals = []
    for k in koi_rows:
        if k["plnt"] is None:
            continue
        t = tce_by_key.get((k["kepid"], k["plnt"]))
        if t is None:
            continue
        c = check(t, k)
        numbered[k["kepoi_name"]] = (t, c)
        if c is not None and c.ok:
            proposals.append((c.score, k["kepoi_name"], t.signal_key, k, t, c))
    for _, name, _, _k, t, c in sorted(proposals, key=lambda p: (p[0], p[1], p[2])):
        if name not in linked and t.signal_key not in tce_taken:
            linked[name] = (t, c, "tce_plnt_num")
            tce_taken.add(t.signal_key)
    fallback = []
    for k in koi_rows:
        if k["kepoi_name"] in linked:
            continue
        for t in tces_by_kepid.get(k["kepid"], []):
            if t.signal_key in tce_taken:
                continue
            c = check(t, k)
            if c is not None and c.ok:
                fallback.append((c.score, k["kepoi_name"], t.signal_key, k, t, c))
    for _, name, _, _k, t, c in sorted(fallback, key=lambda p: (p[0], p[1], p[2])):
        if name not in linked and t.signal_key not in tce_taken:
            linked[name] = (t, c, "ephemeris")
            tce_taken.add(t.signal_key)

    def merge_koi_fields(rec: SignalRecord, k: dict[str, Any]) -> None:
        s = sid.get("koi_cumulative")
        rec.kepoi_name = k["kepoi_name"]
        rec.kepler_name = rec.kepler_name or k["kepler_name"]
        rec.koi_disposition = k["koi_disposition"]
        rec.koi_pdisposition = k["koi_pdisposition"]
        rec.koi_score = k["koi_score"]
        rec.fpflag_nt, rec.fpflag_ss, rec.fpflag_co, rec.fpflag_ec = (
            k["fpflag_nt"],
            k["fpflag_ss"],
            k["fpflag_co"],
            k["fpflag_ec"],
        )
        p = rec.provenance
        p["kepoi_name"] = _prov(t_koi, "kepoi_name", s, k["kepoi_name"])
        if k["kepler_name"]:
            p["kepler_name"] = _prov(t_koi, "kepler_name", s, k["kepler_name"])
        p["koi_disposition"] = _prov(
            t_koi, "koi_disposition", s, k["koi_disposition"], disp_prov=k["disp_prov"]
        )
        p["koi_pdisposition"] = _prov(t_koi, "koi_pdisposition", s, k["koi_pdisposition"], display_only=True)
        p["koi_score"] = _prov(t_koi, "koi_score", s, k["koi_score"], display_only=True)
        for flag in ("nt", "ss", "co", "ec"):
            p[f"fpflag_{flag}"] = _prov(
                t_koi, f"koi_fpflag_{flag}", s, k[f"fpflag_{flag}"], display_only=True
            )

    koi_only_count = 0
    for k in koi_rows:
        name = k["kepoi_name"]
        if name in linked:
            t, c, method = linked[name]
            merge_koi_fields(t, k)
            t.match_status = "koi_matched"
            if t.primary_source == "dr24_tce" and k["prad"] is not None:
                t.planet_radius_re = k["prad"]
                t.provenance["planet_radius_re"] = _prov(
                    t_koi, "koi_prad", sid.get("koi_cumulative"), k["prad"]
                )
            t.provenance["koi_ephemeris"] = {
                "table": t_koi,
                "snapshot_id": sid.get("koi_cumulative"),
                "period_days": k["period"],
                "epoch_bkjd": k["epoch"],
                "duration_hours": k["duration"],
                "depth_ppm": k["depth"],
                "model_snr": k["snr"],
                "note": "alternative catalogue ephemeris; the row uses the DR24 TCE ephemeris",
            }
            t.provenance["match"] = {
                "method": method,
                "koi_tce_plnt_num": k["plnt"],
                "koi_tce_delivname": k["delivname"],
                **c.to_dict(),
            }
            stats["tce_koi_link"][method] += 1
            continue
        # Unlinked KOI -> its own row.
        if k["period"] is None or k["epoch"] is None or k["duration"] is None:
            stats["skipped"]["koi_bad_ephemeris"] += 1
            continue
        s = sid.get("koi_cumulative")
        rec = SignalRecord(
            signal_key=f"KOI-{name}",
            kepid=k["kepid"],
            primary_source="koi",
            period_days=k["period"],
            epoch_bkjd=k["epoch"],
            duration_hours=k["duration"],
            depth_ppm=k["depth"],
            model_snr=k["snr"],
            planet_radius_re=k["prad"],
        )
        rec.provenance = {
            "period_days": _prov(t_koi, "koi_period", s, k["period"]),
            "epoch_bkjd": _prov(t_koi, "koi_time0bk", s, k["epoch"], time_system="BKJD"),
            "duration_hours": _prov(t_koi, "koi_duration", s, k["duration"]),
            "depth_ppm": _prov(t_koi, "koi_depth", s, k["depth"]),
            "model_snr": _prov(t_koi, "koi_model_snr", s, k["snr"]),
            "planet_radius_re": _prov(t_koi, "koi_prad", s, k["prad"]),
        }
        merge_koi_fields(rec, k)
        if name in numbered:
            t, c = numbered[name]
            reason = "tce_claimed_by_other_koi" if (c is not None and c.ok) else "ephemeris_mismatch"
            rec.match_status = "match_conflict"
            detail = {
                "reason": reason,
                "tce_signal_key": t.signal_key,
                "koi_tce_plnt_num": k["plnt"],
                "koi_tce_delivname": k["delivname"],
                **(c.to_dict() if c is not None else {"ok": False, "note": "KOI period missing"}),
            }
            rec.provenance["match"] = detail
            if t.signal_key not in tce_taken:
                t.match_status = "match_conflict"
                t.provenance.setdefault("match_conflicts", []).append({**detail, "kepoi_name": name})
            stats["tce_koi_link"]["match_conflict"] += 1
        else:
            rec.match_status = "koi_only"
            rec.provenance["match"] = {
                "reason": "no DR24 TCE with this planet number and no verified ephemeris match on the star",
                "koi_tce_plnt_num": k["plnt"],
                "koi_tce_delivname": k["delivname"],
            }
            koi_only_count += 1
        records[rec.signal_key] = rec
    stats["tce_koi_link"]["koi_only"] = koi_only_count

    # ---- Confirmed planets ------------------------------------------------------------------------
    by_kepoi = {r.kepoi_name: r for r in records.values() if r.kepoi_name}
    by_kepid: dict[int, list[SignalRecord]] = defaultdict(list)
    for r in sorted(records.values(), key=lambda r: r.signal_key):
        by_kepid[r.kepid].append(r)
    confirmed_assigned: set[str] = set()
    if confirmed is not None:
        stats["input_rows"]["confirmed"] = int(len(confirmed))
        df = confirmed.sort_values(["kepid", "kepler_name"], kind="mergesort")
        planets: list[dict[str, Any]] = []
        seen_names: set[str] = set()
        for row in df.itertuples(index=False):
            kepid, kname = _i(row.kepid), _s(row.kepler_name)
            if kepid is None or kname is None:
                stats["skipped"]["confirmed_missing_id"] += 1
                continue
            if kname in seen_names:
                stats["skipped"]["confirmed_duplicate"] += 1
                continue
            seen_names.add(kname)
            tranmid = _f(row.pl_tranmid)
            depth_pct = _f(row.pl_trandep)
            planets.append(
                {
                    "kepid": kepid,
                    "kepler_name": kname,
                    "koi_name": _s(row.koi_name),
                    "pl_name": _s(row.pl_name),
                    "period": _pos(row.pl_orbper),
                    "tranmid_bjd": tranmid,
                    "epoch_bkjd": None if tranmid is None else tranmid - BKJD_OFFSET,
                    "systemref": _s(row.pl_tranmid_systemref),
                    "duration": _pos(row.pl_trandur),
                    "depth_ppm": None if depth_pct is None else depth_pct * 1e4,  # % -> ppm
                    "depth_pct": depth_pct,
                    "prad": _f(row.pl_rade),
                    "tran_flag": _i(row.tran_flag),
                    "disc_facility": _s(row.disc_facility),
                    "discoverymethod": _s(row.discoverymethod),
                    "disc_year": _i(row.disc_year),
                }
            )
            note_target(kepid, "kepler_host_name", _host_from_planet_name(kname), 1)
            note_target(kepid, "ra", _f(row.ra), 4)
            note_target(kepid, "dec", _f(row.dec), 4)
            note_target(kepid, "kepmag", _f(row.sy_kepmag), 3)

        def attach(rec: SignalRecord, pl: dict[str, Any], method: str, c: MatchCheck | None) -> None:
            s = sid.get("confirmed")
            rec.in_confirmed_table = True
            confirmed_assigned.add(rec.signal_key)
            if rec.kepler_name and rec.kepler_name != pl["kepler_name"]:
                rec.provenance.setdefault("notes", []).append(
                    f"KOI kepler_name {rec.kepler_name!r} differs from keplernames {pl['kepler_name']!r}"
                )
            rec.kepler_name = pl["kepler_name"]
            rec.provenance["kepler_name"] = _prov(t_conf, "kepler_name", s, pl["kepler_name"])
            rec.provenance["confirmed"] = {
                "table": t_conf,
                "snapshot_id": s,
                "pl_name": pl["pl_name"],
                "kepler_name": pl["kepler_name"],
                "disc_facility": pl["disc_facility"],
                "discoverymethod": pl["discoverymethod"],
                "disc_year": pl["disc_year"],
                "match_method": method,
                **({} if c is None else {"match_check": c.to_dict()}),
            }
            stats["confirmed_match"][method] += 1

        pending: list[dict[str, Any]] = []
        # Pass 1: archive-provided KOI name (authoritative cross-identification).
        for pl in planets:
            rec = by_kepoi.get(pl["koi_name"]) if pl["koi_name"] else None
            if rec is not None and rec.signal_key not in confirmed_assigned:
                c = None
                if pl["period"] is not None:
                    c = verify_ephemeris_match(
                        rec.period_days,
                        rec.epoch_bkjd,
                        rec.duration_hours,
                        pl["period"],
                        pl["epoch_bkjd"],
                        pl["duration"],
                        require_epoch=False,
                    )
                attach(rec, pl, "koi_name", c)
            else:
                pending.append(pl)
        # Pass 2: same star, period within 1 % (and epoch when available).
        for pl in pending:
            if pl["period"] is None:
                best = None
            else:
                cands = []
                for rec in by_kepid.get(pl["kepid"], []):
                    if rec.signal_key in confirmed_assigned:
                        continue
                    if rec.kepler_name and rec.kepler_name != pl["kepler_name"]:
                        continue
                    c = verify_ephemeris_match(
                        rec.period_days,
                        rec.epoch_bkjd,
                        rec.duration_hours,
                        pl["period"],
                        pl["epoch_bkjd"],
                        pl["duration"],
                        require_epoch=pl["epoch_bkjd"] is not None,
                    )
                    if c.ok:
                        cands.append((c.score, rec.signal_key, rec, c))
                best = min(cands, key=lambda x: (x[0], x[1])) if cands else None
            if best is not None:
                attach(best[2], pl, "kepid_period", best[3])
                continue
            # Unmatched: own PL- row (transiting planets with a usable ephemeris only).
            if pl["tran_flag"] != 1:
                stats["skipped"]["confirmed_non_transiting"] += 1
                continue
            if pl["period"] is None or pl["epoch_bkjd"] is None or pl["duration"] is None:
                stats["skipped"]["confirmed_no_ephemeris"] += 1
                continue
            s = sid.get("confirmed")
            key = "PL-" + pl["kepler_name"].replace(" ", "_")
            rec = SignalRecord(
                signal_key=key,
                kepid=pl["kepid"],
                primary_source="confirmed",
                period_days=pl["period"],
                epoch_bkjd=pl["epoch_bkjd"],
                duration_hours=pl["duration"],
                depth_ppm=pl["depth_ppm"],
                planet_radius_re=pl["prad"],
                kepler_name=pl["kepler_name"],
                match_status="confirmed_only",
            )
            rec.provenance = {
                "period_days": _prov(t_conf, "pl_orbper", s, pl["period"]),
                "epoch_bkjd": _prov(
                    t_conf,
                    "pl_tranmid",
                    s,
                    pl["tranmid_bjd"],
                    converted="BKJD = BJD - 2454833.0",
                    time_system_ref=pl["systemref"],
                ),
                "duration_hours": _prov(t_conf, "pl_trandur", s, pl["duration"]),
                "depth_ppm": _prov(t_conf, "pl_trandep", s, pl["depth_pct"], converted="ppm = percent x 1e4"),
                "planet_radius_re": _prov(t_conf, "pl_rade", s, pl["prad"]),
            }
            records[key] = rec
            by_kepid[pl["kepid"]].append(rec)
            attach(rec, pl, "own_row", None)  # counted as confirmed_match["own_row"]

    # ---- Stellar parameters ----------------------------------------------------------------------
    if stellar is not None:
        stats["input_rows"]["stellar"] = int(len(stellar))
        df = stellar.sort_values("kepid", kind="mergesort").drop_duplicates("kepid", keep="first")
        for row in df.itertuples(index=False):
            kepid = _i(row.kepid)
            if kepid is None:
                continue
            note_target(kepid, "teff", _f(row.teff), 1)
            note_target(kepid, "logg", _f(row.logg), 1)
            note_target(kepid, "radius", _f(row.radius), 1)
            note_target(kepid, "mass", _f(row.mass), 1)
            note_target(kepid, "kepmag", _f(row.kepmag), 1)
            note_target(kepid, "ra", _f(row.ra), 1)
            note_target(kepid, "dec", _f(row.dec), 1)
        stats["stellar_table"] = t_st

    # ---- Categories, targets ---------------------------------------------------------------------
    out = [records[k] for k in sorted(records)]
    for rec in out:
        _assign_category(rec)
    kepids = {r.kepid for r in out}
    targets = {
        kepid: {key: target_info.get(kepid, {}).get(key, (None, 0))[0] for key in _TARGET_FIELDS}
        for kepid in sorted(kepids)
    }
    stats["skipped"] = dict(stats["skipped"])
    stats["tce_koi_link"] = dict(stats["tce_koi_link"])
    stats["confirmed_match"] = dict(stats["confirmed_match"])
    return CatalogBuild(records=out, targets=targets, stats=stats)


# ------------------------------------------------------------------------------------------------
# Database writing
# ------------------------------------------------------------------------------------------------
def write_catalog(session: Session, build: CatalogBuild, *, retire_missing: bool = True) -> dict[str, Any]:
    """Upsert targets and signals from ``build``.

    Existing rows keep their primary keys (dataset examples and predictions reference
    ``signals.id``) and targets keep their light-curve status fields. Signals that are no longer in
    the catalogue are deleted when nothing references them, otherwise retired
    (``category="retired"``, ``match_status="stale"``) so they can never be labelled again.
    """
    existing_targets = {t.kepid: t for t in session.scalars(select(Target))}
    n_new_targets = 0
    for kepid, attrs in build.targets.items():
        t = existing_targets.get(kepid)
        if t is None:
            t = Target(kepid=kepid, lc_status="none", lc_quarters=[])
            session.add(t)
            n_new_targets += 1
        for key, value in attrs.items():
            if getattr(t, key) != value:
                setattr(t, key, value)
    session.flush()

    existing = {s.signal_key: s for s in session.scalars(select(Signal))}
    n_new = n_updated = n_changed = 0
    changed_fields: Counter[str] = Counter()
    new_keys = set()
    for rec in build.records:
        new_keys.add(rec.signal_key)
        row = rec.as_row()
        s = existing.get(rec.signal_key)
        if s is None:
            session.add(Signal(signal_key=rec.signal_key, **row))
            n_new += 1
            continue
        touched = data_changed = False
        for key, value in row.items():
            if getattr(s, key) != value:
                setattr(s, key, value)
                touched = True
                if key != "provenance":
                    data_changed = True
                    changed_fields[key] += 1
        n_updated += int(touched)
        n_changed += int(data_changed)
    session.flush()

    n_deleted = n_retired = 0
    stale = [s for key, s in existing.items() if key not in new_keys]
    if retire_missing and stale:
        referenced = set(session.scalars(select(DatasetExample.signal_id).distinct())) | set(
            x for x in session.scalars(select(Prediction.signal_id).distinct()) if x is not None
        )
        for s in stale:
            if s.id in referenced:
                if s.category != RETIRED_CATEGORY:
                    prov = dict(s.provenance or {})
                    prov["retired"] = {
                        "reason": "absent from latest catalogue snapshots",
                        "previous_category": s.category,
                    }
                    s.provenance = prov
                    s.category = RETIRED_CATEGORY
                    s.match_status = "stale"
                    n_retired += 1
            else:
                session.delete(s)
                n_deleted += 1
        session.flush()
    return {
        "targets_total": len(build.targets),
        "targets_new": n_new_targets,
        "signals_total": len(build.records),
        "signals_new": n_new,
        "signals_updated": n_updated,  # any column incl. provenance (new snapshot ids) changed
        "signals_changed": n_changed,  # catalogue data (not just provenance) changed
        "changed_fields": dict(sorted(changed_fields.items())),
        "signals_deleted": n_deleted,
        "signals_retired": n_retired,
    }


def catalog_summary(session: Session) -> dict[str, Any]:
    """Counts of the catalogue currently in the database (categories, links, labels)."""

    def counts(col: Any) -> dict[str, int]:
        rows = session.execute(select(col, func.count()).group_by(col)).all()
        return {str(k): int(v) for k, v in sorted(rows, key=lambda r: str(r[0]))}

    return {
        "n_targets": int(session.scalar(select(func.count()).select_from(Target)) or 0),
        "n_signals": int(session.scalar(select(func.count()).select_from(Signal)) or 0),
        "categories": counts(Signal.category),
        "match_status": counts(Signal.match_status),
        "primary_source": counts(Signal.primary_source),
        "av_training_set": counts(Signal.av_training_set),
        "koi_disposition": counts(Signal.koi_disposition),
        "label_conflicts": int(
            session.scalar(select(func.count()).select_from(Signal).where(Signal.label_conflict.is_(True)))
            or 0
        ),
    }


# ------------------------------------------------------------------------------------------------
# Public entry points
# ------------------------------------------------------------------------------------------------
def _ingest(
    session: Session, frames: Mapping[str, pd.DataFrame], snapshot_ids: Mapping[str, int | None]
) -> dict:
    if frames.get("dr24_tce") is None or frames.get("koi_cumulative") is None:
        raise ValueError("catalogue ingestion needs at least the dr24_tce and koi_cumulative snapshots")
    t0 = time.perf_counter()
    build = build_catalog(
        frames.get("dr24_tce"),
        frames.get("koi_cumulative"),
        frames.get("confirmed"),
        frames.get("stellar"),
        snapshot_ids,
    )
    written = write_catalog(session, build)
    summary = catalog_summary(session)
    return {
        "snapshot_ids": dict(snapshot_ids),
        "build": build.stats,
        "written": written,
        "summary": summary,
        "ingest_seconds": round(time.perf_counter() - t0, 2),
    }


def refresh_catalog(
    session: Session,
    progress: ProgressFn | None = None,
    sources: Iterable[str] = ALL_SOURCES,
    *,
    client: ArchiveClient | None = None,
) -> dict[str, Any]:
    """Download fresh snapshots of ``sources`` and (re)ingest the whole catalogue.

    Sources not listed reuse their latest recorded snapshot (verified by SHA-256). ``dr24_tce`` and
    ``koi_cumulative`` must be available one way or the other; ``confirmed`` and ``stellar`` are
    optional. The ``stellar`` query is restricted to the kepids present in the other tables.
    ``progress(done, total, message)`` is called before each step. Each downloaded snapshot row is
    committed as soon as it is recorded: SQLite allows one writer at a time, and holding the write
    lock through the following downloads (minutes) would block every other write meanwhile (job
    progress and heartbeats, other API requests) until they fail with "database is locked". The
    ingested catalogue is committed before the final progress report.
    """
    wanted = list(dict.fromkeys(sources))
    for s in wanted:
        if s not in SOURCES:
            raise ValueError(f"unknown catalogue source {s!r}")
    client = client or ArchiveClient()
    total = len(ALL_SOURCES) + 1
    frames: dict[str, pd.DataFrame] = {}
    snapshot_ids: dict[str, int | None] = {}
    snapshots: dict[str, Any] = {}

    def report(done: int, msg: str) -> None:
        log.info("catalogue refresh [%d/%d] %s", done, total, msg)
        if progress is not None:
            progress(done, total, msg)

    for i, source in enumerate(("dr24_tce", "koi_cumulative", "confirmed")):
        if source in wanted:
            report(i, f"Downloading {source} from the NASA Exoplanet Archive")
            res = fetch_snapshot(source, client=client, session=session)
            session.commit()  # release the SQLite write lock before the next download
            frames[source], snapshot_ids[source] = res.frame, res.snapshot_id
            snapshots[source] = {**res.summary(), "reused": False}
        else:
            report(i, f"Reusing latest {source} snapshot")
            _reuse(session, source, frames, snapshot_ids, snapshots)

    kepids: set[int] = set()
    for source in ("dr24_tce", "koi_cumulative", "confirmed"):
        df = frames.get(source)
        if df is not None:
            kepids.update(int(k) for k in pd.to_numeric(df["kepid"], errors="coerce").dropna().astype(int))
    if "stellar" in wanted and kepids:
        report(3, f"Downloading stellar parameters for {len(kepids)} stars")
        res = fetch_snapshot("stellar", client=client, session=session, kepids=sorted(kepids))
        session.commit()
        frames["stellar"], snapshot_ids["stellar"] = res.frame, res.snapshot_id
        snapshots["stellar"] = {**res.summary(), "reused": False}
    else:
        report(3, "Reusing latest stellar snapshot")
        _reuse(session, "stellar", frames, snapshot_ids, snapshots)

    report(4, "Linking TCEs, KOIs and confirmed planets")
    result = _ingest(session, frames, snapshot_ids)
    session.commit()  # the final progress update below must not wait for the ingest's write lock
    result["snapshots"] = snapshots
    summary = result["summary"]
    report(total, f"Catalogue ready: {summary['n_signals']} signals on {summary['n_targets']} stars")
    return result


def _reuse(
    session: Session,
    source: str,
    frames: dict[str, pd.DataFrame],
    snapshot_ids: dict[str, int | None],
    snapshots: dict[str, Any],
) -> None:
    snap = latest_snapshot(session, source)
    if snap is None:
        snapshots[source] = {"source": source, "available": False}
        return
    frames[source] = load_snapshot_frame(snap)
    snapshot_ids[source] = snap.id
    snapshots[source] = {
        "source": source,
        "snapshot_id": snap.id,
        "rows": snap.row_count,
        "sha256": snap.sha256,
        "path": snap.file_path,
        "retrieved_at": snap.retrieved_at.isoformat() if snap.retrieved_at else None,
        "reused": True,
    }


def ingest_from_files(
    session: Session, paths: Mapping[str, str | Path] | Iterable[str | Path]
) -> dict[str, Any]:
    """Ingest catalogue CSV files already on disk (offline use and tests).

    ``paths`` maps source name → CSV path, or is an iterable of paths whose file names start with
    the source name (``dr24_tce_*.csv``, ``koi_cumulative_*.csv``, ``confirmed_*.csv``,
    ``stellar_*.csv`` — the names :func:`~exofinder.data.archive.fetch_snapshot` produces). Each file
    is validated and recorded as a :class:`CatalogSnapshot` (with its SHA-256) before ingestion.
    """
    mapping: dict[str, Path] = {}
    if isinstance(paths, Mapping):
        mapping = {str(k): Path(v) for k, v in paths.items()}
    else:
        for p in paths:
            p = Path(p)
            source = next((s for s in sorted(SOURCES, key=len, reverse=True) if p.name.startswith(s)), None)
            if source is None:
                raise ValueError(f"cannot infer catalogue source from file name {p.name!r}")
            if source in mapping and mapping[source] != p:
                raise ValueError(
                    f"two files for catalogue source {source!r}: {mapping[source].name}, {p.name}"
                )
            mapping[source] = p
    # Check the request before recording anything: a bad call must not leave snapshot rows behind.
    unknown = set(mapping) - set(SOURCES)
    if unknown:
        raise ValueError(f"unknown catalogue sources: {sorted(unknown)}")
    if "dr24_tce" not in mapping or "koi_cumulative" not in mapping:
        raise ValueError("catalogue ingestion needs at least the dr24_tce and koi_cumulative snapshots")
    frames: dict[str, pd.DataFrame] = {}
    snapshot_ids: dict[str, int | None] = {}
    snapshots: dict[str, Any] = {}
    for source in ALL_SOURCES:
        if source not in mapping:
            continue
        res = register_snapshot_file(source, mapping[source], session=session)
        frames[source], snapshot_ids[source] = res.frame, res.snapshot_id
        snapshots[source] = {**res.summary(), "reused": False}
    result = _ingest(session, frames, snapshot_ids)
    result["snapshots"] = snapshots
    return result
