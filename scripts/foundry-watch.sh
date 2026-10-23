#!/usr/bin/env bash
# The Builder's doorbell (issue #50). Runs in the background inside the Foundry thread and exits the moment the queue
# changes, which wakes the thread at once instead of at the next 15-minute queue check. Nothing outside the thread can
# wake it (docs/FOUNDRY.md, "The checks"), but a background command the thread itself started can: when it exits, the
# thread gets a turn. Polling GitHub costs no plan usage; only the wake does. The 15-minute checks stay as the fallback
# for when the thread's machine has been recycled and the watcher with it.
#
#   scripts/foundry-watch.sh [seconds between looks, default 30]
#
# Prints the new work ("#50 foundry:build") and exits 0. Exits 1 if GitHub can't be read ten times running. When an issue
# that rang has comments from anyone but Nikita and the two bots, it says so on a line of its own (issue #59). The work
# still rings, so a stranger's comment can't hold it up, and the Builder reads it through scripts/foundry-issue.sh.
set -uo pipefail

every="${1:-30}"
repo="nikitapage10/C.E.O."

# One line per open foundry issue and work label: "50 foundry:build". A new line means new work: an approved idea, a
# Revise click, a red check, or a job that has just lost its foundry:working label (unless it has shipped: the Builder
# labels a job foundry:shipped before taking foundry:working off and closing it). A shipped issue Nikita pressed Undo on
# (foundry:undo, reopened with foundry:fix) rings as fix work all the same (docs/FOUNDRY.md, "Undo").
look() {
  gh api "repos/$repo/issues?labels=foundry&state=open&per_page=100" --jq '
    .[] | . as $i | [.labels[].name] as $l
    | select(($l | index("foundry:working")) | not)
    | select((($l | index("foundry:shipped")) | not) or ($l | index("foundry:undo")))
    | $l[] | select(. == "foundry:build" or . == "foundry:revise" or . == "foundry:fix")
    | "\($i.number) \(.)"' | sort
}

# The living Lattice's hourly step (docs/WORLD.md) also gets a nudge from here every ten minutes. GitHub's hourly
# schedule for it is best-effort and has gone hours without firing; the step itself does nothing until an hour has
# passed, so the extra nudges cost nothing. It also nudges once on every start: the Builder restarts this script after
# each ring, and on a busy day it never ran ten unbroken minutes, so the world went over an hour without a step.
# Azure is the only home (#313): the site's /api may cut a long step at ~45 s, but the step itself still lands.
# CEO_SITE overrides the address (https://ceo.nikita.page once switched, docs/DOMAIN.md); the Static Web App's own
# address keeps answering either way.
site="${CEO_SITE:-https://thankful-forest-019308c1e.5.azurestaticapps.net}"
world() { curl -sS -o /dev/null --max-time 120 -X POST "$site/api/world-step" || true; }
ticks=0
world &

# True when issue $1 has a comment from anyone but Nikita, Checks, the crew's App (the Desk writes as ceo-foundry[bot]
# once it is set up, #138; with Nikita's token until then) or Vercel.
owner="nikitapage10"
outside() {
  gh api --paginate "repos/$repo/issues/$1/comments?per_page=100" --jq '.[].user.login' 2>/dev/null \
    | grep -qvxF -e "$owner" -e "github-actions[bot]" -e "ceo-foundry[bot]" -e "vercel[bot]"
}

base="$(look)" || { echo "Can't read the Foundry queue on GitHub." >&2; exit 1; }
misses=0
while sleep "$every"; do
  ticks=$((ticks + 1))
  [ $((ticks * every % 600)) -lt "$every" ] && world
  if ! now="$(look)"; then
    misses=$((misses + 1))
    [ "$misses" -ge 10 ] && { echo "Can't read the Foundry queue on GitHub." >&2; exit 1; }
    continue
  fi
  misses=0
  fresh="$(comm -13 <(printf '%s\n' "$base") <(printf '%s\n' "$now") | sed '/^$/d')"
  if [ -n "$fresh" ]; then
    printf '%s\n' "$fresh" | sed 's/^/#/'
    for n in $(printf '%s\n' "$fresh" | cut -d' ' -f1 | sort -u); do
      outside "$n" && echo "#$n has outside comments: read it with scripts/foundry-issue.sh $n"
    done
    exit 0
  fi
  base="$now"
done
