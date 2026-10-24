#!/usr/bin/env node
/**
 * The room tour for Visual QA (#91): boots the built Lattice once, visits every room with the camera's fixed view of
 * it, and records a short clip of each for scripts/visual-qa.mjs to send to Gemini.
 *
 * How the clips are cut. On SwiftShader the picture on screen runs seconds behind the page's own clock, by a different
 * amount in each room (a room seen for the first time compiles shaders and uploads textures), so cutting by time puts
 * the wrong room in a clip. Instead each room paints a small colour tag in the top-left corner, two frames after the
 * camera cuts to it. The browser's own screencast (Chrome DevTools Protocol, Page.startScreencast: the feed Playwright
 * records video from) runs from the start, every frame is sorted into its room by the tag it shows, and ffmpeg joins a
 * room's frames into a WebM with the tag's strip cropped off. (Playwright's recordVideo drifts the same way, a
 * screencast started after the boot gets no frames, and screenshots take half a minute each here.)
 *
 * Usage: node scripts/room-tour.mjs [base-url]
 *   With no base-url it serves apps/world/dist itself (tests/e2e/dist-server.ts, the way Vercel answers), so run
 *   `npm run build` first. Clips and manifest.json land in test-results/visual-qa/.
 * Needs Chromium for Playwright (PLAYWRIGHT_CHROMIUM_PATH, or Playwright's own, e.g. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers)
 * and ffmpeg (FFMPEG, or on the PATH; the workflow installs it if the runner lacks it). SwiftShader is slow: the boot
 * gets 180 s, like the browser tests; the whole tour takes about five minutes.
 */
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { MAX_CLIP_BYTES, ROOMS } from "../api/_visualqa/review.ts";

const OUT = new URL("../test-results/visual-qa/", import.meta.url).pathname;
const PORT = 5183;
/** Small on purpose: Gemini samples it at low resolution anyway, and small clips upload fast. */
const SIZE = { width: 960, height: 540 };
/** The tag's strip along the top, cropped off every clip. */
const STRIP = 24;
/** How long the camera rests on each room. */
const VISIT_MS = 12_000;
/** At most this many frames a clip (eight seconds at two a second): the last room keeps collecting while the backlog drains. */
const MAX_FRAMES = 16;
const FFMPEG = process.env.FFMPEG || "ffmpeg";

/** One tag colour per room, far apart so JPEG can't blur one into another. */
const TAGS = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [255, 0, 255],
  [0, 255, 255],
  [255, 128, 0],
  [128, 0, 255],
  [255, 255, 255],
  [128, 255, 0],
  [0, 128, 255],
];
if (ROOMS.length > TAGS.length) throw new Error("room-tour: more rooms than tag colours");

try {
  execFileSync(FFMPEG, ["-version"], { stdio: "ignore" });
} catch {
  console.error(`room-tour: ${FFMPEG} not found. Install ffmpeg, or set FFMPEG to its path.`);
  process.exit(1);
}

/** The room a frame belongs to, by the tag in its corner, or -1 when it shows none. */
async function tagOf(path) {
  // (sharp's stats() reads the whole input, not the extract, so the pixels are averaged here.)
  const { data, info } = await sharp(path).extract({ left: 4, top: 4, width: 12, height: 12 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  for (let p = 0; p < data.length; p += info.channels) for (let c = 0; c < 3; c += 1) sum[c] += data[p + c];
  const [r, g, b] = sum.map((s) => s / (data.length / info.channels));
  let best = -1;
  let bestDist = 90;
  TAGS.forEach(([tr, tg, tb], i) => {
    const d = Math.hypot(r - tr, g - tg, b - tb);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  });
  return best;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "room-tour-"));

let server = null;
let base = process.argv[2];
if (!base) {
  const { startDistServer } = await import("../tests/e2e/dist-server.ts");
  server = await startDistServer(PORT);
  base = `http://localhost:${PORT}`;
}

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const manifest = [];
try {
  const page = await browser.newPage({ viewport: SIZE });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let recording = false;
  let lastArrival = Date.now();
  cdp.on("Page.screencastFrame", (f) => {
    lastArrival = Date.now();
    if (recording) {
      const path = join(tmp, `${String(frames.length).padStart(5, "0")}.jpg`);
      writeFileSync(path, Buffer.from(f.data, "base64"));
      frames.push(path);
    }
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: SIZE.width, maxHeight: SIZE.height, everyNthFrame: 1 });

  const t0 = Date.now();
  // The same switches as the browser tests: a fixed seed so the cast starts in its usual places, camera cuts instead
  // of flights, no glitches, agents at four times speed so a few seconds shows them walking.
  await page.goto(`${base}/lattice?view=ring&instant&glitches=off&speed=4&quality=low&seed=7`, { waitUntil: "load" });
  await page.waitForFunction(() => globalThis.__ceo?.positions && Object.keys(globalThis.__ceo.positions()).length >= 14, undefined, { timeout: 180_000, polling: 1000 });
  console.log(`room-tour: booted in ${Math.round((Date.now() - t0) / 1000)} s`);
  // The scene only (the page's own panels and loader are not what's being checked), and the tag.
  await page.addStyleTag({
    content: `.hud, .loader, .studio { display: none !important }
      #vqa-tag { position: fixed; left: 0; top: 0; width: ${STRIP}px; height: ${STRIP}px; z-index: 2147483647; pointer-events: none; background: transparent }`,
  });
  await page.evaluate(() => globalThis.document.body.appendChild(Object.assign(globalThis.document.createElement("div"), { id: "vqa-tag" })));
  await page.waitForTimeout(3000);
  recording = true;

  for (const [i, room] of ROOMS.entries()) {
    await page.evaluate(
      ({ id, rgb }) => {
        globalThis.__ceo.focus(id);
        // Two frames on, so the tag can't reach the screen before the new view does.
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(() => (globalThis.document.getElementById("vqa-tag").style.background = `rgb(${rgb.join(",")})`)));
      },
      { id: room.id, rgb: TAGS[i] },
    );
    await page.waitForTimeout(VISIT_MS);
  }
  // Let the backlog of frames arrive: until none has come for five seconds, or two minutes at most.
  const drainStart = Date.now();
  while (Date.now() - lastArrival < 5000 && Date.now() - drainStart < 120_000) await page.waitForTimeout(500);
  recording = false;
  await cdp.send("Page.stopScreencast").catch(() => {});

  const byRoom = ROOMS.map(() => []);
  for (const path of frames) {
    const tag = await tagOf(path);
    if (tag >= 0) byRoom[tag].push(path);
  }
  for (const [i, room] of ROOMS.entries()) {
    // The room's first frame can still be settling; keep it only when it is all there is.
    const mine = (byRoom[i].length > 2 ? byRoom[i].slice(1) : byRoom[i]).slice(0, MAX_FRAMES);
    const file = `${room.id}.webm`;
    if (mine.length === 0) {
      console.log(`room-tour: ${room.name}: no frames showed its tag; no clip`);
      continue;
    }
    const dir = join(tmp, room.id);
    mkdirSync(dir);
    mine.forEach((p, n) => renameSync(p, join(dir, `${String(n).padStart(4, "0")}.jpg`)));
    // Two frames a second, Gemini's sampling rate, whatever rate SwiftShader managed.
    execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-framerate", "2", "-i", join(dir, "%04d.jpg"), "-vf", `crop=iw:ih-${STRIP}:0:${STRIP}`, "-c:v", "libvpx", "-b:v", "700k", "-pix_fmt", "yuv420p", "-an", join(OUT, file)]);
    const bytes = statSync(join(OUT, file)).size;
    const seconds = Math.max(0.5, mine.length / 2);
    manifest.push({ room: room.id, file, seconds, frames: mine.length, mime: "video/webm" });
    console.log(`room-tour: ${room.name}: ${file}, ${mine.length} frames, ${Math.round(bytes / 1024)} KB${bytes > MAX_CLIP_BYTES ? " (over the size limit; won't be sent)" : ""}`);
  }
} finally {
  await browser.close();
  server?.close();
  if (process.env.ROOM_TOUR_KEEP) console.log(`room-tour: frames kept in ${tmp}`);
  else rmSync(tmp, { recursive: true, force: true });
}

writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ at: new Date().toISOString(), size: SIZE, rooms: manifest }, null, 2));
console.log(`room-tour: ${manifest.length} clips in test-results/visual-qa/`);
