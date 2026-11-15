"""Windows-specific behaviour of the CLI and the dataset build, simulated on any OS.

TEST DATA only: the dataset row below is created for this test in the temporary database.
"""

from __future__ import annotations

import io
import sys

import pytest


def _ansi_stdout() -> tuple[io.BytesIO, io.TextIOWrapper]:
    """What Python gives a redirected/piped stdout on a Western Windows system: cp1252, strict."""
    raw = io.BytesIO()
    return raw, io.TextIOWrapper(raw, encoding="cp1252", errors="strict", write_through=True)


def test_cli_output_survives_the_windows_ansi_code_page(api_env, monkeypatch: pytest.MonkeyPatch):
    """``exofinder status > status.txt`` on Windows: a dataset named in the UI with characters outside
    cp1252 must not abort the command with UnicodeEncodeError (unencodable characters become '?')."""
    from exofinder import cli
    from exofinder.config import PIPELINE_VERSION
    from exofinder.db.models import Dataset
    from exofinder.db.session import session_scope

    with session_scope() as s:
        s.add(
            Dataset(
                name="TEST pilot → ⊕ ±",  # → ⊕ (not in cp1252) and ± (in cp1252)
                label_mode="astronet_dr24",
                tier="pilot",
                status="ready",
                pipeline_version=PIPELINE_VERSION,
            )
        )
    err = io.TextIOWrapper(io.BytesIO(), encoding="cp1252", errors="backslashreplace", write_through=True)
    monkeypatch.setattr(sys, "stderr", err)

    # without the guard the command dies half-way (UnicodeEncodeError is reported as a usage error)
    raw, out = _ansi_stdout()
    monkeypatch.setattr(sys, "stdout", out)
    real_guard = cli._tolerant_console
    monkeypatch.setattr(cli, "_tolerant_console", lambda: None)
    assert cli.main(["status"]) == cli.EXIT_USAGE
    partial = raw.getvalue().decode("cp1252")
    assert "Datasets" in partial and "TEST pilot" not in partial

    raw, out = _ansi_stdout()
    monkeypatch.setattr(sys, "stdout", out)
    monkeypatch.setattr(cli, "_tolerant_console", real_guard)
    assert cli.main(["status"]) == cli.EXIT_OK
    text = raw.getvalue().decode("cp1252")
    assert "#1 TEST pilot ? ? ± [ready]" in text and "Recent jobs" in text


def test_cli_leaves_utf8_streams_strict(monkeypatch: pytest.MonkeyPatch):
    """Linux/macOS terminals and the Windows console are UTF-8: nothing is changed there."""
    from exofinder import cli

    out = io.TextIOWrapper(io.BytesIO(), encoding="utf-8", errors="strict")
    err = io.TextIOWrapper(io.BytesIO(), encoding="UTF-8", errors="backslashreplace")
    monkeypatch.setattr(sys, "stdout", out)
    monkeypatch.setattr(sys, "stderr", err)
    cli._tolerant_console()
    assert (out.errors, err.errors) == ("strict", "backslashreplace")


def test_build_workers_are_capped_at_the_windows_process_pool_limit(monkeypatch: pytest.MonkeyPatch):
    """ProcessPoolExecutor raises ValueError for more than 61 workers on Windows (e.g. the default
    cpu_count - 1 on a 64-thread workstation)."""
    import concurrent.futures.process as cf_process

    from exofinder.services import datasets

    assert datasets.WINDOWS_MAX_WORKERS == cf_process._MAX_WINDOWS_WORKERS
    monkeypatch.setenv("EXOF_BUILD_WORKERS", "")
    monkeypatch.setattr(datasets.os, "cpu_count", lambda: 128)
    monkeypatch.setattr(sys, "platform", "win32")
    assert datasets.default_build_workers() == 61 and datasets.cap_workers(200) == 61
    assert datasets.cap_workers(4) == 4
    monkeypatch.setenv("EXOF_BUILD_WORKERS", "80")
    assert datasets.default_build_workers() == 61
    monkeypatch.setattr(sys, "platform", "linux")
    assert datasets.default_build_workers() == 80 and datasets.cap_workers(127) == 127


def test_doctor_points_to_the_vc_runtime_when_torch_dlls_fail_to_load(
    api_env, monkeypatch: pytest.MonkeyPatch
):
    """A fresh Windows without the Visual C++ runtime: ``import torch`` raises OSError [WinError 126]."""
    import builtins

    from exofinder import cli

    cli._doctor_checks(network=False)  # import everything once, before sys.platform is patched
    real_import = builtins.__import__

    def no_torch_dlls(name, *args, **kwargs):
        if name == "torch":
            raise OSError(
                "[WinError 126] The specified module could not be found. Error loading "
                '"C:\\x\\.venv\\Lib\\site-packages\\torch\\lib\\c10.dll" or one of its dependencies.'
            )
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_torch_dlls)
    monkeypatch.setattr(sys, "platform", "win32")
    rows = {r["check"]: r for r in cli._doctor_checks(network=False).rows}
    assert rows["package torch"]["status"] == "fail"
    assert "Visual C++ Redistributable" in rows["package torch"]["hint"]
    assert rows["package numpy"]["status"] == "ok"
