"""End-to-end operations flow on SYNTHETIC TEST DATA (see ops_testdata.py):

build dataset (parallel process pool) -> explore -> train logistic regression + tiny two-view CNN ->
evaluate (val + test) -> examples / feature importance / compare -> reports (md, html, json) ->
experiments compare -> activate / delete.

Every model trained here is a TEST FIXTURE (``is_fixture=True``) because the light curves are synthetic;
no number produced here is a scientific result.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import numpy as np
from ops_helpers import FAST_CNN, FAST_LOGREG, build_dataset, evaluate, train
from ops_testdata import RESERVED_TEST_KEPID


def _examples(client, ds_id: int, **params) -> list[dict]:
    r = client.get(f"/api/datasets/{ds_id}/examples", params={"limit": 500, **params})
    assert r.status_code == 200, r.text
    return r.json()["items"]


def test_full_operations_flow(ops_client, catalogue, monkeypatch):
    c = ops_client
    monkeypatch.setenv("EXOF_BUILD_WORKERS", "2")  # exercise the spawn-based process pool

    # ---- tiers from the live (synthetic) catalogue --------------------------------------------
    tiers = {t["tier"]: t for t in c.get("/api/datasets/tiers").json()}
    assert set(tiers) == {"pilot", "standard", "full"}
    assert tiers["full"]["n_signals"] == catalogue["n_labelled_with_lc"] + 2  # + no-LC + bad-ephemeris rows
    assert tiers["full"]["n_unlabelled_reserved"] == 1
    assert tiers["full"]["n_stars_missing"] == 1 and tiers["full"]["est_download_bytes"] > 0

    # ---- build ---------------------------------------------------------------------------------
    ds = build_dataset(c, "TEST flow dataset")
    ds_id, stats = ds["id"], ds["stats"]
    assert ds["status"] == "ready" and ds["is_synthetic"] and ds["compatible"]
    assert stats["processing"]["mode"] == "process_pool" and stats["processing"]["workers"] == 2
    assert stats["processing"]["n_errors"] == 1  # bad ephemeris
    ex = stats["exclusions_by_reason"]
    assert ex == {
        "label_conflict": 1,
        "no_av_label": 1,
        "no_ephemeris": 1,
        "no_lightcurve": 1,
        "quality:period_too_long": 1,
    }, ex
    assert stats["exclusion_reason_labels"]["quality:period_too_long"].startswith("Failed quality gate")
    assert ds["n_examples"] == ds["n_train"] + ds["n_val"] + ds["n_test"] == stats["n_included"]
    assert all(
        stats["per_split"][s]["n_pos"] > 0 and stats["per_split"][s]["n_neg"] > 0
        for s in ("train", "val", "test")
    )
    assert stats["quality_grades"] and stats["period_hist"]["counts"]["planet_like"]
    assert "Built from SYNTHETIC" in " ".join(stats["warnings"])

    # files + provenance
    path = Path(ds["path"])
    manifest = json.loads((path / "manifest.json").read_text())
    meta = manifest["meta"]
    assert (path / "arrays.npz").is_file() and (path / "lightcurves.json").is_file()
    assert meta["dataset_id"] == ds_id and meta["synthetic"] is True and meta["label_mode"] == "astronet_dr24"
    assert (
        meta["catalogue_snapshots"][0]["id"] == catalogue["snapshot_id"]
        and len(meta["catalogue_snapshots"][0]["sha256"]) == 64
    )
    assert meta["content_hash"] == ds["content_hash"] and len(meta["feature_names"]) == 15
    assert meta["lightcurves"]["n_stars"] > 0 and len(meta["lightcurves"]["digests_sha256"]) == 64

    # examples: reserved star forced to test, unlabelled reserved signal kept but excluded, no leakage
    items = _examples(c, ds_id)
    assert len(items) == stats["n_selected"]
    reserved = [e for e in items if e["kepid"] == RESERVED_TEST_KEPID]
    assert {(e["included"], e["split"], e["exclusion_reason"]) for e in reserved} == {
        (True, "test", None),
        (False, None, "no_av_label"),
    }
    assert all(e["quality_grade"] for e in reserved)  # both were processed
    splits_by_star = defaultdict(set)
    for e in items:
        if e["included"]:
            splits_by_star[e["kepid"]].add(e["split"])
            assert e["array_index"] is not None
    assert all(len(v) == 1 for v in splits_by_star.values())
    assert len(_examples(c, ds_id, included=False)) == stats["n_excluded"]
    assert [e["signal_key"] for e in _examples(c, ds_id, reason="no_lightcurve")] == ["TEST-NOLC-01"]

    # views: included (arrays) with phases equal to the pipeline's own bin centres
    inc = next(e for e in items if e["included"])
    v = c.get(f"/api/datasets/{ds_id}/examples/{inc['signal_id']}/views").json()
    assert v["source"] == "dataset_arrays" and len(v["global"]) == 2001 and len(v["local"]) == 201
    from exofinder.db.models import Signal
    from exofinder.db.session import session_scope
    from exofinder.services.signal_views import compute_signal_views

    with session_scope() as s:
        sv = compute_signal_views(s, s.get(Signal, inc["signal_id"]))
    np.testing.assert_allclose(v["global_phase"], sv.global_phase, rtol=0, atol=1e-5)
    np.testing.assert_allclose(v["local_phase"], sv.local_phase, rtol=0, atol=1e-5)
    np.testing.assert_allclose(v["local"], sv.local_view, atol=1e-5)
    unl = next(e for e in reserved if not e["included"])
    assert c.get(f"/api/datasets/{ds_id}/examples/{unl['signal_id']}/views").json()["source"] == "view_cache"
    nolc = _examples(c, ds_id, reason="no_lightcurve")[0]
    r = c.get(f"/api/datasets/{ds_id}/examples/{nolc['signal_id']}/views")
    assert r.status_code == 409 and r.json()["code"] == "views_unavailable"
    g = c.get(f"/api/datasets/{ds_id}/gallery", params={"per_class": 2, "seed": 1}).json()
    assert len(g["classes"]["planet_like"]) == 2 and len(g["classes"]["planet_like"][0]["global"]) == 401

    # ---- training ------------------------------------------------------------------------------
    est = c.get("/api/training/estimate", params={"model_type": "cnn_single", "dataset_id": ds_id}).json()
    assert est["seconds_per_epoch"] > 0 and est["n_train"] == ds["n_train"]
    exp_lr = train(c, ds_id, "logreg", FAST_LOGREG)
    mv_lr = exp_lr["model_version"]
    assert exp_lr["status"] == "succeeded" and mv_lr["is_fixture"] and mv_lr["is_active"]
    assert (
        "fixture" in exp_lr["tags"]
        and exp_lr["environment"]["torch"]
        and exp_lr["environment"]["pipeline_version"]
    )
    assert Path(mv_lr["checkpoint_path"]).name == str(mv_lr["id"]) and mv_lr["checkpoint_exists"]
    assert 0 <= mv_lr["val_metrics"]["pr_auc"] <= 1 and len(exp_lr["epochs"]) == 1

    exp_cnn = train(c, ds_id, "cnn_two_view", FAST_CNN)
    mv_cnn = exp_cnn["model_version"]
    assert [e["epoch"] for e in exp_cnn["epochs"]] == [1, 2] and len(exp_cnn["history"]) == 2
    assert mv_cnn["is_fixture"] and not mv_cnn["is_active"] and exp_cnn["config"]["fc_width"] == 16
    models = c.get("/api/models").json()
    assert {m["id"] for m in models} == {mv_lr["id"], mv_cnn["id"]}
    assert all(m["dataset_name"] == "TEST flow dataset" for m in models)
    detail = c.get(f"/api/models/{mv_lr['id']}").json()
    assert (
        detail["model_card"]["type"] == "logreg"
        and detail["bundle"]["best_params"]
        and detail["config"]["cv_folds"] == 2
    )
    from exofinder.config import get_settings

    assert not list(get_settings().models_dir.glob("_training_*"))  # temporary training dirs are cleaned up

    # ---- evaluation ----------------------------------------------------------------------------
    ev_val = evaluate(c, mv_lr["id"], "val")
    assert (
        ev_val["split"] == "val" and ev_val["n"] == ds["n_val"] and ev_val["test_evaluation_number"] is None
    )
    assert ev_val["metrics"]["pr_auc"] == mv_lr["val_metrics"]["pr_auc"]  # same model, same split
    ev_test = evaluate(c, mv_lr["id"], "test")
    assert ev_test["test_evaluation_number"] == 1 and ev_test["n"] == ds["n_test"]
    assert set(ev_test["curves"]) == {"roc", "pr", "calibration"} and set(ev_test["confusion"]) == {
        "tn",
        "fp",
        "fn",
        "tp",
    }
    assert ev_test["ci_method"]["resample"] == "star" and ev_test["timing"]["ms_per_sample_batch1"] > 0
    mv_lr_now = c.get(f"/api/models/{mv_lr['id']}").json()
    assert (
        mv_lr_now["test_metrics"]["evaluation_id"] == ev_test["id"] and mv_lr_now["n_test_evaluations"] == 1
    )
    ev_cnn = evaluate(c, mv_cnn["id"], "val")

    page = c.get(f"/api/evaluation/{ev_test['id']}/examples").json()
    assert page["total"] == ds["n_test"] and sum(page["counts"].values()) == ds["n_test"]
    assert page["items"][0]["local_view"] and len(page["items"][0]["local_view"]) == 201
    for outcome, n in page["counts"].items():
        sub = c.get(f"/api/evaluation/{ev_test['id']}/examples", params={"outcome": outcome}).json()
        assert sub["total"] == n and all(i["outcome"] == outcome for i in sub["items"])
    assert c.get(f"/api/evaluation/{ev_test['id']}/examples", params={"outcome": "xx"}).status_code == 422

    fi = c.get(f"/api/evaluation/{ev_val['id']}/feature-importance", params={"n_repeats": 2}).json()
    assert {f["feature"] for f in fi["features"]} >= {"global_view", "local_view", "depth_ppm"} and fi[
        "intrinsic"
    ]
    r = c.get(f"/api/evaluation/{ev_cnn['id']}/feature-importance")
    assert r.status_code == 409 and r.json()["code"] == "not_supported_for_cnn"

    cmp = c.get("/api/evaluation/compare", params={"ids": f"{ev_val['id']},{ev_cnn['id']}"}).json()
    assert cmp["comparable"] and any("TEST FIXTURE" in w for w in cmp["warnings"])
    pr = next(row for row in cmp["metrics"] if row["metric"] == "pr_auc")
    assert set(pr["values"]) == {str(ev_val["id"]), str(ev_cnn["id"])}
    cmp2 = c.get("/api/evaluation/compare", params={"ids": f"{ev_val['id']},{ev_test['id']}"}).json()
    assert not cmp2["comparable"] and any("different splits" in w for w in cmp2["warnings"])
    assert len(c.get("/api/evaluation", params={"model_version_id": mv_lr["id"]}).json()) == 2
    assert len(c.get("/api/evaluation", params={"split": "test"}).json()) == 1

    # ---- reports -------------------------------------------------------------------------------
    r = c.get(f"/api/reports/experiments/{exp_lr['id']}", params={"format": "md"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/markdown")
    assert "attachment" in r.headers["content-disposition"]
    md = r.text
    assert "research leads, not discoveries" in md and "TEST FIXTURE" in md
    assert meta["catalogue_snapshots"][0]["sha256"] in md and "## 7. Test results" in md
    assert f"{ev_test['metrics']['pr_auc']:.3f}" in md
    r_cnn = c.get(f"/api/reports/experiments/{exp_cnn['id']}", params={"format": "md"}).text
    assert "No test-set evaluation has been run for this model yet" in r_cnn
    html = c.get(f"/api/reports/experiments/{exp_lr['id']}", params={"format": "html"}).text
    assert html.startswith("<!doctype html>") and "<style>" in html
    assert "http://" not in html and "https://" not in html and "<script" not in html
    rep = c.get(f"/api/reports/experiments/{exp_lr['id']}", params={"format": "json"}).json()
    assert rep["test"]["available"] and rep["test"]["metrics"]["pr_auc"] == ev_test["metrics"]["pr_auc"]
    assert rep["is_fixture"] and rep["dataset"]["per_split"]["test"]["n"] == ds["n_test"]
    cr = c.get("/api/reports/comparison", params={"ids": f"{exp_lr['id']},{exp_cnn['id']}", "format": "md"})
    assert cr.status_code == 200 and "Configuration differences" in cr.text
    assert c.get("/api/reports/comparison", params={"ids": str(exp_lr["id"])}).json()["code"] == "invalid_ids"

    # ---- experiments ---------------------------------------------------------------------------
    exps = c.get("/api/experiments", params={"dataset_id": ds_id}).json()
    assert {e["id"] for e in exps} == {exp_lr["id"], exp_cnn["id"]}
    cmpx = c.get("/api/experiments/compare", params={"ids": f"{exp_lr['id']},{exp_cnn['id']}"}).json()
    assert any(row["key"] == "model_type" for row in cmpx["config_diff"])
    assert len(cmpx["curves"][str(exp_cnn["id"])]) == 2
    p = c.patch(
        f"/api/experiments/{exp_cnn['id']}",
        json={"name": "TEST renamed", "notes": "n", "tags": ["a", "a", "b"], "archived": True},
    ).json()
    assert (
        p["name"] == "TEST renamed"
        and p["tags"] == ["a", "b"]
        and p["archived"]
        and p["model_version"]["name"] == "TEST renamed"
    )
    assert [e["id"] for e in c.get("/api/experiments", params={"archived": True}).json()] == [exp_cnn["id"]]

    # ---- models: activate / delete; dataset delete --------------------------------------------
    act = c.post(f"/api/models/{mv_cnn['id']}/activate").json()
    assert act["is_active"] and not c.get(f"/api/models/{mv_lr['id']}").json()["is_active"]
    r = c.delete(f"/api/datasets/{ds_id}")
    assert r.status_code == 409 and r.json()["code"] == "dataset_in_use"
    d = c.delete(f"/api/experiments/{exp_cnn['id']}").json()
    assert d == {
        "deleted": True,
        "experiment_id": exp_cnn["id"],
        "experiments": 1,
        "models": 1,
        "evaluations": 1,
        "predictions": 0,
    }
    assert not Path(mv_cnn["checkpoint_path"]).exists()
    assert c.get(f"/api/models/{mv_lr['id']}").json()[
        "is_active"
    ]  # promoted after the active model was deleted
    r = c.delete(f"/api/models/{mv_lr['id']}")
    assert r.status_code == 409 and r.json()["code"] == "model_is_active"
    d = c.delete(f"/api/datasets/{ds_id}", params={"force": True}).json()
    assert d["deleted"] and d["models"] == 1 and d["experiments"] == 1 and d["evaluations"] == 2
    assert not path.exists() and not Path(mv_lr["checkpoint_path"]).exists()
    assert c.get(f"/api/datasets/{ds_id}").json()["code"] == "dataset_not_found"
    assert c.get("/api/models").json() == [] and c.get("/api/experiments").json() == []
