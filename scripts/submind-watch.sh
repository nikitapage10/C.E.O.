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
# It reads GET /api/skippy-log?room=<room>&needs=<submind> with the subminds' read key (SUBMIND_LOG_TOKEN, sent in the
# x-ceo-room-key header from stdin, so it never shows in the process list), and prints one short line per new hand-off:
#
#   handoff 3f9c0a1b2c3d4e5f green turf 2026-10-23T23:30:00.000Z: Why start Tre Tucker over Godwin?
#
# then exits 0. It never prints the key or the environment. Exits 2 on a bad room or no key, 3 when the key is refused
# (401: not the vault's current key), 1 when the site can't be read ten times running. CEO_SITE overrides the site.
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

if [ -z "${SUBMIND_LOG_TOKEN:-}" ]; then
  echo "SUBMIND_LOG_TOKEN isn't in this session's environment: see docs/AZURE.md, \"The subminds' room keys\"." >&2
  exit 2
fi

site="${CEO_SITE:-https://ceo.nikita.page}"
url="$site/api/skippy-log?room=$room&needs=$mind"

# One look: the open hand-offs as "id<TAB>at<TAB>question" lines, sorted. Return 3 on a refused key, 1 on any other miss.
look() {
  local body code
  # The header comes from stdin (printf is a shell builtin), so the key is never on a command line.
  body="$(printf 'x-ceo-room-key: %s\n' "$SUBMIND_LOG_TOKEN" | curl -sS --max-time 20 -H @- -H "Accept: application/json" -w '\n%{http_code}' "$url" 2>/dev/null)" || return 1
  code="${body##*$'\n'}"
  body="${body%$'\n'*}"
  [ "$code" = 401 ] && return 3
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
  [ "$rc" = 3 ] && { echo "The read key was refused (401): it isn't the vault's current one." >&2; exit 3; }
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
