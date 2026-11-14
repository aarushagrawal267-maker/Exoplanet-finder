#!/usr/bin/env bash
# Start backend (:8000) and frontend (:5173) on macOS / Linux (Windows users: use start.ps1)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs .run
( cd backend && nohup ../.venv/bin/python -m uvicorn exofinder.api.main:app --host 127.0.0.1 --port 8000 > ../logs/backend.log 2>&1 & echo $! > ../.run/backend.pid )
( cd frontend && nohup npm run dev -- --port 5173 --strictPort > ../logs/frontend.log 2>&1 & echo $! > ../.run/frontend.pid )
for i in $(seq 1 120); do curl -sf http://127.0.0.1:8000/api/health >/dev/null && break; sleep 1; done
for i in $(seq 1 120); do curl -sf http://localhost:5173/ >/dev/null && break; sleep 1; done
echo "App: http://localhost:5173   API docs: http://localhost:8000/docs"
