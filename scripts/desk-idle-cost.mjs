/* global process, console */
/**
 * What the Desk costs while it sits there (#327): CPU time per second and animation frames per second over a quiet
 * spell on `/`, once with the Lattice never entered and once after entering it and coming back (the Lattice stays
 * mounted but hidden, main.tsx, and must not draw a single frame).
 *
 * Run it after `npm run build`: `node scripts/desk-idle-cost.mjs [port] [--ms=10000]`. Set PLAYWRIGHT_CHROMIUM_PATH
 * to use a preinstalled Chromium. ANGLE's null GL backend, so a software GPU doesn't skew the CPU numbers.
 */
import { chromium } from "@playwright/test";
import { startDistServer } from "../tests/e2e/dist-server.ts";

const args = process.argv.slice(2);
const PORT = Number(args.find((a) => !a.startsWith("--"))) || 5195;
const MS = Number(args.find((a) => a.startsWith("--ms="))?.slice(5) ?? 10000);
const server = await startDistServer(PORT);
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  args: ["--use-gl=angle", "--use-angle=null", "--ignore-gpu-blocklist"],
});

/** Counts requestAnimationFrame callbacks, from before the page's own scripts run. */
function countFrames() {
  const raf = globalThis.requestAnimationFrame.bind(globalThis);
  globalThis.__rafs = 0;
  globalThis.requestAnimationFrame = (cb) => raf((t) => ((globalThis.__rafs += 1), cb(t)));
}

async function quiet(page, label) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const a = await metric();
  const r0 = await page.evaluate(() => globalThis.__rafs);
  // Frames the Lattice's renderer drew, when it's in the page: none, while it's hidden.
  const drawn = () => page.evaluate(() => globalThis.__ceo?.three?.().gl.info.render.frame ?? null);
  const d0 = await drawn();
  await page.waitForTimeout(MS);
  const b = await metric();
  const r1 = await page.evaluate(() => globalThis.__rafs);
  const d1 = await drawn();
  const secs = MS / 1000;
  console.log(
    `${label}: CPU ${(((b.TaskDuration - a.TaskDuration) / secs) * 1000).toFixed(0)} ms/s (script ${(((b.ScriptDuration - a.ScriptDuration) / secs) * 1000).toFixed(0)} ms/s), ` +
      `${((r1 - r0) / secs).toFixed(1)} animation frames/s` + (d0 === null ? "" : `, Lattice frames drawn ${d1 - d0}`),
  );
}

const desk = async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(countFrames);
  return page;
};
const settle = (page) => page.waitForFunction(() => globalThis.document.querySelector(".desk__tabs"), undefined, { timeout: 60_000 }).then(() => page.waitForTimeout(8000));

// 1. The Desk alone.
const a = await desk();
await a.goto(`http://localhost:${PORT}/`);
await settle(a);
await quiet(a, "Desk, Lattice never entered");
await a.close();

// 2. Into the Lattice (until it draws and its rooms' models are in), and back to the Desk the way its own button goes.
const b = await desk();
await b.goto(`http://localhost:${PORT}/lattice`);
await b.waitForFunction(() => globalThis.__ceo?.boot?.().models !== undefined, undefined, { timeout: 1_500_000, polling: 1000 });
await b.evaluate(() => {
  globalThis.history.pushState(null, "", "/");
  globalThis.dispatchEvent(new globalThis.PopStateEvent("popstate"));
});
await settle(b);
await quiet(b, "Desk, Lattice entered then hidden");
await b.close();

await browser.close();
server.close();
