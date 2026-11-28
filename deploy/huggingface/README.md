---
title: Exoplanet Finder
emoji: 🪐
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
short_description: Train AI on NASA Kepler data to vet transit-like signals
---

# Exoplanet Finder (hosted demo)

Classifies NASA Kepler transit-like signals as planet-like or false-positive-like with four models
trained from scratch on real NASA data (logistic regression, random forest, single-view and two-view
AstroNet-style CNNs). Light curves are downloaded from NASA MAST on demand.

**Planet-like scores are research leads, not discoveries.**

Notes for this hosted copy: it runs on a shared CPU, so heavy jobs (large downloads, dataset builds,
CNN training) are slow; storage is temporary and is reset when the Space restarts (back to the demo
seed, if the image has one). For full use, run the app locally — see the project README.

---

## How to publish this Space (for the project owner)

This file is the README of the *Space repository*; the YAML block at the top tells Hugging Face to
build a Docker image and route traffic to port 7860.

1. Create an account at <https://huggingface.co/join> and a new Space
   (<https://huggingface.co/new-space>): SDK **Docker**, template **Blank**, hardware **CPU basic**.
   (Hugging Face may require a PRO subscription for Docker Spaces on free CPU hardware; without one,
   publish the static results viewer instead: `deploy/browser-demo/build_results_viewer.py`.)
2. Clone the Space repository it creates: `git clone https://huggingface.co/spaces/<you>/<space-name>`.
3. Copy into it, from this project: `backend/`, `frontend/` (without `node_modules/` and `dist/`),
   `docs/`, `deploy/huggingface/demo_seed.py` and `deploy/huggingface/start.sh` (same paths),
   `requirements.txt`, `.env.example`, `README.md` **from this folder** (it replaces the project
   README) and `Dockerfile` **from this folder**, plus a `seed/` folder: a demo seed (below), or, for
   an empty app, just a placeholder file such as `seed/.keep` (git does not store empty folders and
   the Dockerfile copies `seed/`).
4. `git add -A && git commit -m "Exoplanet Finder" && git push` (log in with a Hugging Face access
   token with *write* permission when asked).
5. The Space builds (about 10 minutes: frontend build, then CPU PyTorch). It then opens the app; the
   interactive API documentation is at `/api/docs` on the Space URL.

With an empty `seed/` the Space starts **empty** (no catalogue, no models): open it and follow the
Overview page (refresh the catalogue, build a Pilot dataset, train).

### Demo seed: open the Space with trained models

Copying a locally trained `data/app.db` and `artifacts/` into the image does not work as-is, because the
database stores absolute paths (checkpoints, datasets, evaluations, light curves) of the computer that
made them. `demo_seed.py` packages a finished local run so it can be moved:

```bash
python deploy/huggingface/demo_seed.py make --data data --artifacts artifacts --out seed
```

`seed/` then holds the database (catalogue, dataset, models, evaluations; stored predictions are dropped),
the dataset arrays, model checkpoints, evaluation files, catalogue snapshots and the light curves of the
showcase stars (others are marked "not downloaded" and fetched from MAST on demand). At every start,
`start.sh` runs `demo_seed.py apply`, which copies the seed into the empty data folders and rewrites the
stored paths. A seed of the Pilot reference run (four models) is about 230 MB, mostly the two CNNs.
Checked locally on 2026-11-28: applying that seed and starting the API gave four compatible models with
their checkpoints and the two-view CNN active, and the Playwright suite passed against it.
