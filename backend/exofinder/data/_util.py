"""Small shared helpers for the data package (cancellation, atomic files, hashing, retry backoff).

These helpers are private to :mod:`exofinder.data`; other packages should use the public module APIs.
"""

from __future__ import annotations

import hashlib
import math
import os
import tempfile
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

import requests

#: HTTP status codes that indicate a transient server-side problem worth retrying.
RETRYABLE_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})

#: requests exceptions that indicate a transient transport problem (including a transfer cut off
#: mid-body, which raises ChunkedEncodingError rather than ConnectionError).
RETRYABLE_EXCEPTIONS: tuple[type[BaseException], ...] = (
    requests.ConnectionError,
    requests.Timeout,
    requests.exceptions.ChunkedEncodingError,
    requests.exceptions.ContentDecodingError,
)


@runtime_checkable
class _EventLike(Protocol):
    def is_set(self) -> bool: ...


#: A cancellation token: ``None``, a ``threading.Event``-like object, or a zero-argument callable.
CancelToken = _EventLike | Callable[[], bool] | None

#: Progress callback used throughout the package: ``progress(done, total, message)``.
ProgressCallback = Callable[[int, int, str], None]


def is_cancelled(cancel: Any) -> bool:
    """Return True if the cancellation token says the operation should stop.

    Accepts ``None`` (never cancelled), any object with an ``is_set()`` method (e.g.
    ``threading.Event``), or a callable returning a truthy value when cancellation is requested.
    """
    if cancel is None:
        return False
    if isinstance(cancel, _EventLike):
        return bool(cancel.is_set())
    if callable(cancel):
        return bool(cancel())
    raise TypeError(f"Unsupported cancel token of type {type(cancel).__name__}")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: str | Path, chunk_size: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            block = fh.read(chunk_size)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


#: Attempts for :func:`replace_with_retry` (total wait ≈ 1.5 s with the default delay).
REPLACE_ATTEMPTS = 6


def replace_with_retry(
    src: str | Path, dst: str | Path, *, attempts: int = REPLACE_ATTEMPTS, delay_s: float = 0.05
) -> None:
    """:func:`os.replace` that retries briefly on ``PermissionError``.

    On Windows, replacing a file that another thread/process has open (a concurrent reader, an
    antivirus or indexing service) fails with a sharing violation (``PermissionError``, WinError
    5/32) that clears within milliseconds. POSIX never raises it for this reason, so behaviour
    there is unchanged. The last error is re-raised if the destination stays locked.
    """
    for attempt in range(max(1, attempts)):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if attempt >= attempts - 1:
                raise
            time.sleep(delay_s * (2**attempt))


def atomic_write_bytes(path: str | Path, data: bytes) -> Path:
    """Write ``data`` to ``path`` atomically.

    The bytes are first written to a uniquely named temporary file in the same directory, flushed
    and fsync'ed, then moved into place with :func:`os.replace` (atomic on POSIX and Windows when
    source and destination are on the same filesystem; retried briefly on Windows sharing
    violations, see :func:`replace_with_retry`). Readers therefore never observe a half-written
    file, even if the process is killed mid-write.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.part")
    try:
        with open(tmp, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        replace_with_retry(tmp, path)
    finally:
        if tmp.exists():  # only if os.replace failed
            tmp.unlink(missing_ok=True)
    return path


def atomic_writer_path(path: str | Path) -> Path:
    """Return a temporary sibling path for callers that need to stream into a file themselves.

    The caller must ``os.replace(tmp, path)`` on success and remove ``tmp`` on failure.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".part", dir=path.parent)
    os.close(fd)
    return Path(name)


def backoff_delay(attempt: int, base_s: float, cap_s: float = 60.0) -> float:
    """Deterministic exponential backoff: ``base * 2**attempt`` capped at ``cap_s``.

    No random jitter is used so that behaviour (and tests) are reproducible; the number of
    concurrent clients in this application is small, so synchronised retries are not a concern.
    """
    return float(min(cap_s, base_s * math.pow(2.0, attempt)))


#: Upper bound on a server-requested ``Retry-After`` wait. Retry sleeps are not interruptible by
#: cancellation, so an unbounded value (e.g. ``Retry-After: 86400`` during archive maintenance)
#: would freeze a worker thread; beyond this the request simply fails after its retries.
MAX_RETRY_AFTER_S = 120.0


def parse_retry_after(value: str | None, cap_s: float = MAX_RETRY_AFTER_S) -> float | None:
    """Parse an HTTP ``Retry-After`` header given in seconds (HTTP-date form is ignored).

    The result is clamped to ``cap_s`` (see :data:`MAX_RETRY_AFTER_S`); NaN/inf/negative → None.
    """
    if not value:
        return None
    try:
        secs = float(value.strip())
    except ValueError:
        return None
    if not math.isfinite(secs) or secs < 0:
        return None
    return min(secs, float(cap_s))
