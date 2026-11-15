#!/usr/bin/env bash
# Run all test suites (macOS / Linux). Windows users: scripts/test.ps1
# Usage: scripts/test.sh [--skip-e2e] [--network]
set -uo pipefail
cd "$(dirname "$0")/.."
SKIP_E2E=0; NETWORK=0
for a in "$@"; do case $a in --skip-e2e) SKIP_E2E=1;; --network) NETWORK=1;; esac; done
declare -a NAMES RESULTS
run() { local name=$1; shift; echo; echo "==> $name"; if "$@"; then RESULTS+=(passed); else RESULTS+=("FAILED"); fi; NAMES+=("$name"); }
run "Backend tests (pytest)" bash -c "cd backend && ../.venv/bin/python -m pytest -q"
[ $NETWORK = 1 ] && run "Backend live NASA checks" bash -c "cd backend && ../.venv/bin/python -m pytest -q -m network"
run "Frontend type check" bash -c "cd frontend && npm run typecheck"
run "Frontend unit tests (Vitest)" bash -c "cd frontend && npm test"
[ $SKIP_E2E = 0 ] && run "End-to-end tests (Playwright)" bash -c "cd frontend && npm run test:e2e"
echo; echo "Summary"; fail=0
for i in "${!NAMES[@]}"; do printf "  %-40s %s\n" "${NAMES[$i]}" "${RESULTS[$i]}"; [ "${RESULTS[$i]}" = passed ] || fail=1; done
exit $fail
