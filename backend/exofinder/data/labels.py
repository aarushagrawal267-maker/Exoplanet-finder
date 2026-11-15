"""Training-label definitions.

A *label mode* maps a published catalogue disposition onto the binary target used for training:
``1`` = planet-like transit signal, ``0`` = false-positive-like signal. Signals whose disposition is
undecided are *excluded* (``label_for`` returns ``None``) and :func:`exclusion_reason` explains why.

``astronet_dr24`` (default; Shallue & Vanderburg 2018)
    Uses the DR24 Autovetter training set ``av_training_set`` attached to each Threshold-Crossing
    Event: PC (planet candidate) → 1; AFP (astrophysical false positive, e.g. eclipsing binary) and
    NTP (non-transiting phenomenon, e.g. instrumental artefact or stellar variability) → 0;
    UNK (not part of the training set) or no TCE → excluded.

``koi_disposition``
    Uses the cumulative KOI table disposition: CONFIRMED → 1, FALSE POSITIVE → 0,
    CANDIDATE (not yet resolved) → excluded. Signals with no KOI disposition (TCE-only rows, and
    confirmed planets that never had a KOI such as Kepler-90 i) are excluded: the mode is defined
    on the KOI vetting outcome only, and mixing in other sources would change its meaning.

Labels are read from raw published values; catalogue scores (``koi_score``, fp flags,
``koi_pdisposition``) are never used here or as model features.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

#: Category given by the catalogue ingester to rows that disappeared from a later catalogue
#: refresh but are still referenced by datasets/predictions; never labelled.
RETIRED_CATEGORY = "retired"


@dataclass(frozen=True)
class LabelMode:
    """Definition of one binary labelling scheme."""

    name: str
    title: str
    description: str
    field: str  # Signal attribute holding the raw catalogue value
    positive: frozenset[str]
    negative: frozenset[str]
    excluded: dict[str, str]  # raw value -> exclusion reason code
    missing_reason: str  # reason code when the field is empty


LABEL_MODES: dict[str, LabelMode] = {
    "astronet_dr24": LabelMode(
        name="astronet_dr24",
        title="AstroNet DR24 Autovetter labels",
        description=(
            "DR24 TCE av_training_set: PC -> planet-like (1); AFP, NTP -> false-positive-like (0); "
            "UNK or no TCE -> excluded (Shallue & Vanderburg 2018)."
        ),
        field="av_training_set",
        positive=frozenset({"PC"}),
        negative=frozenset({"AFP", "NTP"}),
        excluded={"UNK": "av_unknown"},
        missing_reason="no_av_label",
    ),
    "koi_disposition": LabelMode(
        name="koi_disposition",
        title="KOI cumulative dispositions",
        description=(
            "Cumulative KOI disposition: CONFIRMED -> planet-like (1); FALSE POSITIVE -> "
            "false-positive-like (0); CANDIDATE or no KOI -> excluded."
        ),
        field="koi_disposition",
        positive=frozenset({"CONFIRMED"}),
        negative=frozenset({"FALSE POSITIVE"}),
        excluded={"CANDIDATE": "koi_candidate", "NOT DISPOSITIONED": "koi_not_dispositioned"},
        missing_reason="no_koi_disposition",
    ),
}

DEFAULT_LABEL_MODE = "astronet_dr24"

#: Human-readable explanations for exclusion reason codes (for UI / dataset reports).
EXCLUSION_REASONS: dict[str, str] = {
    "av_unknown": "Autovetter label UNK: the TCE was not part of the DR24 training set",
    "no_av_label": "No DR24 TCE / Autovetter label for this signal",
    "koi_candidate": "KOI is still a CANDIDATE (undecided)",
    "koi_not_dispositioned": "KOI has not been dispositioned",
    "no_koi_disposition": "Signal has no KOI disposition",
    "unexpected_value": "Catalogue value not recognised by this label mode",
    "label_conflict": "Autovetter label and KOI disposition disagree (excluded on request)",
    "retired": "Signal no longer present in the latest catalogue snapshot",
}


def get_label_mode(mode: str) -> LabelMode:
    try:
        return LABEL_MODES[mode]
    except KeyError:
        raise ValueError(f"unknown label mode {mode!r}; expected one of {sorted(LABEL_MODES)}") from None


def _get(signal: Any, name: str) -> Any:
    if isinstance(signal, Mapping):
        return signal.get(name)
    return getattr(signal, name, None)


def _raw_value(signal: Any, mode: LabelMode) -> str | None:
    value = _get(signal, mode.field)
    if value is None:
        return None
    if isinstance(value, float) and value != value:  # NaN from pandas
        return None
    text = str(value).strip().upper()
    return text or None


def exclusion_reason(signal: Any, mode: str, *, exclude_label_conflicts: bool = False) -> str | None:
    """Reason code why ``signal`` has no label under ``mode``; ``None`` if it is labelled.

    ``signal`` may be a :class:`~exofinder.db.models.Signal` or any mapping/object exposing the
    same attribute names (``av_training_set``, ``koi_disposition``, ``category``,
    ``label_conflict``).
    """
    m = get_label_mode(mode)
    if _get(signal, "category") == RETIRED_CATEGORY:
        return "retired"
    value = _raw_value(signal, m)
    if value is None:
        return m.missing_reason
    if value in m.excluded:
        return m.excluded[value]
    if value not in m.positive and value not in m.negative:
        return "unexpected_value"
    if exclude_label_conflicts and bool(_get(signal, "label_conflict")):
        return "label_conflict"
    return None


def label_for(signal: Any, mode: str, *, exclude_label_conflicts: bool = False) -> int | None:
    """Binary training label of ``signal`` under ``mode``: 1, 0, or ``None`` (excluded)."""
    m = get_label_mode(mode)
    if exclusion_reason(signal, mode, exclude_label_conflicts=exclude_label_conflicts) is not None:
        return None
    value = _raw_value(signal, m)
    return 1 if value in m.positive else 0
