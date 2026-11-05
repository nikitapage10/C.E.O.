import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";

/**
 * Boiler Room > Controls (#647) on the built site, with the APIs stubbed in the browser: signed out the meters show
 * states only (no money), and signed in the house's Google connections (Connect Nest, Connect Google Tasks) are there
 * on their own, with no home device set up, and so is King Soopers' setup (#664). The figures here are made up.
 */

const PORT = Number(process.env.E2E_CONTROLS_PORT ?? 5191);
const BASE = `http://localhost:${PORT}`;
let server: Server;

test.beforeAll(async () => {
  const dist = fileURLToPath(new URL("../../apps/world/dist/index.html", import.meta.url));
  if (!existsSync(dist)) execSync("npm run build", { cwd: fileURLToPath(new URL("../..", import.meta.url)), stdio: "ignore" });
  server = await startDistServer(PORT);
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

async function stub(page: Page, signedIn: boolean) {
  const now = Date.now();
  const month = new Date(now).toISOString().slice(0, 7);
  const posts: Record<string, unknown>[] = [];
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: [] }));
  await page.route(`${BASE}/api/foundry-feed`, (r) => r.fulfill({ json: { issues: [], runs: { workflow_runs: [] }, e2e: { workflow_runs: [] }, pulls: [], commits: [] } }));
  await page.route(`${BASE}/api/desk-auth`, (r) => r.fulfill({ json: signedIn ? { ready: true, signedIn: true, until: now + 30 * 60_000, hardUntil: now + 8 * 3_600_000, device: "Test device", devices: [] } : { ready: true, signedIn: false } }));
  await page.route(`${BASE}/api/keys`, (r) => r.fulfill({ json: { vault: "ok", stepUpSeconds: 120, keys: [] } }));
  await page.route(`${BASE}/api/world`, (r) =>
    r.fulfill({
      json: {
        ok: true, at: null, step: 0, nextAt: null, relationships: [], recent: [], days: [], remarks: [],
        spend: { month, budget: 6, usd: 4.5, calls: 10, scripted: 0, tokensIn: 1, tokensOut: 1 },
        claude: true,
        story: { month, usd: 0, calls: 0, stories: 1, tokensIn: 0, tokensOut: 0, scriptUsd: 0.5, eleven: true, elevenBudget: 10, elevenUsd: 9.5 },
      },
    }),
  );
  await page.route(`${BASE}/api/haven/google`, async (r) => {
    if (!signedIn) return r.fulfill({ status: 401, json: { error: "signed-out" } });
    if (r.request().method() === "POST") {
      posts.push(r.request().postDataJSON() as Record<string, unknown>);
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({ json: { google: true, nest: { project: true, connected: false, refused: false }, tasks: { connected: false, refused: false, list: "Shopping", lastRun: null, lastResult: null, lastImported: 0 } } });
  });
  return posts;
}

test("signed out, the meters say states only: no money anywhere", async ({ page }) => {
  await stub(page, false);
  await page.goto(`${BASE}/boiler/controls`);
  const meters = page.locator("#ct-meters");
  await expect(meters.getByText("Near its cap").first()).toBeVisible();
  await expect(meters).not.toContainText("$");
  await expect(page.getByRole("button", { name: "Connect Nest" })).toHaveCount(0);
});

test("signed in, Connect Nest and Connect Google Tasks are on Controls without any home device", async ({ page }) => {
  const posts = await stub(page, true);
  await page.goto(`${BASE}/boiler/controls`);
  await expect(page.locator("#ct-meters")).toContainText("$5.00");
  // The circuits are charts first (#746): Connections opens to the house's setup.
  await page.locator("#ct-links .bx-fold").click();
  const house = page.locator("#ct-house");
  await expect(house.getByRole("button", { name: "Connect Nest" })).toBeVisible();
  await expect(house.getByRole("button", { name: "Connect Google Tasks" })).toBeVisible();
  await house.getByRole("button", { name: "Connect Nest" }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ action: "connect", grant: "nest" });
});

test("signed in, King Soopers is set up on Controls: ZIP, store picker, Connect King Soopers (#664)", async ({ page }) => {
  await stub(page, true);
  const posts: Record<string, unknown>[] = [];
  const base = { ready: true, state: "waiting", connected: false, refused: false, zip: "", found: [] as unknown[], store: null as unknown, lines: [], total: 0, count: 0, sent: null };
  let view = { ...base };
  await page.route(/\/api\/haven\/kroger(\?.*)?$/, (r) => {
    if (r.request().method() !== "POST") return r.fulfill({ json: view });
    const body = r.request().postDataJSON() as Record<string, unknown>;
    posts.push(body);
    if (body.action === "set-zip") view = { ...view, zip: String(body.zip) };
    if (body.action === "find-stores") view = { ...view, found: [{ id: "62000001", name: "King Soopers - Test Town", line: "1 Test Ave", city: "Testville", state: "CO", zip: "12345" }] };
    if (body.action === "pick-store") view = { ...view, store: view.found[0] };
    if (body.action === "connect") return r.fulfill({ json: { ok: true, url: "https://api.kroger.com/v1/connect/oauth2/authorize?scope=cart.basic%3Awrite&state=x" } });
    return r.fulfill({ json: { ok: true, ...view } });
  });
  await page.route("https://api.kroger.com/**", (r) => r.fulfill({ body: "kroger sign-in (stubbed)" }));
  await page.goto(`${BASE}/boiler/controls`);
  // The circuits are charts first (#746): Connections opens to the house's setup.
  await page.locator("#ct-links .bx-fold").click();
  const house = page.locator("#ct-house");
  await house.getByRole("textbox", { name: "ZIP to find King Soopers stores near" }).fill("12345");
  await house.getByRole("button", { name: "Find stores" }).click();
  await house.getByRole("button", { name: "Use this" }).click();
  await expect(house.getByRole("button", { name: "Home store" })).toBeVisible();
  await expect(house.getByText("Home store: King Soopers - Test Town", { exact: false })).toBeVisible();
  await house.getByRole("button", { name: "Connect King Soopers" }).click();
  await expect(page).toHaveURL("https://api.kroger.com/v1/connect/oauth2/authorize?scope=cart.basic%3Awrite&state=x");
  expect(posts).toEqual([{ action: "set-zip", zip: "12345" }, { action: "find-stores" }, { action: "pick-store", id: "62000001" }, { action: "connect" }]);
});
