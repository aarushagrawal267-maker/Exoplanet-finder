#!/usr/bin/env bash
# Setup for macOS / Linux (Windows users: use setup.ps1)
set -euo pipefail
cd "$(dirname "$0")/.."
PY=${PYTHON:-}
if [ -z "$PY" ]; then for c in python3.12 python3.11 python3.13 python3; do command -v $c >/dev/null && { PY=$c; break; }; done; fi
[ -n "$PY" ] || { echo "Python 3.11-3.13 not found"; exit 1; }
command -v node >/dev/null || { echo "Node.js 20+ not found"; exit 1; }
[ -d .venv ] || "$PY" -m venv .venv
.venv/bin/python -m pip install --upgrade pip -q
.venv/bin/python -c "import torch" 2>/dev/null || .venv/bin/python -m pip install "torch>=2.6,<2.16"
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m pip install -e backend --no-deps -q
(cd frontend && (npm ci --no-audit --no-fund || npm install --no-audit --no-fund))
[ -f .env ] || cp .env.example .env
mkdir -p data artifacts logs .run
.venv/bin/python -m exofinder.cli init
.venv/bin/python -m exofinder.cli doctor || echo "Self-check reported problems (see above)"
echo "Setup complete. Start with: scripts/start.sh"
