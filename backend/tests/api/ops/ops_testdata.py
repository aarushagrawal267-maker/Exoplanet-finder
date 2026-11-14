"""SYNTHETIC TEST DATA for the operations API tests — NOT real observations or catalogue rows.

Everything here is invented to exercise code paths: a tiny catalogue (``Target``/``Signal`` rows with
kepids 9000001+ and signal keys ``TEST-...``), placeholder catalogue snapshot rows, and synthetic
Kepler-like light curves with injected trapezoid transits (U-shaped "planet-like" signals; V-shaped
signals with a secondary eclipse for "false-positive-like" ones). Every light curve carries
``meta["synthetic"] = True``, so datasets built from them are flagged synthetic and every model
trained on them is a TEST FIXTURE (``is_fixture=True``). One synthetic star re-uses the Kepler-90
KIC id (11442793) purely to exercise the reserved-showcase (forced test split) logic.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import numpy as np

KEPLER_CADENCE = 0.02043359821692  # days
RESERVED_TEST_KEPID = 11442793  # Kepler-90's KIC id, used only to test the reserved-star logic


@dataclass
class SynthSignal:
    key: str
    period: float
    epoch: float
    duration_h: float
    depth_ppm: float
    av: str | None  # PC / AFP / NTP / None
    planet_like: bool  # shape used for the injection
    koi_disposition: str | None = None
    label_conflict: bool = False


def synthetic_lightcurve(kepid: int, signals: list[SynthSignal], seed: int, days: float = 60.0):
    """Two 'quarters' of Kepler-like photometry with the given transits injected (TEST DATA)."""
    from exofinder.astro.inject import inject_transit
    from exofinder.astro.types import LightCurve

    rng = np.random.default_rng(seed)
    t0 = 131.5
    half = days / 2
    t = np.concatenate(
        [
            np.arange(t0, t0 + half, KEPLER_CADENCE),
            np.arange(t0 + half + 1.0, t0 + days + 1.0, KEPLER_CADENCE),
        ]
    )
    seg = np.where(t < t0 + half + 0.5, 1, 2)
    flux = 1.0 + 0.0015 * np.sin(2 * np.pi * t / 7.3 + rng.uniform(0, 6)) + rng.normal(0, 2.0e-4, t.size)
    lc = LightCurve(
        time=t,
        flux=flux,
        flux_err=np.full(t.size, 2.0e-4),
        quality=np.zeros(t.size, dtype=np.int64),
        segment=seg,
        meta={"kepid": kepid, "synthetic": True, "cadence_days": KEPLER_CADENCE, "time_system": "BKJD"},
    )
    for s in signals:
        if s.planet_like:
            lc = inject_transit(lc, s.period, s.epoch, s.duration_h, s.depth_ppm, ingress_fraction=0.12)
        else:  # eclipsing-binary-like: V shape plus a secondary eclipse at phase 0.5
            lc = inject_transit(lc, s.period, s.epoch, s.duration_h, s.depth_ppm, ingress_fraction=0.5)
            lc = inject_transit(
                lc, s.period, s.epoch + s.period / 2, s.duration_h, 0.5 * s.depth_ppm, ingress_fraction=0.5
            )
    lc.meta["synthetic"] = True
    lc.meta["quarters"] = [1, 2]
    return lc


def build_catalogue(session, n_pos: int = 9, n_neg: int = 9, seed: int = 0) -> dict:
    """Insert the synthetic TEST DATA catalogue and light-curve caches; returns a description dict."""
    from exofinder.config import get_settings
    from exofinder.data.lightcurve_store import save_lightcurve
    from exofinder.db.models import CatalogSnapshot, Signal, Target

    rng = np.random.default_rng(seed)
    snap_file = get_settings().catalogs_dir / "dr24_tce_TESTDATA.csv"
    snap_file.write_text("kepid,tce_plnt_num\n# synthetic TEST DATA placeholder\n", "utf-8")
    snap = CatalogSnapshot(
        source="dr24_tce",
        table_name="q1_q17_dr24_tce",
        query="TEST DATA (synthetic placeholder, not a NASA snapshot)",
        url="test://synthetic",
        row_count=0,
        sha256=hashlib.sha256(snap_file.read_bytes()).hexdigest(),
        file_path=str(snap_file),
        validation={"synthetic": True},
    )
    session.add(snap)
    session.flush()

    stars: dict[int, list[SynthSignal]] = {}
    kepid = 9000001
    for i in range(n_pos + n_neg):
        pos = i < n_pos
        n_sig = 2 if i % 4 == 0 else 1
        sigs = []
        for j in range(n_sig):
            period = float(rng.uniform(2.0, 6.0)) * (1.37 if j else 1.0)
            sigs.append(
                SynthSignal(
                    key=f"TEST-{kepid}-{j + 1:02d}",
                    period=period,
                    epoch=131.5 + float(rng.uniform(0.3, 1.5)),
                    duration_h=float(rng.uniform(2.5, 4.0)),
                    depth_ppm=float(rng.uniform(1500, 4000)),
                    av="PC" if pos else ("AFP" if j == 0 else "NTP"),
                    planet_like=pos,
                )
            )
        stars[kepid] = sigs
        kepid += 1
    # edge cases --------------------------------------------------------------------------------
    stars[RESERVED_TEST_KEPID] = [
        SynthSignal("TEST-RESERVED-01", 3.1, 132.0, 3.0, 3000, "PC", True),
        SynthSignal(
            "TEST-RESERVED-02", 4.7, 132.4, 2.8, 2000, None, True
        ),  # unlabelled: kept, not trained on
    ]
    stars[9100001] = [
        SynthSignal("TEST-CONFLICT-01", 3.3, 132.1, 3.0, 2500, "PC", True, "FALSE POSITIVE", True)
    ]
    stars[9100002] = [SynthSignal("TEST-LONGPERIOD-01", 45.0, 140.0, 5.0, 3000, "PC", True)]  # P > baseline/2
    nolc_kepid, badeph_kepid = 9100003, 9100004
    edge_without_lc = {
        nolc_kepid: [SynthSignal("TEST-NOLC-01", 3.0, 132.0, 3.0, 2000, "AFP", False)],
        badeph_kepid: [SynthSignal("TEST-BADEPH-01", 3.0, 132.0, 0.0, 2000, "NTP", False)],  # duration 0
    }
    for k, sigs in {**stars, **edge_without_lc}.items():
        session.add(Target(kepid=k, lc_status="none", lc_quarters=[], kepler_host_name=None))
        for s in sigs:
            session.add(
                Signal(
                    signal_key=s.key,
                    kepid=k,
                    primary_source="dr24_tce",
                    tce_plnt_num=1,
                    period_days=s.period,
                    epoch_bkjd=s.epoch,
                    duration_hours=s.duration_h,
                    depth_ppm=s.depth_ppm,
                    model_snr=20.0,
                    av_training_set=s.av,
                    koi_disposition=s.koi_disposition,
                    category="candidate" if s.av == "PC" else ("false_positive" if s.av else "unknown"),
                    label_conflict=s.label_conflict,
                    match_status="tce_only",
                    provenance={
                        "period_days": {"table": "q1_q17_dr24_tce", "snapshot_id": snap.id, "test_data": True}
                    },
                )
            )
    session.flush()
    # light curves: every star except the "no light curve" one (marked no_data so it is not downloaded)
    for i, (k, sigs) in enumerate({**stars, badeph_kepid: edge_without_lc[badeph_kepid]}.items()):
        good = [s for s in sigs if s.duration_h > 0]
        save_lightcurve(k, synthetic_lightcurve(k, good, seed=1000 + i))
        t = session.get(Target, k)
        t.lc_status = "available"
    session.get(Target, nolc_kepid).lc_status = "no_data"
    session.commit()
    n_labelled = sum(1 for sigs in stars.values() for s in sigs if s.av)
    return {
        "n_stars": len(stars) + len(edge_without_lc),
        "n_labelled_with_lc": n_labelled,
        "nolc_kepid": nolc_kepid,
        "badeph_kepid": badeph_kepid,
        "reserved_kepid": RESERVED_TEST_KEPID,
        "snapshot_id": snap.id,
    }
