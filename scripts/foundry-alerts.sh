#!/usr/bin/env bash
# The upkeep tick's view of the open security alerts (#918). The session's own GitHub access can't read the alert
# APIs, so .github/workflows/security-alerts.yml reads them every two hours and prints counts in its job log; this
# fetches the latest successful run's line and prints its JSON (counts by severity and scanner, never an alert's
# details). Exits 1 when there is no run to read yet.
#
#   scripts/foundry-alerts.sh
set -euo pipefail

repo="nikitapage10/C.E.O."
run=$(gh api "repos/$repo/actions/workflows/security-alerts.yml/runs?status=success&per_page=1" --jq '.workflow_runs[0].id // empty')
[ -n "$run" ] || { echo "No successful Security alerts run yet." >&2; exit 1; }
job=$(gh api "repos/$repo/actions/runs/$run/jobs" --jq '.jobs[0].id // empty')
[ -n "$job" ] || { echo "Run $run has no job." >&2; exit 1; }
line=$(gh api "repos/$repo/actions/jobs/$job/logs" | grep -o 'SECURITY_ALERTS {.*}' | tail -n 1 || true)
[ -n "$line" ] || { echo "Run $run printed no counts." >&2; exit 1; }
echo "${line#SECURITY_ALERTS }"
