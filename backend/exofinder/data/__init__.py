"""NASA data acquisition and catalogue ingestion.

Modules (import them directly; nothing heavy is imported here):

* :mod:`~exofinder.data.archive` — Exoplanet Archive TAP client and verbatim, hashed catalogue snapshots.
* :mod:`~exofinder.data.catalog` — TCE/KOI/confirmed-planet/stellar ingestion with verified linking.
* :mod:`~exofinder.data.labels` — binary training-label modes (AstroNet DR24, KOI dispositions).
* :mod:`~exofinder.data.mast` — deterministic MAST URLs and validated Kepler light-curve downloads.
* :mod:`~exofinder.data.lightcurve_store` — compact stitched per-star light-curve cache.
* :mod:`~exofinder.data.acquire` — download orchestration (thread pool, cancel, progress, DB status).
* :mod:`~exofinder.data.tiers` — whole-star, class-balanced dataset tier selection.
"""
