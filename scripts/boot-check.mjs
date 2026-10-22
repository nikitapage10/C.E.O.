/**
 * The boot check (#175): open the BUILT site in a browser and fail if a page throws or stays blank.
 *
 * Why: PR #172 made the vendor chunk throw "t is not a function" at load. Typecheck, lint, unit tests and the build
 * were all green, but every page stayed on the boot screen for hours (#173). None of those open the built site.
 *
 * What it does, against apps/world/dist (run `npm run build` first), served the way Vercel serves it
 * (tests/e2e/dist-server.ts reads vercel.json, so the CSP applies too):
 *   1. `/`        the Desk renders its Today page: no page error, no console error from the app, the boot screen gone.
 *   2. `/foundry` a lazily loaded Desk tab renders its own page.
 *   3. `/lattice` the scene boots: its lazy chunk runs, a WebGL canvas and the HUD mount and window.__ceo is there,
 *                 and nothing throws in the few seconds after. It does not wait for every model (the cast's >= 14
 *                 positions take 100 s+ on SwiftShader; the nightly browser tests cover that, tests/e2e/lattice.spec.ts).
 * The Desk's weight (#195): on `/` it also adds up the JavaScript the page downloads from its own site before Today renders
 * (uncompressed bytes) and fails when that passes DESK_JS_BUDGET below. The live watch only reports the number.
 * Takes about 20 s on SwiftShader. Exits 0 when all pass, 1 otherwise (and prints what each page threw).
 *
 * Run it: `node scripts/boot-check.mjs [port]`. Set PLAYWRIGHT_CHROMIUM_PATH to use a preinstalled Chromium.
 * Wired into the required `checks` job (.github/workflows/checks.yml), after the build.
 *
 * The live watch (#181): `node scripts/boot-check.mjs --url=https://…` runs the same three pages against a deployed
 * site instead of the local build (no build or server needed), hourly from .github/workflows/live-watch.yml.
 *
 * The site lock (#236, #238): when the live site is locked, SITE_BYPASS_TOKEN (the same value as in Vercel) is sent in
 * the x-ceo-site-bypass header on the site's own requests only (never to another host), and never printed. Without
 * it, a locked site is checked only for answering with its login page, and the run passes with a notice.
 */
import { chromium } from "@playwright/test";
import { startDistServer } from "../tests/e2e/dist-server.ts";

const args = process.argv.slice(2);
const live = args.find((a) => a.startsWith("--url="))?.slice("--url=".length).replace(/\/+$/, "");
if (live !== undefined && !/^https:\/\/[^/]+$/.test(live)) {
  console.error("boot-check: --url takes a site's https address, like --url=https://example.com");
  process.exit(2);
}
const PORT = Number(args.find((a) => !a.startsWith("--"))) || 5184;
const BOOT_MS = 60_000; // the Lattice on SwiftShader mounts in about 15 s
const PAGE_MS = 20_000;
// The most JavaScript the Desk may download on first load of `/` (uncompressed bytes of the entry and everything it pulls in
// before Today renders). Oct 19, 2026 (#195): measured 415.0 kB, plus about 15% headroom. Raise it on purpose, in a PR
// that says why, with BOOT_CHECK_DESK_JS_BUDGET=<bytes> for a one-off run or by editing this number.
// Oct 22, 2026 (#225, the Weave Desk): raised to 1 MB. Nikita: up to about 1 MB is fine for a fresher Desk design
// (a good connection, mostly local). Measured 477 kB at the time; the Lattice stays lazy either way.
const DESK_JS_BUDGET = Number(process.env.BOOT_CHECK_DESK_JS_BUDGET) || 1_000_000;

const server = live ? null : await startDistServer(PORT);
const base = live ?? `http://localhost:${PORT}`;
const BYPASS = live ? process.env.SITE_BYPASS_TOKEN?.trim() || "" : "";

if (live) {
  // Locked by the site lock (#236, #238)? Ask once, as the watch will (with the bypass when it has one).
  const res = await fetch(`${base}/`, { headers: BYPASS ? { "x-ceo-site-bypass": BYPASS } : {}, redirect: "manual", signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (res && res.headers.get("x-ceo-site-gate") === "locked") {
    // The login page: the passkey's script from /api/site-login (#238; the #236 page had a form posting there).
    const login = res.status === 401 && /"\/api\/site-login[?"]/.test(await res.text());
    if (!BYPASS && login) {
      console.log("boot-check: the live site is locked and SITE_BYPASS_TOKEN isn't set; checked only that its login page answers.");
      process.exit(0);
    }
    console.error(BYPASS ? "boot-check: FAIL the live site refused SITE_BYPASS_TOKEN (is it the same value as in Vercel?)" : "boot-check: FAIL the live site is locked and its login page didn't answer");
    process.exit(1);
  }
}
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

const failures = [];
const fail = (where, what) => {
  failures.push(`${where}: ${what}`);
  console.error(`boot-check: FAIL ${where}: ${what}`);
};

/** One page with its errors collected. Only the app's own failures count: a 404 for /api/* is expected (no functions here). */
async function visit(path, check, timeout, measureJs = false) {
  const t0 = Date.now();
  // With a bypass, no service worker: its page loads wouldn't pass through the route that adds the header.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ...(BYPASS && { serviceWorkers: "block" }) });
  if (BYPASS) {
    const origin = new URL(base).origin;
    await page.route(
      (url) => url.origin === origin,
      (route) => route.continue({ headers: { ...route.request().headers(), "x-ceo-site-bypass": BYPASS } }),
    );
  }
  const errors = [];
  let thrown;
  const threw = new Promise((_, reject) => (thrown = reject)); // a page that throws won't get better: stop waiting
  threw.catch(() => {});
  // A fetch to an outside service (GitHub's API for usage) that can't be reached is the network, not the bundle.
  page.on("pageerror", (e) => !/^(Failed to fetch|NetworkError|Load failed)/.test(e.message) && (errors.push(`pageerror: ${e.message}`), thrown(new Error("the page threw"))));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`console.error: ${m.text()}`));
  // First load = scripts fetched before the load event; the Desk's idle tab prefetch comes after and is left out.
  const scripts = [];
  let loaded = false;
  if (measureJs) page.on("response", (r) => !loaded && new URL(r.url()).origin === new URL(base).origin && (r.request().resourceType() === "script" || /\.js$/.test(new URL(r.url()).pathname)) && scripts.push(r));
  let jsBytes;
  try {
    await page.goto(base + path, { waitUntil: "load" });
    loaded = true;
    await Promise.race([check(page, timeout), threw]);
    if (measureJs) jsBytes = (await Promise.all(scripts.map((r) => r.body().then((b) => b.length, () => 0)))).reduce((a, b) => a + b, 0);
    if (errors.length === 0) console.log(`boot-check: ok ${path} (${Math.round((Date.now() - t0) / 100) / 10} s)`);
  } catch (e) {
    fail(path, `did not render (${String(e.message).split("\n")[0]})`);
  }
  for (const e of errors) fail(path, e);
  await page.close();
  return jsBytes;
}

/** The Desk's first-load JavaScript against its budget. Live: report only, the deployed number is not ours to fail on. */
function checkDeskJs(bytes) {
  if (bytes === undefined) return; // the page did not render; that is already a failure
  const kB = (n) => `${(n / 1000).toFixed(1)} kB`;
  console.log(`boot-check: Desk JS on first load ${kB(bytes)} (budget ${kB(DESK_JS_BUDGET)}, uncompressed)`);
  if (!live && bytes > DESK_JS_BUDGET) {
    fail("/", `the Desk downloads ${kB(bytes)} of JavaScript on first load, over its budget of ${kB(DESK_JS_BUDGET)}. Trim what the entry pulls in (lazy-load it), or raise DESK_JS_BUDGET in scripts/boot-check.mjs on purpose and say why in the PR`);
  }
}

/** The Desk shell is up: the static boot screen ("C.E.O." in .boot) is replaced by the React app. */
const deskUp = async (page, timeout, text) => {
  await page.waitForSelector(".desk__tabs", { timeout });
  await page.waitForFunction(
    (t) => !globalThis.document.querySelector(".boot") && globalThis.document.getElementById("root")?.innerText.toLowerCase().includes(t.toLowerCase()),
    text,
    { timeout },
  );
};

try {
  checkDeskJs(await visit("/", (page, timeout) => deskUp(page, timeout, "TODAY"), PAGE_MS, true));
  await visit("/foundry", (page, timeout) => deskUp(page, timeout, "FOUNDRY"), PAGE_MS);
  await visit(
    "/lattice",
    (page, timeout) =>
      page
        .waitForFunction(() => globalThis.__ceo && globalThis.document.querySelector("canvas") && globalThis.document.querySelector(".mark__name"), undefined, { timeout, polling: 250 })
        .then(() => page.waitForTimeout(3000)), // a late throw (a model, a shader) lands in the page errors
    BOOT_MS,
  );
} finally {
  await browser.close();
  server?.close();
}

if (failures.length > 0) {
  console.error(`boot-check: ${failures.length} problem(s). The ${live ? "live" : "built"} site does not boot; see docs/FOUNDRY.md ("The checks").`);
  process.exit(1);
}
console.log(`boot-check: the ${live ? "live" : "built"} Desk and Lattice boot.`);
