"""FITS readers: real Kepler fixtures and small synthetic BINTABLE files."""

from __future__ import annotations

import io

import numpy as np
import pytest
from astropy.io import fits

from exofinder.astro.errors import LightCurveFormatError
from exofinder.astro.io_fits import read_fits_lightcurve, read_kepler_fits


def test_read_kepler_quarter2(fixture_paths):
    lc = read_kepler_fits(fixture_paths["kepler2_q2"])
    m = lc.meta
    assert m["kepid"] == 10666592
    assert m["quarter"] == 2
    assert m["mission"] == "Kepler"
    assert m["time_system"] == "BKJD"
    assert m["flux_column"] == "PDCSAP_FLUX"
    assert m["quality_column"] == "SAP_QUALITY"
    assert m["cadence_days"] == pytest.approx(0.02043359821692, abs=1e-10)
    assert m["filename"] == "kplr010666592-2009259160929_llc.fits"
    # 4354 rows in the file, 160 have no time stamp at all (and no flux)
    assert m["n_cadences_file"] == 4354
    assert m["n_dropped_nan_time"] == 160
    assert len(lc) == 4354 - 160
    assert lc.time.dtype == np.float64
    assert np.all(np.diff(lc.time) > 0)
    assert 169.5 < lc.time[0] < lc.time[-1] < 258.5  # BKJD range of Q2 (TSTART/TSTOP)
    assert lc.segment is not None and np.all(lc.segment == 2)
    assert lc.quality is not None and lc.quality.dtype == np.int64
    assert np.count_nonzero(lc.quality) > 0
    assert lc.flux_err is not None and lc.flux_err.shape == lc.flux.shape
    # the reader is faithful: NaN fluxes and flagged cadences are kept for cleaning to handle
    assert np.isnan(lc.flux).sum() == 284 - 160
    assert np.nanmedian(lc.flux) > 1e5  # PDCSAP flux of a Kp=9.7 star in e-/s


def test_read_kepler_quarter3_and_kepler90(fixture_paths):
    q3 = read_kepler_fits(fixture_paths["kepler2_q3"])
    assert q3.meta["quarter"] == 3 and q3.meta["kepid"] == 10666592
    assert np.all(q3.segment == 3)
    assert 260.2 < q3.time[0] < q3.time[-1] < 349.6
    k90 = read_kepler_fits(fixture_paths["kepler90_q3"])
    assert k90.meta["kepid"] == 11442793 and k90.meta["quarter"] == 3
    assert k90.meta["time_system"] == "BKJD"


def test_read_from_bytes_and_file_object(fixture_paths):
    path = fixture_paths["kepler2_q2"]
    from_path = read_kepler_fits(path)
    from_bytes = read_kepler_fits(path.read_bytes())
    with open(path, "rb") as fh:
        from_fh = read_kepler_fits(fh)
    for lc in (from_bytes, from_fh):
        np.testing.assert_array_equal(lc.time, from_path.time)
        np.testing.assert_array_equal(lc.flux, from_path.flux)
        np.testing.assert_array_equal(lc.quality, from_path.quality)
    assert from_bytes.meta["filename"] is None
    assert from_fh.meta["filename"] == path.name


def test_generic_reader_on_kepler_file(fixture_paths):
    lc = read_fits_lightcurve(fixture_paths["kepler2_q2"])
    assert lc.meta["flux_column"] == "PDCSAP_FLUX"
    assert lc.meta["time_system"] == "BKJD" and lc.meta["mission"] == "Kepler"
    sap = read_fits_lightcurve(fixture_paths["kepler2_q2"], flux_column="sap_flux")
    assert sap.meta["flux_column"] == "SAP_FLUX"
    assert sap.meta["flux_err_column"] == "SAP_FLUX_ERR"
    assert not np.allclose(np.nan_to_num(sap.flux), np.nan_to_num(lc.flux))
    with pytest.raises(LightCurveFormatError, match="not found"):
        read_fits_lightcurve(fixture_paths["kepler2_q2"], flux_column="NOPE")


def _bintable_bytes(primary: dict, ext: dict, columns: dict[str, np.ndarray]) -> bytes:
    hdu0 = fits.PrimaryHDU()
    for k, v in primary.items():
        hdu0.header[k] = v
    cols = [
        fits.Column(name=n, format="D" if a.dtype.kind == "f" else "J", array=a) for n, a in columns.items()
    ]
    hdu1 = fits.BinTableHDU.from_columns(cols, name="LIGHTCURVE")
    for k, v in ext.items():
        hdu1.header[k] = v
    buf = io.BytesIO()
    fits.HDUList([hdu0, hdu1]).writeto(buf)
    return buf.getvalue()


def test_generic_reader_tess_like_table():
    # synthetic test table (not an observation)
    n = 300
    t = 1600.0 + np.arange(n) * 2.0 / 1440.0
    data = _bintable_bytes(
        {"TELESCOP": "TESS", "SECTOR": 14, "TICID": 123456},
        {"BJDREFI": 2457000, "BJDREFF": 0.0, "TIMEREF": "SOLARSYSTEM", "TIMEUNIT": "d"},
        {"TIME": t, "FLUX": np.ones(n), "FLUX_ERR": np.full(n, 1e-3), "QUALITY": np.zeros(n, dtype=np.int32)},
    )
    lc = read_fits_lightcurve(data)
    assert lc.meta["mission"] == "TESS"
    assert lc.meta["time_system"] == "BTJD"
    assert lc.meta["flux_column"] == "FLUX" and lc.meta["flux_err_column"] == "FLUX_ERR"
    assert lc.meta["sector"] == 14 and np.all(lc.segment == 14)
    assert lc.meta["ticid"] == 123456
    assert lc.quality is not None and len(lc) == n
    with pytest.raises(LightCurveFormatError, match="Not a Kepler quarter"):
        read_kepler_fits(data)


def test_generic_reader_unknown_time_system_and_errors():
    n = 50
    data = _bintable_bytes(
        {"TELESCOP": "OTHER"},
        {"BJDREFI": 2400000, "BJDREFF": 0.5},
        {"TIME": np.arange(n, dtype=float), "SAP_FLUX": np.ones(n)},
    )
    lc = read_fits_lightcurve(data)
    assert lc.meta["time_system"] == "unknown"
    assert lc.meta["bjd_reference"] == pytest.approx(2400000.5)
    assert lc.meta["flux_column"] == "SAP_FLUX"
    assert lc.segment is None and lc.quality is None and lc.flux_err is None

    no_flux = _bintable_bytes({}, {}, {"TIME": np.arange(n, dtype=float), "OTHER": np.ones(n)})
    with pytest.raises(LightCurveFormatError, match="No flux column"):
        read_fits_lightcurve(no_flux)
    no_time = _bintable_bytes({}, {}, {"T": np.arange(n, dtype=float), "FLUX": np.ones(n)})
    with pytest.raises(LightCurveFormatError, match="TIME"):
        read_fits_lightcurve(no_time)
    with pytest.raises(LightCurveFormatError, match="Not a valid FITS"):
        read_fits_lightcurve(b"this is not a fits file at all" * 10)


@pytest.mark.filterwarnings("ignore:File may have been truncated")
@pytest.mark.parametrize(
    "cut, match",
    [
        (11520, "Not a valid FITS"),  # inside the LIGHTCURVE header (astropy: missing END card)
        (233280, "truncated"),  # inside the LIGHTCURVE table data
        (455000, "truncated"),  # the last table rows are missing
        (460800, "Not a valid FITS"),  # inside the APERTURE header
        (463680 + 100, "truncated"),  # the APERTURE image data (168 bytes) are incomplete
    ],
)
def test_truncated_kepler_file_is_refused(fixture_paths, cut, match):
    """An interrupted download must raise LightCurveFormatError (never a raw OSError or a partial curve).

    Byte offsets refer to the Kepler-2 Q2 file layout: primary 0-5760, LIGHTCURVE header 5760-20160,
    table data 20160-457920 (435,400 bytes), APERTURE header 457920-463680, image data from 463680.
    """
    raw = fixture_paths["kepler2_q2"].read_bytes()
    assert len(raw) == 466560
    with pytest.raises(LightCurveFormatError, match=match):
        read_kepler_fits(raw[:cut])
    with pytest.raises(LightCurveFormatError, match=match):
        read_fits_lightcurve(raw[:cut])


@pytest.mark.filterwarnings("ignore:File may have been truncated")
def test_unpadded_final_block_is_accepted(fixture_paths):
    """Only trailing FITS padding missing (all declared data present): the file is complete."""
    raw = fixture_paths["kepler2_q2"].read_bytes()
    aperture_bytes = 4 * 7 * 6  # APERTURE: BITPIX=32, NAXIS1=7, NAXIS2=6 (int32 = 4 bytes)
    lc = read_kepler_fits(raw[: 463680 + aperture_bytes])
    np.testing.assert_array_equal(lc.time, read_kepler_fits(raw).time)
    with pytest.raises(LightCurveFormatError, match="truncated"):  # one byte short of the data
        read_kepler_fits(raw[: 463680 + aperture_bytes - 1])


def test_gzip_compressed_fits(fixture_paths, tmp_path):
    import gzip

    path = fixture_paths["kepler2_q2"]
    plain = read_kepler_fits(path)
    gz_path = tmp_path / (path.name + ".gz")
    gz_path.write_bytes(gzip.compress(path.read_bytes()))
    for lc in (read_kepler_fits(gz_path), read_fits_lightcurve(gz_path.read_bytes())):
        np.testing.assert_array_equal(lc.time, plain.time)
        np.testing.assert_array_equal(lc.flux, plain.flux)
    assert read_kepler_fits(gz_path).meta["filename"] == gz_path.name
    corrupt = gzip.compress(path.read_bytes())[:5000]
    with pytest.raises(LightCurveFormatError, match="gzip"):
        read_kepler_fits(corrupt)
