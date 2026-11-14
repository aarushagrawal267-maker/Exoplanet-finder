#!/usr/bin/env bash
# Start backend (:8000) and frontend (:5173) on macOS / Linux (Windows users: use start.ps1).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
BACKEND_PORT=${EXOF_PORT:-8000}
FRONTEND_PORT=5173
[ -x .venv/bin/python ] || { echo "Setup has not been run yet: scripts/setup.sh"; exit 1; }
[ -d frontend/node_modules ] || { echo "Frontend dependencies missing: re-run scripts/setup.sh"; exit 1; }
for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if curl -s -o /dev/null "http://127.0.0.1:$port/"; then
    echo "Port $port is already in use (Exoplanet Finder may already be running). Run scripts/stop.sh first."; exit 1
  fi
done
mkdir -p logs .run
( cd "$ROOT/backend" && nohup "$ROOT/.venv/bin/python" -m uvicorn exofinder.api.main:app \
    --host 127.0.0.1 --port "$BACKEND_PORT" > "$ROOT/logs/backend.log" 2>&1 & echo $! > "$ROOT/.run/backend.pid" )
( cd "$ROOT/frontend" && VITE_API_URL="http://127.0.0.1:$BACKEND_PORT" nohup npm run dev -- --port "$FRONTEND_PORT" \
    --strictPort > "$ROOT/logs/frontend.log" 2>&1 & echo $! > "$ROOT/.run/frontend.pid" )
ok=0
for _ in $(seq 1 120); do curl -sf "http://127.0.0.1:$BACKEND_PORT/api/health" >/dev/null && { ok=1; break; }; sleep 1; done
[ $ok = 1 ] || { echo "The backend did not start; last lines of logs/backend.log:"; tail -25 logs/backend.log; scripts/stop.sh; exit 1; }
ok=0
for _ in $(seq 1 120); do curl -sf "http://localhost:$FRONTEND_PORT/" >/dev/null && { ok=1; break; }; sleep 1; done
[ $ok = 1 ] || { echo "The frontend did not start; last lines of logs/frontend.log:"; tail -25 logs/frontend.log; scripts/stop.sh; exit 1; }
echo "App: http://localhost:$FRONTEND_PORT   API: http://localhost:$BACKEND_PORT   API docs: http://localhost:$BACKEND_PORT/docs"
