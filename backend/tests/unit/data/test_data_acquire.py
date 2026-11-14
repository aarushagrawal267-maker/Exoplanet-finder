"""Acquisition orchestration with a mocked downloader (serves the real fixture FITS files)."""

from __future__ import annotations

import shutil
import threading

import pytest
from exof_data_testdata import KEPLER2_Q2, KEPLER2_Q3, KEPLER90_Q3

from exofinder.data.acquire import (
    AcquisitionCancelled,
    LightCurveUnavailableError,
    acquire_lightcurve,
    download_many,
    ensure_lightcurve,
    raw_dir_for,
)
from exofinder.data.lightcurve_store import has_lightcurve
from exofinder.data.mast import DownloadResult
from exofinder.db.models import Target

FIXTURE_FILES = {10666592: [(2, KEPLER2_Q2), (3, KEPLER2_Q3)], 11442793: [(3, KEPLER90_Q3)]}


class FakeDownloader:
    """Copies fixture files into dest (like a successful MAST download); thread-safe call log."""

    def __init__(self, errors=None):
        self.calls: list[int] = []
        self.lock = threading.Lock()
        self.errors = errors or {}

    def __call__(self, kepid, dest, timeout=None, cancel=None):
        with self.lock:
            self.calls.append(kepid)
        if kepid in self.errors:
            return DownloadResult(kepid=kepid, errors=[self.errors[kepid]], failed_quarters=[1])
        res = DownloadResult(kepid=kepid)
        dest.mkdir(parents=True, exist_ok=True)
        for q, src in FIXTURE_FILES.get(kepid, []):
            p = dest / src.name
            shutil.copyfile(src, p)
            res.files.append((q, p))
            res.downloaded += 1
        if not res.files:
            res.missing_quarters = list(range(18))
        return res


def test_ensure_downloads_builds_cache_and_updates_target(db_session):
    dl = FakeDownloader()
    lc = ensure_lightcurve(db_session, 10666592, downloader=dl)
    assert dl.calls == [10666592] and lc.meta["quarters"] == [2, 3]
    t = db_session.get(Target, 10666592)
    assert t.lc_status == "available" and t.lc_quarters == [2, 3] and t.lc_n_cadences == len(lc)
    assert t.lc_path.endswith("010666592.npz") and t.lc_error is None and t.lc_updated_at is not None
    assert not raw_dir_for(10666592).exists()  # keep_raw_fits=false -> raw files removed
    # second call is served from the cache without downloading
    lc2 = ensure_lightcurve(db_session, 10666592, downloader=dl)
    assert dl.calls == [10666592] and len(lc2) == len(lc)


def test_keep_raw_fits_setting(db_session, monkeypatch):
    from exofinder.config import get_settings

    monkeypatch.setenv("EXOF_KEEP_RAW_FITS", "true")
    get_settings.cache_clear()
    ensure_lightcurve(db_session, 11442793, downloader=FakeDownloader())
    assert (raw_dir_for(11442793) / KEPLER90_Q3.name).is_file()


def test_no_data_and_error(db_session):
    with pytest.raises(LightCurveUnavailableError) as ei:
        ensure_lightcurve(db_session, 1234567, downloader=FakeDownloader())
    assert ei.value.status == "no_data"
    t = db_session.get(Target, 1234567)  # created on demand
    assert t.lc_status == "no_data" and t.lc_quarters == []
    with pytest.raises(LightCurveUnavailableError) as ei:
        ensure_lightcurve(db_session, 7654321, downloader=FakeDownloader(errors={7654321: "Q1: HTTP 500"}))
    assert ei.value.status == "error"
    assert db_session.get(Target, 7654321).lc_error == "Q1: HTTP 500"


def test_downloader_exception_is_contained(tmp_env):
    def boom(*a, **k):
        raise OSError("disk full")

    out = acquire_lightcurve(10666592, downloader=boom)
    assert out.status == "error" and "disk full" in out.error


def test_cancelled_before_start(db_session):
    ev = threading.Event()
    ev.set()
    with pytest.raises(AcquisitionCancelled):
        ensure_lightcurve(db_session, 10666592, cancel=ev, downloader=FakeDownloader())
    assert db_session.get(Target, 10666592).lc_status == "none"
    assert not has_lightcurve(10666592)


def test_force_redownloads(db_session):
    dl = FakeDownloader()
    ensure_lightcurve(db_session, 11442793, downloader=dl)
    ensure_lightcurve(db_session, 11442793, downloader=dl, force=True)
    assert dl.calls == [11442793, 11442793]


def test_download_many(db_session):
    dl = FakeDownloader(errors={2222222: "Q5: timeout"})
    events = []
    res = download_many(
        [10666592, 11442793, 1111111, 2222222, 10666592],
        workers=3,
        progress=lambda d, t, m: events.append((d, t, m)),
        session=db_session,
        downloader=dl,
    )
    assert res["total"] == 4 and res["available"] == 2 and res["no_data"] == 1 and res["error"] == 1
    assert sorted(dl.calls) == [1111111, 2222222, 10666592, 11442793]
    assert [e[0] for e in events] == [1, 2, 3, 4] and all(e[1] == 4 for e in events)
    statuses = {k: db_session.get(Target, k).lc_status for k in (10666592, 11442793, 1111111, 2222222)}
    assert statuses == {10666592: "available", 11442793: "available", 1111111: "no_data", 2222222: "error"}
    # rerun: everything already cached is skipped without network
    res2 = download_many([10666592, 11442793], workers=2, session=db_session, downloader=dl)
    assert res2["cached"] == 2 and len(dl.calls) == 4


def test_download_many_cancel(db_session):
    ev = threading.Event()
    ev.set()
    dl = FakeDownloader()
    res = download_many([10666592, 11442793], workers=2, cancel=ev, session=db_session, downloader=dl)
    assert res["cancelled"] == 2 and dl.calls == [] and res["cancelled_requested"]
    assert {db_session.get(Target, k).lc_status for k in (10666592, 11442793)} == {"none"}


def test_concurrent_requests_for_one_star_are_serialised(tmp_env):
    """An API request and a bulk job asking for the same star must not race.

    Regression: both downloaded into the same raw directory; the first to finish deleted the FITS
    files (keep_raw_fits=false) while the second was still stitching them -> FileNotFoundError.
    """
    import time

    entered = threading.Event()
    inner = FakeDownloader()

    def slow(kepid, dest, timeout=None, cancel=None):
        entered.set()
        res = inner(kepid, dest, timeout, cancel)
        time.sleep(0.2)  # the second caller arrives while this download is in progress
        return res

    outcomes = {}

    def run(name):
        outcomes[name] = acquire_lightcurve(10666592, downloader=slow)

    a = threading.Thread(target=run, args=("a",))
    a.start()
    assert entered.wait(5)
    b = threading.Thread(target=run, args=("b",))
    b.start()
    a.join(10)
    b.join(10)
    assert inner.calls == [10666592]  # downloaded once
    assert outcomes["a"].status == "available" and not outcomes["a"].from_cache
    assert outcomes["b"].status == "available" and outcomes["b"].from_cache
    assert outcomes["b"].n_cadences == outcomes["a"].n_cadences


class PartialDownloader(FakeDownloader):
    """Q2 arrives, Q3 fails with a (simulated) server error."""

    def __call__(self, kepid, dest, timeout=None, cancel=None):
        res = super().__call__(kepid, dest, timeout, cancel)
        res.files = [qp for qp in res.files if qp[0] == 2]
        res.downloaded = len(res.files)
        res.failed_quarters = [3]
        res.errors = ["Q3 kplr010666592-2009350155506_llc.fits: HTTP 500"]
        return res


def test_partial_download_is_never_silently_forgotten(db_session):
    """Regression: a later download_many served the partial cache with error=None and cleared lc_error."""
    from exofinder.data.lightcurve_store import load_lightcurve

    lc = ensure_lightcurve(db_session, 10666592, downloader=PartialDownloader())
    assert lc.meta["quarters"] == [2] and lc.meta["failed_quarters"] == [3]
    t = db_session.get(Target, 10666592)
    assert t.lc_status == "available" and "Q3" in t.lc_error and "HTTP 500" in t.lc_error
    res = download_many([10666592], workers=1, session=db_session, downloader=FakeDownloader())
    assert res["cached"] == 1 and res["results"][10666592]["failed_quarters"] == [3]
    t = db_session.get(Target, 10666592)
    assert t.lc_status == "available" and "Q3" in (t.lc_error or "")
    assert load_lightcurve(10666592).meta["acquisition_errors"]
    # a forced, complete re-download clears the gap
    ensure_lightcurve(db_session, 10666592, downloader=FakeDownloader(), force=True)
    t = db_session.get(Target, 10666592)
    assert t.lc_quarters == [2, 3] and t.lc_error is None
    assert "failed_quarters" not in load_lightcurve(10666592).meta


def test_download_many_results_follow_input_order(db_session):
    ids = [11442793, 1111111, 10666592]
    res = download_many(ids, workers=3, session=db_session, downloader=FakeDownloader())
    assert list(res["results"]) == ids


def test_download_many_without_session_uses_own_transactions(tmp_env):
    from exofinder.db.session import session_scope

    res = download_many([11442793], workers=1, downloader=FakeDownloader())
    assert res["available"] == 1
    with session_scope() as s:
        assert s.get(Target, 11442793).lc_status == "available"
