#!/usr/bin/env node
/**
 * Photographs every agent for the Desk: each one's own model, alone in the portrait studio (/studio?agent=<id>,
 * apps/world/src/studio), in a three-quarter turn under a key, a rim and a fill, over its room's colours. Writes
 * apps/world/public/desk/agent-<id>.webp and the list the Desk reads them by (apps/world/src/desk/portraits.ts).
 *
 * The cast comes from the studio itself (window.__studio.roster, from the simulator's SAMPLE_AGENTS), so a new
 * agent, submind or otherwise, gets a portrait the next time this runs, with nothing to add here.
 *
 * Usage: node scripts/portraits.mjs [base-url] [--only=id,id] [--sheet=path.png] [--keep=dir]
 *   Without a base URL it starts a Vite dev server for @ceo/world itself, and stops it when done.
 *   --sheet also writes a contact sheet of the whole cast; --keep keeps each full-size render (PNG) in dir.
 * Needs Chromium (PLAYWRIGHT_CHROMIUM_PATH, else /opt/pw-browsers/chromium, else Playwright's own). Renders with
 * software GL (SwiftShader), so it waits for the studio to say the render has settled, never for network idle.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const only = flag("only")?.split(",").filter(Boolean);
const sheet = flag("sheet");
const keep = flag("keep");
let base = args.find((a) => !a.startsWith("--"));

const ROOT = new URL("../", import.meta.url).pathname;
const OUT = new URL("../apps/world/public/desk/", import.meta.url).pathname;
const LIST = new URL("../apps/world/src/desk/portraits.ts", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/** The Desk's largest avatar is 72px; 192px covers it at 2× with room for its slight zoom. */
const SIZE = 192;
/** The studio's square, in CSS pixels, photographed at 2× and scaled down for clean edges. */
const FRAME = 512;

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

let server = null;
async function startServer() {
  const port = await freePort();
  server = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: `${ROOT}apps/world`, stdio: ["ignore", "pipe", "pipe"], detached: true });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("vite did not start")), 60_000);
    server.stdout.on("data", (d) => {
      if (String(d).includes(`${port}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on("exit", (code) => reject(new Error(`vite exited ${code}`)));
  });
  return `http://localhost:${port}`;
}
function stopServer() {
  if (!server) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    /* Already gone. */
  }
  server = null;
}
process.on("exit", stopServer);
process.on("SIGINT", () => process.exit(130));

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

try {
  if (!base) base = await startServer();
  const browser = await chromium.launch({
    executablePath,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: FRAME, height: FRAME }, deviceScaleFactor: 2 });
  page.on("pageerror", (e) => console.log("pageerror:", e.message));

  await page.goto(`${base}/studio`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => globalThis.__studio?.roster?.length > 0, undefined, { timeout: 120_000 });
  const roster = await page.evaluate(() => globalThis.__studio.roster);
  const wanted = only ? roster.filter((a) => only.includes(a.id)) : roster;
  console.log(`${roster.length} in the cast; photographing ${wanted.length}.`);

  const shots = [];
  for (const a of wanted) {
    const started = Date.now();
    await page.goto(`${base}/studio?agent=${a.id}`, { waitUntil: "domcontentloaded" });
    try {
      await page.waitForFunction(() => globalThis.__studio?.ready === true, undefined, { timeout: 240_000, polling: 500 });
    } catch {
      console.warn(`${a.id}: the studio never settled; skipping`);
      continue;
    }
    // The studio square sits at the page's top left; a clip, not an element shot, so a busy page needn't look "stable".
    const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: FRAME, height: FRAME }, timeout: 120_000 });
    const file = `${OUT}agent-${a.id}.webp`;
    const webp = await sharp(png).resize(SIZE, SIZE, { kernel: "lanczos3" }).webp({ quality: 82, effort: 6, smartSubsample: true }).toBuffer();
    writeFileSync(file, webp);
    if (keep) {
      mkdirSync(keep, { recursive: true });
      writeFileSync(`${keep}/${a.id}.png`, png);
    }
    shots.push({ ...a, png });
    console.log(`agent-${a.id}.webp  ${(webp.length / 1024).toFixed(1)} KB  (${a.body}, ${((Date.now() - started) / 1000).toFixed(0)}s)`);
  }
  // Skippy runs the cast and isn't in it: his portrait for the Desk's chat (apps/world/src/desk/skippy) is
  // public/desk/skippy.webp, shot on a full run or with --only=skippy, and never listed in PORTRAITS.
  if (!only || only.includes("skippy")) {
    await page.goto(`${base}/studio?agent=skippy`, { waitUntil: "domcontentloaded" });
    try {
      await page.waitForFunction(() => globalThis.__studio?.ready === true, undefined, { timeout: 240_000, polling: 500 });
      const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: FRAME, height: FRAME }, timeout: 120_000 });
      const webp = await sharp(png).resize(SIZE, SIZE, { kernel: "lanczos3" }).webp({ quality: 82, effort: 6, smartSubsample: true }).toBuffer();
      writeFileSync(`${OUT}skippy.webp`, webp);
      if (keep) writeFileSync(`${keep}/skippy.png`, png);
      console.log(`skippy.webp  ${(webp.length / 1024).toFixed(1)} KB`);
    } catch {
      console.warn("skippy: the studio never settled; skipping");
    }
  }
  await browser.close();

  // The list the Desk resolves portraits by: every agent in the cast, by id and by name.
  if (!only) {
    const rows = roster.map((a) => `  ${JSON.stringify(a.id)}: { name: ${JSON.stringify(a.name)}, room: ${JSON.stringify(a.room)} },`).join("\n");
    writeFileSync(
      LIST,
      `// Written by scripts/portraits.mjs from the cast: re-run it when an agent joins (a test checks it's current).\n` +
        `/** Every agent with a portrait under public/desk/agent-<id>.webp: its name and its room. */\n` +
        `export const PORTRAITS: Record<string, { name: string; room: string }> = {\n${rows}\n};\n`,
    );
  }

  if (sheet && shots.length) {
    const cell = 220;
    const cols = 6;
    const label = 34;
    const rows = Math.ceil(shots.length / cols);
    const W = cols * cell;
    const H = rows * (cell + label) + 24;
    const tiles = await Promise.all(
      shots.map(async (s, i) => {
        const x = (i % cols) * cell;
        const y = Math.floor(i / cols) * (cell + label) + 12;
        const r = (cell - 28) / 2;
        const mask = Buffer.from(`<svg width="${cell - 28}" height="${cell - 28}"><circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/></svg>`);
        const img = await sharp(s.png).resize(cell - 28, cell - 28).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
        return { input: img, left: x + 14, top: y + 6 };
      }),
    );
    const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const text = shots
      .map((s, i) => {
        const x = (i % cols) * cell + cell / 2;
        const y = Math.floor(i / cols) * (cell + label) + 12 + cell + 4;
        return `<text x="${x}" y="${y}" fill="#dfe8f7" font-family="Inter, sans-serif" font-size="15" text-anchor="middle">${esc(s.name)}</text><text x="${x}" y="${y + 17}" fill="#7f8ea8" font-family="monospace" font-size="10" letter-spacing="2" text-anchor="middle">${esc(s.room.toUpperCase())} · ${esc(s.id)}</text>`;
      })
      .join("");
    const labels = Buffer.from(`<svg width="${W}" height="${H}">${text}</svg>`);
    await sharp({ create: { width: W, height: H, channels: 3, background: "#070b14" } })
      .composite([...tiles, { input: labels, left: 0, top: 0 }])
      .png()
      .toFile(sheet);
    console.log(`contact sheet: ${sheet}`);
  }
} finally {
  stopServer();
}
