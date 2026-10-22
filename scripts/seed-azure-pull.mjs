#!/usr/bin/env node
/**
 * Downloads production's world, stories and idea pictures from the private Vercel Blob store into a folder, keeping
 * each blob's name, for the one-off Azure seed in .github/workflows/backup-azure.yml (docs/AZURE.md).
 *
 *   BLOB_READ_WRITE_TOKEN=… node scripts/seed-azure-pull.mjs <folder>
 *
 * The token is read from the environment by @vercel/blob and never printed. Prints counts only.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { get, list } from "@vercel/blob";
import { SEED_PREFIXES, seedTarget } from "./seed-azure-lib.mjs";

const root = resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  console.error("usage: node scripts/seed-azure-pull.mjs <folder>");
  process.exit(2);
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN isn't set.");
  process.exit(2);
}

let files = 0;
let bytes = 0;
let skipped = 0;
for (const prefix of SEED_PREFIXES) {
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    for (const blob of page.blobs) {
      const target = seedTarget(root, blob.pathname);
      if (!target) {
        skipped++;
        continue;
      }
      const found = await get(blob.pathname, { access: "private", useCache: false });
      if (!found?.stream) {
        skipped++;
        continue;
      }
      const body = new Uint8Array(await new Response(found.stream).arrayBuffer());
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body);
      files++;
      bytes += body.byteLength;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}
console.log(`Downloaded ${files} files (${Math.round(bytes / 1024)} KB) from ${SEED_PREFIXES.join(", ")}; skipped ${skipped}.`);
