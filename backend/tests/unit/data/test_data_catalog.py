"""Catalogue ingestion: TCE↔KOI verified linking, confirmed planets, categories, label conflicts.

Uses the HAND-MADE TEST DATA snapshots from conftest.py (partly real Kepler-2/Kepler-90 values,
partly invented edge cases). Expected outcomes are worked out by hand in the comments.
"""

from __future__ import annotations

import io

import pandas as pd
import pytest
from exof_data_testdata import CONFIRMED_CSV, KOI_CSV, STELLAR_CSV, TCE_CSV
from sqlalchemy import func, select

from exofinder.data.archive import SnapshotValidationError
from exofinder.data.catalog import (
    build_catalog,
    catalog_summary,
    ingest_from_files,
    verify_ephemeris_match,
)
from exofinder.db.models import CatalogSnapshot, Dataset, DatasetExample, Signal, Target


def _frames():
    return {
        "dr24_tce": pd.read_csv(io.StringIO(TCE_CSV)),
        "koi_cumulative": pd.read_csv(io.StringIO(KOI_CSV)),
        "confirmed": pd.read_csv(io.StringIO(CONFIRMED_CSV)),
        "stellar": pd.read_csv(io.StringIO(STELLAR_CSV)),
    }


@pytest.fixture()
def build():
    f = _frames()
    return build_catalog(
        f["dr24_tce"],
        f["koi_cumulative"],
        f["confirmed"],
        f["stellar"],
        {"dr24_tce": 1, "koi_cumulative": 2, "confirmed": 3, "stellar": 4},
    )


def _by_key(build):
    return {r.signal_key: r for r in build.records}


# ------------------------------------------------------------------------------------------------
# Ephemeris verification
# ------------------------------------------------------------------------------------------------
class TestVerifyEphemeris:
    def test_kepler2_dr24_tce_matches_cumulative_koi(self):
        # DR24 TCE (P=2.20474, T0=132.381 BKJD, 3.86 h) vs cumulative K00002.01
        # (P=2.204735417, T0=121.3585417, 3.88864 h): epochs are 5 periods apart.
        c = verify_ephemeris_match(2.20474, 132.381, 3.86, 2.204735417, 121.3585417, 3.88864)
        assert c.ok and c.period_ok and c.epoch_ok
        assert c.epoch_offset_days == pytest.approx(0.0012, abs=2e-4)
        assert c.epoch_offset_durations < 0.05

    def test_secondary_eclipse_is_rejected(self):
        # Kepler-2 TCE 2 (secondary eclipse): same period, epoch offset ~P/2.
        c = verify_ephemeris_match(2.20474, 132.381, 3.86, 2.20475, 133.479, 4.5)
        assert c.period_ok and not c.epoch_ok and not c.ok

    def test_period_alias_is_rejected(self):
        c = verify_ephemeris_match(4.0, 131.5, 2.0, 8.0, 131.5, 2.0)
        assert not c.period_ok and not c.ok

    def test_period_tolerance_is_one_percent(self):
        assert verify_ephemeris_match(10.0, 100.0, 3.0, 10.09, 100.0, 3.0).period_ok
        assert not verify_ephemeris_match(10.0, 100.0, 3.0, 10.11, 100.0, 3.0).period_ok

    def test_epoch_tolerance_is_half_the_longer_duration(self):
        # duration 4.8 h = 0.2 d -> tolerance 0.1 d
        assert verify_ephemeris_match(10.0, 100.0, 4.8, 10.0, 100.099, 2.0).epoch_ok
        assert not verify_ephemeris_match(10.0, 100.0, 4.8, 10.0, 100.101, 2.0).epoch_ok

    def test_missing_epoch(self):
        c = verify_ephemeris_match(10.0, 100.0, 3.0, 10.0, None, None, require_epoch=False)
        assert c.ok and c.epoch_offset_days is None
        assert not verify_ephemeris_match(10.0, 100.0, 3.0, 10.0, None, None).ok


# ------------------------------------------------------------------------------------------------
# build_catalog (pure)
# ------------------------------------------------------------------------------------------------
class TestBuildCatalog:
    def test_row_set(self, build):
        keys = set(_by_key(build))
        assert len(build.records) == 21
        assert {
            "TCE-010666592-01",
            "TCE-010666592-02",
            "TCE-011442793-01",
            "KOI-K00351.02",
            "PL-Kepler-90_i",
            "KOI-K90006.01",
            "KOI-K90008.01",
            "KOI-K90009.02",
            "KOI-K90010.02",
        } <= keys
        # merged KOIs do not get their own rows
        assert "KOI-K00002.01" not in keys and "KOI-K00351.01" not in keys and "KOI-K90007.01" not in keys
        assert [r.signal_key for r in build.records] == sorted(keys)  # deterministic order

    def test_kepler2_merge_and_secondary(self, build):
        r = _by_key(build)
        b = r["TCE-010666592-01"]
        assert b.match_status == "koi_matched"
        assert b.kepoi_name == "K00002.01" and b.kepler_name == "Kepler-2 b"
        assert b.category == "confirmed" and not b.label_conflict
        # ephemeris stays the DR24 TCE one; KOI ephemeris kept as alternative in provenance
        assert b.period_days == 2.20474 and b.epoch_bkjd == 132.381
        assert b.provenance["period_days"]["column"] == "tce_period"
        assert b.provenance["koi_ephemeris"]["period_days"] == pytest.approx(2.204735417)
        assert b.provenance["match"]["method"] == "tce_plnt_num"
        assert b.provenance["confirmed"]["pl_name"] == "HAT-P-7 b"
        sec = r["TCE-010666592-02"]
        assert sec.match_status == "tce_only" and sec.kepoi_name is None
        assert sec.category == "false_positive" and sec.kepler_name is None

    def test_kepler90(self, build):
        r = _by_key(build)
        h = r["TCE-011442793-01"]
        assert h.kepoi_name == "K00351.01" and h.kepler_name == "Kepler-90 h" and h.category == "confirmed"
        g = r["KOI-K00351.02"]  # plnt num 2 refers to DR25 numbering; DR24 has only one TCE on the star
        assert g.match_status == "koi_only" and g.kepler_name == "Kepler-90 g" and g.category == "confirmed"
        i = r["PL-Kepler-90_i"]
        assert i.match_status == "confirmed_only" and i.primary_source == "confirmed"
        assert i.category == "confirmed" and i.av_training_set is None and i.koi_disposition is None
        assert i.epoch_bkjd == pytest.approx(2455644.3488 - 2454833.0)  # BJD -> BKJD
        assert i.provenance["epoch_bkjd"]["value"] == pytest.approx(2455644.3488)
        assert i.depth_ppm is None  # not published; never invented

    def test_link_statuses(self, build):
        r = _by_key(build)
        # ephemeris fallback (KOI planet numbers point at the other TCE)
        for key, koi in (("TCE-001000007-01", "K90007.01"), ("TCE-001000007-02", "K90007.02")):
            assert r[key].kepoi_name == koi and r[key].match_status == "koi_matched"
            assert r[key].provenance["match"]["method"] == "ephemeris"
        # period alias -> conflict, KOI fields not merged into the TCE row
        assert r["KOI-K90006.01"].match_status == "match_conflict"
        assert r["KOI-K90006.01"].provenance["match"]["reason"] == "ephemeris_mismatch"
        assert r["TCE-001000006-01"].match_status == "match_conflict"
        assert r["TCE-001000006-01"].kepoi_name is None and r["TCE-001000006-01"].koi_disposition is None
        # same period but epoch off by 1.8 durations -> conflict
        m = r["KOI-K90008.01"].provenance["match"]
        assert m["period_ok"] and not m["epoch_ok"] and m["epoch_offset_durations"] == pytest.approx(1.8)
        # two KOIs claim one TCE: the better match wins, the other is a conflict
        assert r["TCE-001000010-01"].kepoi_name == "K90010.01"
        assert r["TCE-001000010-01"].match_status == "koi_matched"
        assert r["KOI-K90010.02"].provenance["match"]["reason"] == "tce_claimed_by_other_koi"
        # KOI without TCE link
        assert r["KOI-K90009.02"].match_status == "koi_only"
        assert build.stats["tce_koi_link"] == {
            "tce_plnt_num": 6,
            "ephemeris": 2,
            "match_conflict": 3,
            "koi_only": 2,
        }

    def test_categories_and_conflicts(self, build):
        r = _by_key(build)
        cats = {k: v.category for k, v in r.items()}
        assert cats["TCE-001000001-01"] == "false_positive"  # AFP, no KOI
        assert cats["TCE-001000001-02"] == "candidate"  # PC, no KOI
        assert cats["TCE-001000003-01"] == "unknown"  # UNK, no KOI
        assert cats["TCE-001000004-01"] == "false_positive"  # KOI FALSE POSITIVE
        assert cats["TCE-001000005-01"] == "confirmed"  # KOI CONFIRMED
        assert cats["TCE-001000002-01"] == "confirmed"  # confirmed table via kepid+period
        conflicts = {k for k, v in r.items() if v.label_conflict}
        # PC vs FALSE POSITIVE; AFP vs CONFIRMED (KOI); NTP vs confirmed table
        assert conflicts == {"TCE-001000004-01", "TCE-001000005-01", "TCE-001000002-01"}
        assert Counter_(v.category for v in r.values()) == {
            "confirmed": 7,
            "false_positive": 3,
            "candidate": 10,
            "unknown": 1,
        }
        assert Counter_(v.match_status for v in r.values()) == {
            "koi_matched": 8,
            "tce_only": 5,
            "match_conflict": 5,
            "koi_only": 2,
            "confirmed_only": 1,
        }

    def test_confirmed_matching(self, build):
        r = _by_key(build)
        t2 = r["TCE-001000002-01"]
        assert t2.kepler_name == "Kepler-T2 b"
        assert t2.provenance["confirmed"]["match_method"] == "kepid_period"
        assert t2.provenance["confirmed"]["match_check"]["epoch_ok"]
        assert r["TCE-001000005-01"].provenance["confirmed"]["match_method"] == "koi_name"
        assert build.stats["confirmed_match"] == {"koi_name": 4, "kepid_period": 1, "own_row": 1}
        # non-transiting (TTV) planet and a planet without a duration never create rows
        assert build.stats["skipped"]["confirmed_non_transiting"] == 1
        assert build.stats["skipped"]["confirmed_no_ephemeris"] == 1
        assert not any("Kepler-T9" in k or "Kepler-T3" in k for k in r)

    def test_provenance_points_to_snapshots(self, build):
        b = _by_key(build)["TCE-010666592-01"]
        assert b.provenance["av_training_set"] == {
            "table": "q1_q17_dr24_tce",
            "column": "av_training_set",
            "snapshot_id": 1,
            "value": "PC",
        }
        assert b.provenance["koi_disposition"]["snapshot_id"] == 2
        assert b.provenance["koi_score"]["display_only"] is True
        assert b.provenance["kepler_name"]["snapshot_id"] == 3
        assert b.provenance["category"]["derived"] is True

    def test_targets(self, build):
        t = build.targets
        assert len(t) == 12
        assert t[10666592]["teff"] == 6440 and t[10666592]["radius"] == pytest.approx(1.952)
        assert t[10666592]["kepler_host_name"] == "Kepler-2"
        assert t[11442793]["kepler_host_name"] == "Kepler-90"
        assert t[1000002]["kepler_host_name"] == "Kepler-T2"
        assert t[1000004]["teff"] is None  # no stellar row -> missing, not invented
        assert t[1000004]["kepmag"] == 14.0  # from the KOI table

    def test_deterministic(self):
        f = _frames()
        a = build_catalog(f["dr24_tce"], f["koi_cumulative"], f["confirmed"], f["stellar"])
        shuffled = {k: v.sample(frac=1.0, random_state=7) for k, v in f.items()}
        b = build_catalog(
            shuffled["dr24_tce"], shuffled["koi_cumulative"], shuffled["confirmed"], shuffled["stellar"]
        )
        assert [x.as_row() for x in a.records] == [x.as_row() for x in b.records]

    def test_catalogue_scores_are_not_used_for_categories(self):
        f = _frames()
        koi = f["koi_cumulative"].copy()
        koi["koi_score"] = 0.0
        koi["koi_fpflag_ss"] = 1
        koi["koi_pdisposition"] = "FALSE POSITIVE"
        a = build_catalog(f["dr24_tce"], f["koi_cumulative"], f["confirmed"])
        b = build_catalog(f["dr24_tce"], koi, f["confirmed"])
        assert [(x.signal_key, x.category, x.label_conflict) for x in a.records] == [
            (x.signal_key, x.category, x.label_conflict) for x in b.records
        ]


def Counter_(it):
    out: dict[str, int] = {}
    for x in it:
        out[x] = out.get(x, 0) + 1
    return out


# ------------------------------------------------------------------------------------------------
# Database ingestion
# ------------------------------------------------------------------------------------------------
class TestIngestFromFiles:
    def test_ingest_counts_and_snapshots(self, db_session, catalog_files):
        res = ingest_from_files(db_session, catalog_files)
        assert res["written"]["signals_new"] == 21 and res["written"]["targets_new"] == 12
        s = res["summary"]
        assert s["n_signals"] == 21 and s["n_targets"] == 12 and s["label_conflicts"] == 3
        assert s["categories"] == {"candidate": 10, "confirmed": 7, "false_positive": 3, "unknown": 1}
        snaps = db_session.scalars(select(CatalogSnapshot).order_by(CatalogSnapshot.id)).all()
        assert [x.source for x in snaps] == ["dr24_tce", "koi_cumulative", "confirmed", "stellar"]
        assert all(len(x.sha256) == 64 and x.validation["ok"] for x in snaps)
        sig = db_session.scalars(select(Signal).where(Signal.signal_key == "TCE-010666592-01")).one()
        assert sig.provenance["av_training_set"]["snapshot_id"] == snaps[0].id
        assert sig.target.kepler_host_name == "Kepler-2"

    def test_paths_as_iterable(self, db_session, catalog_files):
        res = ingest_from_files(db_session, list(catalog_files.values()))
        assert res["summary"]["n_signals"] == 21

    def test_reingest_is_idempotent_and_keeps_ids_and_lc_status(self, db_session, catalog_files):
        ingest_from_files(db_session, catalog_files)
        ids = dict(db_session.execute(select(Signal.signal_key, Signal.id)).all())
        t = db_session.get(Target, 10666592)
        t.lc_status, t.lc_quarters = "available", [2, 3]
        db_session.flush()
        res = ingest_from_files(db_session, catalog_files)
        w = res["written"]
        assert w["signals_new"] == 0 and w["signals_changed"] == 0 and w["changed_fields"] == {}
        assert w["signals_updated"] == 21  # provenance now cites the newly registered snapshots
        assert dict(db_session.execute(select(Signal.signal_key, Signal.id)).all()) == ids
        t = db_session.get(Target, 10666592)
        assert t.lc_status == "available" and t.lc_quarters == [2, 3]

    def test_missing_signals_are_deleted_or_retired(self, db_session, catalog_files, tmp_path):
        ingest_from_files(db_session, catalog_files)
        referenced = db_session.scalars(select(Signal).where(Signal.signal_key == "TCE-001000003-01")).one()
        ds = Dataset(name="t", label_mode="astronet_dr24", tier="pilot", pipeline_version="1.0")
        db_session.add(ds)
        db_session.flush()
        db_session.add(DatasetExample(dataset_id=ds.id, signal_id=referenced.id, kepid=referenced.kepid))
        db_session.flush()
        # Re-ingest without stars 1000003 (referenced) and 1000001 (unreferenced)
        tce = pd.read_csv(io.StringIO(TCE_CSV))
        tce = tce[~tce["kepid"].isin([1000003, 1000001])]
        p = tmp_path / "dr24_tce_reduced.csv"
        tce.to_csv(p, index=False)
        res = ingest_from_files(db_session, {**catalog_files, "dr24_tce": p})
        assert res["written"]["signals_deleted"] == 2 and res["written"]["signals_retired"] == 1
        retired = db_session.get(Signal, referenced.id)
        assert retired.category == "retired" and retired.match_status == "stale"
        assert db_session.scalar(select(func.count()).select_from(Signal).where(Signal.kepid == 1000001)) == 0

    def test_invalid_snapshot_rejected(self, db_session, catalog_files, tmp_path):
        bad = tmp_path / "dr24_tce_bad.csv"
        bad.write_text(TCE_CSV.replace("av_training_set", "av_label"), encoding="utf-8")
        with pytest.raises(SnapshotValidationError, match="av_training_set"):
            ingest_from_files(db_session, {**catalog_files, "dr24_tce": bad})

    def test_duplicate_tce_key_rejected(self, db_session, catalog_files, tmp_path):
        lines = TCE_CSV.splitlines()
        dup = tmp_path / "dr24_tce_dup.csv"
        dup.write_text("\n".join(lines + [lines[1]]) + "\n", encoding="utf-8")
        with pytest.raises(SnapshotValidationError, match="share a key"):
            ingest_from_files(db_session, {**catalog_files, "dr24_tce": dup})

    def test_requires_tce_and_koi(self, db_session, catalog_files):
        with pytest.raises(ValueError, match="dr24_tce and koi_cumulative"):
            ingest_from_files(db_session, {"confirmed": catalog_files["confirmed"]})
        assert db_session.scalars(select(CatalogSnapshot)).all() == []  # nothing recorded

    def test_bad_request_records_no_snapshots(self, db_session, catalog_files, tmp_path):
        # Regression: valid files were registered as CatalogSnapshot rows before the unknown source
        # name was rejected, leaving orphan snapshot rows in a caller-committed session.
        with pytest.raises(ValueError, match="unknown catalogue sources"):
            ingest_from_files(db_session, {**catalog_files, "nonsense": catalog_files["stellar"]})
        assert db_session.scalars(select(CatalogSnapshot)).all() == []
        second = tmp_path / "dr24_tce_second.csv"
        second.write_text(TCE_CSV, encoding="utf-8")
        with pytest.raises(ValueError, match="two files"):
            ingest_from_files(db_session, [*catalog_files.values(), second])
        assert db_session.scalars(select(CatalogSnapshot)).all() == []

    def test_summary_helper(self, db_session, catalog_files):
        ingest_from_files(db_session, catalog_files)
        s = catalog_summary(db_session)
        assert s["match_status"] == {
            "confirmed_only": 1,
            "koi_matched": 8,
            "koi_only": 2,
            "match_conflict": 5,
            "tce_only": 5,
        }


# ------------------------------------------------------------------------------------------------
# refresh_catalog (download + ingest) with a mocked TAP service serving the hand-made test CSVs
# ------------------------------------------------------------------------------------------------
class FakeTAP:
    """Answers TAP POSTs by table name with the HAND-MADE TEST CSVs; records every ADQL query."""

    BODIES = {
        "FROM q1_q17_dr24_tce": TCE_CSV,
        "FROM cumulative": KOI_CSV,
        "FROM pscomppars": CONFIRMED_CSV,
        "FROM keplerstellar": STELLAR_CSV,
    }

    def __init__(self):
        self.queries: list[str] = []

    def post(self, url, data=None, timeout=None, headers=None):
        from dataclasses import dataclass, field

        @dataclass
        class Resp:
            status_code: int
            content: bytes
            headers: dict = field(default_factory=dict)

        q = data["query"]
        self.queries.append(q)
        body = next(text for marker, text in self.BODIES.items() if marker in q)
        return Resp(200, body.encode())

    def close(self):
        pass


def _tap_client(tap):
    from exofinder.data.archive import ArchiveClient

    return ArchiveClient("https://tap.example/TAP/sync", timeout=5, http=tap, sleep=lambda s: None)


class TestRefreshCatalog:
    def test_full_refresh(self, db_session):
        from exofinder.data.catalog import refresh_catalog

        tap, events = FakeTAP(), []
        res = refresh_catalog(
            db_session, progress=lambda d, t, m: events.append((d, t, m)), client=_tap_client(tap)
        )
        assert res["summary"]["n_signals"] == 21 and res["summary"]["n_targets"] == 12
        assert res["written"]["signals_new"] == 21
        assert [s["reused"] for s in res["snapshots"].values()] == [False] * 4
        assert len(tap.queries) == 4
        # the stellar query is restricted to the union of the stars in the TCE/KOI/confirmed tables
        stellar_q = tap.queries[3]
        expected = sorted(
            {
                int(k)
                for csv in (TCE_CSV, KOI_CSV, CONFIRMED_CSV)
                for k in pd.read_csv(io.StringIO(csv))["kepid"]
            }
        )
        assert f"kepid IN ({', '.join(map(str, expected))})" in stellar_q
        snaps = db_session.scalars(select(CatalogSnapshot).order_by(CatalogSnapshot.id)).all()
        assert [s.source for s in snaps] == ["dr24_tce", "koi_cumulative", "confirmed", "stellar"]
        assert res["snapshot_ids"] == {s.source: s.id for s in snaps}
        # progress: monotonic, ends at total
        done = [e[0] for e in events]
        assert done == sorted(done) and done[-1] == events[-1][1] == 5
        assert db_session.get(Target, 10666592).teff == 6440

    def test_partial_refresh_reuses_latest_verified_snapshots(self, db_session):
        from exofinder.data.catalog import refresh_catalog

        first = refresh_catalog(db_session, client=_tap_client(FakeTAP()))
        tap = FakeTAP()
        res = refresh_catalog(db_session, sources=("koi_cumulative",), client=_tap_client(tap))
        assert len(tap.queries) == 1 and "FROM cumulative" in tap.queries[0]
        for source in ("dr24_tce", "confirmed", "stellar"):
            assert res["snapshots"][source]["reused"] is True
            assert res["snapshot_ids"][source] == first["snapshot_ids"][source]
        assert res["snapshot_ids"]["koi_cumulative"] != first["snapshot_ids"]["koi_cumulative"]
        assert res["written"]["signals_new"] == 0 and res["written"]["signals_changed"] == 0

    def test_tampered_reused_snapshot_is_refused(self, db_session, tmp_env):
        from exofinder.data.archive import ArchiveError
        from exofinder.data.catalog import refresh_catalog

        refresh_catalog(db_session, client=_tap_client(FakeTAP()))
        (tce_file,) = (tmp_env / "catalogs").glob("dr24_tce_*.csv")
        tce_file.write_text(TCE_CSV.replace('"AFP"', '"PC"'), encoding="utf-8")
        with pytest.raises(ArchiveError, match="modified"):
            refresh_catalog(db_session, sources=("koi_cumulative",), client=_tap_client(FakeTAP()))

    def test_bad_sources(self, db_session):
        from exofinder.data.catalog import refresh_catalog

        tap = FakeTAP()
        with pytest.raises(ValueError, match="unknown catalogue source"):
            refresh_catalog(db_session, sources=("dr24_tce", "nope"), client=_tap_client(tap))
        assert tap.queries == []
        # nothing downloaded before and dr24_tce/koi not requested -> cannot ingest
        with pytest.raises(ValueError, match="dr24_tce and koi_cumulative"):
            refresh_catalog(db_session, sources=("confirmed",), client=_tap_client(tap))
