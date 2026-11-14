"""MAST downloader with mocked HTTP, served with the real Kepler fixture FITS files."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from pathlib import Path

import pytest
import requests
from exof_data_testdata import KEPLER2_Q2, KEPLER2_Q3, KEPLER90_Q3

from exofinder.data.mast import (
    KEPLER_LC_QUARTER_STAMPS,
    DownloadResult,
    InvalidLightCurveFile,
    download_kepler_lightcurves,
    kepler_lc_urls,
    validate_lightcurve_bytes,
)

Q2_STAMP, Q3_STAMP = "2009259160929", "2009350155506"


@dataclass
class R:
    status_code: int
    content: bytes = b""
    headers: dict = field(default_factory=dict)


class FakeMAST:
    """Serves scripted responses per file name; everything else is 404."""

    def __init__(self, routes):
        self.routes = {k: list(v) for k, v in routes.items()}
        self.calls: list[str] = []
        self.lock = threading.Lock()

    def get(self, url, timeout=None, headers=None):
        name = url.rsplit("/", 1)[-1]
        with self.lock:
            self.calls.append(name)
            script = self.routes.get(name)
            item = script.pop(0) if script and len(script) > 1 else (script[0] if script else R(404))
        if isinstance(item, Exception):
            raise item
        return item

    def close(self):
        pass


def fname(kepid, stamp):
    return f"kplr{kepid:09d}-{stamp}_llc.fits"


def test_quarter_stamp_table():
    assert sorted(KEPLER_LC_QUARTER_STAMPS) == list(range(18))
    assert KEPLER_LC_QUARTER_STAMPS[3] == ["2009350155506"]  # known-good example
    assert KEPLER_LC_QUARTER_STAMPS[4] == ["2010078095331", "2010009091648"]  # module-3 split
    assert all(len(s) == 13 and s.isdigit() for v in KEPLER_LC_QUARTER_STAMPS.values() for s in v)
    # stamps are chronological across quarters (YYYYDDDHHMMSS)
    firsts = [min(KEPLER_LC_QUARTER_STAMPS[q]) for q in range(18) if q != 4]
    assert firsts == sorted(firsts)


def test_urls_are_deterministic():
    urls = kepler_lc_urls(11442793, base_url="https://mast.stsci.edu/api/v0.1/Download/file")
    assert len(urls) == 19
    q, url, name = urls[3]
    assert q == 3 and name == "kplr011442793-2009350155506_llc.fits"
    assert url == (
        "https://mast.stsci.edu/api/v0.1/Download/file?uri=mast:KEPLER/url/missions/kepler/lightcurves/"
        "0114/011442793/kplr011442793-2009350155506_llc.fits"
    )
    assert kepler_lc_urls(757450)[0][1].endswith("/0007/000757450/kplr000757450-2009131105131_llc.fits")


class TestValidate:
    def test_real_file(self):
        info = validate_lightcurve_bytes(KEPLER2_Q2.read_bytes(), 10666592, 2)
        assert info == {"kepid": 10666592, "quarter": 2, "n_rows": 4354}

    def test_wrong_star_or_quarter(self):
        with pytest.raises(InvalidLightCurveFile, match="KIC 11442793"):
            validate_lightcurve_bytes(KEPLER90_Q3.read_bytes(), 10666592, 3)
        with pytest.raises(InvalidLightCurveFile, match="quarter 2"):
            validate_lightcurve_bytes(KEPLER2_Q2.read_bytes(), 10666592, 3)

    def test_not_fits_and_truncated(self):
        with pytest.raises(InvalidLightCurveFile, match="magic"):
            validate_lightcurve_bytes(b"<html>404</html>", 10666592)
        with pytest.raises(InvalidLightCurveFile):
            validate_lightcurve_bytes(KEPLER2_Q2.read_bytes()[:100_000], 10666592)

    @pytest.mark.parametrize("missing", [1, 100, 2879, 2880, 2 * 2880, 3 * 2880])
    def test_truncation_inside_trailing_aperture_hdu_is_detected(self, missing):
        # The Q2 fixture is PRIMARY + LIGHTCURVE + APERTURE (466 560 bytes = 162 FITS blocks); the
        # APERTURE HDU is the last three blocks (2-block header at byte 457 920, 1-block image). Losing
        # any of those bytes leaves the light-curve table readable, which used to be accepted as a
        # valid file (and then reused forever). 3*2880 removes the whole HDU at a block boundary.
        data = KEPLER2_Q2.read_bytes()
        assert len(data) == 466_560
        with pytest.raises(InvalidLightCurveFile, match="truncated|could not be parsed"):
            validate_lightcurve_bytes(data[:-missing], 10666592, 2)


def _download(tmp_path, fake, **kw):
    sleeps = []
    res = download_kepler_lightcurves(
        10666592,
        tmp_path / "raw",
        timeout=5,
        http=fake,
        base_url="https://mast.example/file",
        sleep=sleeps.append,
        backoff_s=0.1,
        **kw,
    )
    return res, sleeps


def test_downloads_present_quarters_and_reports_404_as_missing(tmp_path):
    fake = FakeMAST(
        {
            fname(10666592, Q2_STAMP): [R(200, KEPLER2_Q2.read_bytes())],
            fname(10666592, Q3_STAMP): [R(200, KEPLER2_Q3.read_bytes())],
        }
    )
    res, sleeps = _download(tmp_path, fake, use_fallback=False)
    assert res.quarters == [2, 3] and res.downloaded == 2 and res.errors == []
    assert res.missing_quarters == [0, 1] + list(range(4, 18))
    assert [p.name for _, p in res.files] == [fname(10666592, Q2_STAMP), fname(10666592, Q3_STAMP)]
    assert res.files[0][1].read_bytes() == KEPLER2_Q2.read_bytes()
    assert not list((tmp_path / "raw").glob("*.part")) and not list((tmp_path / "raw").glob(".*"))
    assert sleeps == [] and res.source == "mast"


def test_retry_on_transient_errors_and_corrupt_file(tmp_path):
    good = KEPLER2_Q3.read_bytes()
    fake = FakeMAST(
        {
            fname(10666592, Q2_STAMP): [
                requests.ConnectionError("reset"),
                requests.exceptions.ChunkedEncodingError("transfer cut off"),
                R(503),
                R(200, KEPLER2_Q2.read_bytes()),
            ],
            fname(10666592, Q3_STAMP): [R(200, good[:200_000]), R(200, good)],  # truncated, then fine
        }
    )
    res, sleeps = _download(tmp_path, fake, use_fallback=False)
    assert res.quarters == [2, 3] and res.errors == []
    assert fake.calls.count(fname(10666592, Q2_STAMP)) == 4
    assert fake.calls.count(fname(10666592, Q3_STAMP)) == 2
    assert sleeps == [0.1, 0.2, 0.4, 0.1]


def test_unexpected_request_exception_fails_only_that_quarter(tmp_path):
    fake = FakeMAST(
        {
            fname(10666592, Q2_STAMP): [requests.exceptions.TooManyRedirects("loop")],
            fname(10666592, Q3_STAMP): [R(200, KEPLER2_Q3.read_bytes())],
        }
    )
    res, _ = _download(tmp_path, fake, use_fallback=False)
    assert res.quarters == [3] and res.failed_quarters == [2] and "TooManyRedirects" in res.errors[0]


def test_persistent_corruption_and_wrong_star_are_errors(tmp_path):
    fake = FakeMAST(
        {
            fname(10666592, Q2_STAMP): [R(200, b"SIMPLE  = garbage")],
            fname(10666592, Q3_STAMP): [R(200, KEPLER90_Q3.read_bytes())],  # another star's file
        }
    )
    res, _ = _download(tmp_path, fake, use_fallback=False, max_retries=1)
    assert res.files == [] and res.failed_quarters == [2, 3]
    assert any("Q3" in e and "KIC 11442793" in e for e in res.errors)
    assert 2 not in res.missing_quarters and 3 not in res.missing_quarters
    assert not (tmp_path / "raw" / fname(10666592, Q3_STAMP)).exists()


def test_http_error_not_retried(tmp_path):
    fake = FakeMAST({fname(10666592, Q2_STAMP): [R(403)]})
    res, sleeps = _download(tmp_path, fake, use_fallback=False)
    assert res.failed_quarters == [2] and "HTTP 403" in res.errors[0]
    assert fake.calls.count(fname(10666592, Q2_STAMP)) == 1


def test_existing_valid_files_are_reused(tmp_path):
    dest = tmp_path / "raw"
    dest.mkdir()
    (dest / fname(10666592, Q2_STAMP)).write_bytes(KEPLER2_Q2.read_bytes())
    (dest / fname(10666592, Q3_STAMP)).write_bytes(b"corrupt")  # replaced by a fresh download
    fake = FakeMAST({fname(10666592, Q3_STAMP): [R(200, KEPLER2_Q3.read_bytes())]})
    res, _ = _download(tmp_path, fake, use_fallback=False)
    assert res.reused == 1 and res.downloaded == 1 and res.quarters == [2, 3]
    assert fname(10666592, Q2_STAMP) not in fake.calls
    assert (dest / fname(10666592, Q3_STAMP)).read_bytes() == KEPLER2_Q3.read_bytes()


def test_truncated_file_on_disk_is_not_reused(tmp_path):
    """A file cut short in its last HDU (e.g. disk full during an earlier run) must be re-downloaded."""
    dest = tmp_path / "raw"
    dest.mkdir()
    good = KEPLER2_Q2.read_bytes()
    (dest / fname(10666592, Q2_STAMP)).write_bytes(good[:-2880])
    fake = FakeMAST({fname(10666592, Q2_STAMP): [R(200, good)]})
    res, _ = _download(tmp_path, fake, use_fallback=False)
    assert res.reused == 0 and res.downloaded == 1 and res.quarters == [2]
    assert (dest / fname(10666592, Q2_STAMP)).read_bytes() == good


def test_retry_after_is_capped(tmp_path):
    from exofinder.data._util import MAX_RETRY_AFTER_S

    fake = FakeMAST(
        {
            fname(10666592, Q2_STAMP): [
                R(503, headers={"Retry-After": "86400"}),
                R(200, KEPLER2_Q2.read_bytes()),
            ]
        }
    )
    res, sleeps = _download(tmp_path, fake, use_fallback=False)
    assert res.quarters == [2] and sleeps == [MAX_RETRY_AFTER_S]


def test_cancel_between_files(tmp_path):
    ev = threading.Event()
    fake = FakeMAST(
        {
            fname(10666592, Q2_STAMP): [R(200, KEPLER2_Q2.read_bytes())],
            fname(10666592, Q3_STAMP): [R(200, KEPLER2_Q3.read_bytes())],
        }
    )
    orig = fake.get

    def get(url, **kw):
        r = orig(url, **kw)
        if Q2_STAMP in url:
            ev.set()  # cancel right after Q2 arrives
        return r

    fake.get = get
    res, _ = _download(tmp_path, fake, cancel=ev)
    assert res.cancelled and res.quarters == [2] and res.missing_quarters == []
    assert fname(10666592, Q3_STAMP) not in fake.calls


def test_fallback_used_when_all_deterministic_urls_fail(tmp_path):
    calls = []

    def fallback(kepid, dest, timeout, cancel):
        calls.append(kepid)
        p = dest / fname(kepid, Q2_STAMP)
        p.write_bytes(KEPLER2_Q2.read_bytes())
        return DownloadResult(kepid=kepid, files=[(2, p)], downloaded=1, source="lightkurve")

    fake = FakeMAST({})  # every URL 404 (e.g. URL scheme changed)
    res, _ = _download(tmp_path, fake, fallback=fallback)
    assert calls == [10666592] and res.source == "lightkurve" and res.quarters == [2]


def test_fallback_failure_is_reported(tmp_path):
    def fallback(kepid, dest, timeout, cancel):
        raise RuntimeError("search failed")

    res, _ = _download(tmp_path, FakeMAST({}), fallback=fallback)
    assert res.files == [] and any("lightkurve fallback failed" in e for e in res.errors)


# ------------------------------------------------------------------------------------------------
# lightkurve fallback (the real _lightkurve_fallback, with a stub lightkurve module: no network)
# ------------------------------------------------------------------------------------------------
class _StubRow:
    def __init__(self, src, name=None):
        self.src = src
        self.table = {"productFilename": [name or src.name]}
        self.downloads = 0

    def download(self, download_dir, quality_bitmask):
        # lightkurve stores products under <download_dir>/mastDownload/Kepler/<obs id>/
        d = Path(download_dir) / "mastDownload" / "Kepler" / "kplr010666592_lc_Q111111111111111111"
        d.mkdir(parents=True, exist_ok=True)
        data = self.src.read_bytes() if self.src is not None else b"SIMPLE  = corrupt"
        (d / self.table["productFilename"][0]).write_bytes(data)
        self.downloads += 1


class _StubSearch(list):
    pass


def _install_stub_lightkurve(monkeypatch, rows):
    import sys
    import types

    calls = []

    def search_lightcurve(target, mission=None, author=None, cadence=None):
        calls.append((target, mission, author, cadence))
        return _StubSearch(rows)

    monkeypatch.setitem(sys.modules, "lightkurve", types.SimpleNamespace(search_lightcurve=search_lightcurve))
    return calls


def test_real_lightkurve_fallback_validates_and_stores_files(tmp_path, monkeypatch):
    rows = [
        _StubRow(KEPLER2_Q3),
        _StubRow(KEPLER2_Q2),
        _StubRow(KEPLER2_Q2, name="kplr010666592-2009259160929_lpd-targ.fits.gz"),  # not an llc file
        _StubRow(None, name=fname(10666592, "2009166043257")),  # corrupt Q1 product
    ]
    calls = _install_stub_lightkurve(monkeypatch, rows)
    res, _ = _download(tmp_path, FakeMAST({}))  # every deterministic URL 404 -> fallback
    assert calls == [("KIC 10666592", "Kepler", "Kepler", "long")]
    assert res.source == "lightkurve" and res.quarters == [2, 3] and res.downloaded == 2
    assert [p.name for _, p in res.files] == [fname(10666592, Q2_STAMP), fname(10666592, Q3_STAMP)]
    assert all(p.parent == tmp_path / "raw" for _, p in res.files)
    assert (tmp_path / "raw" / fname(10666592, Q2_STAMP)).read_bytes() == KEPLER2_Q2.read_bytes()
    assert rows[2].downloads == 0  # non-llc products are never downloaded
    assert any("2009166043257" in e and "invalid file" in e for e in res.errors)


def test_lightkurve_fallback_rejects_another_stars_file_and_honours_cancel(tmp_path, monkeypatch):
    ev = threading.Event()
    wrong = _StubRow(KEPLER90_Q3, name=fname(10666592, Q3_STAMP))  # mislabelled: Kepler-90 data
    _install_stub_lightkurve(monkeypatch, [wrong])
    res, _ = _download(tmp_path, FakeMAST({}))
    assert res.files == [] and any("KIC 11442793" in e for e in res.errors)
    ev.set()
    _install_stub_lightkurve(monkeypatch, [_StubRow(KEPLER2_Q2)])
    from exofinder.data.mast import _lightkurve_fallback

    out = _lightkurve_fallback(10666592, tmp_path / "raw2", 5.0, ev)
    assert out.cancelled and out.files == []
