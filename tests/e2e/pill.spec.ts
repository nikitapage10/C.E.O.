import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";

/**
 * Ask Skippy keeps clear (#706): the floating pill (#638) sits bottom right on every Desk page, and twice it has sat on
 * a control (the Haven's gauge strip, #693; Today's later bar, #702). This opens every Desk tab, the Boiler Room's
 * subpages too, signed out on the built site with the APIs stubbed as the other specs do, at phone (390) and desktop
 * (1440) widths, and fails naming any visible button, link or field the pill sits on. It looks twice:
 * - scrolled all the way down, on every page: whatever is last on a page has nowhere to go from under the pill;
 * - at rest, as the page opens, on pages about a screen tall (they scroll less than a screen more), since those are
 *   laid out to be seen at rest, as Today is (#702). On a longer page, content flows under the pill and out again as
 *   it scrolls past the fold, as under any floating button, so there only the scrolled-down look counts. Anything held
 *   in place (fixed or sticky) counts at rest on every page.
 * Overlaps of a couple of pixels (shadows, rounding) are let through.
 */

const PORT = Number(process.env.E2E_PILL_PORT ?? 5193);
const BASE = `http://localhost:${PORT}`;
/** Overlap, in CSS pixels along each side, that still counts as clear. */
const TOLERANCE = 2;
let server: Server;

test.beforeAll(async () => {
  const dist = fileURLToPath(new URL("../../apps/world/dist/index.html", import.meta.url));
  if (!existsSync(dist)) execSync("npm run build", { cwd: fileURLToPath(new URL("../..", import.meta.url)), stdio: "ignore" });
  server = await startDistServer(PORT);
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

/** The Desk's tabs, in the bar's order (NAV_ORDER in apps/world/src/route.ts), and the Boiler Room's subpages. */
const PAGES = ["/", "/haven", "/foundry", "/relay", "/green", "/exchange", "/archive", "/annex", "/spire", "/workshop", "/studio", "/boiler", "/boiler/controls", "/boiler/security", "/boiler/compliance"];

const FEED = { issues: [], runs: { workflow_runs: [] }, e2e: { workflow_runs: [] }, pulls: [], commits: [] };

/** Signed out, as a visitor sees it; anything not stubbed here answers 404 from the dist server, as it does offline. */
async function stub(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.SpeechRecognition;
    delete w.webkitSpeechRecognition;
  });
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: [] }));
  await page.route(`${BASE}/api/foundry-feed`, (r) => r.fulfill({ json: FEED }));
  await page.route(`${BASE}/api/foundry`, (r) => r.fulfill({ json: { buttons: true, direct: true, shape: true, images: false } }));
  await page.route(`${BASE}/api/desk-auth`, (r) => r.fulfill({ json: { ready: true, signedIn: false } }));
}

type Hit = { what: string; box: string };
type Mode = "rest" | "end";

/**
 * Every visible control the pill sits on, by what's drawn of it rather than its padding: its text, its icons and
 * pictures, and the whole box of a field (#703 kept the later bar's icons clear by padding the bar, which still runs
 * under the pill). Each part is clipped to the viewport and to any ancestor that clips it, and counts when it overlaps
 * the pill by more than the tolerance on both axes. At rest, a control on a page (or in a scroller) that scrolls a
 * screen or more doesn't count, nor does a part the bottom of the screen cuts through: it's below the fold either way,
 * and a scroll brings it up. Runs in the page.
 */
function overlapsInPage({ tolerance, mode }: { tolerance: number; mode: Mode }): Hit[] {
  const pill = document.querySelector<HTMLElement>(".vdock__ask");
  if (!pill) throw new Error("no Ask Skippy pill on the page");
  const p = pill.getBoundingClientRect();
  const sel =
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="switch"], [role="textbox"], [contenteditable="true"]';
  const field = 'input, select, textarea, [role="textbox"], [contenteditable="true"]';
  const hits: Hit[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(sel)) {
    if (el.closest(".vdock")) continue;
    if (el.closest('[aria-hidden="true"], [inert]')) continue;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    // What's drawn of it: a field's whole box; otherwise its text runs and its icons and pictures (or, with neither,
    // its box).
    const parts: DOMRect[] = [];
    if (el.matches(field)) parts.push(el.getBoundingClientRect());
    else {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.textContent?.trim() || !n.parentElement?.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        parts.push(...range.getClientRects());
      }
      for (const g of el.querySelectorAll<HTMLElement>("svg, img, canvas, video, picture"))
        if (g.checkVisibility({ opacityProperty: true, visibilityProperty: true })) parts.push(g.getBoundingClientRect());
      if (!parts.length) parts.push(el.getBoundingClientRect());
    }
    // The clip: the viewport, and every ancestor that hides its overflow, up to the first fixed one. On the way, what
    // scrolls it: the first scroller above it (or the page), unless something fixed or sticky holds it first.
    let [cl, ct, cr, cb] = [0, 0, window.innerWidth, window.innerHeight];
    let pinned = ["fixed", "sticky"].includes(getComputedStyle(el).position);
    let scroller: Element | null = null;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (!pinned && !scroller && (s.overflowY === "auto" || s.overflowY === "scroll") && a.scrollHeight > a.clientHeight + 1) scroller = a;
      if (!scroller && (s.position === "fixed" || s.position === "sticky")) pinned = true;
      if (s.overflowX !== "visible" || s.overflowY !== "visible") {
        const c = a.getBoundingClientRect();
        [cl, ct, cr, cb] = [Math.max(cl, c.left), Math.max(ct, c.top), Math.min(cr, c.right), Math.min(cb, c.bottom)];
      }
      if (s.position === "fixed") break;
    }
    if (mode === "rest" && !pinned) {
      const sc = scroller ?? document.scrollingElement ?? document.documentElement;
      const view = scroller ? sc.clientHeight : window.innerHeight;
      if (sc.scrollHeight - view >= view) continue;
    }
    let worst = { w: 0, h: 0 };
    for (const r of parts) {
      if (r.width <= 0 || r.height <= 0) continue;
      if (mode === "rest" && r.top < window.innerHeight && r.bottom > window.innerHeight) continue;
      const w = Math.min(r.right, cr, p.right) - Math.max(r.left, cl, p.left);
      const h = Math.min(r.bottom, cb, p.bottom) - Math.max(r.top, ct, p.top);
      if (w > tolerance && h > tolerance && w * h > worst.w * worst.h) worst = { w, h };
    }
    if (!worst.w) continue;
    const name = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || (el as HTMLInputElement).placeholder || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 50);
    const cls = typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).join(".") : "";
    hits.push({ what: `<${el.tagName.toLowerCase()}${cls}> "${name}"`, box: `${Math.round(worst.w)}x${Math.round(worst.h)}px under the pill` });
  }
  return hits;
}

/** Every control's box, rounded: equal twice in a row means the layout has settled. */
function layoutInPage(): string {
  const parts: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(".vdock__ask, a[href], button, input, select, textarea")) {
    const r = el.getBoundingClientRect();
    parts.push(`${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`);
  }
  return `${document.documentElement.scrollHeight}|${parts.join(";")}`;
}

/** Scrolls the page, and every inner scroller, all the way down. */
function scrollAllDownInPage() {
  window.scrollTo(0, document.documentElement.scrollHeight);
  for (const el of document.querySelectorAll<HTMLElement>("*")) {
    if (el.closest(".vdock")) continue;
    const s = getComputedStyle(el);
    if ((s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1) el.scrollTop = el.scrollHeight;
  }
}

/** Waits out every animation and transition that ends (entrance motion, a bar rising into place); not the loops. */
function animationsDoneInPage(): Promise<unknown> {
  const finite = document.getAnimations().filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime)));
  return Promise.race([Promise.all(finite.map((a) => a.finished.catch(() => null))), new Promise((done) => setTimeout(done, 8_000))]);
}

/** Settled: no animation left to finish, and every control's box the same twice in a row, 500 ms apart. */
async function settle(page: Page) {
  let last = "";
  for (let i = 0; i < 20; i++) {
    await page.evaluate(animationsDoneInPage);
    await page.waitForTimeout(500);
    const now = await page.evaluate(layoutInPage);
    if (now === last) return;
    last = now;
  }
  throw new Error("the page never settled");
}

for (const [label, width, height] of [
  ["phone", 390, 844],
  ["desktop", 1440, 900],
] as const) {
  for (const path of PAGES) {
    test(`Ask Skippy covers no control on ${path} (${label}, ${width} wide)`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await stub(page);
      await page.goto(BASE + path);
      await expect(page.locator(".vdock__ask")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await settle(page);
      const atTop = await page.evaluate(overlapsInPage, { tolerance: TOLERANCE, mode: "rest" as Mode });

      await page.evaluate(scrollAllDownInPage);
      await settle(page);
      await page.evaluate(scrollAllDownInPage);
      await settle(page);
      const atBottom = await page.evaluate(overlapsInPage, { tolerance: TOLERANCE, mode: "end" as Mode });

      const found = [...atTop.map((h) => `top: ${h.what}, ${h.box}`), ...atBottom.map((h) => `scrolled down: ${h.what}, ${h.box}`)];
      expect(found, `Ask Skippy sits on these on ${path} at ${width} wide`).toEqual([]);
    });
  }
}
