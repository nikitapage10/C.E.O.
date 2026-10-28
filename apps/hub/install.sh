#!/bin/bash
# Relay's texts hub on the MacBook (#535, docs/RELAY-PRIVACY.md). One paste in Terminal installs it, no repo needed:
#
#   curl -fsSL https://ceo.nikita.page/relay/install.sh | bash
#
# The same file is the `relay` command afterwards:
#
#   relay status          is it running, and what the site shows (counts only)
#   relay off | relay on  pause or resume: no reading, no model calls, no nudges, no sends while off
#   relay wipe            erase everything Relay keeps on this Mac (asks first), then check it worked
#   relay wipe --all      the same, and quit BlueBubbles and delete its folder too
#   relay verify          only the check (also: curl -fsSL https://ceo.nikita.page/relay/install.sh | bash -s verify)
#
# What it puts on the Mac, and nothing else:
#   ~/Library/Application Support/CEO Relay/   the hub (relay-hub.mjs), its own Node runtime, its state file. Kept out
#                                              of Time Machine and Spotlight. Mode 0700.
#   ~/Library/Logs/CEO Relay/                  the hub's log: event kinds and counts only, 14 days
#   ~/Library/LaunchAgents/page.nikita.ceo.relay.plist   starts the hub at login and keeps it running
#   ~/.local/bin/relay                         this command (and one PATH line in ~/.zprofile, marked "CEO Relay")
#   the login Keychain, service "CEO Relay"    the BlueBubbles password, the hub token, the send key, the local key
# No API key: the model calls go through the site (Claude, with the site's own key and Relay's own $10 a month).

set -euo pipefail
umask 077

SITE="https://ceo.nikita.page"
NODE_VERSION="22.20.0"
LABEL="page.nikita.ceo.relay"
SERVICE="CEO Relay"
HOME_DIR="$HOME/Library/Application Support/CEO Relay"
LOG_DIR="$HOME/Library/Logs/CEO Relay"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$HOME_DIR/runtime/node"
HUB="$HOME_DIR/hub/relay-hub.mjs"
BIN_LINK="$HOME/.local/bin/relay"
UID_NOW="$(id -u)"
# Where the questions are read from: the Terminal (stdin is the download when piped from curl).
TTY="${RELAY_TTY:-/dev/tty}"

say() { printf '%s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\nRelay: %s\n' "$*" >&2; exit 1; }
ask() { local a; read -r -p "$1 " a < "$TTY" || a=""; printf '%s' "$a"; }

hub() { "$NODE" "$HUB" "$@"; }

running() { launchctl print "gui/$UID_NOW/$LABEL" >/dev/null 2>&1; }
listening() { nc -z 127.0.0.1 7420 >/dev/null 2>&1; }

site_status() { curl -fsS --max-time 15 "$SITE/api/relay?view=status" 2>/dev/null || true; }

install_relay() {
  [ "$(uname -s)" = "Darwin" ] || fail "this installer is for macOS."
  case "$(uname -m)" in
    arm64) ARCH=arm64 ;;
    x86_64) ARCH=x64 ;;
    *) fail "unknown Mac processor ($(uname -m))." ;;
  esac
  [ -r "$TTY" ] || fail "run this in Terminal (it asks two questions)."

  say "Relay's texts hub for C.E.O."
  say "It installs into your Library folder, asks for your BlueBubbles password and a pair code from the Desk,"
  say "and starts at login. It sends nothing unless you tap Send on the Desk. Undo any time with: relay wipe"
  [ "$(ask "Continue? [y/N]")" = "y" ] || fail "nothing was installed."

  step "1/6  Folders"
  mkdir -p "$HOME_DIR/runtime" "$HOME_DIR/hub" "$HOME_DIR/bin" "$LOG_DIR" "$HOME/Library/LaunchAgents" "$HOME/.local/bin"
  chmod 700 "$HOME_DIR" "$LOG_DIR"
  touch "$HOME_DIR/.metadata_never_index"
  tmutil addexclusion "$HOME_DIR" >/dev/null 2>&1 || say "  (Time Machine exclusion skipped: Time Machine isn't set up)"
  say "  ok"

  step "2/6  The hub and its own Node $NODE_VERSION"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  NAME="node-v$NODE_VERSION-darwin-$ARCH"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$NAME.tar.gz" -o "$TMP/node.tar.gz"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  WANT="$(grep " $NAME.tar.gz\$" "$TMP/SHASUMS256.txt" | cut -d' ' -f1)"
  GOT="$(shasum -a 256 "$TMP/node.tar.gz" | cut -d' ' -f1)"
  [ -n "$WANT" ] && [ "$WANT" = "$GOT" ] || fail "Node's download didn't match its checksum; nothing was installed."
  tar -xzf "$TMP/node.tar.gz" -C "$TMP" "$NAME/bin/node"
  install -m 700 "$TMP/$NAME/bin/node" "$NODE"
  curl -fsSL "$SITE/relay/relay-hub.mjs" -o "$TMP/relay-hub.mjs"
  curl -fsSL "$SITE/relay/relay-hub.mjs.sha256" -o "$TMP/relay-hub.mjs.sha256"
  (cd "$TMP" && shasum -a 256 -c relay-hub.mjs.sha256 >/dev/null) || fail "the hub's download didn't match its checksum."
  install -m 600 "$TMP/relay-hub.mjs" "$HUB"
  curl -fsSL "$SITE/relay/install.sh" -o "$TMP/relay"
  install -m 700 "$TMP/relay" "$HOME_DIR/bin/relay"
  ln -sf "$HOME_DIR/bin/relay" "$BIN_LINK"
  grep -q '# CEO Relay' "$HOME/.zprofile" 2>/dev/null || printf '\nexport PATH="$HOME/.local/bin:$PATH" # CEO Relay\n' >> "$HOME/.zprofile"
  say "  ok"

  step "3/6  Your BlueBubbles password (into the Keychain)"
  say "  Type the server password you set in BlueBubbles (typing is hidden), twice."
  until security add-generic-password -U -s "$SERVICE" -a bluebubbles-password -w < "$TTY" && hub check; do
    [ "$(ask "  Try the password again? [Y/n]")" = "n" ] && fail "BlueBubbles didn't answer. Open BlueBubbles, check it's running with the local connection, then paste the install line again."
  done
  hub init >/dev/null

  step "4/6  Pair with the Desk"
  say "  On the Desk: Relay → Texts → Pair a Mac. It shows an 8-character code for 10 minutes."
  until CODE="$(ask "  Pair code:")" && printf '%s' "$CODE" | hub pair; do
    [ "$(ask "  Try another code? [Y/n]")" = "n" ] && fail "not paired. Paste the install line again when you have a code."
  done
  unset CODE

  step "5/6  BlueBubbles' webhook"
  hub webhook

  step "6/6  Start at login"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$HUB</string><string>serve</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>Umask</key><integer>63</integer>
  <key>SoftResourceLimits</key><dict><key>Core</key><integer>0</integer></dict>
  <key>HardResourceLimits</key><dict><key>Core</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$LOG_DIR/launchd.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/launchd.log</string>
</dict>
</plist>
PLIST
  chmod 600 "$PLIST"
  launchctl bootout "gui/$UID_NOW/$LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$UID_NOW" "$PLIST"
  for _ in 1 2 3 4 5 6 7 8 9 10; do listening && break; sleep 1; done
  listening || fail "the hub didn't start. Its log is in ~/Library/Logs/CEO Relay."
  say "  ok"

  step "Relay is on."
  say "The Desk's Relay page shows Texts as live within a minute. New texts you owe a reply land there,"
  say "with Blasto's draft. Nothing sends until you tap Send. Open a new Terminal window to use the relay command."
}

pause_relay() {
  [ -x "$NODE" ] || fail "Relay isn't installed."
  hub control pause
}

resume_relay() {
  [ -x "$NODE" ] || fail "Relay isn't installed."
  running || launchctl bootstrap "gui/$UID_NOW" "$PLIST" 2>/dev/null || true
  for _ in 1 2 3 4 5; do listening && break; sleep 1; done
  hub control resume
}

status_relay() {
  if running; then say "Hub: running"; else say "Hub: not running"; fi
  if listening; then say "Listening on 127.0.0.1:7420 (BlueBubbles' webhook only)"; fi
  S="$(site_status)"
  if [ -n "$S" ]; then
    printf 'Site: hub %s, %s owed, %s drafts ready\n' "$(printf '%s' "$S" | sed -n 's/.*"hub":"\([a-z]*\)".*/\1/p')" "$(printf '%s' "$S" | sed -n 's/.*"owed":\([0-9]*\).*/\1/p')" "$(printf '%s' "$S" | sed -n 's/.*"draftsReady":\([0-9]*\).*/\1/p')"
  fi
}

verify_relay() {
  local bad=0
  check() { if eval "$2"; then printf '  pass  %s\n' "$1"; else printf '  FAIL  %s\n' "$1"; bad=1; fi; }
  say "Checking the wipe:"
  check "Relay's folder is gone" '[ ! -e "$HOME_DIR" ]'
  check "Relay's log folder is gone" '[ ! -e "$LOG_DIR" ]'
  check "no Relay item in the Keychain" '! security find-generic-password -s "$SERVICE" >/dev/null 2>&1'
  check "no Relay job in launchd" '! running && [ ! -e "$PLIST" ]'
  check "nothing listens on port 7420" '! listening'
  check "the relay command is gone" '[ ! -e "$BIN_LINK" ]'
  check "the site shows Relay as wiped" 'site_status | grep -q "\"hub\":\"wiped\""'
  if [ "$bad" = 0 ]; then say "All clear."; else say "Something is left: run relay wipe again, or see docs/RELAY-PRIVACY.md, \"The off switch and the full wipe\"."; fi
  return "$bad"
}

wipe_relay() {
  local all="${1:-}"
  say "This erases everything Relay keeps on this Mac: its state, drafts, logs, Keychain items and launchd job."
  say "Your messages in Messages are not touched."
  [ "$all" = "--all" ] && say "--all: it also quits BlueBubbles and deletes its folder."
  [ "$(ask "Type wipe to go on:")" = "wipe" ] || fail "nothing was wiped."
  if [ -x "$NODE" ] && [ -f "$HUB" ]; then
    hub control pause >/dev/null 2>&1 || true
    hub wipe-report || true
  fi
  launchctl bootout "gui/$UID_NOW/$LABEL" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  if [ -x "$NODE" ] && [ -f "$HUB" ]; then hub wipe-keys || true; fi
  # Belt and braces: any Relay Keychain item left over.
  for item in bluebubbles-password hub-token send-key local-key; do security delete-generic-password -s "$SERVICE" -a "$item" >/dev/null 2>&1 || true; done
  tmutil removeexclusion "$HOME_DIR" >/dev/null 2>&1 || true
  rm -rf "$HOME_DIR" "$LOG_DIR"
  rm -f "$BIN_LINK"
  if [ -f "$HOME/.zprofile" ]; then
    grep -v '# CEO Relay$' "$HOME/.zprofile" > "$HOME/.zprofile.relay-tmp" || true
    cat "$HOME/.zprofile.relay-tmp" > "$HOME/.zprofile"
    rm -f "$HOME/.zprofile.relay-tmp"
  fi
  if [ "$all" = "--all" ]; then
    osascript -e 'quit app "BlueBubbles"' >/dev/null 2>&1 || true
    rm -rf "$HOME/Library/Application Support/bluebubbles-server"
  fi
  say ""
  verify_relay || true
  say ""
  say "Two things only you can do:"
  say "  - On the Desk's Relay page, press Unpair (it forgets the hub's token and the who's-waiting list on the site)."
  if [ "$all" = "--all" ]; then
    say "  - System Settings › Privacy & Security › Full Disk Access and Accessibility: turn BlueBubbles off."
  else
    say "  - BlueBubbles is still installed; to remove it too, run: relay wipe --all (or delete it from Applications)."
  fi
}

case "${1:-install}" in
  install) install_relay ;;
  on) resume_relay ;;
  off) pause_relay ;;
  status) status_relay ;;
  wipe)
    if [ "${2:-}" = "--verify" ]; then verify_relay; else wipe_relay "${2:-}"; fi
    ;;
  verify) verify_relay ;;
  *) say "relay: install | status | on | off | wipe [--all] | wipe --verify" ;;
esac
