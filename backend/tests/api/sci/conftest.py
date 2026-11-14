"""Fixtures for the science/interactive API tests.

TEST DATA ONLY. The catalogue rows are the HAND-MADE test snapshots of
``tests/unit/data/exof_data_testdata.py`` (a few rows copy published Kepler-2 / Kepler-90 values; the
rest are invented), ingested into the temporary database of the ``api_env`` fixture. Light curves
are the REAL public Kepler FITS fixtures (Kepler-2 Q2+Q3, Kepler-90 Q3) stitched into the temporary
light-curve cache. The model is a TEST FIXTURE: a logistic regression trained on SYNTHETIC toy views
(``is_fixture=True``); none of its outputs mean anything scientifically.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pytest
from sci_testlib import KEPLER2, KEPLER2_FITS, KEPLER90, KEPLER90_FITS, cache_star, write_catalog_files


@pytest.fixture(autouse=True)
def _clear_service_caches():
    """In-memory caches are keyed by file signature; clear them so tests stay independent."""
    from exofinder.services import analysis, lightcurves, predictions

    lightcurves.clear_cache()
    analysis.clear_caches()
    predictions.clear_predictor_cache()
    yield
    lightcurves.clear_cache()
    analysis.clear_caches()
    predictions.clear_predictor_cache()


@pytest.fixture()
def sci_catalog(api_env: Path, tmp_path: Path) -> dict[str, Any]:
    """TEST DATA catalogue in the temporary DB + real Kepler-2 (Q2+Q3) and Kepler-90 (Q3) caches."""
    from sqlalchemy import select

    from exofinder.data.catalog import ingest_from_files
    from exofinder.db.models import Signal
    from exofinder.db.session import session_scope

    files = write_catalog_files(tmp_path / "testdata_catalogs")
    with session_scope() as s:
        ingest_from_files(s, files)
    cache_star(KEPLER2, KEPLER2_FITS)
    cache_star(KEPLER90, KEPLER90_FITS)
    with session_scope() as s:
        sigs = {x.signal_key: x.id for x in s.scalars(select(Signal))}
    return {"signals": sigs, "files": files}


# --------------------------------------------------------------------------------------------------
# fixture model (SYNTHETIC training data, is_fixture=True)
# --------------------------------------------------------------------------------------------------
def _toy_arrays(seed: int = 0):
    """SYNTHETIC toy views with the real view geometry (2001/201 bins) and the real feature names."""
    from exofinder.astro.features import FEATURE_NAMES
    from exofinder.config import GLOBAL_VIEW_BINS, LOCAL_VIEW_BINS, PIPELINE_VERSION
    from exofinder.ml.dataset_arrays import DatasetArrays
    from exofinder.ml.splits import star_level_split

    rng = np.random.default_rng(seed)
    xg = np.linspace(-0.5, 0.5, GLOBAL_VIEW_BINS)
    xl = np.linspace(-2.0, 2.0, LOCAL_VIEW_BINS)
    G, L, F, y, sid, kep = [], [], [], [], [], []
    for s in range(48):
        label = s % 2
        for _ in range(1 + s % 2):
            if label:
                loc = -1.0 * (np.abs(xl) < 0.45)
                glob = -1.0 * (np.abs(xg) < 0.004)
            else:
                loc = -np.clip(1.0 - np.abs(xl) / 0.6, 0, None)
                glob = -np.clip(1.0 - np.abs(xg) / 0.006, 0, None) - 0.5 * (np.abs(xg) > 0.49)
            G.append((glob + rng.normal(0, 0.05, xg.size)).astype(np.float32))
            L.append((loc + rng.normal(0, 0.05, xl.size)).astype(np.float32))
            F.append(rng.normal(0, 1, len(FEATURE_NAMES)).astype(np.float32))
            y.append(label)
            sid.append(len(sid) + 1)
            kep.append(5_000_000 + s)
    labels = np.asarray(y, dtype=np.int64)
    kepids = np.asarray(kep, dtype=np.int64)
    return DatasetArrays(
        global_view=np.stack(G),
        local_view=np.stack(L),
        features=np.stack(F),
        labels=labels,
        signal_ids=np.asarray(sid, dtype=np.int64),
        kepids=kepids,
        splits=star_level_split(kepids, labels, fractions=(0.6, 0.2, 0.2), seed=seed),
        feature_names=list(FEATURE_NAMES),
        meta={"synthetic": True, "pipeline_version": PIPELINE_VERSION, "dataset_id": "sci-test-fixture"},
    )


@pytest.fixture(scope="session")
def fixture_bundle(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A real model bundle (logistic regression) trained on SYNTHETIC arrays — TEST FIXTURE."""
    from exofinder.ml.train import TrainConfig, train

    out = tmp_path_factory.mktemp("sci_fixture_logreg")
    train(
        TrainConfig(model_type="logreg", seed=3, num_threads=2, logreg_c_grid=(0.1, 1.0)), _toy_arrays(), out
    )
    return out


@pytest.fixture()
def fixture_model(sci_catalog: dict[str, Any], fixture_bundle: Path) -> dict[str, Any]:
    """Register the fixture bundle as the active ModelVersion (is_fixture=True). Its dataset (TEST
    DATA) holds Kepler-2 in the TRAIN split and Kepler-90 in the TEST split, so ``seen_in_split``
    paths can be checked."""
    import json

    from exofinder.config import PIPELINE_VERSION
    from exofinder.db.models import Dataset, DatasetExample, ModelVersion
    from exofinder.db.session import session_scope

    meta = json.loads((fixture_bundle / "meta.json").read_text())
    sigs = sci_catalog["signals"]
    with session_scope() as s:
        ds = Dataset(
            name="TEST DATA fixture dataset",
            label_mode="astronet_dr24",
            tier="custom",
            status="ready",
            pipeline_version=PIPELINE_VERSION,
        )
        s.add(ds)
        s.flush()
        s.add(
            DatasetExample(
                dataset_id=ds.id, signal_id=sigs["TCE-010666592-01"], kepid=KEPLER2, label=1, split="train"
            )
        )
        s.add(
            DatasetExample(
                dataset_id=ds.id, signal_id=sigs["TCE-011442793-01"], kepid=KEPLER90, label=1, split="test"
            )
        )
        mv = ModelVersion(
            name="TEST FIXTURE logreg (synthetic)",
            model_type="logreg",
            dataset_id=ds.id,
            pipeline_version=PIPELINE_VERSION,
            checkpoint_path=str(fixture_bundle),
            threshold=float(meta["threshold"]),
            temperature=float(meta["temperature"]),
            is_active=True,
            is_fixture=True,
        )
        s.add(mv)
        s.flush()
        return {"model_id": mv.id, "dataset_id": ds.id, "signals": sigs}
