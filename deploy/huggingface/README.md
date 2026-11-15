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
AstroNet-style CNNs). This demo ships the models trained in development (Standard and Full DR24
tiers, with their held-out test evaluations) and light curves for the showcase systems; other stars'
light curves are downloaded from NASA MAST on demand.

**Planet-like scores are research leads, not discoveries.**

Notes for this hosted copy: it runs on a shared free CPU, so heavy jobs (large downloads, dataset
builds, CNN training) are slow; storage is temporary and is reset when the Space restarts. For full
use, run the app locally — see the project README.
