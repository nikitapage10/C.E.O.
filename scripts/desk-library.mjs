// Writes the Desk's library for Skippy (#1141; scripts/desk-library-lib.mjs) into api/_skippy/deskIndex.ts: the
// repo's public docs, lore, room manifests and dossiers, split by section. Not committed: written at every install
// (postinstall) and every build (npm run build, npm run build:azure), so the Function App's bundle always carries it.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderDeskIndex } from "./desk-library-lib.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const path = fileURLToPath(new URL("../api/_skippy/deskIndex.ts", import.meta.url));
const text = renderDeskIndex(root);
let now = "";
try {
  now = readFileSync(path, "utf8");
} catch {
  // Not written yet.
}
if (now === text) console.log(`${path} is current`);
else {
  writeFileSync(path, text);
  console.log(`wrote ${path} (${(text.length / 1024).toFixed(0)} KB)`);
}
