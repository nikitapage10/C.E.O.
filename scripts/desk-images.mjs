#!/usr/bin/env node
/**
 * Renders the Desk's imagery from the Lattice itself: the overview as a hero, each room, and a portrait of every
 * agent (the Agent Studio's framing), written as WebP under apps/world/public/desk/. The Desk shows them as static
 * files, so three.js never loads with it.
 *
 * Usage: node scripts/desk-images.mjs [base-url] [--only=rooms|agents|hero]
 *   base-url defaults to http://localhost:5181 (a `vite preview` or `vite dev` of @ceo/world).
 * Needs Chromium for Playwright (PLAYWRIGHT_CHROMIUM_PATH, or Playwright's own) and ImageMagick's `convert`
 * (falls back to JPEG straight from Playwright when it is missing).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith("--")) ?? "http://localhost:5181";
const only = args.find((a) => a.startsWith("--only="))?.slice(7) ?? "all";
const OUT = new URL("../apps/world/public/desk/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "desk-images-"));

const W = 1440;
const H = 900;
/** The Desk's rooms, in its order. */
const ROOMS = ["relay", "foundry", "spire", "exchange", "green", "archive", "workshop", "boiler"];
/** Where the studio camera puts the agent on a 1440×900 render: left of centre, so the panel has room. */
const PORTRAIT = { x: 150, y: 110, size: 700 };

let hasConvert = true;
try {
  execFileSync("convert", ["-version"], { stdio: "ignore" });
} catch {
  hasConvert = false;
  console.warn("ImageMagick `convert` not found: writing JPEG instead of WebP.");
}

/** Crop + resize + encode. `crop` is {x, y, w, h} on the full render; `width` the output width. */
function encode(src, name, crop, width, quality) {
  if (!hasConvert) return name + ".jpg";
  const out = join(OUT, `${name}.webp`);
  execFileSync("convert", [src, "-crop", `${crop.w}x${crop.h}+${crop.x}+${crop.y}`, "+repage", "-resize", String(width), "-quality", String(quality), "-define", "webp:method=6", out]);
  const kb = Math.round(statSync(out).size / 1024);
  console.log(`${name}.webp  ${kb} KB`);
  return out;
}

async function shoot(page, name, crop, width, quality) {
  if (hasConvert) {
    const png = join(tmp, `${name}.png`);
    await page.screenshot({ path: png });
    encode(png, name, crop, width, quality);
  } else {
    await page.screenshot({ path: join(OUT, `${name}.jpg`), type: "jpeg", quality, clip: { x: crop.x, y: crop.y, width: crop.w, height: crop.h } });
  }
}

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
// A fixed seed so the cast is in its usual places; cuts instead of flights so each shot settles quickly.
await page.goto(`${base}/lattice?instant&glitches=off&quality=high&seed=7`, { waitUntil: "load" });
await page.waitForFunction(() => window.__ceo?.positions && Object.keys(window.__ceo.positions()).length >= 14, undefined, { timeout: 180_000, polling: 1000 });
await page.waitForTimeout(4000);
// Clean renders: no HUD, loader, studio panel, callouts, name tags or speech.
await page.addStyleTag({ content: ".hud, .loader, .studio, .callout, .tag, .bubble, .announce { display: none !important }" });

if (only === "all" || only === "hero") {
  await page.evaluate(() => window.__ceo.focus(null));
  await page.waitForTimeout(3000);
  await shoot(page, "lattice", { x: 0, y: 0, w: W, h: H }, 1440, 68);
}

if (only === "all" || only === "rooms") {
  for (const room of ROOMS) {
    await page.evaluate((r) => window.__ceo.focus(r), room);
    await page.waitForTimeout(2500);
    await shoot(page, `room-${room}`, { x: 0, y: 60, w: W, h: 810 }, 960, 68);
  }
}

if (only === "all" || only === "agents") {
  const roster = await page.evaluate(() =>
    Object.entries(window.__ceo.state().agents).map(([id, a]) => ({ id, room: a.agent.home?.room ?? a.place?.room ?? null, name: a.agent.name })),
  );
  for (const a of roster) {
    if (!a.room) {
      console.warn(`no room for ${a.id}, skipping`);
      continue;
    }
    // The studio camera frames the agent only once it is in its room; an agent still walking over gets a few tries.
    let framed = false;
    for (let tries = 0; tries < 6 && !framed; tries++) {
      await page.evaluate(([id, room]) => {
        window.__ceo.openStudio(null);
        window.__ceo.focus(room);
        window.__ceo.openStudio(id);
      }, [a.id, a.room]);
      await page.waitForTimeout(2500);
      framed = await page.evaluate(() => (window.__ceo.camera()?.distance ?? 99) < 9);
      if (!framed) await page.waitForTimeout(4000);
    }
    if (!framed) console.warn(`${a.id}: the studio camera never reached them; portrait may be off`);
    await shoot(page, `agent-${a.id}`, { x: PORTRAIT.x, y: PORTRAIT.y, w: PORTRAIT.size, h: PORTRAIT.size }, 480, 70);
    await page.evaluate(() => window.__ceo.openStudio(null));
  }
}

await browser.close();
rmSync(tmp, { recursive: true, force: true });
