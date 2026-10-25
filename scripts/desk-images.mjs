#!/usr/bin/env node
/**
 * Renders the Desk's imagery from the Lattice itself: the overview as a hero and each room, written as WebP under
 * apps/world/public/desk/. The page renders at twice its CSS size (deviceScaleFactor 2), so the hero comes out as
 * lattice.webp (1440 wide, also the "Enter the Lattice" thumbnail) and lattice@2x.webp (2880 wide, for retina screens),
 * and each room as room-<room>.webp (960 wide, Today's room cards) and room-<room>@2x.webp (2880 wide, the banner
 * over that room's Desk page, see desk/RoomBanner.tsx). The Desk shows them as static files, so three.js never loads with it. The agents'
 * portraits are taken separately, each model alone in the portrait studio: scripts/portraits.mjs.
 *
 * Usage: node scripts/desk-images.mjs [base-url] [--only=rooms|hero] [--rooms=studio,workshop]
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
/** Device pixels per CSS pixel: crops are given in CSS pixels and scaled by this. */
const SCALE = 2;
/** The Desk's rooms, in its order. */
const ALL_ROOMS = ["relay", "foundry", "spire", "exchange", "green", "archive", "workshop", "studio", "boiler"];
/** --rooms=a,b shoots only those rooms (a new room needs only its own stills). */
const pick = args.find((a) => a.startsWith("--rooms="))?.slice(8).split(",").filter(Boolean);
const ROOMS = pick ? ALL_ROOMS.filter((r) => pick.includes(r)) : ALL_ROOMS;

let hasConvert = true;
try {
  execFileSync("convert", ["-version"], { stdio: "ignore" });
} catch {
  hasConvert = false;
  console.warn("ImageMagick `convert` not found: writing JPEG instead of WebP.");
}

/** Crop + resize + encode. `crop` is {x, y, w, h} in CSS pixels on the full render; `width` the output width. */
function encode(src, name, crop, width, quality) {
  if (!hasConvert) return name + ".jpg";
  const out = join(OUT, `${name}.webp`);
  const c = { x: crop.x * SCALE, y: crop.y * SCALE, w: crop.w * SCALE, h: crop.h * SCALE };
  execFileSync("convert", [src, "-crop", `${c.w}x${c.h}+${c.x}+${c.y}`, "+repage", "-resize", String(width), "-quality", String(quality), "-define", "webp:method=6", out]);
  const kb = Math.round(statSync(out).size / 1024);
  console.log(`${name}.webp  ${kb} KB`);
  return out;
}

/** `outputs` is a list of [name, width, quality], all cut from one screenshot. */
async function shoot(page, outputs, crop) {
  const [name, , quality] = outputs[0];
  if (hasConvert) {
    const png = join(tmp, `${name}.png`);
    // At 2x, SwiftShader can take a while to hand over a frame.
    await page.screenshot({ path: png, timeout: 180_000 });
    for (const [n, width, q] of outputs) encode(png, n, crop, width, q);
  } else {
    await page.screenshot({ path: join(OUT, `${name}.jpg`), type: "jpeg", quality, clip: { x: crop.x, y: crop.y, width: crop.w, height: crop.h } });
  }
}

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
// A fixed seed so the cast is in its usual places; cuts instead of flights so each shot settles quickly.
await page.goto(`${base}/lattice?view=ring&instant&glitches=off&quality=high&seed=7`, { waitUntil: "load" });
await page.waitForFunction(() => globalThis.__ceo?.positions && Object.keys(globalThis.__ceo.positions()).length >= 14, undefined, { timeout: 180_000, polling: 1000 });
await page.waitForTimeout(4000);
// Clean renders: no HUD, loader, studio panel, callouts, name tags, nameplates or speech.
await page.addStyleTag({ content: ".hud, .loader, .studio, .callout, .tag, .nameplate, .bubble, .announce { display: none !important }" });

if (only === "all" || only === "hero") {
  await page.evaluate(() => globalThis.__ceo.focus(null));
  await page.waitForTimeout(3000);
  await shoot(page, [["lattice", W, 78], ["lattice@2x", W * 2, 74]], { x: 0, y: 0, w: W, h: H });
}

if (only === "all" || only === "rooms") {
  for (const room of ROOMS) {
    await page.evaluate((r) => globalThis.__ceo.focus(r), room);
    await page.waitForTimeout(2500);
    // room-<room>.webp is the card still on Today; room-<room>@2x.webp the banner over that room's Desk page.
    await shoot(page, [[`room-${room}`, 960, 68], [`room-${room}@2x`, W * 2, 70]], { x: 0, y: 60, w: W, h: 810 });
  }
}

await browser.close();
rmSync(tmp, { recursive: true, force: true });
