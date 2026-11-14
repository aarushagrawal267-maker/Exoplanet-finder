"""Tests for the shared service helpers (settings store, JSON conversion) and app start-up."""

from __future__ import annotations

import math

import numpy as np
import pytest


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["pipeline_version"]


def test_settings_store_roundtrip_and_overrides(db):
    from exofinder.config import get_settings
    from exofinder.services import app_settings

    values = app_settings.get_all(db)
    assert values["device"] == "cpu"  # from EXOF_DEVICE in the test env
    new = app_settings.update(db, {"download_workers": 3, "keep_raw_fits": True})
    assert new["download_workers"] == 3 and new["keep_raw_fits"] is True
    assert get_settings().download_workers == 3 and get_settings().keep_raw_fits is True
    assert app_settings.defaults()["download_workers"] != 3 or get_settings().download_workers == 3
    with pytest.raises(ValueError):
        app_settings.update(db, {"download_workers": 0})
    with pytest.raises(ValueError):
        app_settings.update(db, {"nope": 1})


def test_to_jsonable_handles_numpy_and_nan():
    from exofinder.services.jsonutil import to_jsonable

    out = to_jsonable({"a": np.array([1.0, np.nan, np.inf]), "b": np.float32(2.5), "c": [math.nan]})
    assert out == {"a": [1.0, None, None], "b": 2.5, "c": [None]}
