"""Exceptions raised by the astronomy pipeline.

Both derive from :class:`ValueError` so generic callers can catch bad input uniformly, while the API
layer can map them to user-facing messages (the ``str()`` of each exception is written to be shown
to a user as-is).
"""

from __future__ import annotations


class LightCurveFormatError(ValueError):
    """The input file/table cannot be interpreted as a light curve (bad format or bad values)."""


class InsufficientDataError(ValueError):
    """The light curve is valid but contains too little usable data for the requested operation."""


__all__ = ["InsufficientDataError", "LightCurveFormatError"]
