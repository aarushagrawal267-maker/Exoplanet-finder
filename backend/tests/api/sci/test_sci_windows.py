"""Windows file-system behaviour, simulated on any OS.

* ``os.replace`` onto a file that another thread/process holds open raises ``PermissionError`` on
  Windows (sharing violation) — POSIX never does, so it is injected here.
* File names such as ``con.csv`` open a DEVICE on Windows 10 instead of a file.
* NTFS is case-insensitive, so ``dev_progress`` opens ``DEV_PROGRESS.md``.

TEST DATA: the catalogue/light curves are the sci fixtures (real Kepler-2 FITS quarters, hand-made
catalogue rows); the CSV is the real Kepler-2 Q3 quarter re-expressed as a table.
"""

from __future__ import annotations

import io
import json
import os

import numpy as np
import pytest
from sci_testlib import KEPLER2_FITS


def test_view_cache_entry_in_use_does_not_fail_the_computation(sci_catalog, monkeypatch: pytest.MonkeyPatch):
    """A concurrent reader (np.load in another request or a dataset-build worker) blocks the replace on
    Windows: the freshly computed views are still returned, the existing entry is kept and no
    temporary file is left behind."""
    from exofinder.data import _util
    from exofinder.db.models import Signal
    from exofinder.db.session import session_scope
    from exofinder.services import signal_views

    sid = sci_catalog["signals"]["TCE-010666592-01"]
    with session_scope() as s:
        first = signal_views.compute_signal_views(s, s.get(Signal, sid))
    assert not first.from_cache
    entry = signal_views._cache_path(first.signal_key, first.config_hash)
    before = entry.read_bytes()

    calls = []

    def locked(src, dst):
        calls.append(os.fspath(dst))
        raise PermissionError(
            13, "The process cannot access the file because it is being used by another process"
        )

    monkeypatch.setattr(_util.os, "replace", locked)
    monkeypatch.setattr(_util.time, "sleep", lambda _s: None)
    with session_scope() as s:  # with_diagnostics bypasses the cache read and rewrites the entry
        again = signal_views.compute_signal_views(s, s.get(Signal, sid), with_diagnostics=True)
    assert len(calls) == _util.REPLACE_ATTEMPTS and calls[0] == os.fspath(entry)
    assert not again.from_cache
    np.testing.assert_array_equal(again.global_view, first.global_view)
    np.testing.assert_array_equal(again.local_view, first.local_view)
    assert entry.read_bytes() == before
    assert [p.name for p in entry.parent.iterdir()] == [entry.name]  # no stray .tmp.npz


def _kepler2_csv() -> bytes:
    from exofinder.astro.io_fits import read_fits_lightcurve

    lc = read_fits_lightcurve(KEPLER2_FITS[1])
    ok = np.isfinite(lc.flux)
    buf = io.StringIO()
    buf.write("BJD_TDB,rel_flux,flux_unc\n")
    med = np.nanmedian(lc.flux)
    for t, f, e in zip(lc.time[ok] + 2454833.0, lc.flux[ok] / med, lc.flux_err[ok] / med, strict=True):
        buf.write(f"{t:.6f},{f:.7f},{e:.7f}\n")
    return buf.getvalue().encode()


def test_upload_named_like_a_windows_device_gets_a_safe_stored_name(client, api_env):
    r = client.post("/api/uploads", files={"file": ("con.csv", _kepler2_csv(), "text/csv")})
    assert r.status_code == 200, r.text
    uid = r.json()["upload_id"]
    meta = json.loads((api_env / "uploads" / uid / "meta.json").read_text("utf-8"))
    assert meta["filename"] == "con.csv" and meta["stored_name"] == "_con.csv"
    assert (api_env / "uploads" / uid / "_con.csv").is_file()
    p = client.post(f"/api/uploads/{uid}/parse", json={"time_system": "BJD"})
    assert p.status_code == 200, p.text

    from exofinder.services.uploads import _safe_name

    names = ("AUX.txt", "nul.fits.gz", "COM1.csv", "lpt9.txt", "console.csv", "kplr_con.csv", "Con")
    assert [_safe_name(n) for n in names] == [
        "_AUX.txt",
        "_nul.fits.gz",
        "_COM1.csv",
        "_lpt9.txt",
        "console.csv",
        "kplr_con.csv",
        "_Con",
    ]


def test_docs_exclusion_is_case_insensitive(client, tmp_path, monkeypatch: pytest.MonkeyPatch):
    """On a case-insensitive file system /api/docs/pages/dev_progress would open DEV_PROGRESS.md;
    simulated with a lower-case file name."""
    from exofinder.services import docs_pages

    (tmp_path / "methodology.md").write_text("# Research methodology\n", "utf-8")
    (tmp_path / "dev_progress.md").write_text("# Internal development log\n", "utf-8")
    monkeypatch.setattr(docs_pages, "_docs_dir", lambda: tmp_path)
    assert [p["slug"] for p in client.get("/api/docs/pages").json()] == ["methodology"]
    assert client.get("/api/docs/pages/methodology").status_code == 200
    for slug in ("dev_progress", "Dev_Progress", "DEV_PROGRESS"):
        assert client.get(f"/api/docs/pages/{slug}").status_code == 404, slug
