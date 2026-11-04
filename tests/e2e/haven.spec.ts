import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";
import { FAKE_PLAN } from "../../api/_haven/plan.fixture.ts";

/**
 * The Haven (#616) on the built site, with its endpoints stubbed in the browser. Signed out it shows counts and states
 * and no map; signed in with no plan it waits for one; signed in with a plan it draws the house and opens a room over
 * it. The plan here is the made-up fixture (api/_haven/plan.fixture.ts), never Nikita's home, and the readings are
 * made up for the run. E2E_SHOTS=<dir> also saves pictures of the fixture house.
 */

const PORT = Number(process.env.E2E_HAVEN_PORT ?? 5191);
const SHOTS = process.env.E2E_SHOTS ?? "";
const BASE = `http://localhost:${PORT}`;
let server: Server;

test.beforeAll(async () => {
  const dist = fileURLToPath(new URL("../../apps/world/dist/index.html", import.meta.url));
  if (!existsSync(dist)) execSync("npm run build", { cwd: fileURLToPath(new URL("../..", import.meta.url)), stdio: "ignore" });
  server = await startDistServer(PORT);
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

const VENDORS = { roborock: "live", petlibro: "live", whisker: "live" };

function devices(now: number) {
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  return [
    { id: "a00000000001", vendor: "roborock", kind: "vacuum", model: "Test vacuum", place: "", online: true, state: "cleaning", battery: 81, alerts: [], rooms: ["Hall", "Kitchen", "Living room", "Bedroom"] },
    { id: "a00000000002", vendor: "petlibro", kind: "dry-feeder", model: "Test feeder", place: "", online: true, state: "ok", alerts: [], foodLow: true, lastFed: ago(20), manualToday: 0, manualCap: 2 },
    { id: "a00000000003", vendor: "petlibro", kind: "fountain", model: "Test fountain", place: "", online: true, state: "flowing", alerts: [], water: 72, filter: 40 },
    { id: "a00000000004", vendor: "whisker", kind: "litter", model: "Test litter box", place: "", online: true, state: "ready", alerts: [], drawer: 30, litter: 80, lastUse: ago(95) },
  ];
}

async function stub(page: Page, opts: { signedIn: boolean; plan: unknown }) {
  const now = Date.now();
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: [] }));
  await page.route(`${BASE}/api/foundry-feed`, (r) => r.fulfill({ json: { issues: [], runs: { workflow_runs: [] }, e2e: { workflow_runs: [] }, pulls: [], commits: [] } }));
  await page.route(`${BASE}/api/desk-auth`, (r) => r.fulfill({ json: opts.signedIn ? { ready: true, signedIn: true, until: now + 30 * 60_000, hardUntil: now + 8 * 3_600_000, device: "Test device", devices: [] } : { ready: true, signedIn: false } }));
  await page.route(/\/api\/haven(\?.*)?$/, (r) => {
    const view = new URL(r.request().url()).searchParams.get("view");
    if (view === "status") return r.fulfill({ json: { kitchen: { open: 3, done: 1 }, todos: 2, ready: true } });
    if (!opts.signedIn) return r.fulfill({ status: 401, json: { error: "signed-out" } });
    if (view === "list")
      return r.fulfill({
        json: {
          items: ["Lemons", "Garlic", "Oat milk"].map((name, i) => ({ id: `k${i}`, name, addedAt: new Date(now - i * 3_600_000).toISOString(), source: "phone", done: false })),
        },
      });
    return r.fulfill({ json: { ok: true } });
  });
  await page.route(/\/api\/haven\/devices(\?.*)?$/, (r) => {
    const view = new URL(r.request().url()).searchParams.get("view");
    const all = devices(now);
    if (view === "status" || !opts.signedIn) return r.fulfill({ json: { vendors: VENDORS, devices: all.map((d) => ({ kind: d.kind, state: d.state, online: d.online })) } });
    return r.fulfill({ json: { vendors: VENDORS, devices: all, feedCap: 2, roborockConnected: true } });
  });
  await page.route(`${BASE}/api/haven-plan`, (r) => (opts.signedIn ? r.fulfill({ json: { plan: opts.plan } }) : r.fulfill({ status: 401, json: { error: "signed-out" } })));
}

const shoot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/haven-616-${name}.png` });
};

test("signed out: counts and states, no map", async ({ page }) => {
  await stub(page, { signedIn: false, plan: null });
  await page.goto(`${BASE}/haven`);
  await expect(page.getByRole("heading", { name: "The Haven" })).toBeVisible();
  await expect(page.getByText("The house draws only for your passkey.")).toBeVisible();
  const util = page.getByRole("complementary", { name: "House-wide" });
  await expect(util.getByText("Climate", { exact: true })).toBeVisible();
  await expect(util.getByText("Waiting", { exact: true })).toBeVisible();
  await expect(page.locator(".hv-house canvas")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("signed in with no plan: it waits for one and offers the import", async ({ page }) => {
  await stub(page, { signedIn: true, plan: null });
  await page.goto(`${BASE}/haven`);
  await expect(page.getByText("Waiting for your floor plan.")).toBeVisible();
  await expect(page.getByText("Import your floor plan")).toBeVisible();
  await expect(page.locator(".hv-house canvas")).toHaveCount(0);
});

for (const [label, size] of [
  ["desktop", { width: 1440, height: 900 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test(`signed in with the fixture plan (${label}): the house draws, a room opens over it`, async ({ page }) => {
    await page.setViewportSize(size);
    await stub(page, { signedIn: true, plan: FAKE_PLAN });
    await page.goto(`${BASE}/haven`);
    const house = page.locator(".hv-house");
    await expect(house).not.toHaveAttribute("data-gl", "idle", { timeout: 20_000 });
    const gl = await house.getAttribute("data-gl");
    if (gl === "on") await expect(house.locator("canvas")).toHaveCount(1);
    // The lit rooms come from the readings: the vacuum is running in the Hall and the dry food is low by the feeders.
    await expect(page.locator(".hv-sum")).toContainText("food low");
    await page.waitForTimeout(1200);
    await shoot(page, `map-${label}`);

    const util = page.getByRole("complementary", { name: "House-wide" });
    await util.scrollIntoViewIfNeeded();
    await expect(util.getByText("Kitchen list", { exact: true })).toBeVisible();
    await shoot(page, `utilities-${label}`);
    await page.evaluate(() => window.scrollTo(0, 0));

    await page.getByRole("navigation", { name: "Haven rooms" }).getByRole("button", { name: "Pets" }).click();
    const sheet = page.getByRole("dialog", { name: "Pets" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Dry food is low.")).toBeVisible();
    await page.waitForTimeout(600);
    await shoot(page, `room-${label}`);

    await sheet.getByRole("button", { name: "Kitchen" }).click();
    await expect(page.getByRole("dialog", { name: "Kitchen" }).getByText("Lemons")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
