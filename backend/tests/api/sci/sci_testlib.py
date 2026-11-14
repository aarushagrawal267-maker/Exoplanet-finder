"""Helpers for the science/interactive API tests (TEST DATA only; see conftest.py)."""

from __future__ import annotations

import importlib.util
import time
from pathlib import Path
from typing import Any

TESTS = Path(__file__).resolve().parents[2]
FIXTURES = TESTS / "fixtures"
KEPLER2 = 10666592
KEPLER90 = 11442793
KEPLER2_FITS = [
    FIXTURES / "kplr010666592-2009259160929_llc.fits",
    FIXTURES / "kplr010666592-2009350155506_llc.fits",
]
KEPLER90_FITS = [FIXTURES / "kplr011442793-2009350155506_llc.fits"]


def _testdata_module():
    spec = importlib.util.spec_from_file_location(
        "exof_data_testdata_sci", TESTS / "unit" / "data" / "exof_data_testdata.py"
    )
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def write_catalog_files(directory: Path) -> dict[str, Path]:
    td = _testdata_module()
    directory.mkdir(parents=True, exist_ok=True)
    out = {}
    for source, text in (
        ("dr24_tce", td.TCE_CSV),
        ("koi_cumulative", td.KOI_CSV),
        ("confirmed", td.CONFIRMED_CSV),
        ("stellar", td.STELLAR_CSV),
    ):
        p = directory / f"{source}_TESTDATA.csv"
        p.write_text(text, encoding="utf-8")
        out[source] = p
    return out


def cache_star(kepid: int, fits_paths: list[Path]) -> None:
    """Stitch real FITS fixtures into the temporary light-curve cache and mark the target available."""
    from exofinder.data.lightcurve_store import build_from_fits, save_lightcurve
    from exofinder.db.models import Target, utcnow
    from exofinder.db.session import session_scope

    lc = build_from_fits(kepid, fits_paths)
    path = save_lightcurve(kepid, lc)
    with session_scope() as s:
        t = s.get(Target, kepid)
        t.lc_status = "available"
        t.lc_quarters = list(lc.meta["quarters"])
        t.lc_n_cadences = len(lc)
        t.lc_path = str(path)
        t.lc_updated_at = utcnow()


def signal_id(cat: dict[str, Any], key: str) -> int:
    return cat["signals"][key]


def wait_job(job_id: str, timeout: float = 120.0) -> dict[str, Any]:
    """Poll the Job row (no dependency on the jobs router) until it leaves queued/running."""
    from exofinder.db.models import Job
    from exofinder.db.session import session_scope

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with session_scope() as s:
            job = s.get(Job, job_id)
            if job is not None and job.status not in ("queued", "running"):
                return {
                    "status": job.status,
                    "result": job.result,
                    "error": job.error,
                    "message": job.message,
                }
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish within {timeout}s")
