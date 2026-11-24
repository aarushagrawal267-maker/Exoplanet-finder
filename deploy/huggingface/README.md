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

Notes for this hosted copy: it runs on a shared free CPU, so heavy jobs (large downloads, dataset
builds, CNN training) are slow; storage is temporary and is reset when the Space restarts. For full
use, run the app locally — see the project README.

---

## How to publish this Space (for the project owner)

This file is the README of the *Space repository*; the YAML block at the top tells Hugging Face to
build a Docker image and route traffic to port 7860.

1. Create a free account at <https://huggingface.co/join> and a new Space
   (<https://huggingface.co/new-space>): SDK **Docker**, template **Blank**, hardware **CPU basic**.
2. Clone the Space repository it creates: `git clone https://huggingface.co/spaces/<you>/<space-name>`.
3. Copy into it, from this project: `backend/`, `frontend/` (without `node_modules/` and `dist/`),
   `docs/`, `requirements.txt`, `.env.example`, `README.md` **from this folder** (it replaces the
   project README) and `Dockerfile` **from this folder**.
4. `git add -A && git commit -m "Exoplanet Finder" && git push` (log in with a Hugging Face access
   token with *write* permission when asked).
5. The Space builds (about 10 minutes: frontend build, then CPU PyTorch). It then opens the app; the
   interactive API documentation is at `/api/docs` on the Space URL.

The Space starts **empty** (no catalogue, no models): open it and follow the Overview page (refresh the
catalogue, build a Pilot dataset, train). To ship your own trained models with the demo, run the app
locally first, then copy your `data/app.db`, `data/` caches and `artifacts/` into the Space repository
with Git LFS (`git lfs track "*.db" "*.pt" "*.joblib" "*.npz"`) and remove `data`/`artifacts` from
`.dockerignore` before pushing. Mind the Space size limits.
