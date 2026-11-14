#!/usr/bin/env bash
cd "$(dirname "$0")/.."
for f in .run/backend.pid .run/frontend.pid; do
  [ -f "$f" ] && { pid=$(cat "$f"); pkill -TERM -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null; rm -f "$f"; }
done
for port in 8000 5173; do pid=$(lsof -ti tcp:$port 2>/dev/null || true); [ -n "$pid" ] && kill $pid 2>/dev/null; done
echo "Stopped."
