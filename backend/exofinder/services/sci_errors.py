"""Service-layer error type for the science/interactive services.

Services must not import :mod:`exofinder.api` (dependency rule ``api -> services``), so they raise
:class:`ServiceError` carrying the HTTP status, a machine-readable ``code`` and a user-facing
``hint``. The science routers convert it into :class:`exofinder.api.errors.ApiError` (see
``exofinder/api/routers/_sci_route.py``), so clients always receive ``{detail, code, hint}``.
"""

from __future__ import annotations


class ServiceError(Exception):
    """A request that cannot be served, with the HTTP status and a hint on how to fix it."""

    def __init__(self, status_code: int, detail: str, code: str | None = None, hint: str | None = None):
        super().__init__(detail)
        self.status_code = int(status_code)
        self.detail = detail
        self.code = code
        self.hint = hint


def not_found(what: str, code: str = "not_found", hint: str | None = None) -> ServiceError:
    """404 ``"<what> not found"``."""
    return ServiceError(404, f"{what} not found", code, hint)


def bad_request(detail: str, code: str = "bad_request", hint: str | None = None) -> ServiceError:
    """400 for input the user can correct."""
    return ServiceError(400, detail, code, hint)


def conflict(detail: str, code: str = "conflict", hint: str | None = None) -> ServiceError:
    """409 for a request that conflicts with the current state (e.g. data not downloaded yet)."""
    return ServiceError(409, detail, code, hint)


NOT_DOWNLOADED_HINT = (
    "Download the star's light curve first (POST /api/targets/{kepid}/download, or the Download button "
    "on the target page), then try again."
)


def not_downloaded(kepid: int) -> ServiceError:
    """404 ``code=not_downloaded`` for a catalogue star without a cached light curve."""
    return ServiceError(
        404,
        f"No light curve has been downloaded for KIC {kepid}",
        "not_downloaded",
        NOT_DOWNLOADED_HINT.replace("{kepid}", str(kepid)),
    )
