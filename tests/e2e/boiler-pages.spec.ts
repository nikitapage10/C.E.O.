import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";

/**
 * The Boiler Room's Controls, Security and Compliance as one screen each (#746, the C3, S3 and P3 concepts) on the
 * built site, signed out, with the feeds stubbed in the browser. With something broken, each page puts it in a "Needs
 * you" column beside its charts; with nothing broken the column isn't there at all and the charts run full width.
 * The figures here are made up. E2E_SHOTS saves a desktop and a phone screenshot of each page.
 */

const PORT = Number(process.env.E2E_PAGES_PORT ?? 5196);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.E2E_SHOTS ?? "";
const DAY = 86_400_000;
let server: Server;

test.beforeAll(async () => {
  const dist = fileURLToPath(new URL("../../apps/world/dist/index.html", import.meta.url));
  if (!existsSync(dist)) execSync("npm run build", { cwd: fileURLToPath(new URL("../..", import.meta.url)), stdio: "ignore" });
  server = await startDistServer(PORT);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

async function stub(page: Page, broken: boolean) {
  const now = Date.now();
  const month = new Date(now).toISOString().slice(0, 7);
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {
      /* none */
    }
  });
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: [] }));
  await page.route(`${BASE}/api/desk-auth`, (r) => r.fulfill({ json: { ready: true, signedIn: false } }));
  await page.route(`${BASE}/api/foundry-feed`, (r) => r.fulfill({ json: { issues: [], runs: { workflow_runs: [] }, e2e: { workflow_runs: [] }, pulls: [], commits: [] } }));
  // Thirty days of the Foundry's trails: Rivet's shaping calls and the crew's Claude Code tokens, a few a day.
  const trails: { issue: number; at: string; body: string }[] = [];
  for (let d = 0; d < 30; d++) {
    for (let k = 0; k < 1 + ((d * 7) % 4); k++) trails.push({ issue: 100 + d, at: new Date(now - d * DAY - k * 3_600_000).toISOString(), body: "**Trail · Shaped:** Used 812 tokens in and 140 out, $0.000151." });
    if (d % 2 === 0) trails.push({ issue: 200 + d, at: new Date(now - d * DAY).toISOString(), body: `**Trail · Shipped:** #${200 + d}\n\nClaude Code: ${120 + ((d * 37) % 300)}k tokens on Sonnet, 40 min` });
  }
  await page.route(`${BASE}/api/foundry-usage`, (r) => r.fulfill({ json: { issues: [], trails } }));
  await page.route(`${BASE}/api/world`, (r) =>
    r.fulfill({
      json: {
        ok: true, at: null, step: 0, nextAt: null, relationships: [], recent: [], days: [], remarks: [],
        spend: { month, budget: 6, usd: 2.1, calls: 10, scripted: 0, tokensIn: 1, tokensOut: 1 },
        claude: true,
        story: { month, usd: 0, calls: 0, stories: 1, tokensIn: 0, tokensOut: 0, scriptUsd: 0.4, eleven: true, elevenBudget: 10, elevenUsd: broken ? 8.6 : 3.1 },
        email: { budgetPct: 42 },
      },
    }),
  );
  await page.route(`${BASE}/api/haven/devices**`, (r) =>
    r.fulfill({ json: { vendors: { roborock: "live", petlibro: broken ? "down" : "live", whisker: "live", nest: "live" }, links: { tasks: "live", kroger: "waiting" }, devices: [] } }),
  );
  const marks = (fails: number[]) => Array.from({ length: 20 }, (_, i) => ({ state: fails.includes(i) ? "fail" : "pass", at: new Date(now - (20 - i) * 6 * 3_600_000).toISOString() }));
  const wf = (id: string, name: string, fails: number[], last: "pass" | "fail") => ({ id, name, scope: id === "dependency-review" ? "pull request" : "main", state: last, conclusion: null, at: new Date(now - 3_600_000).toISOString(), url: "https://github.com/nikitapage10/C.E.O./actions/runs/7", recent: marks(fails) });
  await page.route(`${BASE}/api/security-feed`, (r) =>
    r.fulfill({
      json: {
        at: new Date(now).toISOString(),
        workflows: [
          wf("checks", "Checks", [4, 11], "pass"),
          wf("codeql", "CodeQL", broken ? [19] : [], broken ? "fail" : "pass"),
          wf("scorecard", "Scorecard", [], "pass"),
          wf("dependency-review", "Dependency review", [8], "pass"),
          wf("e2e", "E2E", [2, 3], "pass"),
        ],
        features: [
          { id: "secret-scanning", name: "Secret scanning", state: "on" },
          { id: "push-protection", name: "Push protection", state: "on" },
          { id: "private-reporting", name: "Private vulnerability reporting", state: "on" },
        ],
        alerts: {
          codeScanning: { open: 1, fixed: 6, more: false, severity: { critical: 0, high: 0, medium: 1, low: 0 } },
          dependabot: { open: broken ? 3 : 2, fixed: 9, more: false, severity: { critical: broken ? 1 : 0, high: 0, medium: 1, low: 1 } },
        },
        scorecard: { score: 7.4, date: new Date(now - 2 * DAY).toISOString(), checks: [{ name: "Code-Review", score: 6, short: "Determines if the project requires review before code is merged." }] },
      },
    }),
  );
}

async function noSideScroll(page: Page) {
  // The page as it reads once its loader (#752) has faded: the loader is a fixed cover whose motes gather from outside
  // its mark, so its own boxes overflow while it is up, without ever scrolling the page (rooms/boiler since #842).
  // Each panel's gold corner ticks (#936) sit 3px outside its corners on purpose, inside the body's gutter, so a box
  // may run up to 3px past its edge without the page ever scrolling sideways.
  await expect(page.locator(".room-loader")).toHaveCount(0);
  const wide = await page.evaluate(() => {
    const els = [document.documentElement, ...document.querySelectorAll<HTMLElement>(".desk, .desk *")];
    return els.filter((e) => e.scrollWidth > e.clientWidth + (e === document.documentElement ? 1 : 3) && getComputedStyle(e).overflowX !== "auto" && getComputedStyle(e).overflowX !== "scroll" && getComputedStyle(e).overflowX !== "hidden").map((e) => e.className).slice(0, 3);
  });
  expect(wide).toEqual([]);
}

/** What one screen shows: the page from its top, as Nikita lands on it. */
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.evaluate(() => document.querySelectorAll<HTMLElement>("*").forEach((e) => e.scrollHeight > e.clientHeight && (e.scrollTop = 0)));
  await page.mouse.move(2, 2);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test("Controls: what needs you beside the meters, links and switches as charts", async ({ page }) => {
  await stub(page, true);
  await page.goto(`${BASE}/boiler/controls`);
  const bx = page.locator(".bx");
  await expect(bx).toHaveAttribute("data-needs", "split");
  const needs = bx.locator(".bx-needs");
  await expect(needs.locator(".bx-need")).toHaveCount(2);
  await expect(needs).toContainText("Petlibro is down");
  await expect(needs).toContainText("Sign in on the Desk to fix this one.");
  await expect(needs).toContainText("Voice is near its cap");
  // Spend against each cap, with thirty days of history where the trails have it.
  const meters = bx.locator("#ct-meters");
  await expect(meters.locator(".bx-spark")).toHaveCount(2);
  await expect(meters).toContainText("Near its cap");
  await expect(bx.locator("#ct-links .bx-donut")).toBeVisible();
  await expect(bx.locator("#ct-links .bx-legend")).toContainText("Down 1");
  await expect(bx.locator("#ct-breakers .bx-lamps li")).toHaveCount(6);
  // A need's button opens the circuit it points at.
  await needs.getByRole("button", { name: "See the meter" }).click();
  await expect(meters.locator(".bx-fold")).toHaveAttribute("aria-expanded", "true");
  await expect(meters.locator(".ct-meters")).toBeVisible();
  await meters.locator(".bx-fold").click();
  // Signed out, no money anywhere.
  await expect(bx).not.toContainText("$");
  await shot(page, "controls-desktop");
});

test("Security: the trust map leads, with the scans' trend and the alerts by severity", async ({ page }) => {
  await stub(page, true);
  await page.goto(`${BASE}/boiler/security`);
  const bx = page.locator(".bx");
  await expect(bx).toHaveAttribute("data-needs", "split");
  await expect(bx.locator(".bx-needs .bx-need")).toHaveCount(2);
  await expect(bx.locator(".bx-needs")).toContainText("CodeQL is failing");
  await expect(bx.locator(".bx-needs")).toContainText("critical or high Dependabot alert");
  await expect(bx.locator("#sx-scans .bx-runs")).toHaveCount(5);
  await expect(bx.locator("#sx-scans .bx-runs").first().locator("i.is-fail")).toHaveCount(2);
  await expect(bx.locator("#sx-alerts .bx-sev")).toContainText("critical");
  // Pointing at a boundary says what crosses it.
  await bx.locator(".bx-map .tb", { hasText: "TB5" }).hover();
  await expect(bx.locator(".bx-cap2")).toContainText("TB5 Issues to the builder");
  // Everything the old page had is still a line away.
  await bx.locator("#sx-road .bx-fold").click();
  await expect(bx.locator("#sx-road .bx-checks li").first()).toBeVisible();
  await bx.locator("#sx-road .bx-fold").click();
  await page.mouse.move(5, 5);
  await shot(page, "security-desktop");
});

test("Compliance: coverage rings and a bar per framework, then the gaps", async ({ page }) => {
  await stub(page, false);
  await page.goto(`${BASE}/boiler/compliance`);
  const bx = page.locator(".bx");
  await expect(bx.locator(".bx-cov .bx-panel")).toHaveCount(4);
  await expect(bx.locator(".bx-cov .bx-ring")).toHaveCount(4);
  await expect(bx.locator(".bx-cov .bx-stack")).toHaveCount(4);
  await expect(bx).toContainText("Not fully in place");
  await expect(bx).toContainText("Regulation");
  await bx.locator("#cp-owasp .bx-fold").click();
  await expect(bx.locator("#cp-owasp .bx-checks > li")).toHaveCount(10);
  await bx.locator("#cp-owasp .bx-fold").click();
  await shot(page, "compliance-desktop");
});

test("with nothing that needs you, the column is gone and the charts run full width", async ({ page }) => {
  await stub(page, false);
  for (const p of ["controls", "security"]) {
    await page.goto(`${BASE}/boiler/${p}`);
    const bx = page.locator(".bx");
    await expect(bx).toHaveAttribute("data-needs", "full");
    await expect(bx.locator(".bx-needs")).toHaveCount(0);
    // Full width: the charts fill the body inside its gutters (which grow with the screen since #936).
    const main = (await bx.locator(".bx-main").boundingBox())!;
    const inner = await bx.locator(".bx-body").evaluate((e) => {
      const cs = getComputedStyle(e);
      return e.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    });
    expect(main.width).toBeGreaterThan(inner - 2);
    if (p === "controls") await shot(page, "controls-desktop-clear");
  }
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

  test("each page runs top to bottom, needs first, with no sideways scroll", async ({ page }) => {
    await stub(page, true);
    for (const p of ["controls", "security", "compliance"]) {
      await page.goto(`${BASE}/boiler/${p}`);
      const bx = page.locator(".bx");
      await expect(bx.locator(".bx-main")).toBeVisible();
      if (p !== "compliance") {
        const needs = (await bx.locator(".bx-needs").boundingBox())!;
        const main = (await bx.locator(".bx-main").boundingBox())!;
        expect(needs.y).toBeLessThan(main.y);
      }
      await noSideScroll(page);
      if (SHOTS) {
        await page.evaluate(() => document.querySelectorAll<HTMLElement>("*").forEach((e) => e.scrollHeight > e.clientHeight && (e.scrollTop = 0)));
        const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.querySelector(".bx")?.getBoundingClientRect().bottom ?? 0));
        await page.setViewportSize({ width: 390, height: Math.ceil(h) + 40 });
        await shot(page, `${p}-phone`);
        await page.setViewportSize({ width: 390, height: 844 });
      }
    }
  });
});
