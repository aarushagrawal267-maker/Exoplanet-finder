"""Resolve an analysis/prediction *source* (a catalogue star or a parsed upload) to a light curve.

Request bodies name a source as ``{"type": "catalog", "kepid": ...}`` or
``{"type": "upload", "upload_id": ...}``. :func:`load_source` returns the raw (un-cleaned) light curve
plus everything the services need to label results honestly: a cache key that changes when the
underlying file changes, the time system, the catalogue target (for stellar parameters) and the
out-of-distribution warnings of uploads.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from exofinder.astro.types import LightCurve
from exofinder.data.lightcurve_store import lightcurve_path, load_lightcurve
from exofinder.db.models import Target
from exofinder.services import uploads
from exofinder.services.sci_common import file_signature
from exofinder.services.sci_errors import bad_request, not_downloaded


@dataclass
class SourceData:
    """A loaded light-curve source."""

    kind: str  # catalog | upload
    lc: LightCurve
    cache_key: tuple
    time_system: str
    input_name: str
    kepid: int | None = None
    upload_id: str | None = None
    upload_kind: str | None = None  # fits | csv (uploads only)
    target: Target | None = None
    warnings: list[str] = field(default_factory=list)
    upload_meta: dict[str, Any] | None = None

    @property
    def prediction_source_type(self) -> str:
        """``Prediction.source_type``: catalog | fits | csv."""
        return "catalog" if self.kind == "catalog" else (self.upload_kind or "csv")

    def describe(self) -> dict[str, Any]:
        """JSON summary of the source for responses."""
        return {
            "type": self.kind,
            "kepid": self.kepid,
            "upload_id": self.upload_id,
            "upload_kind": self.upload_kind,
            "input_name": self.input_name,
            "time_system": self.time_system,
            "n_cadences": len(self.lc),
        }


def load_catalog_source(session: Session, kepid: int, missing_status: int = 404) -> SourceData:
    """Cached light curve of a catalogue star (``not_downloaded`` error when absent)."""
    kepid = int(kepid)
    lc = load_lightcurve(kepid)
    if lc is None:
        err = not_downloaded(kepid)
        err.status_code = missing_status
        raise err
    target = session.get(Target, kepid)
    sig = file_signature(lightcurve_path(kepid))
    warnings: list[str] = []
    failed = lc.meta.get("failed_quarters") or []
    if failed:
        warnings.append(
            f"Partial download: quarters {', '.join(map(str, failed))} failed and are missing; re-download "
            "the star to retry them."
        )
    label = f"KIC {kepid}"
    if target is not None and target.kepler_host_name:
        label = f"{target.kepler_host_name} (KIC {kepid})"
    return SourceData(
        kind="catalog",
        lc=lc,
        cache_key=("catalog", kepid, sig),
        time_system=str(lc.meta.get("time_system") or "BKJD"),
        input_name=label,
        kepid=kepid,
        target=target,
        warnings=warnings,
    )


def load_upload_source(session: Session, upload_id: str, missing_status: int = 409) -> SourceData:
    """Parsed light curve of an upload (``upload_not_parsed`` error when not parsed yet)."""
    lc, meta = uploads.load_parsed(upload_id, missing_status=missing_status)
    parsed_path = uploads.upload_dir(upload_id) / uploads.PARSED_FILE
    kepid = lc.meta.get("kepid")
    target = session.get(Target, int(kepid)) if kepid is not None else None
    return SourceData(
        kind="upload",
        lc=lc,
        cache_key=("upload", upload_id, file_signature(parsed_path)),
        time_system=str(lc.meta.get("time_system") or "unknown"),
        input_name=str(meta.get("filename") or upload_id),
        kepid=int(kepid) if kepid is not None else None,
        upload_id=upload_id,
        upload_kind=str(meta.get("kind")),
        target=target,
        warnings=list((meta.get("parsed") or {}).get("warnings") or []),
        upload_meta=meta,
    )


def load_source(session: Session, source: dict[str, Any], missing_status: int = 409) -> SourceData:
    """Dispatch on ``source["type"]``."""
    kind = source.get("type")
    if kind == "catalog":
        if source.get("kepid") is None:
            raise bad_request("A catalogue source needs a kepid.", "invalid_source")
        return load_catalog_source(session, int(source["kepid"]), missing_status=missing_status)
    if kind == "upload":
        if not source.get("upload_id"):
            raise bad_request("An upload source needs an upload_id.", "invalid_source")
        return load_upload_source(session, str(source["upload_id"]), missing_status=missing_status)
    raise bad_request(f"Unknown source type {kind!r}", "invalid_source", "Use 'catalog' or 'upload'.")
