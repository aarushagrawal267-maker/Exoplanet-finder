"""Package a locally trained Exoplanet Finder state as a relocatable demo seed, and apply it.

The hosted demo (Hugging Face Space) should open with the NASA catalogue loaded and trained models
ready to score, instead of asking every visitor to download ~1.3 GB and train first. The SQLite
database stores absolute paths (checkpoints, datasets, evaluations, light curves), so a state
trained on one machine cannot simply be copied into the container. This script:

``make``  copies a finished local run (database, dataset arrays, model checkpoints, evaluation
          results, catalogue snapshots and a few light curves) into a seed folder and records the
          original data/artifacts folders in ``seed.json``. Light curves that are not kept are marked
          "not downloaded", so the app fetches them from NASA MAST on demand.
``apply`` copies a seed into empty data/artifacts folders and rewrites every stored path from the
          recorded folders to the new ones. It does nothing if a database already exists there.

Usage (from the repository root; the app's own Python environment is enough):

    python deploy/huggingface/demo_seed.py make --data data --artifacts artifacts --out seed
    python deploy/huggingface/demo_seed.py apply --seed seed --data /home/user/app/data \
        --artifacts /home/user/app/artifacts

Only public NASA data (Exoplanet Archive tables and products derived from MAST light curves) and
models trained in this project go into a seed; nothing else from the machine is copied.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path

SEED_VERSION = 1
#: Light curves kept in a seed by default: the reserved showcase systems (test split) and Kepler-2,
#: so the demo's featured targets open without a MAST download.
DEFAULT_KEEP_KEPIDS = (11442793, 4852528, 6541920, 8120608, 8311864, 10666592)


def _text_columns(con: sqlite3.Connection) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    tables = [
        r[0]
        for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    ]
    for t in tables:
        for row in con.execute(f'PRAGMA table_info("{t}")'):
            col, ctype = row[1], (row[2] or "").upper()
            if ctype in ("", "TEXT", "JSON", "CLOB") or "CHAR" in ctype or "TEXT" in ctype:
                out.append((t, col))
    return out


def _rewrite_prefix(con: sqlite3.Connection, old: str, new: str) -> int:
    """Replace the folder ``old`` by ``new`` at the start of paths in every text column."""
    old, new = old.rstrip("/"), new.rstrip("/")
    if old == new:
        return 0
    n = 0
    for t, col in _text_columns(con):
        cur = con.execute(
            f'UPDATE "{t}" SET "{col}" = REPLACE("{col}", ?, ?) WHERE instr("{col}", ?) > 0',
            (old + "/", new + "/", old + "/"),
        )
        n += cur.rowcount
        cur = con.execute(f'UPDATE "{t}" SET "{col}" = ? WHERE "{col}" = ?', (new, old))
        n += cur.rowcount
    return n


def _kic9(kepid: int) -> str:
    return f"{int(kepid):09d}"


def make(data: Path, artifacts: Path, out: Path, keep: list[int]) -> None:
    data, artifacts, out = data.resolve(), artifacts.resolve(), out.resolve()
    db = data / "app.db"
    if not db.is_file():
        sys.exit(f"no database at {db}")
    if out.exists() and any(out.iterdir()):
        sys.exit(f"{out} is not empty")
    (out / "data").mkdir(parents=True, exist_ok=True)
    (out / "artifacts").mkdir(parents=True, exist_ok=True)

    seed_db = out / "data" / "app.db"
    with sqlite3.connect(db) as src, sqlite3.connect(seed_db) as dst:
        src.backup(dst)  # consistent copy, WAL included
    con = sqlite3.connect(seed_db)
    try:
        con.execute("PRAGMA journal_mode=DELETE")
        busy = con.execute("SELECT count(*) FROM jobs WHERE status IN ('queued','running')").fetchone()[0]
        if busy:
            sys.exit(f"{busy} job(s) are still queued or running; wait for them to finish")
        n_pred = con.execute("SELECT count(*) FROM predictions").fetchone()[0]
        con.execute("DELETE FROM predictions")  # visitors' own predictions start from an empty history
        # Light curves that are not shipped: mark them "not downloaded" (the app re-downloads on demand).
        kept = [k for k in keep if (data / "lightcurves" / f"{_kic9(k)}.npz").is_file()]
        marks = ",".join("?" for _ in kept) or "NULL"
        con.execute(
            "UPDATE targets SET lc_status='none', lc_path=NULL, lc_error=NULL, lc_quarters='[]', lc_n_cadences=NULL "
            f"WHERE lc_status IN ('available','queued','downloading') AND kepid NOT IN ({marks})",
            kept,
        )
        con.commit()
        con.execute("VACUUM")
    finally:
        con.close()

    for sub in ("catalogs", "datasets"):
        if (data / sub).is_dir():
            shutil.copytree(data / sub, out / "data" / sub)
    (out / "data" / "lightcurves").mkdir()
    for k in kept:
        shutil.copy2(data / "lightcurves" / f"{_kic9(k)}.npz", out / "data" / "lightcurves")
    for sub in ("models", "evaluations", "reports"):
        if (artifacts / sub).is_dir():
            shutil.copytree(artifacts / sub, out / "artifacts" / sub)

    manifest = {
        "seed_version": SEED_VERSION,
        "created_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_data_dir": str(data),
        "source_artifacts_dir": str(artifacts),
        "light_curves_kept": kept,
        "predictions_dropped": n_pred,
    }
    (out / "seed.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"seed written to {out} ({size / 1e6:.1f} MB); kept light curves: {kept}")


def apply(seed: Path, data: Path, artifacts: Path) -> None:
    seed, data, artifacts = seed.resolve(), data.resolve(), artifacts.resolve()
    if (data / "app.db").exists():
        print(f"demo seed: {data / 'app.db'} already exists, nothing to do")
        return
    manifest = json.loads((seed / "seed.json").read_text(encoding="utf-8"))
    if manifest.get("seed_version") != SEED_VERSION:
        sys.exit(f"unsupported seed version {manifest.get('seed_version')}")
    data.mkdir(parents=True, exist_ok=True)
    artifacts.mkdir(parents=True, exist_ok=True)
    shutil.copytree(seed / "data", data, dirs_exist_ok=True)
    shutil.copytree(seed / "artifacts", artifacts, dirs_exist_ok=True)
    con = sqlite3.connect(data / "app.db")
    try:
        n = _rewrite_prefix(con, manifest["source_data_dir"], str(data))
        n += _rewrite_prefix(con, manifest["source_artifacts_dir"], str(artifacts))
        con.commit()
    finally:
        con.close()
    print(f"demo seed applied to {data} and {artifacts} ({n} stored paths rewritten)")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("make", help="package a local run as a seed")
    m.add_argument("--data", type=Path, required=True)
    m.add_argument("--artifacts", type=Path, required=True)
    m.add_argument("--out", type=Path, required=True)
    m.add_argument(
        "--keep-lightcurves",
        type=lambda s: [int(x) for x in s.split(",") if x],
        default=list(DEFAULT_KEEP_KEPIDS),
    )
    a = sub.add_parser("apply", help="install a seed into empty data/artifacts folders")
    a.add_argument("--seed", type=Path, required=True)
    a.add_argument("--data", type=Path, required=True)
    a.add_argument("--artifacts", type=Path, required=True)
    args = p.parse_args(argv)
    if args.cmd == "make":
        make(args.data, args.artifacts, args.out, args.keep_lightcurves)
    else:
        apply(args.seed, args.data, args.artifacts)


if __name__ == "__main__":
    main()
