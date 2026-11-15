#!/usr/bin/env bash
# Stop Exoplanet Finder on macOS / Linux. Only processes started by scripts/start.sh (pid files) or
# whose command line shows uvicorn exofinder / vite are stopped; other programs are left alone.
cd "$(dirname "$0")/.."
stopped=0
for f in .run/backend.pid .run/frontend.pid; do
  if [ -f "$f" ]; then
    pid=$(cat "$f")
    if kill -0 "$pid" 2>/dev/null; then
      pkill -TERM -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null && stopped=1
    fi
    rm -f "$f"
  fi
done
for port in ${EXOF_PORT:-8000} 5173; do
  for pid in $(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true); do
    cmd=$(ps -o args= -p "$pid" 2>/dev/null || true)
    if echo "$cmd" | grep -qE "exofinder|vite"; then kill "$pid" 2>/dev/null && stopped=1
    else echo "Port $port is used by another program (pid $pid) - not stopped"; fi
  done
done
[ $stopped = 1 ] && echo "Exoplanet Finder stopped." || echo "Exoplanet Finder was not running."
