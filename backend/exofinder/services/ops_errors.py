"""Errors raised by the operations services (datasets, training, models, evaluation, experiments).

Services may not import :mod:`exofinder.api` (dependency rule), so they raise :class:`OpsError`,
which carries everything the API layer needs to build its ``{detail, code, hint}`` error body. The
routers translate it into :class:`exofinder.api.errors.ApiError`; the CLI prints ``detail`` and
``hint`` and exits with a non-zero code.
"""

from __future__ import annotations


class OpsError(Exception):
    """A user-facing failure: HTTP-like ``status_code``, machine-readable ``code`` and a ``hint``."""

    def __init__(self, status_code: int, detail: str, code: str, hint: str | None = None) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code
        self.hint = hint

    def __str__(self) -> str:
        return self.detail if not self.hint else f"{self.detail} (hint: {self.hint})"


def not_found(what: str, code: str, hint: str | None = None) -> OpsError:
    """404 error for a missing resource."""
    return OpsError(404, f"{what} not found", code, hint)


def conflict(detail: str, code: str, hint: str | None = None) -> OpsError:
    """409 error: the request conflicts with the current state."""
    return OpsError(409, detail, code, hint)


def bad_request(detail: str, code: str, hint: str | None = None) -> OpsError:
    """400 error: the request is well-formed but its values cannot be used."""
    return OpsError(400, detail, code, hint)
