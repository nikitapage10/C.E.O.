#!/usr/bin/env bash
# A submind's doorbell (#341). Runs in the background inside a room's submind thread ("Skippy, the Commentator" and the
# rest) and exits the moment Desk Skippy hands that room a new ask, which gives the thread a turn at once. The site
# can't fire a claude.ai trigger or post into a thread, but a background command the thread started itself can wake
# it, as scripts/foundry-watch.sh does for the Builder. Polling costs no plan usage; only the wake does.
#
#   scripts/submind-watch.sh <room> [seconds between looks, default 30] [--all]
#
#   <room>   green (the Commentator), exchange (the Bookie), boiler (the Pessimist) or foundry (the Builder)
#   --all    ring at once for hand-offs already open when it starts (by default those are counted and left: the
#            thread reads them before it starts the watcher, docs/SKIPPY.md)
#
# It reads GET /api/skippy-log?room=<room>&needs=<submind> with the subminds' read key. In a submind thread the key
# is a network secret: the environment's egress proxy adds the x-ceo-room-key header to every request to the site, so the
# script sends none (#361). Where SUBMIND_LOG_TOKEN is set instead, it is sent in that header from stdin, so it never
# shows in the process list. It prints one short line per new hand-off:
#
#   handoff 3f9c0a1b2c3d4e5f green turf 2026-10-23T23:30:00.000Z: Why start Tre Tucker over Godwin?
#
# then exits 0. It never prints a key or the environment. Exits 2 on a bad room, 3 when the key isn't set up or is refused
# (401 or 403: no network secret, or not the vault's current key; docs/SKIPPY.md), 1 when the site can't be read ten
# times running. CEO_SITE overrides the site.
set -uo pipefail

room="${1:-}"
every=30
all=0
shift || true
for a in "$@"; do
  case "$a" in
    --all) all=1 ;;
    ''|*[!0-9]*) echo "usage: scripts/submind-watch.sh <green|exchange|boiler|foundry> [seconds] [--all]" >&2; exit 2 ;;
    *) every="$a" ;;
  esac
done
[ "$every" -ge 10 ] 2>/dev/null || every=10

# The room's active submind (ROOM_SUBMINDS in api/_skippy/log.ts; a test holds this list to it).
case "$room" in
  green) mind=turf ;;
  exchange) mind=ticker ;;
  boiler) mind=soot ;;
  foundry) mind=ember ;;
  *) echo "usage: scripts/submind-watch.sh <green|exchange|boiler|foundry> [seconds] [--all]" >&2; exit 2 ;;
esac

site="${CEO_SITE:-https://ceo.nikita.page}"
url="$site/api/skippy-log?room=$room&needs=$mind"

# One look: the open hand-offs as "id<TAB>at<TAB>question" lines, sorted. Return 3 on a refused key, 1 on any other miss.
look() {
  local body code
  if [ -n "${SUBMIND_LOG_TOKEN:-}" ]; then
    # The fallback: the header comes from stdin (printf is a shell builtin), so the key is never on a command line.
    body="$(printf 'x-ceo-room-key: %s\n' "$SUBMIND_LOG_TOKEN" | curl -sS --max-time 20 -H @- -H "Accept: application/json" -w '\n%{http_code}' "$url" 2>/dev/null)" || return 1
  else
    # No key here: the environment's proxy adds x-ceo-room-key for the site's host (a network secret).
    body="$(curl -sS --max-time 20 -H "Accept: application/json" -w '\n%{http_code}' "$url" 2>/dev/null)" || return 1
  fi
  code="${body##*$'\n'}"
  body="${body%$'\n'*}"
  { [ "$code" = 401 ] || [ "$code" = 403 ]; } && return 3
  [ "$code" = 200 ] || return 1
  printf '%s' "$body" | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const b = JSON.parse(s);
      if (!Array.isArray(b.turns)) process.exit(1);
      const flat = (v, n) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, n);
      for (const t of b.turns) if (/^[0-9a-f]{16}$/.test(t.id)) console.log([t.id, flat(t.at, 30), flat(t.question, 120)].join("\t"));
    });
  ' | sort
}

# Prints the hand-offs in $1 (lines) whose ids aren't in $2.
fresh() {
  local seen
  seen="$(printf '%s\n' "$2" | cut -f1)"
  printf '%s\n' "$1" | while IFS=$'\t' read -r id at q; do
    [ -n "$id" ] || continue
    printf '%s\n' "$seen" | grep -qx "$id" && continue
    printf 'handoff %s %s %s %s: %s\n' "$id" "$room" "$mind" "$at" "$q"
  done
}

# One look, kept in $got; counts misses and gives up as described above. Returns 1 on a miss.
misses=0
got=""
take() {
  local rc
  got="$(look)"
  rc=$?
  [ "$rc" = 3 ] && { echo "The read key isn't set up (the site said 401 or 403): no network secret for it in this environment, or not the vault's current key. See docs/SKIPPY.md, \"Room keys\"." >&2; exit 3; }
  if [ "$rc" != 0 ]; then
    misses=$((misses + 1))
    [ "$misses" -ge 10 ] && { echo "Can't read $room's hand-offs on the site." >&2; exit 1; }
    return 1
  fi
  misses=0
}

until take; do sleep "$every"; done
base="$got"
if [ "$all" = 1 ] && [ -n "$base" ]; then
  fresh "$base" ""
  exit 0
fi
open_now="$(printf '%s' "$base" | grep -c . || true)"
[ "$open_now" -gt 0 ] && echo "$open_now hand-off(s) already open for $room; watching for new ones." >&2

while sleep "$every"; do
  take || continue
  now="$got"
  new="$(fresh "$now" "$base")"
  if [ -n "$new" ]; then
    printf '%s\n' "$new"
    exit 0
  fi
  base="$now"
done
