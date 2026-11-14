"""Live tests against NASA services (run with ``pytest -m network``).

They query the NASA Exoplanet Archive TAP service and MAST, and download exactly ONE star's light
curves (Kepler-2 / HAT-P-7, KIC 10666592; 18 long-cadence quarters, ~8 MB) into a temporary
directory.
"""

from __future__ import annotations

import re

import numpy as np
import pytest

pytestmark = pytest.mark.network

KEPLER2 = 10666592
# Kepler-2 b catalogue values: NASA Exoplanet Archive cumulative KOI table, K00002.01
# (koi_period, koi_time0bk, koi_duration, koi_depth), retrieved 2026-11-14.
K2_PERIOD, K2_T0_BKJD, K2_DURATION_H, K2_DEPTH_PPM = 2.204735417, 121.3585417, 3.88864, 6674.7


def test_live_tap_query_dr24_tces_of_kepler2(tmp_env):
    from exofinder.data.archive import ArchiveClient

    df = ArchiveClient().query(
        "SELECT kepid, tce_plnt_num, tce_period, tce_time0bk, tce_duration, tce_depth, av_training_set "
        f"FROM q1_q17_dr24_tce WHERE kepid = {KEPLER2} ORDER BY tce_plnt_num"
    )
    assert df["tce_plnt_num"].tolist() == [1, 2]
    # TCE 1 = the planet, TCE 2 = its secondary eclipse half an orbit later (Autovetter AFP)
    assert df["av_training_set"].tolist() == ["PC", "AFP"]
    assert df.loc[0, "tce_period"] == pytest.approx(2.20474, abs=1e-4)
    assert df.loc[0, "tce_depth"] == pytest.approx(6704, rel=0.01)
    dt = (df.loc[1, "tce_time0bk"] - df.loc[0, "tce_time0bk"]) % df.loc[0, "tce_period"]
    assert dt / df.loc[0, "tce_period"] == pytest.approx(0.5, abs=0.01)


def test_live_snapshot_koi_cumulative(db_session, tmp_env):
    import hashlib

    from exofinder.data.archive import fetch_snapshot
    from exofinder.db.models import CatalogSnapshot

    res = fetch_snapshot("koi_cumulative", session=db_session)
    assert res.validation["ok"], res.validation
    assert res.row_count > 9000
    assert res.path.parent == tmp_env / "catalogs"
    assert hashlib.sha256(res.path.read_bytes()).hexdigest() == res.sha256
    row = db_session.get(CatalogSnapshot, res.snapshot_id)
    assert row.table_name == "cumulative" and row.query.startswith("SELECT kepid, kepoi_name")
    k2 = res.frame[res.frame["kepoi_name"] == "K00002.01"].iloc[0]
    assert (
        k2["kepid"] == KEPLER2 and k2["kepler_name"] == "Kepler-2 b" and k2["koi_disposition"] == "CONFIRMED"
    )
    assert k2["koi_period"] == pytest.approx(K2_PERIOD, rel=1e-6)


def test_quarter_stamps_match_lightkurve_search():
    """Metadata only (no download): MAST product names must use our quarter stamps."""
    import lightkurve as lk

    from exofinder.data.mast import KEPLER_LC_QUARTER_STAMPS

    allowed = {s for v in KEPLER_LC_QUARTER_STAMPS.values() for s in v}
    for kic in (11442793, KEPLER2):
        res = lk.search_lightcurve(f"KIC {kic}", mission="Kepler", author="Kepler", cadence="long")
        names = [str(n) for n in res.table["productFilename"]]
        stamps = {m.group(1) for n in names if (m := re.match(rf"kplr{kic:09d}-(\d{{13}})_llc\.fits", n))}
        assert stamps and stamps <= allowed, sorted(stamps - allowed)
        if kic == 11442793:  # Kepler-90 sat on CCD module 3: its Q4 file uses the second Q4 stamp
            assert "2010009091648" in stamps


def test_live_download_one_star_kepler2(db_session, tmp_env):
    from exofinder.data.acquire import ensure_lightcurve, raw_dir_for
    from exofinder.db.models import Target

    lc = ensure_lightcurve(db_session, KEPLER2)
    t = db_session.get(Target, KEPLER2)
    assert t.lc_status == "available", t.lc_error
    assert t.lc_error is None
    # Kepler-2 was observed in every quarter Q0-Q17 (MAST product list, checked 2026-11-14)
    assert t.lc_quarters == list(range(18))
    assert len(lc) > 60000 and lc.meta["time_system"] == "BKJD"
    assert not raw_dir_for(KEPLER2).exists()  # keep_raw_fits=false
    good = (lc.quality == 0) & np.isfinite(lc.flux)
    phase = (lc.time - K2_T0_BKJD + 0.5 * K2_PERIOD) % K2_PERIOD - 0.5 * K2_PERIOD
    dur = K2_DURATION_H / 24
    in_tr = good & (np.abs(phase) < 0.25 * dur)
    out_tr = good & (np.abs(phase) > dur) & (np.abs(phase) < 3 * dur)
    depth = 1e6 * (np.median(lc.flux[out_tr]) - np.median(lc.flux[in_tr]))
    assert depth == pytest.approx(K2_DEPTH_PPM, rel=0.10)
