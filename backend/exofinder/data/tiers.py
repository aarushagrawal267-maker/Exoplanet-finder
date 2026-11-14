"""Dataset tiers: which signals to download and process for a training set.

A tier picks **whole stars**: if a star is selected, every labelled signal on it is selected. The
later train/validation/test split is also made per star (:func:`exofinder.ml.splits.star_level_split`),
so signals of one star can never end up on both sides of a split (multi-planet systems share
stellar noise and systematics, which would otherwise leak information).

Tiers: ``pilot`` ≈ 300 labelled signals (quick end-to-end run), ``standard`` ≈ 3 000, ``full`` =
every labelled signal. Pilot and standard are class-balanced where possible: stars are visited in
a seeded random order and the next star is taken from the class (planet-like or false-positive-
like majority) that is currently under-represented, until the target size is reached. The result
is deterministic for a given catalogue, label mode and seed.

The reserved showcase systems (:data:`RESERVED_SHOWCASE_KEPIDS`) are always included — all their
signals, labelled or not, so they can be demonstrated — and the split code forces them into the
test split, so no model is ever trained on them.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from exofinder.data.labels import RETIRED_CATEGORY, get_label_mode, label_for
from exofinder.db.models import Signal

#: Showcase multi-planet systems, reserved for the test split. KIC ids verified on 2026-11-14
#: against the NASA Exoplanet Archive ``keplernames`` table (kepid ↔ Kepler name).
RESERVED_SHOWCASE_KEPIDS: dict[int, str] = {
    11442793: "Kepler-90",  # 8 planets; Kepler-90 i found by AstroNet (Shallue & Vanderburg 2018)
    4852528: "Kepler-80",  # 6 planets; Kepler-80 g found by AstroNet
    6541920: "Kepler-11",  # 6 planets
    8120608: "Kepler-186",  # 5 planets incl. habitable-zone Kepler-186 f
    8311864: "Kepler-452",  # Kepler-452 b, Earth-size habitable-zone candidate
}

#: Approximate number of labelled signals per tier (``None`` = all).
TIER_SIZES: dict[str, int | None] = {"pilot": 300, "standard": 3000, "full": None}


@dataclass(frozen=True)
class StarCounts:
    kepid: int
    n_pos: int
    n_neg: int

    @property
    def n(self) -> int:
        return self.n_pos + self.n_neg


@dataclass
class TierPlan:
    """Result of :func:`plan_tier_stars` (pure function, no database)."""

    kepids: list[int]
    n_pos: int
    n_neg: int
    reserved: list[int] = field(default_factory=list)


def plan_tier_stars(
    stars: Sequence[StarCounts],
    target: int | None,
    seed: int = 42,
    reserved: Iterable[int] = (),
) -> TierPlan:
    """Choose whole stars so that ≈``target`` labelled signals are selected, class-balanced.

    ``stars`` lists the labelled-signal counts per star. Reserved stars are always included first.
    For ``target=None`` every star is selected. Otherwise the remaining stars are shuffled with
    ``np.random.default_rng(seed)`` (after sorting by kepid, so the order is reproducible) and
    split into planet-majority and false-positive-majority queues (ties go to a third queue); the
    next star comes from the queue of the currently rarer class until the target is reached.
    """
    reserved_set = {int(k) for k in reserved}
    by_id = {s.kepid: s for s in stars}
    chosen: list[int] = [k for k in sorted(reserved_set) if k in by_id]
    n_pos = sum(by_id[k].n_pos for k in chosen)
    n_neg = sum(by_id[k].n_neg for k in chosen)
    rest = sorted((s for s in stars if s.kepid not in reserved_set and s.n > 0), key=lambda s: s.kepid)
    if target is None:
        for s in rest:
            chosen.append(s.kepid)
            n_pos += s.n_pos
            n_neg += s.n_neg
        return TierPlan(kepids=chosen, n_pos=n_pos, n_neg=n_neg, reserved=sorted(reserved_set & set(by_id)))
    rng = np.random.default_rng(seed)
    order = [rest[i] for i in rng.permutation(len(rest))]
    pos_q = [s for s in order if s.n_pos > s.n_neg]
    neg_q = [s for s in order if s.n_neg > s.n_pos]
    tie_q = [s for s in order if s.n_pos == s.n_neg]
    queues = {"pos": pos_q, "neg": neg_q, "tie": tie_q}
    idx = {"pos": 0, "neg": 0, "tie": 0}

    def take(name: str) -> StarCounts | None:
        q = queues[name]
        if idx[name] < len(q):
            idx[name] += 1
            return q[idx[name] - 1]
        return None

    while n_pos + n_neg < target:
        if n_pos < n_neg:
            prefs = ("pos", "tie", "neg")
        elif n_neg < n_pos:
            prefs = ("neg", "tie", "pos")
        else:
            prefs = ("tie", "pos", "neg")
        star = None
        for name in prefs:
            star = take(name)
            if star is not None:
                break
        if star is None:
            break  # every star used
        chosen.append(star.kepid)
        n_pos += star.n_pos
        n_neg += star.n_neg
    return TierPlan(kepids=chosen, n_pos=n_pos, n_neg=n_neg, reserved=sorted(reserved_set & set(by_id)))


def select_signals_for_tier(
    session: Session,
    tier: str,
    label_mode: str,
    seed: int = 42,
    reserved_kepids: Iterable[int] | None = None,
    *,
    target_size: int | None = None,
    include_unlabelled_reserved: bool = True,
) -> list[Signal]:
    """Signals to process for ``tier`` under ``label_mode`` (see module docstring).

    Returns every labelled signal of the selected stars plus, for reserved stars, all their
    non-retired signals (``include_unlabelled_reserved``), ordered by ``(kepid, signal_key)``.
    ``target_size`` overrides the tier's default size (``tier="custom"`` requires it).
    """
    get_label_mode(label_mode)  # validates the mode name
    if tier not in TIER_SIZES and tier != "custom":
        raise ValueError(f"unknown tier {tier!r}; expected one of {sorted(TIER_SIZES)} or 'custom'")
    if tier == "custom" and target_size is None:
        raise ValueError("tier 'custom' needs target_size")
    target = target_size if target_size is not None else TIER_SIZES.get(tier)
    if target is not None and (isinstance(target, bool) or int(target) != target or target < 1):
        raise ValueError(f"target_size must be a positive integer, got {target_size!r}")
    reserved = set(RESERVED_SHOWCASE_KEPIDS if reserved_kepids is None else (int(k) for k in reserved_kepids))

    signals = list(session.scalars(select(Signal).where(Signal.category != RETIRED_CATEGORY)))
    labelled_by_star: dict[int, list[Signal]] = defaultdict(list)
    all_by_star: dict[int, list[Signal]] = defaultdict(list)
    pos: dict[int, int] = defaultdict(int)
    neg: dict[int, int] = defaultdict(int)
    for s in signals:
        all_by_star[s.kepid].append(s)
        y = label_for(s, label_mode)
        if y is None:
            continue
        labelled_by_star[s.kepid].append(s)
        if y == 1:
            pos[s.kepid] += 1
        else:
            neg[s.kepid] += 1
    stars = [StarCounts(k, pos[k], neg[k]) for k in sorted(labelled_by_star)]
    stars += [StarCounts(k, 0, 0) for k in sorted(reserved) if k in all_by_star and k not in labelled_by_star]
    plan = plan_tier_stars(stars, target, seed=seed, reserved=reserved)
    out: list[Signal] = []
    for kepid in plan.kepids:
        if kepid in reserved and include_unlabelled_reserved:
            out.extend(all_by_star.get(kepid, []))
        else:
            out.extend(labelled_by_star.get(kepid, []))
    out.sort(key=lambda s: (s.kepid, s.signal_key))
    return out
