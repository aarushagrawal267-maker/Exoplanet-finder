"""CLI tests in a temporary environment (fresh install, then SYNTHETIC TEST DATA)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest


def _run(capsys, *argv: str) -> tuple[int, str]:
    from exofinder.cli import main

    code = main(list(argv))
    out = capsys.readouterr()
    return code, out.out + out.err


def test_cli_fresh_install(api_env, capsys):
    code, out = _run(capsys, "init")
    assert code == 0 and "initialised" in out and str(api_env) in out
    assert _run(capsys, "init")[0] == 0  # idempotent
    code, out = _run(capsys, "doctor", "--no-network")
    assert (
        code == 0
        and "[ok]   database" in out
        and "catalogue: not downloaded yet" in out
        and "Result: OK" in out
    )
    code, out = _run(capsys, "doctor", "--no-network", "--json")
    report = json.loads(out)
    assert report["ok"] and any(
        r["check"] == "NASA services" and r["status"] == "skip" for r in report["checks"]
    )
    code, out = _run(capsys, "status")
    assert code == 0 and "not downloaded yet" in out and "Datasets" in out
    code, out = _run(capsys, "train", "--model-type", "logreg", "--dataset", "1")
    assert code == 1 and "Dataset not found" in out
    with pytest.raises(SystemExit) as exc:
        _run(capsys, "train", "--model-type", "svm", "--dataset", "1")
    assert exc.value.code == 2
    assert _run(capsys)[0] == 2  # no command: help + usage exit code


def test_cli_build_train_evaluate_report_predict(catalogue, capsys, tmp_path):
    code, out = _run(capsys, "build-dataset", "--name", "TEST cli", "--tier", "full", "--workers", "1")
    assert code == 0, out
    assert "Dataset #1 ready" in out and "exclusions:" in out and "processing:" in out
    code, out = _run(
        capsys,
        "train",
        "--model-type",
        "logreg",
        "--dataset",
        "1",
        "--set",
        "cv_folds=2",
        "--set",
        "logreg_c_grid=[0.1, 1.0]",
    )
    assert code == 0, out
    assert "-> model #1 (logreg)" in out and "[active]" in out
    code, out = _run(capsys, "evaluate", "--model", "1", "--split", "val", "--n-boot", "20")
    assert code == 0 and "Evaluation #1 (val" in out
    report = tmp_path / "r.html"
    code, out = _run(capsys, "report", "--experiment", "1", "--format", "html", "--out", str(report))
    assert code == 0 and report.read_text().startswith("<!doctype html>")
    code, out = _run(capsys, "predict", "--kepid", "9000001")
    assert code == 0, out
    assert "TEST-9000001-01" in out and "research leads, not discoveries" in out and "TEST FIXTURE" in out
    code, out = _run(capsys, "status")
    assert "#1 TEST cli [ready]" in out and "ACTIVE FIXTURE" in out and "build_dataset" in out
    code, out = _run(capsys, "evaluate", "--model", "99")
    assert code == 1 and "Model version not found" in out
    from exofinder.config import get_settings

    assert Path(get_settings().models_dir / "1" / "meta.json").is_file()
