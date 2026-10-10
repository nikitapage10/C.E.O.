#!/usr/bin/env bash
# Downloads the raw model library (about 1.5 GB zipped, 2.4 GB extracted) and unpacks it outside the repo.
# assets/catalog/catalog.json maps every model to its path under this folder (the "source" field).
#
#   scripts/fetch-assets.sh [dest]    # dest defaults to $CEO_ASSETS or ~/.cache/ceo-assets
set -euo pipefail

DRIVE_ID="1sFUf8DYr0cMToM0yWcCKclOhffA3f9m6"
DEST="${1:-${CEO_ASSETS:-$HOME/.cache/ceo-assets}}"

if [ -d "$DEST/x" ]; then
  echo "Already fetched: $DEST/x"
  exit 0
fi

mkdir -p "$DEST"
echo "Downloading the library to $DEST ..."
curl -fSL -o "$DEST/assets.zip" "https://drive.usercontent.google.com/download?id=${DRIVE_ID}&export=download&confirm=t"

# The zip holds one zip per pack, some of which hold zips of their own.
unzip -q -o "$DEST/assets.zip" -d "$DEST/outer"
mkdir -p "$DEST/x"
for z in "$DEST/outer"/*.zip; do
  d="$DEST/x/$(basename "${z%.zip}")"
  mkdir -p "$d" && unzip -q -o "$z" -d "$d"
done
for _ in 1 2; do
  find "$DEST/x" -name '*.zip' -print0 | while IFS= read -r -d '' z; do
    mkdir -p "${z%.zip}" && unzip -q -o "$z" -d "${z%.zip}" && rm "$z"
  done
done
rm -rf "$DEST/outer" "$DEST/assets.zip"

# Some kits keep their textures in a shared folder but reference them by bare name. Link them in next to the .gltf.
node - "$DEST/x" <<'EOF'
const fs = require("fs"), path = require("path");
const root = process.argv[2], images = {}, gltfs = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(png|jpe?g)$/i.test(e.name)) (images[e.name] ??= []).push(p);
    else if (e.name.endsWith(".gltf")) gltfs.push(p);
  }
})(root);
let linked = 0;
for (const f of gltfs) {
  const pack = path.relative(root, f).split(path.sep)[0];
  for (const im of JSON.parse(fs.readFileSync(f, "utf8")).images || []) {
    if (!im.uri || im.uri.startsWith("data:")) continue;
    const target = path.join(path.dirname(f), decodeURIComponent(im.uri));
    if (fs.existsSync(target)) continue;
    const src = (images[path.basename(target)] || []).find((p) => path.relative(root, p).split(path.sep)[0] === pack);
    if (src) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.symlinkSync(src, target); linked++; }
  }
}
console.log(`Linked ${linked} shared textures.`);
EOF

echo "Done: $DEST/x"
