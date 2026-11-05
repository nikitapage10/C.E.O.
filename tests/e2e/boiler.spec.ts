import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";

/**
 * The Boiler Room's Map (#732, the B4 pipes) on the built site, signed out, with the feeds stubbed in the browser: a
 * Petlibro that stopped answering cracks its spur, a skipped nightly backup shuts its valve, an overdue world clock
 * runs late, and the fault panel walks them worst first with one Fix each; with every feed healthy it says everything
 * is holding. The states here are made up. E2E_SHOTS saves a desktop and a phone screenshot of the faulted map.
 */

const PORT = Number(process.env.E2E_BOILER_PORT ?? 5195);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.E2E_SHOTS ?? "";
let server: Server;

test.beforeAll(async () => {
  const dist = fileURLToPath(new URL("../../apps/world/dist/index.html", import.meta.url));
  if (!existsSync(dist)) execSync("npm run build", { cwd: fileURLToPath(new URL("../..", import.meta.url)), stdio: "ignore" });
  server = await startDistServer(PORT);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

const run = (at: number, conclusion: string) => ({ name: "x", status: "completed", conclusion, created_at: new Date(at).toISOString(), run_started_at: null, html_url: "https://github.com/nikitapage10/C.E.O./actions/runs/1" });

/** The nightly backup's last slot (10:41 UTC), plus three minutes: on time. */
function backupAt(now: number): number {
  const d = new Date(now);
  let slot = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 10, 41);
  if (slot + 3 * 60_000 > now) slot -= 86_400_000;
  return slot + 3 * 60_000;
}

async function stub(page: Page, broken: boolean) {
  const now = Date.now();
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {
      /* none */
    }
  });
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: [] }));
  await page.route(`${BASE}/api/desk-auth`, (r) => r.fulfill({ json: { ready: true, signedIn: false } }));
  await page.route(`${BASE}/api/foundry-feed`, (r) =>
    r.fulfill({
      json: {
        issues: [],
        runs: { workflow_runs: [] },
        e2e: { workflow_runs: [] },
        pulls: [],
        commits: [],
        jobs: [{ file: "backup-azure.yml", run: run(backupAt(now), broken ? "skipped" : "success") }, { file: "deploy-azure.yml", run: run(now - 3_600_000, "success") }],
      },
    }),
  );
  await page.route(`${BASE}/api/haven/devices**`, (r) =>
    r.fulfill({ json: { vendors: { roborock: "live", petlibro: broken ? "down" : "live", whisker: "live", nest: "live" }, links: { tasks: "live", kroger: "waiting" }, devices: [] } }),
  );
  await page.route(`${BASE}/api/world-step`, (r) => r.fulfill({ json: { at: new Date(now - (broken ? 95 : 10) * 60_000).toISOString(), step: 412, nextAt: null, store: "blob", claude: true } }));
  await page.route(`${BASE}/api/visual-qa-feed`, (r) =>
    r.fulfill({ json: { at: new Date(now).toISOString(), latest: { at: new Date(now - 3_600_000).toISOString(), url: "https://github.com/nikitapage10/C.E.O./actions/runs/2", run: "pass", review: "reviewed", rooms: 12, findings: 0, blockers: 0 } } }),
  );
  await page.route(`${BASE}/api/security-feed`, (r) =>
    r.fulfill({
      json: {
        at: new Date(now).toISOString(),
        workflows: ["Checks", "CodeQL", "Scorecard"].map((name, i) => ({ id: ["checks", "codeql", "scorecard"][i], name, scope: "main", state: "pass", conclusion: "success", at: null, url: null })),
        features: [],
        alerts: { codeScanning: { open: 0, fixed: 3, more: false }, dependabot: { open: 0, fixed: 1, more: false } },
        scorecard: null,
      },
    }),
  );
}

test("the faults are in the pipes: a leak, a shut valve and a late clock, worst first, one Fix each", async ({ page }) => {
  await stub(page, true);
  await page.goto(`${BASE}/boiler`);
  const board = page.locator(".bp");
  await expect(board.locator(".bp-h")).toContainText("2 faults, 1 late in the pipes");
  const panel = board.locator(".bp-panel");
  await expect(panel.locator(".bp-title")).toHaveText("Petlibro is down.");
  // Petlibro has no connect flow: the panel shows the steps instead of a button.
  await expect(panel.locator(".bp-fix")).toHaveCount(0);
  await expect(panel.locator("ol li").first()).toBeVisible();
  await expect(panel.locator(".bp-queue button")).toHaveCount(3);
  await panel.locator(".bp-queue button", { hasText: "nightly backup" }).click();
  await expect(panel.locator(".bp-title")).toHaveText("The nightly backup was skipped.");
  await expect(panel.locator(".bp-fix")).toHaveText("Open the nightly backup's run");
  await panel.locator(".bp-queue button", { hasText: "world clock" }).click();
  await expect(panel.locator(".bp-fix")).toHaveText("Read the clock again");
  // Every room is its own section: picking one focuses it.
  const rooms = board.locator(".bp-rooms button");
  await expect(rooms.first()).toHaveText("All rooms");
  await expect(rooms).toHaveCount(8);
  await rooms.filter({ hasText: "Boiler Room" }).click();
  await expect(rooms.filter({ hasText: "Boiler Room" })).toHaveAttribute("aria-pressed", "true");
  // The panel opens the fault's card: what it is, its state, when it last worked, what it needs, its fix.
  await panel.locator(".bp-more").click();
  const card = board.locator(".bp-card");
  await expect(card.locator("h3")).toHaveText("World clock");
  await expect(card).toContainText("Running late");
  await expect(card).toContainText("Needs you");
  await expect(card.locator(".bp-fix")).toHaveText("Read the clock again");
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  // Hovering a station's gauge opens its card.
  await rooms.first().click();
  await expect(board.locator(".bp-map.is-on")).toBeVisible();
  await page.waitForTimeout(1500);
  const lb = board.locator('.bp-lb.is-st.is-show', { hasText: "Petlibro" });
  const b = (await lb.boundingBox())!;
  for (const dy of [10, 16, 22, 28]) {
    await page.mouse.move(b.x + b.width / 2, b.y + b.height + dy);
    if (await card.count()) break;
    await page.waitForTimeout(200);
  }
  await expect(card.locator("h3")).toHaveText("Petlibro");
  await page.mouse.move(5, 5);
  // The tabs carry the other three pages.
  await expect(board.locator(".bp-tabs a")).toHaveText([/^Map/, /^Controls/, /^Security/, /^Compliance/]);
  // Signed out, nothing private: no money, no addresses.
  await expect(board).not.toContainText("$");
  await expect(board).not.toContainText("@");

  if (SHOTS) {
    // The whole map, then one room in focus with a station's card open.
    await rooms.first().click();
    await page.waitForTimeout(3500);
    await board.screenshot({ path: `${SHOTS}/boiler-pipes-desktop.png` });
    await panel.locator(".bp-queue button").first().click();
    await panel.locator(".bp-more").click();
    await page.waitForTimeout(3500);
    await board.screenshot({ path: `${SHOTS}/boiler-pipes-desktop-room.png` });
  }
});

test("with every feed healthy, everything is holding", async ({ page }) => {
  await stub(page, false);
  await page.goto(`${BASE}/boiler`);
  await expect(page.locator(".bp .bp-h")).toContainText("everything is holding");
  await expect(page.locator(".bp .bp-title")).toHaveText("Everything is holding.");
});

test("on a phone the map sits above the panel", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await stub(page, true);
  await page.goto(`${BASE}/boiler`);
  const map = page.locator(".bp-map");
  const panel = page.locator(".bp-panel");
  await expect(panel.locator(".bp-title")).toHaveText("Petlibro is down.");
  const [m, p] = [await map.boundingBox(), await panel.boundingBox()];
  expect(m && p && m.y + m.height <= p.y + 1).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // A tap on a room focuses it; the panel opens the fault's card, rising from the foot of the map.
  await page.locator(".bp-rooms button", { hasText: "Boiler Room" }).tap();
  await panel.locator(".bp-more").tap();
  await expect(page.locator(".bp-card h3")).toHaveText("Petlibro");
  if (SHOTS) {
    await expect(page.locator(".bp-map.is-on")).toBeVisible();
    await page.waitForTimeout(3500);
    // The Desk scrolls inside its own frame, so the shot goes back to the top and grows the screen to the board's foot.
    await page.evaluate(() => document.querySelectorAll("*").forEach((e) => e.scrollTop && (e.scrollTop = 0)));
    const box = await page.locator(".bp").boundingBox();
    const h = Math.ceil((box?.y ?? 0) + (box?.height ?? 844));
    await page.setViewportSize({ width: 390, height: h });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/boiler-pipes-phone.png`, clip: { x: 0, y: 0, width: 390, height: h } });
  }
  await ctx.close();
});
