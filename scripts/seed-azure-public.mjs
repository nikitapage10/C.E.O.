#!/usr/bin/env node
/**
 * The Azure seed without a token (docs/AZURE.md, "Seeding the Azure state"): reads production's world, its days and
 * its stories from the public API, the same pages the nightly backup saves, and writes them into a folder under the
 * Azure store's own blob names and format (scripts/seed-azure-lib.mjs) for .github/workflows/backup-azure.yml to upload.
 *
 *   node scripts/seed-azure-public.mjs <folder> [site]
 *
 * Plain Node, no dependencies and no secrets. Prints counts only.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mondayOf, publicSeedFiles, seedTarget } from "./seed-azure-lib.mjs";

if (!process.argv[2]) {
  console.error("usage: node scripts/seed-azure-public.mjs <folder> [site]");
  process.exit(2);
}
const root = resolve(process.argv[2]);
const site = new URL(process.argv[3] ?? "https://command-everything-obviously.vercel.app");
// A fresh read, past the edge's cached copy (the API ignores the extra parameter).
const fresh = String(Date.now());

async function getJson(path, params) {
  const url = new URL(path, site);
  for (const [k, v] of Object.entries({ ...params, fresh })) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url.pathname}?${[...url.searchParams.keys()].join("&")} answered ${res.status}`);
  return res.json();
}

/** A story's WAV: one answer when small, else in ranges (the route caps each answer at 4 MB). */
async function getWav(params) {
  const url = new URL("/api/day-story", site);
  for (const [k, v] of Object.entries({ ...params, audio: "1", fresh })) url.searchParams.set(k, v);
  const parts = [];
  let at = 0;
  for (;;) {
    const res = await fetch(url, { headers: { Range: `bytes=${at}-` }, signal: AbortSignal.timeout(60_000) });
    if (res.status === 404) return null;
    if (res.status !== 200 && res.status !== 206) throw new Error(`audio answered ${res.status}`);
    const chunk = new Uint8Array(await res.arrayBuffer());
    if (res.status === 200) return chunk;
    const total = Number(/\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1]);
    if (!Number.isFinite(total) || chunk.byteLength === 0) throw new Error("audio range without a size");
    parts.push(chunk);
    at += chunk.byteLength;
    if (at >= total) break;
  }
  const wav = new Uint8Array(at);
  let off = 0;
  for (const p of parts) {
    wav.set(p, off);
    off += p.byteLength;
  }
  return wav;
}

const feed = await getJson("/api/world", {});
const days = Array.isArray(feed.days) ? feed.days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
const pages = [];
const stories = [];
for (const day of days) {
  pages.push(await getJson("/api/world", { day }));
  const view = await getJson("/api/day-story", { day });
  if (view.ready) stories.push({ view, wav: await getWav({ day }) });
}
const weeks = [];
for (const week of [...new Set(days.map(mondayOf))]) {
  const view = await getJson("/api/day-story", { week });
  if (view.ready) weeks.push({ view, wav: view.audio ? await getWav({ week }) : null });
}

let bytes = 0;
const files = publicSeedFiles({ feed, pages, stories, weeks });
for (const { name, data } of files) {
  const target = seedTarget(root, name);
  if (!target) throw new Error(`refused to write ${name}`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
  bytes += typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
}
console.log(`Built ${files.length} files (${Math.round(bytes / 1024)} KB) from ${site.host}'s public API: step ${feed.step}, ${pages.length} days, ${stories.length} day stories, ${weeks.length} week stories.`);
