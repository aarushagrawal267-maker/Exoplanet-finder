"""Private helpers of exofinder.data: Retry-After parsing and atomic replacement on Windows."""

from __future__ import annotations

import os

import pytest

from exofinder.data import _util
from exofinder.data._util import MAX_RETRY_AFTER_S, atomic_write_bytes, parse_retry_after


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        ("", None),
        ("7", 7.0),
        (" 2.5 ", 2.5),
        ("-1", None),
        ("nan", None),
        ("inf", None),
        ("Wed, 21 Oct 2015 07:28:00 GMT", None),  # HTTP-date form is ignored
        ("86400", MAX_RETRY_AFTER_S),  # a day-long wait would freeze a worker thread
    ],
)
def test_parse_retry_after(value, expected):
    assert parse_retry_after(value) == expected


def test_atomic_write_retries_windows_sharing_violation(tmp_path, monkeypatch):
    """os.replace onto a file another reader holds open fails transiently on Windows (WinError 32)."""
    real_replace = os.replace
    attempts = []

    def flaky_replace(src, dst):
        attempts.append(dst)
        if len(attempts) < 3:
            raise PermissionError(32, "The process cannot access the file because it is being used")
        real_replace(src, dst)

    monkeypatch.setattr(_util.os, "replace", flaky_replace)
    monkeypatch.setattr(_util.time, "sleep", lambda s: None)
    target = tmp_path / "x.bin"
    target.write_bytes(b"old")
    atomic_write_bytes(target, b"new")
    assert target.read_bytes() == b"new" and len(attempts) == 3
    assert [p.name for p in tmp_path.iterdir()] == ["x.bin"]  # no leftover temporary file


def test_atomic_write_gives_up_and_cleans_up(tmp_path, monkeypatch):
    def locked(src, dst):
        raise PermissionError(5, "Access is denied")

    monkeypatch.setattr(_util.os, "replace", locked)
    monkeypatch.setattr(_util.time, "sleep", lambda s: None)
    target = tmp_path / "x.bin"
    target.write_bytes(b"old")
    with pytest.raises(PermissionError):
        atomic_write_bytes(target, b"new")
    assert target.read_bytes() == b"old"
    assert [p.name for p in tmp_path.iterdir()] == ["x.bin"]
