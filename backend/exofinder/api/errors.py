"""API error type and handlers.

Every error response has the shape ``{"detail": str, "code": str | None, "hint": str | None}`` so
the UI can show *what happened*, a machine-readable code, and *how to fix it*.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

log = logging.getLogger("exofinder.api")


class ApiError(Exception):
    def __init__(self, status_code: int, detail: str, code: str | None = None, hint: str | None = None):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code
        self.hint = hint


def not_found(what: str, code: str = "not_found", hint: str | None = None) -> ApiError:
    return ApiError(404, f"{what} not found", code, hint)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail, "code": exc.code, "hint": exc.hint})

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        parts = []
        for e in errors[:5]:
            loc = ".".join(str(x) for x in e.get("loc", []) if x != "body")
            parts.append(f"{loc}: {e.get('msg')}" if loc else str(e.get("msg")))
        return JSONResponse(
            status_code=422,
            content={"detail": "; ".join(parts) or "Invalid request", "code": "validation_error", "hint": None, "errors": errors[:20]},
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:  # pragma: no cover - safety net
        log.exception("Unhandled error")
        return JSONResponse(
            status_code=500,
            content={"detail": f"Internal error: {type(exc).__name__}: {exc}", "code": "internal_error",
                     "hint": "See logs/backend.log for details."},
        )
