#!/usr/bin/env node
/**
 * Per-frame cost of the Lattice, per view: the overview and a couple of rooms.
 *
 *   node scripts/perf-lattice.mjs [--rooms foundry,workshop] [--frames 30] [--quality high|low]
 *                                 [--shots <dir>] [--tag before] [--port 5189] [--no-build] [--json]
 *
 * Builds the app, serves it with `vite preview` and opens /lattice in headless Chromium. For each view it prints:
 *
 * - renderer counts for one whole frame (draw calls, triangles, shader programs, textures, geometries);
 * - main-thread time per frame (ms), stepping frames by hand: median and lower quartile;
 * - how often a frame redoes whole-scene work: scene renders and full matrix updates per frame;
 * - JS heap allocated per frame (KB, sampled by the heap profiler);
 * - React commits per second, and the number of useFrame hooks;
 * - still furniture merged (#136): how many meshes, in how many pieces.
 *
 * Timing runs on ANGLE's null GL backend: the browser does all of its own and three.js's work, but nothing is
 * drawn, so a slow software GPU can't stall the frame being timed. Screenshots (--shots) come from a second
 * browser on SwiftShader, which draws for real. Either way this is a VM: compare two runs (before and after a
 * change), not with a desktop, and expect some noise in the timings (the counts are exact).
 * Set PLAYWRIGHT_CHROMIUM_PATH to pick the browser (default /opt/pw-browsers/chromium).
 */
import { execSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const PORT = Number(opt("port", "5189"));
const ROOMS = opt("rooms", "foundry,workshop").split(",").filter(Boolean);
const FRAMES = Number(opt("frames", "30"));
const QUALITY = opt("quality", "high");
const SHOTS = opt("shots", "");
const TAG = opt("tag", "run");
const EXE = process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const VIEWPORT = { width: 1280, height: 800 };
const NULL_GL = ["--use-gl=angle", "--use-angle=null", "--ignore-gpu-blocklist"];
const SWIFTSHADER = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

if (!flag("no-build")) execSync("npm run build", { cwd: root, stdio: "ignore" });

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  cwd: join(root, "apps/world"),
  stdio: "ignore",
  detached: true,
});
const stopServer = () => {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
};
process.on("exit", stopServer);

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`vite preview did not come up on port ${PORT}`);
}

/** Runs in the page before its scripts: a stand-in React DevTools hook that counts commits. */
function countCommits() {
  const stats = { commits: 0 };
  window.__perf = stats;
  let id = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(),
    supportsFiber: true,
    isDisabled: false,
    inject(renderer) {
      this.renderers.set(++id, renderer);
      return id;
    },
    onCommitFiberRoot() {
      stats.commits++;
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
}

async function openLattice(browser) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.addInitScript(countCommits);
  await page.goto(`http://localhost:${PORT}/lattice?view=ring&instant&glitches=off&seed=7&quality=${QUALITY}`);
  await page.waitForFunction(
    () => {
      const c = window.__ceo;
      return c?.positions && Object.keys(c.positions()).length >= 14 && c.renderInfo && c.three;
    },
    undefined,
    { timeout: 300_000, polling: 1000 },
  );
  // Let late models, shaders and the first shadow and reflection passes settle.
  await page.waitForTimeout(8000);
  await settleStill(page);
  return page;
}

/**
 * Still furniture (#136) merges over a few seconds of frames, and a headless browser draws few of them on its own:
 * step frames by hand until the merged count stops changing (at most two minutes), so every view is measured merged.
 */
async function settleStill(page) {
  if (!(await page.evaluate(() => !!window.__ceo.still))) return;
  await page.evaluate(async () => {
    const st = window.__ceo.three();
    st.setFrameloop("never");
    const count = () => {
      const s = window.__ceo.still();
      return `${s.merged}/${s.pieces}`;
    };
    let last = "";
    const end = performance.now() + 120_000;
    while (performance.now() < end) {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 30));
        st.advance(performance.now());
      }
      const now = count();
      if (now === last && !now.startsWith("0/")) break;
      last = now;
      await new Promise((r) => setTimeout(r, 1500));
    }
    st.setFrameloop("always");
  });
}

const VIEWS = [null, ...ROOMS];
const nameOf = (view) => view ?? "overview";
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

async function measure(page, view) {
  await page.evaluate((v) => window.__ceo.focus(v), view);
  await page.waitForTimeout(5000);

  // React commits over three seconds of the normal loop.
  const c0 = await page.evaluate(() => window.__perf.commits);
  await page.waitForTimeout(3000);
  const commits = (await page.evaluate(() => window.__perf.commits)) - c0;

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  // Step frames by hand, timing each, with the counters on.
  await page.evaluate(() => {
    const st = window.__ceo.three();
    st.setFrameloop("never");
    if (window.__perfCount) return;
    const c = (window.__perfCount = { renders: 0, matrixUpdates: 0 });
    const scene = st.scene;
    const umw = scene.updateMatrixWorld;
    scene.updateMatrixWorld = function (force) {
      c.matrixUpdates++;
      return umw.call(this, force);
    };
    const gl = st.gl;
    const render = gl.render;
    gl.render = function (s, cam) {
      if (s === scene) c.renders++;
      return render.call(this, s, cam);
    };
  });
  await page.evaluate(() => {
    const st = window.__ceo.three();
    for (let i = 0; i < 3; i++) st.advance(performance.now());
  });
  await cdp.send("HeapProfiler.startSampling", { samplingInterval: 1024 });
  const step = await page.evaluate(async (frames) => {
    const st = window.__ceo.three();
    const c = window.__perfCount;
    c.renders = 0;
    c.matrixUpdates = 0;
    const times = [];
    for (let i = 0; i < frames; i++) {
      await new Promise((r) => setTimeout(r, 30));
      const t0 = performance.now();
      st.advance(performance.now());
      times.push(performance.now() - t0);
    }
    const info = window.__ceo.renderInfo();
    const still = window.__ceo.still?.() ?? null;
    st.setFrameloop("always");
    return { still, times, renders: c.renders / frames, matrixUpdates: c.matrixUpdates / frames, info, hooks: st.internal.subscribers.length };
  }, FRAMES);
  const { profile } = await cdp.send("HeapProfiler.stopSampling");
  let bytes = 0;
  const walk = (n) => {
    bytes += n.selfSize;
    n.children.forEach(walk);
  };
  walk(profile.head);
  await cdp.detach();

  const sorted = [...step.times].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    view: nameOf(view),
    calls: step.info.calls,
    triangles: step.info.triangles,
    programs: step.info.programs,
    textures: step.info.textures,
    geometries: step.info.geometries,
    frameMsMedian: round(q(0.5)),
    frameMsP25: round(q(0.25)),
    sceneRenders: round(step.renders),
    matrixUpdates: round(step.matrixUpdates),
    allocKBPerFrame: round(bytes / 1024 / FRAMES),
    commitsPerSec: round(commits / 3),
    frameHooks: step.hooks,
    // Still furniture (#136): meshes merged, and the pieces they make.
    merged: step.still ? `${step.still.merged} in ${step.still.pieces}` : "-",
  };
}

async function shoot(page, view) {
  await page.evaluate((v) => window.__ceo.focus(v), view);
  await page.waitForTimeout(6000);
  // Stop the overview's slow drift and put the camera on its framing, so before and after shots line up.
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerdown")));
  if (view === null) await page.evaluate(() => window.__ceo.three().controls?.setLookAt?.(0, 66, 96, 0, -2, 4, false));
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(SHOTS, `perf-${TAG}-${nameOf(view)}.png`) });
}

async function main() {
  await waitForServer();

  const timing = await chromium.launch({ executablePath: EXE, args: NULL_GL });
  const page = await openLattice(timing);
  const results = [];
  for (const view of VIEWS) results.push(await measure(page, view));
  await timing.close();

  if (flag("json")) console.log(JSON.stringify(results, null, 2));
  else console.table(results);

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    const drawing = await chromium.launch({ executablePath: EXE, args: SWIFTSHADER });
    const shotPage = await openLattice(drawing);
    for (const view of VIEWS) await shoot(shotPage, view);
    await drawing.close();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(stopServer);
