"""Application configuration.

All settings are read from environment variables prefixed with ``EXOF_`` (or a ``.env`` file in the
repository root). No API keys are needed: every NASA service used is public.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

#: Repository root (…/Exoplanet-finder). ``backend/exofinder/config.py`` -> parents[2]
REPO_ROOT = Path(__file__).resolve().parents[2]

#: Version of the signal-processing pipeline. Bump when preprocessing output changes, so models
#: trained on one pipeline version refuse to score views from an incompatible one.
PIPELINE_VERSION = "1.0"

#: AstroNet view geometry (Shallue & Vanderburg 2018).
GLOBAL_VIEW_BINS = 2001
LOCAL_VIEW_BINS = 201
LOCAL_VIEW_NUM_DURATIONS = 4.0  # local view spans +/- 2 transit durations

#: Kepler time system: BKJD = BJD - 2454833.0
BKJD_OFFSET = 2454833.0


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="EXOF_",
        env_file=str(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    data_dir: Path = Field(default=REPO_ROOT / "data")
    artifacts_dir: Path = Field(default=REPO_ROOT / "artifacts")
    db_url: str = ""
    device: str = "auto"  # auto | cpu | cuda
    download_workers: int = 4
    keep_raw_fits: bool = False
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    log_level: str = "INFO"
    http_timeout: float = 60.0

    archive_tap_url: str = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
    mast_download_url: str = "https://mast.stsci.edu/api/v0.1/Download/file"

    # ---- derived paths -------------------------------------------------------------------------
    def _abs(self, p: Path) -> Path:
        return p if p.is_absolute() else (REPO_ROOT / p).resolve()

    @property
    def data_path(self) -> Path:
        return self._abs(self.data_dir)

    @property
    def artifacts_path(self) -> Path:
        return self._abs(self.artifacts_dir)

    @property
    def catalogs_dir(self) -> Path:
        return self.data_path / "catalogs"

    @property
    def raw_dir(self) -> Path:
        """Raw Kepler FITS files: raw/kepler/<kic9>/kplr<kic9>-<stamp>_llc.fits"""
        return self.data_path / "raw" / "kepler"

    @property
    def lightcurves_dir(self) -> Path:
        """Compact stitched light-curve cache: lightcurves/<kic9>.npz"""
        return self.data_path / "lightcurves"

    @property
    def views_dir(self) -> Path:
        """Per-signal processed view cache: views/v<PIPELINE_VERSION>/<signal_key>.npz"""
        return self.data_path / "views" / f"v{PIPELINE_VERSION}"

    @property
    def datasets_dir(self) -> Path:
        """Consolidated dataset builds: datasets/<dataset_id>/{arrays.npz,manifest.json}"""
        return self.data_path / "datasets"

    @property
    def uploads_dir(self) -> Path:
        return self.data_path / "uploads"

    @property
    def models_dir(self) -> Path:
        return self.artifacts_path / "models"

    @property
    def reports_dir(self) -> Path:
        return self.artifacts_path / "reports"

    @property
    def database_url(self) -> str:
        return self.db_url or f"sqlite:///{(self.data_path / 'app.db').as_posix()}"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def ensure_dirs(self) -> None:
        for d in (
            self.data_path,
            self.catalogs_dir,
            self.raw_dir,
            self.lightcurves_dir,
            self.views_dir,
            self.datasets_dir,
            self.uploads_dir,
            self.models_dir,
            self.reports_dir,
        ):
            d.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()


def kic9(kepid: int | str) -> str:
    """Zero-padded 9-digit Kepler Input Catalog identifier."""
    return f"{int(kepid):09d}"
