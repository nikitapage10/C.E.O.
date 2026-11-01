import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";

/**
 * Undo on the Desk's Changelog (#170, docs/FOUNDRY.md "Undo"): the built site, with the Foundry feed, the buttons and
 * a signed-in session stubbed in the browser. A shipped change gets an Undo button that takes two taps and sends
 * `choice: "undo"` for that issue; one already being undone shows "Undo requested" instead.
 */

const PORT = Number(process.env.E2E_UNDO_PORT ?? 5183);
const BASE = `http://localhost:${PORT}`;
/** Where to save the screenshots, when set (the Foundry's Pictures step). */
const SHOTS = process.env.E2E_SHOTS ?? "";
let server: Server;

test.beforeAll(async () => {
  const dist = fileURLToPath(new URL("../../apps/world/dist/index.html", import.meta.url));
  if (!existsSync(dist)) execSync("npm run build", { cwd: fileURLToPath(new URL("../..", import.meta.url)), stdio: "ignore" });
  server = await startDistServer(PORT);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const issue = (number: number, title: string, labels: string[], state: "open" | "closed", at: string, body = "") => ({
  number,
  title,
  state,
  html_url: `https://github.com/nikitapage10/C.E.O./issues/${number}`,
  created_at: hoursAgo(30),
  updated_at: at,
  closed_at: state === "closed" ? at : null,
  body,
  labels: labels.map((name) => ({ name })),
});

const FEED = {
  issues: [
    issue(41, "Idea: Podium in the Spire", ["foundry", "foundry:build", "foundry:auto", "foundry:shipped"], "closed", hoursAgo(1), "**Pitch:** A podium.\n**Size:** small\n**Short:** Adding a podium\n**Builder:** Rusty (Sonnet)"),
    issue(42, "Idea: Brighter idea cards", ["foundry", "foundry:build", "foundry:shipped", "foundry:fix", "foundry:undo"], "open", hoursAgo(2), "**Pitch:** Brighter.\n**Size:** small\n**Builder:** Rocky (Opus)"),
    issue(43, "Tidy the lint ignores", ["foundry", "foundry:upkeep", "foundry:shipped"], "closed", hoursAgo(3), "**Builder:** Rusty (Haiku)"),
  ],
  runs: { workflow_runs: [] },
  e2e: { workflow_runs: [] },
  pulls: [{ number: 50, title: "Idea: Podium in the Spire", html_url: "https://github.com/nikitapage10/C.E.O./pull/50", merged_at: hoursAgo(1), body: "Closes #41", head: { ref: "foundry/build/41-podium" } }],
  commits: [],
};

/** The feed, the Foundry buttons and a signed-in Desk, stubbed; the clicks the Desk sends are kept. */
async function stub(page: Page): Promise<Record<string, unknown>[]> {
  const sent: Record<string, unknown>[] = [];
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: [] }));
  await page.route(`${BASE}/api/foundry-feed`, (r) => r.fulfill({ json: FEED }));
  await page.route(`${BASE}/api/desk-auth`, (r) => r.fulfill({ json: { ready: true, signedIn: true, until: Date.now() + 30 * 60_000, hardUntil: Date.now() + 8 * 3_600_000, device: "Test device", devices: [] } }));
  await page.route(`${BASE}/api/foundry`, async (r) => {
    if (r.request().method() === "POST") {
      sent.push(r.request().postDataJSON() as Record<string, unknown>);
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({ json: { buttons: true, direct: true, shape: false, images: false } });
  });
  return sent;
}

test("a shipped change on the Changelog can be undone in two taps", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const sent = await stub(page);

  await page.goto(BASE + "/");
  await expect(page.locator(".today .desk__title")).toBeVisible();
  await page.goto(BASE + "/foundry");
  const log = page.locator(".fy-changelog");
  const podium = log.locator(".cl-entry", { hasText: "Podium in the Spire" });
  await expect(podium.getByRole("button", { name: "Undo" })).toBeVisible();
  // Already being undone: marked, no button.
  const asked = log.locator(".cl-entry", { hasText: "Brighter idea cards" });
  await expect(asked.locator(".cl-undo")).toHaveText("Undo requested");
  await expect(asked.getByRole("button", { name: "Undo" })).toHaveCount(0);
  if (SHOTS) {
    await log.scrollIntoViewIfNeeded();
    await log.screenshot({ path: `${SHOTS}/changelog-undo-wide.png` });
  }

  // One tap asks; "Keep it" backs out without sending anything.
  await podium.getByRole("button", { name: "Undo" }).click();
  await expect(podium.getByRole("button", { name: "Yes, undo it" })).toBeVisible();
  if (SHOTS) await log.screenshot({ path: `${SHOTS}/changelog-undo-confirm.png` });
  await podium.getByRole("button", { name: "Keep it" }).click();
  expect(sent).toEqual([]);

  await podium.getByRole("button", { name: "Undo" }).click();
  await podium.getByRole("button", { name: "Yes, undo it" }).click();
  await expect(podium.locator(".cl-undo")).toHaveText("Undo requested");
  expect(sent).toEqual([{ issue: 41, choice: "undo", note: "" }]);
  expect(errors).toEqual([]);
});

test("the Undo button stays off when the Desk's buttons aren't set up", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await stub(page);
  await page.route(`${BASE}/api/foundry`, (r) => r.fulfill({ json: { buttons: false } }));
  await page.goto(BASE + "/foundry");
  const log = page.locator(".fy-changelog");
  await expect(log.locator(".cl-entry", { hasText: "Podium in the Spire" })).toBeVisible();
  await expect(log.getByRole("button", { name: "Undo" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the Undo shows at phone width without breaking the entry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page);
  await page.goto(BASE + "/foundry");
  const log = page.locator(".fy-changelog");
  await expect(log.locator(".cl-entry", { hasText: "Podium in the Spire" }).getByRole("button", { name: "Undo" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (SHOTS) {
    await log.scrollIntoViewIfNeeded();
    await log.screenshot({ path: `${SHOTS}/changelog-undo-phone.png` });
  }
});

test("the Archive lists what shipped, week by week, newest first", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await stub(page);
  const day = 24;
  // Each opened `took` hours before it closed.
  const shipped = (n: number, title: string, hours: number, extra = "", took = 3) => ({
    ...issue(n, title, ["foundry", "foundry:build", "foundry:shipped"], "closed", hoursAgo(hours), `**Pitch:** x.\n**Size:** small\n**Short:** ${extra}\n**Builder:** Rusty (Sonnet)`),
    created_at: hoursAgo(hours + took),
  });
  await page.route(`${BASE}/api/foundry-feed`, (r) =>
    r.fulfill({
      json: {
        ...FEED,
        issues: [
          shipped(61, "Idea: Podium in the Spire", 2, "Adding a podium"),
          shipped(62, "Idea: Brighter idea cards", 5 * day, "Brightening idea cards"),
          shipped(63, "Idea: Quieter Boiler Room", 12 * day, "Quieting the Boiler Room", 2 * day),
          shipped(64, "Idea: Faster Lattice", 19 * day, "Speeding up the Lattice", 0.7),
        ],
        pulls: [],
      },
    }),
  );
  await page.goto(BASE + "/archive");
  const ships = page.locator(".ax-ships");
  await expect(ships.locator("li", { hasText: "Podium in the Spire" })).toBeVisible();
  await expect(ships.locator("li", { hasText: "Podium in the Spire" })).toContainText("Adding a podium");
  await expect(ships.locator("li", { hasText: "Podium in the Spire" })).toContainText("Built by Rusty");
  await expect(ships.locator("li", { hasText: "Podium in the Spire" })).toContainText("in 3 h");
  await expect(ships.locator(".ax-ship-week h3").first()).toContainText("median 3 h");
  // Newest two weeks stand open; older ones fold away behind a button.
  await expect(ships.locator(".ax-ship-week")).toHaveCount(2);
  await ships.getByRole("button", { name: /earlier week/ }).click();
  await expect(ships.locator(".ax-ship-week").nth(2)).toBeVisible();
  if (SHOTS) {
    await ships.scrollIntoViewIfNeeded();
    await ships.screenshot({ path: `${SHOTS}/archive-week-by-week.png` });
  }
  expect(errors).toEqual([]);
});
