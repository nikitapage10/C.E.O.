import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";
import { FAKE_PLAN } from "../../api/_haven/plan.fixture.ts";

/**
 * The Desk on a phone (#1045) on the built site: its own frame, not the desktop bar made small. A slim fixed bar at the
 * top with the room's name, the main rooms in a fixed bar at the bottom, every room and the room's tabs in a sheet,
 * and a finger dragged on either bar moves nothing. The desktop bar is never drawn there. The Haven puts its controls
 * first with the house behind them, still to the touch, until Explore the house. The plan is the made-up fixture.
 */

const PORT = Number(process.env.E2E_PHONE_PORT ?? 5193);
const BASE = `http://localhost:${PORT}`;
let server: Server;

test.beforeAll(async () => {
  const dist = fileURLToPath(new URL("../../apps/world/dist/index.html", import.meta.url));
  if (!existsSync(dist)) execSync("npm run build", { cwd: fileURLToPath(new URL("../..", import.meta.url)), stdio: "ignore" });
  server = await startDistServer(PORT);
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

test.use({ viewport: { width: 393, height: 659 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });

test("the phone frame: fixed bars, the Rooms sheet with the room's tabs, and bars that never move under a finger", async ({ page }) => {
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: [] }));
  await page.goto(`${BASE}/boiler/controls`);
  const bar = page.getByRole("navigation", { name: "Desk" });
  await expect(bar).toBeVisible();
  // No desktop bar, no sideways row of words.
  await expect(page.locator(".wv-tabs")).toHaveCount(0);
  await expect(bar.getByRole("link")).toHaveText(["Senate", "Haven", "Relay"]);
  // The room on screen takes the last slot; the top bar names it and its tab.
  await expect(bar.getByRole("button", { name: "Boiler Room" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".ph-title")).toContainText("Boiler Room");
  await expect(page.locator(".ph-title")).toContainText("Controls");
  const box = await bar.boundingBox();
  expect(box!.y + box!.height).toBeCloseTo(659, 0);
  for (const el of await page.locator(".ph-bar .ph-slot, .ph-top a, .ph-top button").all()) {
    const b = await el.boundingBox();
    if (b) expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
  }

  // A drag on the bottom bar or the top bar scrolls nothing; one on the page does.
  const scroll = () => page.evaluate(() => document.querySelector(".desk")!.scrollTop);
  const cdp = await page.context().newCDPSession(page);
  const drag = async (x: number, y0: number, y1: number) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / 8 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(500);
  };
  await drag(200, 630, 250);
  await drag(200, 26, 420);
  expect(await scroll()).toBe(0);
  await drag(200, 520, 150);
  expect(await scroll()).toBeGreaterThan(0);
  expect((await bar.boundingBox())!.y).toBe(box!.y);

  // The sheet: the room's tabs first, then every room; a tap goes there and shuts it, at the new page's top.
  await page.locator(".ph-title").tap();
  const sheet = page.getByRole("dialog", { name: "Rooms" });
  await expect(sheet.getByRole("navigation", { name: "Boiler Room tabs" }).getByRole("link", { name: /^Controls/ })).toHaveAttribute("aria-current", "page");
  await expect(sheet.getByRole("navigation", { name: "Every room" }).getByRole("link")).toHaveCount(12);
  await sheet.getByRole("navigation", { name: "Every room" }).getByRole("link", { name: /^Studio/ }).tap();
  await expect(page).toHaveURL(`${BASE}/studio`);
  await expect(sheet).toHaveCount(0);
  expect(await scroll()).toBe(0);
  await expect(bar.getByRole("button", { name: "Studio" })).toHaveAttribute("aria-current", "page");

  // Escape and the scrim shut it too.
  await bar.getByRole("button", { name: "Studio" }).tap();
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  // So does a swipe down from its top (#1049); a short one springs back.
  await bar.getByRole("button", { name: "Studio" }).tap();
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(1000);
  const top = (await sheet.boundingBox())!.y;
  await drag(200, top + 20, top + 50);
  await expect(sheet).toBeVisible();
  expect((await sheet.boundingBox())!.y).toBeCloseTo(top, 0);
  await drag(200, top + 20, 640);
  await expect(sheet).toHaveCount(0);

  // Skippy is the middle slot.
  await bar.getByRole("button", { name: "Skippy" }).tap();
  await expect(page.getByRole("dialog", { name: "Skippy, the Magnificent" })).toBeVisible();
});

test("the Haven on a phone: controls first, the house behind them and still to the touch until Explore the house", async ({ page }) => {
  const now = Date.now();
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: [] }));
  await page.route(`${BASE}/api/desk-auth`, (r) => r.fulfill({ json: { ready: true, signedIn: true, until: now + 30 * 60_000, hardUntil: now + 8 * 3_600_000, device: "Test device", devices: [] } }));
  await page.route(/\/api\/haven(\?.*)?$/, (r) => r.fulfill({ json: new URL(r.request().url()).searchParams.get("view") === "status" ? { kitchen: { open: 0, done: 0 }, todos: 0, ready: true } : { items: [] } }));
  await page.route(/\/api\/haven\/devices(\?.*)?$/, (r) => r.fulfill({ json: { vendors: { roborock: "waiting", petlibro: "waiting", whisker: "waiting" }, devices: [] } }));
  await page.route(`${BASE}/api/haven-plan`, (r) => r.fulfill({ json: { plan: FAKE_PLAN } }));
  await page.goto(`${BASE}/haven`);
  const house = page.locator(".hv-house");
  await expect(house).not.toHaveAttribute("data-gl", "idle", { timeout: 20_000 });
  test.skip((await house.getAttribute("data-gl")) !== "on", "no WebGL here");
  // The gauges in rows, nothing scrolling sideways; the house behind, taking no touch.
  const strip = page.getByRole("complementary", { name: "House-wide" });
  await expect(strip).toBeVisible();
  expect(await strip.locator(".hv-plate").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(house.locator("canvas.hv-gl")).toHaveCSS("pointer-events", "none");
  await page.getByRole("button", { name: "Explore the house" }).tap();
  await expect(house.locator("canvas.hv-gl")).toHaveCSS("pointer-events", "auto");
  await expect(strip).toBeHidden();
  // A finger on the house lands on the house itself, not on an overlay drawn over it (#1051).
  const box = (await house.locator("canvas.hv-gl").boundingBox())!;
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.classList.contains("hv-gl") ?? false, [box.x + box.width / 2, box.y + box.height / 2] as const)).toBe(true);
  await page.getByRole("button", { name: "Back to the controls" }).tap();
  await expect(strip).toBeVisible();
  await expect(house.locator("canvas.hv-gl")).toHaveCSS("pointer-events", "none");
});

test("every tap target in the rooms is at least 44px on a phone, by its box or its hit area", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: [] }));
  for (const path of ["/", "/relay", "/archive", "/annex", "/spire", "/workshop", "/foundry", "/boiler", "/boiler/controls", "/boiler/security", "/boiler/compliance"]) {
    await page.goto(`${BASE}${path}`);
    await page.waitForTimeout(1500);
    // A target under 44px passes when a finger 21px either side of its centre still lands on it (a padded hit area
    // round a smaller face), or on a neighbouring target drawn over it. A trust boundary's line on the map is drawn,
    // not boxed, and is left out.
    const small = await page.evaluate(() => {
      const TAP = "a, button, summary, input, select, [role=button], [role=tab]";
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(`.desk__main :is(${TAP})`)) {
        if (el.closest("svg")) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || Math.min(r.width, r.height) >= 44) continue;
        let off = getComputedStyle(el).visibility === "hidden";
        for (let q: Element | null = el; q && !off; q = q.parentElement) off = getComputedStyle(q).pointerEvents === "none";
        if (off) continue;
        el.scrollIntoView({ block: "center", inline: "center" });
        const b = el.getBoundingClientRect();
        const [cx, cy] = [b.left + b.width / 2, b.top + b.height / 2];
        const ok = [
          [cx, cy - 21],
          [cx, cy + 21],
          [cx - 21, cy],
          [cx + 21, cy],
        ].every(([x, y]) => {
          const hit = document.elementFromPoint(x!, y!);
          return !!hit && (el.contains(hit) || !!hit.closest(TAP));
        });
        if (!ok) out.push(`${el.tagName.toLowerCase()}.${el.className} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}"`);
      }
      return out;
    });
    expect(small, `under 44px on ${path}`).toEqual([]);
  }
});
