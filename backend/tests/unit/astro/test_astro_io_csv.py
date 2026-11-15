"""CSV reader: column detection, time systems and user-facing error messages."""

from __future__ import annotations

import io

import numpy as np
import pandas as pd
import pytest

from exofinder.astro.errors import LightCurveFormatError
from exofinder.astro.io_csv import detect_columns, read_csv_lightcurve


def _table(
    n: int = 200, t0: float = 131.5, header=("time", "flux", "flux_err"), sep: str = ",", seed: int = 0
) -> str:
    rng = np.random.default_rng(seed)
    t = t0 + np.arange(n) * 0.0204
    f = 1.0 + 1e-4 * rng.standard_normal(n)
    e = np.full(n, 1e-4)
    rows = [sep.join(header)] + [sep.join(f"{v:.10f}" for v in row) for row in zip(t, f, e, strict=True)]
    return "\n".join(rows) + "\n"


@pytest.mark.parametrize(
    "columns, expected",
    [
        (
            ["TIME [BKJD]", "PDCSAP_FLUX", "PDCSAP_FLUX_ERR", "SAP_QUALITY"],
            {
                "time": "TIME [BKJD]",
                "flux": "PDCSAP_FLUX",
                "flux_err": "PDCSAP_FLUX_ERR",
                "quality": "SAP_QUALITY",
            },
        ),
        (
            ["bjd", "rel_flux", "flux_err"],
            {"time": "bjd", "flux": "rel_flux", "flux_err": "flux_err", "quality": None},
        ),
        (
            ["Time (days)", "Flux", "Flux Error", "Quality"],
            {"time": "Time (days)", "flux": "Flux", "flux_err": "Flux Error", "quality": "Quality"},
        ),
        (["flux_err", "flux", "t"], {"time": "t", "flux": "flux", "flux_err": "flux_err", "quality": None}),
    ],
)
def test_detect_columns_by_name(columns, expected):
    df = pd.DataFrame({c: np.arange(5, dtype=float) for c in columns})
    assert detect_columns(df) == expected


def test_detect_columns_positional_fallback():
    df = pd.DataFrame({"a": np.arange(10.0), "b": np.ones(10), "c": np.ones(10)})
    assert detect_columns(df) == {"time": "a", "flux": "b", "flux_err": None, "quality": None}


def test_read_basic_csv_sorted_and_meta():
    text = _table()
    lines = text.strip().split("\n")
    shuffled = "\n".join([lines[0], *lines[1:][::-1]]) + "\n"  # reverse order
    lc = read_csv_lightcurve(shuffled.encode())
    assert len(lc) == 200
    assert np.all(np.diff(lc.time) > 0)
    assert lc.time.dtype == np.float64
    assert lc.flux_err is not None and lc.segment is None
    assert lc.meta["time_system"] == "BKJD" and lc.meta["source"] == "csv"
    assert lc.meta["columns"] == {"time": "time", "flux": "flux", "flux_err": "flux_err", "quality": None}
    assert lc.meta["cadence_days"] == pytest.approx(0.0204, rel=1e-6)


def test_read_bjd_converted_to_bkjd_and_other_inputs(tmp_path):
    text = _table(t0=2455000.25)
    lc = read_csv_lightcurve(io.StringIO(text), time_system="BJD")
    assert lc.time[0] == pytest.approx(2455000.25 - 2454833.0)
    assert lc.meta["time_system"] == "BKJD" and lc.meta["time_input_system"] == "BJD"
    path = tmp_path / "lc.csv"
    path.write_text(_table())
    assert read_csv_lightcurve(path).meta["filename"] == "lc.csv"
    rel = read_csv_lightcurve(path, time_system="days")
    assert rel.meta["time_system"] == "unknown"
    btjd = read_csv_lightcurve(path, time_system="BTJD")
    assert btjd.meta["time_system"] == "BTJD"


def test_whitespace_delimited_with_comments_and_mapping():
    body = _table(header=("t_obs", "brightness", "unc"), sep=" ")
    text = "# exported light curve\n# units: days, relative flux\n" + body
    lc = read_csv_lightcurve(
        text.encode(), mapping={"time": "t_obs", "flux": "brightness", "flux_err": "unc"}
    )
    assert len(lc) == 200
    assert lc.meta["columns"]["flux"] == "brightness"


def test_headerless_numeric_file():
    body = "\n".join(_table().strip().split("\n")[1:]) + "\n"
    lc = read_csv_lightcurve(body.encode())
    assert len(lc) == 200
    assert lc.meta["columns"]["time"] == "col_0" and lc.meta["columns"]["flux"] == "col_1"


def test_exact_duplicate_rows_dropped():
    lines = _table().strip().split("\n")
    text = "\n".join(lines + lines[1:11]) + "\n"
    lc = read_csv_lightcurve(text.encode())
    assert len(lc) == 200
    assert lc.meta["n_exact_duplicates_dropped"] == 10


def test_error_non_numeric():
    lines = _table().strip().split("\n")
    lines[6] = "136.0,abc,0.0001"
    with pytest.raises(LightCurveFormatError, match=r"flux column 'flux' contains non-numeric values.*'abc'"):
        read_csv_lightcurve("\n".join(lines).encode())


def test_error_too_few_points():
    with pytest.raises(LightCurveFormatError, match=r"Only 50 rows.*at least 100"):
        read_csv_lightcurve(_table(n=50).encode())


def test_error_all_nan_flux():
    n = 150
    text = "time,flux\n" + "\n".join(f"{131.5 + i * 0.02},nan" for i in range(n)) + "\n"
    with pytest.raises(LightCurveFormatError, match="no numeric values"):
        read_csv_lightcurve(text.encode())


def test_error_non_monotonic_duplicates():
    lines = _table().strip().split("\n")
    t_dup = lines[10].split(",")[0]
    lines[11] = f"{t_dup},1.5,0.0001"  # same time, different flux
    with pytest.raises(LightCurveFormatError, match="not strictly increasing"):
        read_csv_lightcurve("\n".join(lines).encode())


def test_error_time_system_mismatch_and_bad_flux():
    with pytest.raises(LightCurveFormatError, match="'BJD'"):
        read_csv_lightcurve(_table(t0=2455000.0).encode(), time_system="BKJD")
    with pytest.raises(LightCurveFormatError, match="not full Julian dates"):
        read_csv_lightcurve(_table().encode(), time_system="BJD")
    with pytest.raises(LightCurveFormatError, match="Unknown time system"):
        read_csv_lightcurve(_table().encode(), time_system="MJD")
    neg = "time,flux\n" + "\n".join(f"{131.5 + i * 0.02},{-1e-4 * (i % 3)}" for i in range(150)) + "\n"
    with pytest.raises(LightCurveFormatError, match="positive flux"):
        read_csv_lightcurve(neg.encode())


def test_error_missing_columns():
    with pytest.raises(LightCurveFormatError, match="not in the file"):
        read_csv_lightcurve(_table().encode(), mapping={"time": "time", "flux": "nope"})
    text = "alpha,beta\n" + "\n".join(f"x{i},y{i}" for i in range(150)) + "\n"
    with pytest.raises(LightCurveFormatError, match="Could not identify the time column"):
        read_csv_lightcurve(text.encode())
    with pytest.raises(LightCurveFormatError, match="empty"):
        read_csv_lightcurve(b"   \n")


def test_headerless_first_row_with_repeated_values_is_kept():
    """pandas renames duplicate header names ("1.0", "1.0.1"); the first data row must not be lost."""
    lines = _table().strip().split("\n")[1:]
    lines[0] = "1.0000000000,1.0000000000,0.0001000000"  # first data row: time == flux
    lc = read_csv_lightcurve(("\n".join(lines) + "\n").encode())
    assert len(lc) == 200
    assert lc.meta["columns"]["time"] == "col_0"
    assert lc.time[0] == 1.0 and lc.flux[0] == 1.0


def test_duplicates_cannot_bring_rows_below_minimum():
    lines = _table(n=60).strip().split("\n")
    text = "\n".join(lines + lines[1:46]) + "\n"  # 105 rows, 60 distinct
    with pytest.raises(LightCurveFormatError, match=r"Only 60 distinct rows.*45 exact duplicate"):
        read_csv_lightcurve(text.encode())


def test_windows_text_encodings():
    """Excel "Unicode text" (UTF-16 with BOM, tab-separated) and Windows-1252 headers are read."""
    base = read_csv_lightcurve(_table().encode())
    utf16 = read_csv_lightcurve(_table(sep="\t").encode("utf-16"))
    np.testing.assert_array_equal(utf16.time, base.time)
    np.testing.assert_array_equal(utf16.flux, base.flux)
    cp1252 = _table(header=("time", "flux (e·s-1)", "flux_err"))  # middle dot = byte 0xB7 in cp1252
    lc = read_csv_lightcurve(cp1252.encode("cp1252"))
    assert len(lc) == 200 and lc.meta["columns"]["flux"].startswith("flux (e")
    with pytest.raises(LightCurveFormatError, match="binary"):
        read_csv_lightcurve(b"\x00\x01\x02\xff\xfe" * 100)


def test_modified_julian_dates_declared_as_bkjd_are_refused():
    """MJD ~ 55,000 is not BKJD (Kepler BKJD spans ~120-1600): folding would use wrong phases."""
    mjd = _table(t0=55000.25).encode()
    for system in ("BKJD", "BTJD"):
        with pytest.raises(LightCurveFormatError, match="look like MJD"):
            read_csv_lightcurve(mjd, time_system=system)
    assert read_csv_lightcurve(mjd, time_system="days").meta["time_system"] == "unknown"
    negative = read_csv_lightcurve(_table(t0=-1333.0).encode())  # pre-Kepler epochs are negative BKJD
    assert negative.time[0] == pytest.approx(-1333.0)
