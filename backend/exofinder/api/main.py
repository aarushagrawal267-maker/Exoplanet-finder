"""FastAPI application factory.

Routers are discovered automatically: every module in ``exofinder.api.routers`` that defines a
module-level ``router`` (an ``APIRouter`` whose prefix starts with ``/api``) is included.
"""

from __future__ import annotations

import importlib
import logging
import pkgutil
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from exofinder import __version__
from exofinder.api.errors import install_error_handlers
from exofinder.config import PIPELINE_VERSION, get_settings
from exofinder.db import init_db

log = logging.getLogger("exofinder")


def _include_routers(app: FastAPI) -> list[str]:
    import exofinder.api.routers as routers_pkg

    names = []
    for mod in sorted(pkgutil.iter_modules(routers_pkg.__path__), key=lambda m: m.name):
        if mod.name.startswith("_"):
            continue
        module = importlib.import_module(f"exofinder.api.routers.{mod.name}")
        router = getattr(module, "router", None)
        if router is not None:
            app.include_router(router)
            names.append(mod.name)
    return names


@asynccontextmanager
async def lifespan(app: FastAPI):
    from exofinder.jobs.runner import get_runner, mark_interrupted_jobs

    settings = get_settings()
    settings.ensure_dirs()
    init_db()
    n = mark_interrupted_jobs()
    if n:
        log.warning("Marked %d interrupted job(s) as failed", n)
    from exofinder.services.app_settings import apply_overrides

    apply_overrides()
    get_runner()
    yield
    get_runner().shutdown(wait=False)


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(
        level=settings.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    app = FastAPI(
        title="Exoplanet Finder API",
        version=__version__,
        description=(
            "AI-powered classification of NASA Kepler transit-like signals. Planet-like predictions are "
            "research leads, not confirmed discoveries."
        ),
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)

    @app.get("/api/health", tags=["system"])
    def health() -> dict:
        return {"status": "ok", "version": __version__, "pipeline_version": PIPELINE_VERSION}

    app.state.routers = _include_routers(app)
    return app


app = create_app()
