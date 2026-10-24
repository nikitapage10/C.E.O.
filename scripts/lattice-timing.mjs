/* global process, console */
/**
 * How long "Enter the Lattice" takes (#327): loads the BUILT site's /lattice in Chromium and prints the boot timeline
 * from window.__ceo.boot() (apps/world/src/boot.ts) and what the page downloaded.
 *
 *   lattice  its code ran (the lazy chunk and three.js are in)
 *   scene    the scene on screen has its models and its shaders compiled
 *   curtain  the loading screen starts to lift: the first frame of the world you see
 *   models   nothing left loading (every room, agent and pet streamed in): fully interactive
 *
 * Run it after `npm run build`: `node scripts/lattice-timing.mjs [port] [--runs=3] [--net=fast4g|20mbps|none] [--cpu=4]
 * [--path=/lattice?room=foundry]
 * [--gl=swiftshader|null] [--limit=240]`. Set PLAYWRIGHT_CHROMIUM_PATH to use a preinstalled Chromium. It renders on
 * SwiftShader (no GPU here), so shader compile and frame times run far slower than on a real machine; compare runs on
 * the same machine, not against a phone or a desktop GPU.
 */
import { chromium } from "@playwright/test";
import { startDistServer } from "../tests/e2e/dist-server.ts";

const args = process.argv.slice(2);
const opt = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const PORT = Number(args.find((a) => !a.startsWith("--"))) || 5190;
const RUNS = Number(opt("runs", "1"));
const PATH = opt("path", "/lattice");
const CPU = Number(opt("cpu", "1"));
const NETS = {
  none: null,
  // Chrome DevTools' presets, in bytes per second.
  fast4g: { latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 },
  "20mbps": { latency: 30, downloadThroughput: (20 * 1024 * 1024) / 8, uploadThroughput: (5 * 1024 * 1024) / 8 },
};
const NET = NETS[opt("net", "none")];
const LIMIT_MS = Number(opt("limit", "240")) * 1000;
// swiftshader draws for real on the CPU (shader compiles and frames are very slow); null runs everything the browser
// and three.js do but draws nothing, so it times the page's own work (perf-lattice.mjs does the same).
const GL = opt("gl", "swiftshader") === "null" ? ["--use-gl=angle", "--use-angle=null", "--ignore-gpu-blocklist"] : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

const server = await startDistServer(PORT);
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  args: GL,
});

async function run() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  if (NET) await cdp.send("Network.emulateNetworkConditions", { offline: false, ...NET });
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  let bytes = 0;
  let requests = 0;
  let lastModel;
  let t0 = Date.now();
  const kinds = {};
  const urls = new Map();
  cdp.on("Network.responseReceived", (e) => urls.set(e.requestId, e.response.url));
  cdp.on("Network.loadingFinished", (e) => {
    bytes += e.encodedDataLength;
    requests += 1;
    const url = urls.get(e.requestId) ?? "";
    const kind = /\.glb/.test(url) ? "glb" : /\.js(\?|$)/.test(url) ? "js" : /\.(png|webp|jpg|ktx2)/.test(url) ? "img" : "other";
    kinds[kind] = (kinds[kind] ?? 0) + e.encodedDataLength;
    if (kind === "glb") lastModel = Date.now() - t0;
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  t0 = Date.now();
  await page.goto(`http://localhost:${PORT}${PATH}`, { waitUntil: "commit" });
  await page.waitForFunction(() => globalThis.__ceo?.boot?.().models !== undefined, undefined, { timeout: LIMIT_MS, polling: 200 }).catch(() => errors.push("timed out waiting for every model"));
  const marks = await page.evaluate(() => globalThis.__ceo?.boot?.() ?? {});
  const wall = Date.now() - t0;
  await page.close();
  return { marks, wall, bytes, requests, kinds, errors, lastModel };
}

const s = (ms) => (ms === undefined ? "  -  " : `${(ms / 1000).toFixed(1)} s`);
const mb = (b) => `${(b / 1e6).toFixed(1)} MB`;
const results = [];
for (let i = 0; i < RUNS; i++) {
  const r = await run();
  results.push(r);
  const m = r.marks;
  console.log(
    `run ${i + 1}: lattice ${s(m.lattice)} · scene ${s(m.scene)} · curtain ${s(m.curtain)} · models ${s(m.models)} · ` +
      `last model in ${s(r.lastModel)} · ${r.requests} requests, ${mb(r.bytes)} (glb ${mb(r.kinds.glb ?? 0)}, js ${mb(r.kinds.js ?? 0)})` +
      (r.errors.length ? ` · errors: ${r.errors.join(" | ")}` : ""),
  );
}
if (RUNS > 1) {
  const med = (k) => {
    const v = results.map((r) => r.marks[k]).filter((x) => x !== undefined).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  console.log(`median: lattice ${s(med("lattice"))} · scene ${s(med("scene"))} · curtain ${s(med("curtain"))} · models ${s(med("models"))}`);
}
await browser.close();
server?.close();
