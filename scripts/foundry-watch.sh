#!/usr/bin/env bash
# The Builder's doorbell (issue #50). Runs in the background inside the Foundry thread and exits the moment the queue
# changes, which wakes the thread at once instead of at the next 15-minute queue check. Nothing outside the thread can
# wake it (docs/FOUNDRY.md, "The checks"), but a background command the thread itself started can: when it exits, the
# thread gets a turn. Polling GitHub costs no plan usage; only the wake does. The 15-minute checks stay as the fallback
# for when the thread's machine has been recycled and the watcher with it.
#
#   scripts/foundry-watch.sh [seconds between looks, default 30]
#
# Prints the new work ("#50 foundry:build") and exits 0. Exits 1 if GitHub can't be read ten times running.
set -uo pipefail

every="${1:-30}"
repo="nikitapage10/C.E.O."

# One line per open foundry issue and work label: "50 foundry:build". A new line means new work: an approved idea, a
# Revise click, a red check, or a job that has just lost its foundry:working label.
look() {
  gh api "repos/$repo/issues?labels=foundry&state=open&per_page=100" --jq '
    .[] | . as $i | [.labels[].name] as $l
    | select(($l | index("foundry:working")) | not)
    | $l[] | select(. == "foundry:build" or . == "foundry:revise" or . == "foundry:fix")
    | "\($i.number) \(.)"' | sort
}

base="$(look)" || { echo "Can't read the Foundry queue on GitHub." >&2; exit 1; }
misses=0
while sleep "$every"; do
  if ! now="$(look)"; then
    misses=$((misses + 1))
    [ "$misses" -ge 10 ] && { echo "Can't read the Foundry queue on GitHub." >&2; exit 1; }
    continue
  fi
  misses=0
  fresh="$(comm -13 <(printf '%s\n' "$base") <(printf '%s\n' "$now") | sed '/^$/d')"
  if [ -n "$fresh" ]; then
    printf '%s\n' "$fresh" | sed 's/^/#/'
    exit 0
  fi
  base="$now"
done
