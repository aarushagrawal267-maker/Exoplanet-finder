# Development progress log (Stage 2)

Single source of truth for resuming work. Updated at the end of every phase.
Branch: `claude/hopeful-edison-jbmnjq`.

## Decisions taken (user did not answer the Stage-1 questions; defaults applied)
- Ship a reference build: real dataset + trained checkpoints produced in the dev environment.
- Assume CPU-only laptop (CUDA supported automatically when present).
- README includes Python/Node installation walkthrough.
- Keep the extra pages (Target Dossier, Prediction History).
- All models are trained from scratch locally (user explicitly wants their own trained AI) — no external AI services.

## Phases
- [x] P0  Foundation: repo skeleton, config, DB schema, shared types, contracts (docs/dev/CONTRACTS.md)
- [ ] P1  Backend core: astro pipeline, data acquisition, ML engine (+ unit tests)
- [ ] P1b Frontend design system + app shell
- [ ] P2  Services, job runner, FastAPI routers, CLI (+ API tests) -> docs/dev/API.md
- [ ] P3  Frontend pages wired to API
- [ ] P4  Real data: catalogue refresh, pilot + standard downloads, dataset builds
- [ ] P5  Real training of 4 models + final evaluation, reference report
- [ ] P6  Windows scripts, README, docs, research report template
- [ ] P7  QA: full test suites, Playwright e2e, review/fix loop, acceptance checklist
- [ ] P8  Delivery summary

## Environment notes
- Dev container: Linux, 4 CPU, 15 GB RAM, no GPU. venv at .venv (Python 3.11), `pip install -e backend`.
- MAST deterministic download URL works through the proxy; lightkurve search ~5 s/target.
