#!/usr/bin/env bash
# Fetches DoorDash's own CLI for the Function app (#1195, docs/HOME-DEVICES.md, "DoorDash"): the pinned Linux release
# from github.com/doordash-oss/doordash-cli, checked against its sha256 (any mismatch stops here), unpacked into
# azure/vendor/dd-cli/ (gitignored), which azure/build.mjs copies into the functions package as bin/dd-cli/.
#
#   GH_TOKEN=... scripts/fetch-dd-cli.sh    # Deploy to Azure runs it before `npm run build:azure`
#
# The folder is the PyInstaller bundle itself: the executable dd-cli-v0.2.6-linux-amd64 beside its _internal/.
set -euo pipefail

VERSION="0.2.6"
ASSET="dd-cli-v${VERSION}-linux-amd64.tar.gz"
SHA256="b6abad40c4881589611d3b87e8f5e68fa5473f12469bd2a9d71db7064c5ff051"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/azure/vendor/dd-cli"
EXE="dd-cli-v${VERSION}-linux-amd64"

if [ -x "$DEST/$EXE" ] && [ "$(cat "$DEST/.version" 2>/dev/null)" = "$VERSION" ]; then
  echo "dd-cli $VERSION already in azure/vendor/dd-cli"
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
gh release download -R doordash-oss/doordash-cli "v${VERSION}" --pattern "$ASSET" --dir "$WORK"
echo "${SHA256}  ${WORK}/${ASSET}" | sha256sum -c --quiet - || {
  echo "dd-cli: $ASSET does not match the pinned sha256; refusing it" >&2
  exit 1
}

mkdir -p "$WORK/x"
tar -xzf "$WORK/$ASSET" -C "$WORK/x" --no-same-owner
[ -x "$WORK/x/$EXE/$EXE" ] || { echo "dd-cli: $EXE not found in $ASSET" >&2; exit 1; }
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
mv "$WORK/x/$EXE" "$DEST"
echo "$VERSION" > "$DEST/.version"
echo "dd-cli $VERSION ready in azure/vendor/dd-cli ($(du -sh "$DEST" | cut -f1))"
