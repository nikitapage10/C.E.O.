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
 * Takes about 20 s on SwiftShader. Exits 0 when all pass, 1 otherwise (and prints what each page threw).
 *
 * Run it: `node scripts/boot-check.mjs [port]`. Set PLAYWRIGHT_CHROMIUM_PATH to use a preinstalled Chromium.
 * Wired into the required `checks` job (.github/workflows/checks.yml), after the build.
 */
import { chromium } from "@playwright/test";
import { startDistServer } from "../tests/e2e/dist-server.ts";

const PORT = Number(process.argv[2]) || 5184;
const BOOT_MS = 60_000; // the Lattice on SwiftShader mounts in about 15 s
const PAGE_MS = 20_000;

const server = await startDistServer(PORT);
const base = `http://localhost:${PORT}`;
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
async function visit(path, check, timeout) {
  const t0 = Date.now();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  let thrown;
  const threw = new Promise((_, reject) => (thrown = reject)); // a page that throws won't get better: stop waiting
  threw.catch(() => {});
  // A fetch to an outside service (GitHub's API for usage) that can't be reached is the network, not the bundle.
  page.on("pageerror", (e) => !/^(Failed to fetch|NetworkError|Load failed)/.test(e.message) && (errors.push(`pageerror: ${e.message}`), thrown(new Error("the page threw"))));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`console.error: ${m.text()}`));
  try {
    await page.goto(base + path, { waitUntil: "load" });
    await Promise.race([check(page, timeout), threw]);
    if (errors.length === 0) console.log(`boot-check: ok ${path} (${Math.round((Date.now() - t0) / 100) / 10} s)`);
  } catch (e) {
    fail(path, `did not render (${String(e.message).split("\n")[0]})`);
  }
  for (const e of errors) fail(path, e);
  await page.close();
}

/** The Desk shell is up: the static boot screen ("C.E.O." in .boot) is replaced by the React app. */
const deskUp = async (page, timeout, text) => {
  await page.waitForSelector(".desk__tabs", { timeout });
  await page.waitForFunction(
    (t) => !globalThis.document.querySelector(".boot") && globalThis.document.getElementById("root")?.innerText.includes(t),
    text,
    { timeout },
  );
};

try {
  await visit("/", (page, timeout) => deskUp(page, timeout, "TODAY"), PAGE_MS);
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
  server.close();
}

if (failures.length > 0) {
  console.error(`boot-check: ${failures.length} problem(s). The built site does not boot; see docs/FOUNDRY.md ("The checks").`);
  process.exit(1);
}
console.log("boot-check: the built Desk and Lattice boot.");
