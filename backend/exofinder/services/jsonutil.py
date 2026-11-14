"""JSON conversion shared by services and routers.

Scientific code returns numpy arrays/scalars and uses NaN/Inf for undefined values; JSON has neither.
:func:`to_jsonable` converts recursively: numpy -> Python, NaN/Inf -> ``None``, datetimes -> ISO
strings, dataclasses -> dicts.
"""

from __future__ import annotations

import dataclasses
import math
from datetime import date, datetime
from pathlib import Path
from typing import Any

import numpy as np


def to_jsonable(obj: Any, *, float_digits: int | None = None) -> Any:
    """Recursively convert ``obj`` into JSON-serialisable built-ins (non-finite floats become None).

    ``float_digits`` optionally rounds floats (significant for large display arrays, never for metrics).
    """
    if obj is None or isinstance(obj, (str, bool)):
        return obj
    if isinstance(obj, int) and not isinstance(obj, bool):
        return obj
    if isinstance(obj, float):
        if not math.isfinite(obj):
            return None
        return round(obj, float_digits) if float_digits is not None else obj
    if isinstance(obj, np.generic):
        return to_jsonable(obj.item(), float_digits=float_digits)
    if isinstance(obj, np.ndarray):
        if obj.dtype.kind == "f":
            arr = obj.astype(np.float64)
            if float_digits is not None:
                arr = np.round(arr, float_digits)
            out = arr.tolist()
            return _nan_to_none(out)
        return [to_jsonable(x, float_digits=float_digits) for x in obj.tolist()]
    if isinstance(obj, dict):
        return {str(k): to_jsonable(v, float_digits=float_digits) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [to_jsonable(v, float_digits=float_digits) for v in obj]
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, Path):
        return str(obj)
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return to_jsonable(dataclasses.asdict(obj), float_digits=float_digits)
    if hasattr(obj, "to_dict"):
        return to_jsonable(obj.to_dict(), float_digits=float_digits)
    return str(obj)


def _nan_to_none(values: Any) -> Any:
    if isinstance(values, list):
        return [_nan_to_none(v) for v in values]
    if isinstance(values, float) and not math.isfinite(values):
        return None
    return values
