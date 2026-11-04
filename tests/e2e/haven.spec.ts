import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";
import { FAKE_PLAN } from "../../api/_haven/plan.fixture.ts";
import { DEFAULT_GYM_PLAN } from "../../api/_haven/gymShape.ts";

/**
 * The Haven (#616) on the built site, with its endpoints stubbed in the browser. Signed out it shows counts and states
 * and no map; signed in with no plan it waits for one; signed in with a plan it draws the house and opens a room over
 * it. The plan here is the made-up fixture (api/_haven/plan.fixture.ts), never Nikita's home, and the readings are
 * made up for the run, as is the Gym's log (#660). E2E_SHOTS=<dir> also saves pictures of the fixture house.
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
    // The Petlibro day (#685): made-up numbers and plans, not anyone's real schedule.
    { id: "a00000000002", vendor: "petlibro", kind: "dry-feeder", model: "Test feeder", place: "", online: true, state: "ok", alerts: [], foodLow: true, lastFed: ago(20), manualToday: 0, manualCap: 2, fedPortions: 3, feeds: 1, feedUnit: "cup", plan: [{ time: "06:30", portions: 3, on: true, status: "done" }, { time: "13:00", portions: 1, on: false }, { time: "19:30", portions: 3, on: true, status: "next" }] },
    { id: "a00000000005", vendor: "petlibro", kind: "wet-feeder", model: "Test wet feeder", place: "", online: true, state: "closed", alerts: [], foodLow: false, lastFed: null, manualToday: 0, manualCap: 2, plate: 2, visits: 4, visitSec: 151, meals: [{ time: "07:15", end: "09:15", plate: 1, status: "done" }, { time: "11:45", end: "13:45", plate: 2, status: "now" }, { time: "18:30", end: "20:30", plate: 3, status: "next" }] },
    { id: "a00000000003", vendor: "petlibro", kind: "fountain", model: "Test fountain", place: "", online: true, state: "flowing", alerts: ["filter due"], water: 58, filter: 0, filterDays: -3, cleanDays: 5, drankMl: 210, visits: 9, avgSec: 17 },
    { id: "a00000000004", vendor: "whisker", kind: "litter", model: "Test litter box", place: "", online: true, state: "ready", alerts: [], drawer: 30, litter: 80, lastUse: ago(95) },
  ];
}

/** The Gym's view (#660): the shipped default plan, with a made-up log: day A done yesterday, and eight made-up weeks. */
function gymView(now: number, extra: Array<{ id: string; session: string; at: string; via: string }> = []) {
  const done = [{ id: "g-test-a", session: "a", at: new Date(now - 26 * 3_600_000).toISOString(), via: "phone" }, ...extra];
  return { plan: DEFAULT_GYM_PLAN, isDefault: true, week: { start: new Date(now - 3 * 86_400_000).toISOString(), done }, weeks: [1, 2, 2, 0, 1, 2, 2, done.length] };
}

async function stub(page: Page, opts: { signedIn: boolean; plan: unknown }) {
  const now = Date.now();
  const gymLog: Array<{ id: string; session: string; at: string; via: string }> = [];
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: [] }));
  await page.route(`${BASE}/api/foundry-feed`, (r) => r.fulfill({ json: { issues: [], runs: { workflow_runs: [] }, e2e: { workflow_runs: [] }, pulls: [], commits: [] } }));
  await page.route(`${BASE}/api/desk-auth`, (r) => r.fulfill({ json: opts.signedIn ? { ready: true, signedIn: true, until: now + 30 * 60_000, hardUntil: now + 8 * 3_600_000, device: "Test device", devices: [] } : { ready: true, signedIn: false } }));
  await page.route(/\/api\/haven(\?.*)?$/, (r) => {
    const view = new URL(r.request().url()).searchParams.get("view");
    if (view === "status") return r.fulfill({ json: { kitchen: { open: 3, done: 1 }, todos: 2, gym: { perWeek: 2, doneThisWeek: 1 + gymLog.length }, ready: true } });
    if (!opts.signedIn) return r.fulfill({ status: 401, json: { error: "signed-out" } });
    if (view === "gym") return r.fulfill({ json: gymView(now, gymLog) });
    const body = r.request().method() === "POST" ? (r.request().postDataJSON() as { action?: string; session?: string; id?: string }) : {};
    if (body.action === "gym-log") {
      const entry = { id: `g-test-${gymLog.length + 1}`, session: body.session ?? "b", at: new Date().toISOString(), via: "desk" };
      gymLog.push(entry);
      return r.fulfill({ json: { ok: true, entry, view: gymView(now, gymLog) } });
    }
    if (body.action === "gym-unlog") {
      gymLog.splice(gymLog.findIndex((e) => e.id === body.id), 1);
      return r.fulfill({ json: { ok: true, view: gymView(now, gymLog) } });
    }
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
    await expect(sheet.getByText(/^Dry food is low/)).toBeVisible();
    // The Petlibro day (#685): the fountain's overdue filter in ember, the wet bowls, the dry schedule's next meal.
    await expect(sheet.getByText("3 days overdue")).toBeVisible();
    await expect(sheet.getByText("Today's bowls")).toBeVisible();
    await expect(sheet.getByText("Feeding now")).toBeVisible();
    await expect(sheet.getByText("next 7:30 PM")).toBeVisible();
    await page.waitForTimeout(600);
    await shoot(page, `room-${label}`);
    await sheet.getByText("Today's bowls").scrollIntoViewIfNeeded();
    await shoot(page, `pets-day-${label}`);

    await sheet.getByRole("button", { name: "Kitchen" }).click();
    await expect(page.getByRole("dialog", { name: "Kitchen" }).getByText("Lemons")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

test("signed out: the Gym is a count, never an exercise (#660)", async ({ page }) => {
  await stub(page, { signedIn: false, plan: null });
  await page.goto(`${BASE}/haven`);
  const util = page.getByRole("complementary", { name: "House-wide" });
  await expect(util.getByText("Gym", { exact: true })).toBeVisible();
  await expect(util.getByText("1 of 2", { exact: true })).toBeVisible();
  await expect(util.getByText("this week", { exact: true })).toBeVisible();
  await expect(page.getByText(/dead bugs|pallof|plank/i)).toHaveCount(0);
});

for (const [label, size] of [
  ["desktop", { width: 1440, height: 900 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test(`signed in: the Gym's plan, laid out in time, logs a session by tap (${label}, #660)`, async ({ page }) => {
    await page.setViewportSize(size);
    await stub(page, { signedIn: true, plan: FAKE_PLAN });
    await page.goto(`${BASE}/haven`);
    await page.getByRole("navigation", { name: "Haven rooms" }).getByRole("button", { name: "Gym" }).click();
    const sheet = page.getByRole("dialog", { name: "Gym" });
    await expect(sheet.getByText("2 sessions a week", { exact: false })).toBeVisible();
    // The week: day A is done (from the phone), day B is still to do.
    const week = sheet.getByRole("list", { name: "This week" });
    await expect(week.getByRole("button", { name: /Core day A, Tuesday, done/ })).toBeVisible();
    await week.getByRole("button", { name: /Core day A/ }).click();
    await expect(sheet.getByText(/Done \w{3} .* · from the phone/)).toBeVisible();
    await expect(sheet.getByRole("list", { name: "Core day A, in order" }).getByRole("listitem")).toHaveCount(4);
    await expect(sheet.getByText("3 × 10 / side").first()).toBeVisible();
    await expect(sheet.getByText("3 × 30 s / side")).toBeVisible();
    await page.waitForTimeout(800);
    await shoot(page, `gym-${label}`);

    await week.getByRole("button", { name: /Core day B/ }).click();
    await expect(sheet.getByText("3 × 45 s")).toBeVisible();
    await sheet.getByRole("button", { name: "Log day B" }).click();
    await expect(sheet.getByRole("status").filter({ hasText: "Done" })).toBeVisible();
    await expect(week.getByRole("button", { name: /Core day B, Friday, done/ })).toBeVisible();
    await expect(sheet.getByText("The week is done.")).toBeVisible();
    await shoot(page, `gym-logged-${label}`);
    await sheet.getByRole("button", { name: "Undo" }).click();
    await expect(sheet.getByRole("button", { name: "Log day B" })).toBeVisible();

    // Adjust turns the doses into steppers.
    await sheet.getByRole("button", { name: "Adjust" }).click();
    await expect(sheet.getByRole("group", { name: "Front plank seconds" })).toBeVisible();
    await sheet.getByRole("button", { name: "More: Front plank seconds" }).click();
    await expect(sheet.getByRole("group", { name: "Front plank seconds" })).toContainText("50");
    await shoot(page, `gym-adjust-${label}`);
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet.getByText("3 × 45 s")).toBeVisible();
  });
}

test("signed in: the plinth's Climate dial opens the control and turns the set point (#680)", async ({ page }) => {
  await stub(page, { signedIn: true, plan: FAKE_PLAN });
  const now = Date.now();
  const thermo = { id: "a00000000009", vendor: "nest", kind: "thermostat", model: "Test thermostat", place: "", online: true, state: "heating", alerts: [], tempF: 68, humidity: 41, mode: "heat", modes: ["heat", "cool", "heatcool", "off"], eco: false, hvac: "heating", heatF: 70, coolF: null };
  const vendors = { ...VENDORS, petlibro: "down", nest: "live" };
  const sent: Record<string, unknown>[] = [];
  await page.route(/\/api\/haven\/devices(\?.*)?$/, (r) => {
    const all = [...devices(now), thermo];
    if (new URL(r.request().url()).searchParams.get("view") === "status") return r.fulfill({ json: { vendors, devices: all.map((d) => ({ kind: d.kind, state: d.state, online: d.online })) } });
    return r.fulfill({ json: { vendors, devices: all, feedCap: 2, roborockConnected: true } });
  });
  await page.route(/\/api\/haven\/devices\/action$/, (r) => {
    sent.push(r.request().postDataJSON() as Record<string, unknown>);
    return r.fulfill({ json: { ok: true, say: "Set." } });
  });
  await page.goto(`${BASE}/haven`);
  const strip = page.getByRole("complementary", { name: "House-wide" });
  // A down device lights its lamp ember.
  await expect(strip.locator('[data-gauge="petlibro"]')).toHaveAttribute("data-tone", "down");
  await expect(strip.locator('[data-gauge="petlibro"]').getByText("Down", { exact: true })).toBeVisible();
  const dial = strip.getByRole("button", { name: /^Climate: 68°/ });
  await expect(dial).toBeVisible();
  await dial.click();
  await expect(page.getByRole("dialog", { name: "Climate" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Climate" })).toHaveCount(0);
  // The arrow keys turn it a degree at a time, and it sends once, through the control's own action.
  await dial.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(dial).toHaveAccessibleName(/set to 72°F/);
  await expect.poll(() => sent.length, { timeout: 5000 }).toBe(1);
  expect(sent[0]).toMatchObject({ action: "thermostat.set", device: "a00000000009", tempF: 72 });
});

test("signed in, ?open=kitchen: King Soopers shows the store, picks, prices and total, and sends exactly the shown picks", async ({ page }) => {
  await stub(page, { signedIn: true, plan: null });
  const posts: Record<string, unknown>[] = [];
  const product = (productId: string, description: string, price: number, promo: number | null = null) => ({ productId, upc: productId, description, brand: "Test", size: "1 ct", price, promo, stock: "high" });
  const view = {
    ready: true,
    state: "live",
    connected: true,
    refused: false,
    zip: "12345",
    found: [],
    store: { id: "62000001", name: "King Soopers - Test Town", line: "1 Test Ave", city: "Testville", state: "CO", zip: "12345" },
    lines: [
      { id: "k0", name: "Lemons", key: "lemon", pick: { product: product("0001111000004", "Organic Lemons", 119), alts: [product("0001111000005", "Meyer Lemons", 199)], chosen: false, skip: false, at: new Date().toISOString() } },
      { id: "k1", name: "Garlic", key: "garlic", pick: { product: product("0001111000006", "Garlic Bulb", 59, 49), alts: [], chosen: false, skip: false, at: new Date().toISOString() } },
      { id: "k2", name: "Oat milk", key: "oat milk", pick: null },
    ],
    total: 168,
    count: 2,
    sent: null,
  };
  await page.route(/\/api\/haven\/kroger(\?.*)?$/, (r) => {
    if (r.request().method() === "POST") {
      const body = r.request().postDataJSON() as Record<string, unknown>;
      posts.push(body);
      return r.fulfill({ json: body.action === "send" ? { ok: true, items: 2, url: "https://www.kingsoopers.com/cart", ...view } : { ok: true, ...view } });
    }
    return r.fulfill({ json: view });
  });
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await page.goto(`${BASE}/haven?open=kitchen`);
  const sheet = page.getByRole("dialog", { name: "Kitchen" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("King Soopers - Test Town · 1 Test Ave, Testville")).toBeVisible();
  await expect(sheet.getByText("Organic Lemons · 1 ct")).toBeVisible();
  await expect(sheet.locator(".hv-gTotal")).toContainText("$1.68");
  await expect(sheet.getByRole("button", { name: "Match 1 item at this store" })).toBeVisible();
  await expect(page).toHaveURL(`${BASE}/haven`);
  if (SHOTS) await sheet.screenshot({ path: `${SHOTS}/haven-664-groceries.png` });
  await sheet.getByRole("button", { name: "Send 2 to King Soopers" }).click();
  await expect(sheet.getByText("Added 2 to your King Soopers cart.", { exact: false })).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Open the cart" })).toHaveAttribute("href", "https://www.kingsoopers.com/cart");
  expect(posts).toEqual([
    {
      action: "send",
      picks: [
        { key: "lemon", productId: "0001111000004" },
        { key: "garlic", productId: "0001111000006" },
      ],
    },
  ]);
});

test("signed in, the Kitchen removes an item with ×, with five seconds to Undo (#673)", async ({ page }) => {
  await stub(page, { signedIn: true, plan: null });
  const posts: Record<string, unknown>[] = [];
  await page.route(/\/api\/haven(\?.*)?$/, (r) => {
    if (r.request().method() === "POST") {
      posts.push(r.request().postDataJSON() as Record<string, unknown>);
      return r.fulfill({ json: { ok: true } });
    }
    const view = new URL(r.request().url()).searchParams.get("view");
    if (view === "status") return r.fulfill({ json: { kitchen: { open: 2, done: 0 }, todos: 0, ready: true } });
    const items = ["Lemons", "Garlic"].map((name, i) => ({ id: `k${i}`, name, addedAt: new Date().toISOString(), source: "phone", done: false }));
    // After an Undo the list is read again: Garlic is back.
    return r.fulfill({ json: { items } });
  });
  await page.goto(`${BASE}/haven?open=kitchen`);
  const sheet = page.getByRole("dialog", { name: "Kitchen" });
  const list = sheet.getByRole("list", { name: "Kitchen list" });
  await expect(list.getByRole("checkbox")).toHaveCount(2);
  await list.getByRole("button", { name: "Remove Garlic" }).click();
  await expect(list.getByRole("checkbox")).toHaveCount(1);
  await expect(sheet.getByText("2 things on the list.")).toHaveCount(0);
  await sheet.getByRole("button", { name: "Undo" }).click();
  await expect(list.getByRole("checkbox")).toHaveCount(2);
  expect(posts).toEqual([
    { action: "remove", id: "k1" },
    { action: "undo-remove", id: "k1" },
  ]);
});
