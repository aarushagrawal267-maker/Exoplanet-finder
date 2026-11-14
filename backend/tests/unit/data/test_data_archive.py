"""TAP client (mocked HTTP) and verbatim snapshot handling."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path

import pytest
import requests
from exof_data_testdata import KOI_CSV, STELLAR_CSV, TCE_CSV
from sqlalchemy import select

from exofinder.data import archive
from exofinder.data.archive import (
    ArchiveClient,
    ArchiveError,
    ArchiveQueryError,
    ArchiveUnavailableError,
    SnapshotValidationError,
    build_query,
    fetch_snapshot,
    latest_snapshot,
    load_snapshot_frame,
    validate_snapshot,
)
from exofinder.db.models import CatalogSnapshot


@dataclass
class FakeResponse:
    status_code: int
    content: bytes = b""
    headers: dict = field(default_factory=dict)


class FakeHTTP:
    """Replays a scripted list of responses/exceptions for POST requests and records calls."""

    def __init__(self, script):
        self.script = list(script)
        self.calls: list[dict] = []

    def post(self, url, data=None, timeout=None, headers=None):
        self.calls.append({"url": url, "data": dict(data or {}), "timeout": timeout})
        item = self.script.pop(0)
        if callable(item):
            item = item(data)
        if isinstance(item, Exception):
            raise item
        return item

    def close(self):
        pass


VOTABLE_ERROR = b"""<?xml version="1.0" encoding="UTF-8"?>
<VOTABLE version="1.4"><RESOURCE type="results">
<INFO name="QUERY_STATUS" value="ERROR">
ORA-00904: 'NOSUCHCOL': invalid identifier
</INFO></RESOURCE></VOTABLE>"""


def _client(http, **kw):
    sleeps: list[float] = []
    c = ArchiveClient("https://tap.example/TAP/sync", timeout=5, http=http, sleep=sleeps.append, **kw)
    return c, sleeps


class TestArchiveClient:
    def test_success_returns_dataframe_and_uses_post_csv(self, tmp_env):
        http = FakeHTTP([FakeResponse(200, b"kepid,x\n1,2.5\n3,4.5\n")])
        c, sleeps = _client(http)
        df = c.query("SELECT kepid, x FROM t")
        assert list(df.columns) == ["kepid", "x"] and df["x"].tolist() == [2.5, 4.5]
        assert http.calls[0]["data"] == {"query": "SELECT kepid, x FROM t", "format": "csv"}
        assert sleeps == []

    def test_retries_transient_errors_with_backoff(self, tmp_env):
        http = FakeHTTP(
            [
                requests.ConnectionError("reset"),
                requests.exceptions.ChunkedEncodingError("transfer cut off"),
                FakeResponse(429, headers={"Retry-After": "7"}),
                FakeResponse(503),
                FakeResponse(200, b"a\n1\n"),
            ]
        )
        c, sleeps = _client(http, max_retries=4, backoff_s=1.0)
        assert c.query_text("SELECT a FROM t") == "a\n1\n"
        # exponential backoff 1, 2, (4 -> Retry-After 7 is longer), 8
        assert sleeps == [1.0, 2.0, 7.0, 8.0]

    def test_gives_up_after_max_retries(self, tmp_env):
        http = FakeHTTP([requests.Timeout("slow")] * 3)
        c, sleeps = _client(http, max_retries=2, backoff_s=0.5)
        with pytest.raises(ArchiveUnavailableError, match="3 attempts"):
            c.query("SELECT 1")
        assert sleeps == [0.5, 1.0]

    def test_adql_error_is_not_retried(self, tmp_env):
        http = FakeHTTP([FakeResponse(400, VOTABLE_ERROR)])
        c, sleeps = _client(http)
        with pytest.raises(ArchiveQueryError, match="invalid identifier") as ei:
            c.query("SELECT nosuchcol FROM t")
        assert ei.value.status == 400 and len(http.calls) == 1 and sleeps == []

    def test_html_page_is_an_error(self, tmp_env):
        http = FakeHTTP([FakeResponse(403, b"<!DOCTYPE html><html><title>Attention Required</title></html>")])
        c, _ = _client(http)
        with pytest.raises(ArchiveQueryError, match="HTML"):
            c.query("SELECT 1")

    def test_empty_body_is_an_error(self, tmp_env):
        c, _ = _client(FakeHTTP([FakeResponse(200, b"  \n")]))
        with pytest.raises(ArchiveQueryError, match="empty"):
            c.query("SELECT 1")

    def test_body_cut_off_mid_line_is_retried(self, tmp_env):
        # A connection closed early without a transport error leaves a partial last record. It must
        # never be accepted: write_catalog deletes signals missing from a snapshot.
        full = b"kepid,x\n1,2.5\n3,4.5\n"
        http = FakeHTTP([FakeResponse(200, full[:-3]), FakeResponse(200, full)])
        c, sleeps = _client(http, backoff_s=1.0)
        assert c.query_bytes("SELECT kepid, x FROM t") == full
        assert len(http.calls) == 2 and sleeps == [1.0]

    def test_persistent_truncation_is_an_unavailable_error(self, tmp_env):
        http = FakeHTTP([FakeResponse(200, b"kepid,x\n1,2.5\n3,4")] * 3)
        c, _ = _client(http, max_retries=2)
        with pytest.raises(ArchiveUnavailableError, match="mid-line"):
            c.query("SELECT kepid, x FROM t")

    def test_retry_after_is_capped(self, tmp_env):
        from exofinder.data._util import MAX_RETRY_AFTER_S

        http = FakeHTTP([FakeResponse(503, headers={"Retry-After": "86400"}), FakeResponse(200, b"a\n1\n")])
        c, sleeps = _client(http, backoff_s=1.0)
        assert c.query_text("SELECT a FROM t") == "a\n1\n"
        assert sleeps == [MAX_RETRY_AFTER_S]

    def test_get_url_is_reproducible(self, tmp_env):
        c, _ = _client(FakeHTTP([]))
        assert c.get_url("SELECT a FROM t") == "https://tap.example/TAP/sync?query=SELECT+a+FROM+t&format=csv"


class TestQueries:
    def test_dr24_columns_and_order(self):
        (q,) = build_query("dr24_tce")
        assert q.startswith("SELECT kepid, tce_plnt_num, tce_period,") and "FROM q1_q17_dr24_tce" in q
        assert q.endswith("ORDER BY kepid, tce_plnt_num")
        assert "av_training_set" in q and "av_pred_class" not in q

    def test_confirmed_joins_keplernames(self):
        (q,) = build_query("confirmed")
        assert "FROM pscomppars p JOIN keplernames k ON p.pl_name = k.pl_name" in q

    def test_stellar_chunks(self, monkeypatch):
        monkeypatch.setattr(archive, "STELLAR_CHUNK_SIZE", 2)
        qs = build_query("stellar", [5, 3, 1, 3, 4])
        assert len(qs) == 2
        assert "kepid IN (1, 3)" in qs[0] and "kepid IN (4, 5)" in qs[1]
        assert all("st_delivname = 'q1_q17_dr25_stellar'" in q for q in qs)

    def test_unknown_source(self):
        with pytest.raises(ValueError):
            build_query("nope")


class TestValidation:
    def test_valid_test_snapshot(self):
        import io

        import pandas as pd

        v = validate_snapshot("dr24_tce", pd.read_csv(io.StringIO(TCE_CSV)), live=False)
        assert v["ok"] and v["errors"] == [] and v["row_count"] == 15

    def test_live_row_count_warning(self):
        import io

        import pandas as pd

        v = validate_snapshot("dr24_tce", pd.read_csv(io.StringIO(TCE_CSV)), live=True)
        assert v["ok"] and any("below expected minimum" in w for w in v["warnings"])

    def test_range_and_category_violations_are_counted(self):
        import io

        import pandas as pd

        df = pd.read_csv(io.StringIO(TCE_CSV))
        df.loc[0, "tce_period"] = -1.0
        df.loc[1, "av_training_set"] = "XYZ"
        v = validate_snapshot("dr24_tce", df, live=False)
        assert v["ok"]
        assert v["checks"]["out_of_range_tce_period"] == 1
        assert v["checks"]["unexpected_av_training_set"] == 1

    def test_missing_kepid_is_fatal(self):
        import io

        import pandas as pd

        df = pd.read_csv(io.StringIO(KOI_CSV))
        df.loc[0, "kepid"] = None
        v = validate_snapshot("koi_cumulative", df, live=False)
        assert not v["ok"] and any("no kepid" in e for e in v["errors"])


class TestFetchSnapshot:
    def test_saves_verbatim_with_hash_and_records_row(self, tmp_env, db_session):
        body = TCE_CSV.encode()
        http = FakeHTTP([FakeResponse(200, body)])
        client, _ = _client(http)
        res = fetch_snapshot("dr24_tce", client=client, session=db_session)
        assert res.path.parent == tmp_env / "catalogs" and res.path.name.startswith("dr24_tce_")
        assert res.path.read_bytes() == body  # byte-for-byte
        assert res.sha256 == hashlib.sha256(body).hexdigest()
        assert res.row_count == 15 and res.validation["ok"]
        row = db_session.get(CatalogSnapshot, res.snapshot_id)
        assert row.source == "dr24_tce" and row.table_name == "q1_q17_dr24_tce"
        assert row.query == build_query("dr24_tce")[0]
        assert row.url.startswith("https://tap.example/TAP/sync?query=SELECT")
        assert row.file_path == f"catalogs/{res.path.name}"  # relative to the data dir
        assert latest_snapshot(db_session, "dr24_tce").id == row.id
        assert len(load_snapshot_frame(row)) == 15

    def test_stellar_chunks_are_concatenated_verbatim(self, tmp_env, db_session, monkeypatch):
        monkeypatch.setattr(archive, "STELLAR_CHUNK_SIZE", 2)
        lines = STELLAR_CSV.splitlines(keepends=True)
        header, rows = lines[0], lines[1:]
        # rows are kepid-sorted by the query: 1000001 | 10666592, 11442793
        chunks = [
            FakeResponse(200, (header + rows[2]).encode()),
            FakeResponse(200, (header + rows[0] + rows[1]).encode()),
        ]
        client, _ = _client(FakeHTTP(chunks))
        res = fetch_snapshot(
            "stellar", client=client, session=db_session, kepids=[11442793, 10666592, 1000001]
        )
        assert res.path.read_text() == header + rows[2] + rows[0] + rows[1]
        assert res.row_count == 3 and res.validation["n_queries"] == 2
        assert res.query.count("-- chunk") == 2 and "kepid IN (1000001, 10666592)" in res.query

    def test_invalid_snapshot_is_kept_but_not_recorded(self, tmp_env, db_session):
        body = TCE_CSV.replace("tce_period,", "tce_periodX,", 1).encode()
        client, _ = _client(FakeHTTP([FakeResponse(200, body)]))
        with pytest.raises(SnapshotValidationError, match="tce_period"):
            fetch_snapshot("dr24_tce", client=client, session=db_session)
        assert db_session.scalars(select(CatalogSnapshot)).all() == []
        assert len(list((tmp_env / "catalogs").glob("dr24_tce_*.csv"))) == 1

    def test_tampered_file_is_detected(self, tmp_env, db_session):
        client, _ = _client(FakeHTTP([FakeResponse(200, KOI_CSV.encode())]))
        res = fetch_snapshot("koi_cumulative", client=client, session=db_session)
        Path(res.path).write_text(KOI_CSV.replace("CONFIRMED", "CANDIDATE"), encoding="utf-8")
        with pytest.raises(ArchiveError, match="modified"):
            load_snapshot_frame(db_session.get(CatalogSnapshot, res.snapshot_id))

    def test_two_snapshots_in_same_second_get_distinct_files(self, tmp_env, db_session, monkeypatch):
        from datetime import datetime

        monkeypatch.setattr(archive, "utcnow", lambda: datetime(2026, 1, 2, 3, 4, 5))
        client, _ = _client(FakeHTTP([FakeResponse(200, KOI_CSV.encode())] * 2))
        a = fetch_snapshot("koi_cumulative", client=client, session=db_session)
        b = fetch_snapshot("koi_cumulative", client=client, session=db_session)
        assert a.path != b.path and a.path.name == "koi_cumulative_20260102T030405Z.csv"
