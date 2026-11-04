import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";
import { FAKE_PLAN } from "../../api/_haven/plan.fixture.ts";
import { DEFAULT_GYM_PLAN } from "../../api/_haven/gymShape.ts";
import { fakeMeals } from "../../api/_haven/meals.fixture.ts";
import { allComponents, applyEdit, readEdit, type MealsFile } from "../../api/_haven/mealShape.ts";

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
    { id: "a00000000001", vendor: "roborock", kind: "vacuum", model: "Test vacuum", place: "", online: true, state: "cleaning", battery: 81, alerts: ["clean water tank empty"], rooms: ["Hall", "Kitchen", "Living room", "Bedroom"] },
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
    if (gl === "on") {
      await expect(house.locator("canvas.hv-gl")).toHaveCount(1);
      // Myshka (#729): his model comes in after the house, lazily.
      await expect(house).toHaveAttribute("data-cat", "on", { timeout: 20_000 });
    }
    // The lit rooms come from the readings: the vacuum is running in the Hall and the dry food is low by the feeders.
    await expect(page.locator(".hv-sum")).toContainText("food low");
    await page.waitForTimeout(1200);
    await shoot(page, `map-${label}`);
    if (SHOTS && label === "desktop" && gl === "on") {
      // Close in on the house, to see Myshka (#729).
      await page.mouse.move(720, 640);
      for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -240);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SHOTS}/haven-729-myshka.png` });
      await page.locator(".hv-reset").click().catch(() => undefined);
    }

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
    const artAsked: { meal: string; style: string }[][] = [];
    await page.route(/\/api\/haven-photos(\?.*)?$/, (r) => {
      if (r.request().method() !== "POST") return r.fulfill({ json: { photos: [] } });
      const meals = (r.request().postDataJSON() as { meals: { meal: string; style: string }[] }).meals;
      artAsked.push(meals);
      return r.fulfill({ json: { photos: meals.map((m) => ({ meal: m.meal, key: "0000000000000000", id: `${m.meal}-00000000`, status: "queued" })), budget: null } });
    });
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
    await expect(sheet.getByText("3 × 30 s / side").first()).toBeVisible();
    // The exercises as cards (#718) with the exercise reference's frames (#729); no generated art is asked for.
    const cards = sheet.getByRole("list", { name: "Core day A: the exercises" });
    await expect(cards.getByRole("listitem")).toHaveCount(4);
    await expect(cards.locator(".gy-frames img").first()).toHaveAttribute("src", "/gym/exercises/dead-bug/0.jpg");
    await cards.getByRole("button", { name: /^Dead bugs/ }).click();
    const how = sheet.getByRole("region", { name: "Dead bugs: how to" });
    await expect(how.getByRole("list", { name: "Muscles worked" })).toContainText(/abdominals/i);
    await expect(how.getByRole("link", { name: /Watch a demo/ })).toHaveAttribute("href", /youtube\.com\/results\?search_query=Dead%20bugs/);
    await expect.poll(() => how.locator(".gy-frames img").first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    expect(artAsked).toEqual([]);
    await page.waitForTimeout(800);
    await shoot(page, `gym-${label}`);

    await week.getByRole("button", { name: /Core day B/ }).click();
    await expect(sheet.getByText("3 × 45 s").first()).toBeVisible();
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
    await expect(sheet.getByText("3 × 45 s").first()).toBeVisible();
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
  const climate = page.getByRole("dialog", { name: "Climate" });
  await expect(climate).toBeVisible();
  // The big dial (#729): a nudge holds the change, counted down in the card with Cancel and Send now.
  await climate.getByRole("button", { name: "Heat to: one degree warmer" }).click();
  await expect(climate.getByRole("status")).toContainText("Sending 71°");
  await climate.getByRole("button", { name: "Cancel" }).click();
  await expect(climate.getByRole("status")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Climate" })).toHaveCount(0);
  // The arrow keys turn it a degree at a time, and it sends once, through the control's own action.
  await dial.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(dial).toHaveAccessibleName(/set to 72°F/);
  // Held three seconds after the last turn (#718), then sent once with the final setting.
  await expect(strip.getByRole("status")).toContainText("Setting 72°");
  await page.waitForTimeout(1500);
  expect(sent.length).toBe(0);
  await expect.poll(() => sent.length, { timeout: 5000 }).toBe(1);
  expect(sent[0]).toMatchObject({ action: "thermostat.set", device: "a00000000009", tempF: 72 });
  // Cancel drops a held change: nothing more is sent.
  await dial.focus();
  await page.keyboard.press("ArrowDown");
  await strip.getByRole("status").getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(3500);
  expect(sent.length).toBe(1);
});

test("signed in: the wet tray says when it closes itself, and Close shuts it now (#713)", async ({ page }) => {
  await stub(page, { signedIn: true, plan: FAKE_PLAN });
  const now = Date.now();
  // A made-up opening from the Desk: 01:15 UTC is 6:15pm in Denver (MST, as in November).
  const closesAt = "2026-11-05T01:15:00.000Z";
  const sent: Record<string, unknown>[] = [];
  await page.route(/\/api\/haven\/devices(\?.*)?$/, (r) => {
    const all = devices(now).map((d) => (d.kind === "wet-feeder" ? { ...d, state: "lid open", manualToday: 1, closesAt } : d));
    if (new URL(r.request().url()).searchParams.get("view") === "status") return r.fulfill({ json: { vendors: VENDORS, devices: all.map((d) => ({ kind: d.kind, state: d.state, online: d.online })) } });
    return r.fulfill({ json: { vendors: VENDORS, devices: all, feedCap: 2, roborockConnected: true } });
  });
  await page.route(/\/api\/haven\/devices\/action$/, (r) => {
    sent.push(r.request().postDataJSON() as Record<string, unknown>);
    return r.fulfill({ json: { ok: true, say: "The wet food feeder's lid is closing." } });
  });
  await page.goto(`${BASE}/haven`);
  await page.getByRole("navigation", { name: "Haven rooms" }).getByRole("button", { name: "Pets" }).click();
  const sheet = page.getByRole("dialog", { name: "Pets" });
  await expect(sheet.getByTestId("wet-state")).toHaveText("Open, closes at 6:15pm");
  await expect(sheet.getByRole("button", { name: "Two more hours" })).toBeEnabled();
  const close = sheet.getByRole("button", { name: "Close", exact: true });
  await close.scrollIntoViewIfNeeded();
  await shoot(page, "wet-tray-713");
  await page.setViewportSize({ width: 390, height: 844 });
  await close.scrollIntoViewIfNeeded();
  await shoot(page, "wet-tray-713-phone");
  await close.click();
  await expect.poll(() => sent.length, { timeout: 5000 }).toBe(1);
  expect(sent[0]).toMatchObject({ action: "wet.close", device: "a00000000005" });
});

test("signed in: each device gauge opens its controls, and they send the existing actions (#718)", async ({ page }) => {
  await stub(page, { signedIn: true, plan: FAKE_PLAN });
  const sent: Record<string, unknown>[] = [];
  await page.route(/\/api\/haven\/devices\/action$/, (r) => {
    sent.push(r.request().postDataJSON() as Record<string, unknown>);
    return r.fulfill({ json: { ok: true, say: "Done." } });
  });
  await page.goto(`${BASE}/haven`);
  const strip = page.getByRole("complementary", { name: "House-wide" });
  // Roborock: rooms picked on the floor plan, with a mode word.
  await strip.locator('[data-gauge="roborock"]').click();
  const vac = page.getByRole("dialog", { name: "Roborock" });
  await expect(vac).toBeVisible();
  await vac.getByRole("checkbox", { name: "Clean Kitchen" }).click();
  await vac.getByRole("checkbox", { name: "Clean Bedroom" }).click();
  await vac.getByRole("button", { name: "Quiet" }).click();
  // The sheet (#729): its status up top, the tank alert, and one primary action.
  await expect(vac.getByRole("list", { name: "Needs attention" })).toContainText("Clean water tank empty");
  await expect(vac.getByRole("img", { name: "Battery 81%" })).toBeVisible();
  if (SHOTS) await page.waitForTimeout(400).then(() => page.screenshot({ path: `${SHOTS}/haven-729-roborock.png` }));
  await vac.getByRole("button", { name: "Clean Kitchen, Bedroom" }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ action: "vacuum.rooms", device: "a00000000001", rooms: ["Kitchen", "Bedroom"], suction: "quiet" });
  await vac.getByRole("button", { name: "Dock" }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toMatchObject({ action: "vacuum.dock" });
  await page.keyboard.press("Escape");
  await expect(vac).toHaveCount(0);
  // Petlibro: two portions of dry food, then the wet tray's next bowl.
  await strip.locator('[data-gauge="petlibro"]').click();
  const pet = page.getByRole("dialog", { name: "Petlibro" });
  await pet.getByRole("button", { name: "One portion more" }).click();
  await pet.getByRole("button", { name: "Feed 2 portions" }).click();
  await expect.poll(() => sent.length).toBe(3);
  expect(sent[2]).toMatchObject({ action: "feeder.feed", device: "a00000000002", portions: 2 });
  await pet.getByRole("button", { name: "Next bowl" }).click();
  await expect.poll(() => sent.length).toBe(4);
  expect(sent[3]).toMatchObject({ action: "wet.rotate", device: "a00000000005" });
  await pet.getByRole("button", { name: "Close Petlibro" }).click();
  // Whisker: a clean cycle.
  await strip.locator('[data-gauge="whisker"]').click();
  await page.getByRole("dialog", { name: "Whisker" }).getByRole("button", { name: "Run a clean cycle" }).click();
  await expect.poll(() => sent.length).toBe(5);
  expect(sent[4]).toMatchObject({ action: "litter.clean", device: "a00000000004" });
  await page.keyboard.press("Escape");
  // The Hall page picks rooms on the same floor plan, with the vacuum drawn beside it.
  await page.getByRole("navigation", { name: "Haven rooms" }).getByRole("button", { name: "Hall" }).click();
  const hall = page.getByRole("dialog", { name: "Hall" });
  await hall.getByRole("checkbox", { name: "Clean Living room" }).click();
  await hall.getByRole("button", { name: "Max" }).click();
  await hall.getByRole("button", { name: "Clean Living room" }).click();
  await expect.poll(() => sent.length).toBe(6);
  expect(sent[5]).toMatchObject({ action: "vacuum.rooms", rooms: ["Living room"], suction: "max" });
});

test("signed in, ?open=kitchen: one Shopping card; Finalize & match matches all in batches and turns to King Soopers, which sends exactly the shown picks (#664, #737)", async ({ page }) => {
  await stub(page, { signedIn: true, plan: null });
  const posts: Record<string, unknown>[] = [];
  const product = (productId: string, description: string, price: number, promo: number | null = null, more: Record<string, unknown> = {}) => ({
    productId,
    upc: productId,
    description,
    brand: "Test",
    size: "1 ct",
    price,
    promo,
    stock: "high",
    aisle: null,
    categories: [],
    image: `https://www.kroger.com/product/images/medium/front/${productId}`,
    ...more,
  });
  const at = new Date().toISOString();
  const lemons = {
    id: "k0",
    name: "Lemons",
    key: "lemon",
    inCart: false,
    pick: { term: "lemons", product: product("0001111000004", "Organic Lemons", 119, null, { aisle: "Produce", categories: ["Produce"] }), alts: [product("0001111000005", "Meyer Lemons", 199)], chosen: false, skip: false, at },
  };
  const garlic = { id: "k1", name: "Garlic", key: "garlic", inCart: false, pick: { term: "garlic", product: product("0001111000006", "Garlic Bulb", 59, 49, { aisle: "Aisle 3" }), alts: [], chosen: false, skip: false, at } };
  const oat = { id: "k2", name: "Oat milk", key: "oat milk", inCart: true, pick: { term: "oat milk", product: product("0001111000001", "Test Oat Milk", 429, null, { categories: ["Dairy"] }), alts: [], chosen: false, skip: false, at } };
  const base = {
    ready: true,
    state: "live",
    connected: true,
    refused: false,
    zip: "12345",
    found: [],
    store: { id: "62000001", name: "King Soopers - Test Town", line: "1 Test Ave", city: "Testville", state: "CO", zip: "12345" },
    count: 3,
    sent: null,
  };
  let view: Record<string, unknown> = {
    ...base,
    lines: [
      { ...lemons, pick: null },
      { ...garlic, pick: null },
      { ...oat, pick: null, inCart: false },
    ],
    total: 0,
  };
  const matched = { ...base, lines: [lemons, garlic, oat], total: 119 + 49 + 429 };
  let matches = 0;
  await page.route(/\/api\/haven\/kroger(\?.*)?$/, async (r) => {
    if (r.request().method() !== "POST") return r.fulfill({ json: view });
    const body = r.request().postDataJSON() as Record<string, unknown>;
    posts.push(body);
    if (body.action === "match") {
      // Two batches: 25 of 38, then the last 13 (a made-up count: the server matches 25 a call, #737).
      matches++;
      if (matches === 2) await new Promise((ok) => setTimeout(ok, 700));
      view = matched;
      return r.fulfill({ json: { ok: true, matched: matches === 1 ? 25 : 13, failed: 0, left: matches === 1 ? 13 : 0, ...view } });
    }
    if (body.action === "clear")
      return r.fulfill({
        json: {
          ok: true,
          ...base,
          lines: [
            { ...lemons, pick: null },
            { ...garlic, pick: null },
            { ...oat, pick: null, inCart: false },
          ],
          total: 0,
        },
      });
    return r.fulfill({ json: body.action === "send" ? { ok: true, items: 2, already: 1, url: "https://www.kingsoopers.com/cart", ...view } : { ok: true, ...view } });
  });
  // Made-up product photos: a plain disc per product, served for Kroger's image host.
  await page.route("https://www.kroger.com/product/images/**", (r) => {
    const hue = Number(r.request().url().slice(-2)) * 47;
    return r.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="52" r="34" fill="hsl(${hue} 70% 58%)"/><ellipse cx="40" cy="40" rx="10" ry="6" fill="#fff" opacity=".35"/></svg>` });
  });
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await page.goto(`${BASE}/haven?open=kitchen`);
  const sheet = page.getByRole("dialog", { name: "Kitchen" });
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(`${BASE}/haven`);

  // One card, two tabs with their counts; the List by shelf.
  const tabs = sheet.getByRole("tablist", { name: "Shopping" });
  await expect(tabs.getByRole("tab", { name: "List 3" })).toHaveAttribute("aria-selected", "true");
  await expect(tabs.getByRole("tab", { name: "King Soopers 0" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "King Soopers", exact: true })).toHaveCount(0);
  const list = sheet.getByRole("list", { name: "Kitchen list" });
  await expect(list.getByRole("heading", { name: /^Produce/ })).toBeVisible();
  await expect(list.getByRole("heading", { name: /^Dairy & eggs/ })).toBeVisible();

  if (SHOTS) await sheet.locator(".hv-shop").screenshot({ path: `${SHOTS}/haven-737-list.png` });
  // Finalize & match: every item in one press, with progress, then the King Soopers tab.
  await sheet.getByRole("button", { name: "Finalize & match" }).click();
  await expect(sheet.getByText("Matching 25 of 38…")).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "King Soopers 3" })).toHaveAttribute("aria-selected", "true");
  expect(posts).toEqual([{ action: "match" }, { action: "match" }]);
  posts.length = 0;
  // Matched, the List groups by Kroger's own department.
  await expect(sheet.getByText("King Soopers - Test Town · 1 Test Ave, Testville")).toBeVisible();
  await expect(sheet.getByText("Organic Lemons · 1 ct")).toBeVisible();
  await expect(sheet.getByText("Already in your cart")).toHaveCount(1);
  await expect(sheet.locator(".hv-gTotal")).toContainText("$5.97");
  await expect(sheet.getByRole("link", { name: "King Soopers app" })).toHaveAttribute("href", "https://www.kingsoopers.com/cart");
  if (SHOTS) {
    await page.waitForTimeout(300);
    await sheet.locator(".hv-shop").screenshot({ path: `${SHOTS}/haven-737-shopping-desktop.png` });
    const was = page.viewportSize()!;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await sheet.locator(".hv-shop").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/haven-737-shopping-phone.png` });
    await page.setViewportSize(was);
  }

  // The product's own sheet, and Choose this from its swaps.
  await sheet.getByRole("button", { name: "Organic Lemons: details" }).click();
  const detail = page.getByRole("dialog", { name: "Lemons: Organic Lemons" });
  await expect(detail.getByText("Produce", { exact: true }).first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/haven-737-product.png` });
  await detail.getByRole("button", { name: "Choose this" }).click();
  await expect(detail).toHaveCount(0);
  await sheet.getByRole("button", { name: "Rematch Garlic" }).click();

  // Send adds only what isn't in the cart already.
  await sheet.getByRole("button", { name: "Send 2 to King Soopers" }).click();
  await expect(sheet.getByText("Added 2 to your King Soopers cart (1 already there, not added again).", { exact: false })).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Open the cart" })).toHaveAttribute("href", "https://www.kingsoopers.com/cart");

  // Clear matches takes two taps.
  await sheet.getByRole("button", { name: "Clear matches" }).click();
  expect(posts.some((p) => p.action === "clear")).toBe(false);
  await sheet.getByRole("button", { name: "Tap again to clear every match" }).click();
  await expect(tabs.getByRole("tab", { name: "King Soopers 0" })).toBeVisible();
  expect(posts).toEqual([
    { action: "choose", key: "lemon", productId: "0001111000005" },
    { action: "rematch", key: "garlic" },
    {
      action: "send",
      picks: [
        { key: "lemon", productId: "0001111000004" },
        { key: "garlic", productId: "0001111000006" },
        { key: "oat milk", productId: "0001111000001" },
      ],
    },
    { action: "clear" },
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

test("signed in, the Kitchen's meal planner: the week list, a night customized live, HelloFresh, and Finalize (#678, #721)", async ({ page }) => {
  await stub(page, { signedIn: true, plan: null });
  // The made-up planner file (api/_haven/meals.fixture.ts), changed in the browser by the same edits the server runs.
  let file: MealsFile = fakeMeals();
  const posts: Array<Record<string, unknown>> = [];
  await page.route(`${BASE}/api/haven-meals`, (r) => {
    if (r.request().method() !== "POST") return r.fulfill({ json: { meals: file, components: allComponents(file) } });
    const body = r.request().postDataJSON() as Record<string, unknown>;
    posts.push(body);
    if (body.action === "confirm") {
      const got = applyEdit(file, { op: "confirm" }, Date.now());
      if (got.ok) file = got.file;
      return r.fulfill({ json: { ok: true, changes: got.ok ? got.changes : [], added: 12, already: 1, photos: file.week!.photoQueue.length, meals: file } });
    }
    const edit = readEdit(body.edit);
    const got = edit ? applyEdit(file, edit, Date.now()) : null;
    if (!got?.ok) return r.fulfill({ status: 409, json: { error: got && !got.ok ? got.error : "bad-request" } });
    file = got.file;
    return r.fulfill({ json: { ok: true, changes: got.changes, meals: file } });
  });
  // The photo library (#687): no photos in it (the placeholders show), and a customized night's photo being made.
  const shots: unknown[] = [];
  await page.route(/\/api\/haven-photos(\?.*)?$/, (r) => {
    const url = new URL(r.request().url());
    if (url.searchParams.has("id")) return r.fulfill({ status: 404, json: { error: "not-found" } });
    if (url.searchParams.get("view") === "catalog") return r.fulfill({ json: { photos: (url.searchParams.get("ids") ?? "").split(",").map((id) => ({ id, status: "making" })), budget: null, ready: true } });
    const body = r.request().postDataJSON() as { meals: Array<{ meal: string }> };
    shots.push(...body.meals);
    return r.fulfill({ json: { photos: body.meals.map((m) => ({ meal: m.meal, key: "0123456789abcdef", id: `${m.meal}-01234567`, status: "queued" })), budget: { month: "2026-11", images: 1, usd: 0.1, capUsd: 10, left: 99, reached: false } } });
  });
  await page.goto(`${BASE}/haven?open=kitchen`);
  const sheet = page.getByRole("dialog", { name: "Kitchen" });
  const week = sheet.getByRole("list", { name: "This week's meals" });
  const steps = sheet.getByRole("list", { name: "Steps" });
  await expect(week.getByRole("listitem")).toHaveCount(7);
  // Plan first (#721): the list on the left, nothing open, no customization in sight.
  await expect(steps.getByRole("button", { name: /Plan/ })).toHaveAttribute("aria-current", "step");
  await expect(sheet.getByRole("region", { name: "Finalize the week" })).toBeVisible();
  await expect(sheet.getByRole("group", { name: /^Carb for/ })).toHaveCount(0);

  await week.getByRole("button", { name: "Wednesday's dinner: sausage pasta" }).click();
  const plan = sheet.getByRole("region", { name: "Wednesday's dinner" });
  await expect(plan.getByRole("heading", { name: "sausage pasta" })).toBeVisible();
  await expect(plan.locator(".mp-macros .is-p b")).toHaveText("62");
  await plan.getByRole("button", { name: /^Customize this meal/ }).click();
  await expect(steps.getByRole("button", { name: /Customize/ })).toHaveAttribute("aria-current", "step");
  const drawer = sheet.getByRole("region", { name: "Customize Wednesday's dinner" });
  await drawer.getByRole("group", { name: "Carb for Wednesday" }).getByRole("button", { name: /^Protein pasta/ }).click();
  await expect(drawer.locator(".mp-macros .is-p b")).toHaveText(String(62 - 14 + 28));
  await expect(drawer.getByText("Protein pasta for rigatoni")).toBeVisible();
  await expect(week.getByRole("listitem").nth(2).getByText("photo pending")).toBeVisible();
  expect(posts.at(-1)).toEqual({ action: "edit", edit: { op: "customize", day: "wed", part: { index: 1, option: "protein-pasta" } } });

  await steps.getByRole("button", { name: /Plan/ }).click();
  await plan.getByRole("switch", { name: "HelloFresh" }).click();
  await expect(week.getByRole("listitem").nth(2).getByText("HelloFresh night")).toBeVisible();
  await plan.getByRole("switch", { name: "HelloFresh" }).click();
  await expect(week.getByRole("listitem").nth(2).getByText("HelloFresh night")).toHaveCount(0);
  // Lunch opens in full like dinner (#729): its heading, the Leftovers switch and the lunches to swap in.
  await week.getByRole("button", { name: /^Tuesday's lunch/ }).click();
  const lunch = sheet.getByRole("region", { name: "Tuesday's lunch" });
  await expect(lunch.getByRole("heading", { level: 3 })).toBeVisible();
  await expect(lunch.getByRole("switch", { name: /^Leftovers/ })).toBeVisible();
  await expect(lunch.getByRole("group", { name: "Other lunches for Tuesday" })).toBeVisible();
  if (SHOTS) await page.waitForTimeout(600).then(() => page.screenshot({ path: `${SHOTS}/haven-729-lunch.png` }));
  await week.getByRole("button", { name: "Wednesday's dinner: sausage pasta" }).click();
  if (SHOTS) {
    await sheet.evaluate((el) => el.scrollTo(0, 300));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/haven-678-planner.png` });
  }

  await sheet.getByRole("button", { name: "Finalize the week" }).click();
  await expect(sheet.getByText(/Finalized\. 12 things went on the Kitchen list \(1 already there\)/)).toBeVisible();
  await expect(sheet.getByText("1 customized meal is getting its own photo.", { exact: false })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Week finalized" })).toBeDisabled();
  // Finalizing moves on to Shop: the list and King Soopers.
  await expect(steps.getByRole("button", { name: /Shop/ })).toHaveAttribute("aria-current", "step");
  await expect(sheet.getByRole("list", { name: "Kitchen list" }).getByText("Lemons")).toBeVisible();
  expect(posts.find((p) => p.action === "confirm")).toEqual({ action: "confirm" });
  // The library got the night as customized, and the night keeps the id it answered.
  expect(shots).toEqual([{ meal: "sausage-pasta", name: "sausage pasta", description: expect.stringContaining("Protein pasta for rigatoni"), components: ["Italian sausage", "Protein pasta"], style: "plate" }]);
  expect(posts.at(-1)).toEqual({ action: "edit", edit: { op: "photo", day: "wed", photo: "sausage-pasta-01234567" } });
  await steps.getByRole("button", { name: /Plan/ }).click();
  await expect(week.getByRole("listitem").nth(2).getByText(/photo queued|making the photo/)).toBeVisible();

  await sheet.getByRole("button", { name: "Catalog" }).click();
  const cat = page.getByRole("dialog", { name: "Meal catalog" });
  await expect(cat.getByRole("row")).toHaveCount(11);
  await expect(cat.getByRole("heading", { name: "Meal catalog" })).toBeVisible();
  if (SHOTS) await page.waitForTimeout(500).then(() => page.screenshot({ path: `${SHOTS}/haven-678-catalog.png` }));
  await cat.getByRole("button", { name: "Close" }).last().click();
  await expect(cat).toHaveCount(0);

  if (SHOTS) {
    await page.setViewportSize({ width: 390, height: 844 });
    await week.getByRole("button", { name: /^Monday's dinner/ }).click();
    await sheet.evaluate((el) => el.scrollTo(0, 250));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/haven-678-planner-phone.png` });
    await sheet.evaluate((el) => el.scrollBy(0, 700));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/haven-678-planner-phone-2.png` });
  }
});

test("signed in, the Kitchen's cook mode: a night as customized, one step at a time, keys, swipe and the wake lock (#705)", async ({ page }) => {
  await stub(page, { signedIn: true, plan: null });
  // A stand-in for the browser's Wake Lock, so the run can see it taken, let go, and refused.
  await page.addInitScript(() => {
    const w = window as unknown as { wake: { asked: number; held: number; refuse: boolean } };
    w.wake = { asked: 0, held: 0, refuse: false };
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async () => {
          w.wake.asked++;
          if (w.wake.refuse) throw new DOMException("No.", "NotAllowedError");
          w.wake.held++;
          const t = new EventTarget() as EventTarget & { released: boolean; release: () => Promise<void> };
          t.released = false;
          t.release = async () => {
            if (t.released) return;
            t.released = true;
            w.wake.held--;
            t.dispatchEvent(new Event("release"));
          };
          return t;
        },
      },
    });
  });
  let file: MealsFile = fakeMeals();
  await page.route(`${BASE}/api/haven-meals`, (r) => {
    if (r.request().method() !== "POST") return r.fulfill({ json: { meals: file, components: allComponents(file) } });
    const edit = readEdit((r.request().postDataJSON() as { edit?: unknown }).edit);
    const got = edit ? applyEdit(file, edit, Date.now()) : null;
    if (!got?.ok) return r.fulfill({ status: 409, json: { error: "bad-request" } });
    file = got.file;
    return r.fulfill({ json: { ok: true, changes: got.changes, meals: file } });
  });
  await page.route(/\/api\/haven-photos(\?.*)?$/, (r) => r.fulfill({ status: 404, json: { error: "not-found" } }));
  const wake = () => page.evaluate(() => (window as unknown as { wake: { asked: number; held: number } }).wake);

  await page.goto(`${BASE}/haven?open=kitchen`);
  const sheet = page.getByRole("dialog", { name: "Kitchen" });
  const steps = sheet.getByRole("list", { name: "Steps" });
  await sheet.getByRole("list", { name: "This week's meals" }).getByRole("button", { name: "Wednesday's dinner: sausage pasta" }).click();
  await steps.getByRole("button", { name: /Customize/ }).click();
  const custom = sheet.getByRole("region", { name: "Customize Wednesday's dinner" });
  await custom.getByRole("group", { name: "Carb for Wednesday" }).getByRole("button", { name: /^Protein pasta/ }).click();
  await expect(custom.getByText("Protein pasta for rigatoni")).toBeVisible();

  // Cook (#721): the week's recipes, each with cook mode.
  await steps.getByRole("button", { name: /Cook/ }).click();
  const drawer = sheet.getByRole("region", { name: "Recipes this week" }).getByRole("listitem").filter({ hasText: "Wednesday · dinner" });
  await expect(drawer.getByText("Protein pasta for rigatoni")).toBeVisible();
  await drawer.getByRole("button", { name: /^Cook mode/ }).click();
  const cook = page.getByRole("dialog", { name: "Cook mode: sausage pasta" });
  const text = cook.locator(".ck-text");
  await expect(text).toHaveText("Bring a big pot of well-salted water to a boil.");
  await expect(cook.getByText("of 5")).toBeVisible();
  await expect(cook.getByText("Screen stays on")).toBeVisible();
  expect(await wake()).toEqual({ asked: 1, held: 1, refuse: false });
  await expect(cook.getByRole("button", { name: "Back" })).toBeDisabled();
  // The parts and amounts as customized: protein pasta for rigatoni, cooked for two (Thursday's lunch).
  const side = cook.getByRole("complementary", { name: "Tonight's parts and amounts" });
  await expect(side.getByText("for rigatoni")).toBeVisible();
  await expect(side.getByText("Amounts for 2")).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(text).toHaveText(/^Brown the Italian sausage/);
  await cook.getByRole("button", { name: "Next step" }).click();
  await expect(text).toHaveText("Cook the protein pasta two minutes short of the box, then save a cup of the water.");
  await expect(text.locator("mark")).toHaveText("protein pasta");
  if (SHOTS) await page.waitForTimeout(500).then(() => page.screenshot({ path: `${SHOTS}/haven-705-cook.png` }));
  await cook.getByRole("button", { name: "Back" }).click();
  await expect(text).toHaveText(/^Brown the Italian sausage/);
  // A swipe left on the step is Next.
  const stage = cook.locator(".ck-stage");
  await stage.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 7, isPrimary: true, clientX: 700, clientY: 400 });
  await stage.dispatchEvent("pointerup", { pointerType: "touch", pointerId: 7, isPrimary: true, clientX: 520, clientY: 410 });
  await expect(text).toHaveText(/^Cook the protein pasta/);
  await page.keyboard.press("End");
  await expect(text).toHaveText(/^Off the heat/);
  await expect(cook.getByRole("button", { name: "Done" })).toBeVisible();

  // Escape leaves cook mode only: the Kitchen stays open, and the screen is let go.
  await page.keyboard.press("Escape");
  await expect(cook).toHaveCount(0);
  await expect(sheet).toBeVisible();
  expect((await wake()).held).toBe(0);

  // Where the browser says no, cook mode works the same, just without the note.
  await page.evaluate(() => ((window as unknown as { wake: { refuse: boolean } }).wake.refuse = true));
  await page.setViewportSize({ width: 390, height: 844 });
  await drawer.getByRole("button", { name: /^Cook mode/ }).click();
  await expect(text).toHaveText(/^Bring a big pot/);
  await expect(cook.getByText("Screen stays on")).toHaveCount(0);
  await cook.getByRole("button", { name: "Next step" }).click();
  await cook.getByRole("button", { name: "Next step" }).click();
  await expect(text).toHaveText(/^Cook the protein pasta/);
  if (SHOTS) await page.waitForTimeout(500).then(() => page.screenshot({ path: `${SHOTS}/haven-705-cook-phone.png` }));
  // On a phone the parts and amounts are a panel over the step.
  await expect(side).toBeHidden();
  await cook.getByRole("button", { name: "Ingredients" }).click();
  await expect(side.locator(".ck-parts b", { hasText: "Protein pasta" })).toBeVisible();
  if (SHOTS) await page.waitForTimeout(400).then(() => page.screenshot({ path: `${SHOTS}/haven-705-cook-phone-side.png` }));
  await cook.getByRole("button", { name: "Back to the step" }).click();
  await cook.getByRole("button", { name: "Close cook mode" }).click();
  await expect(cook).toHaveCount(0);
  if (SHOTS) {
    await drawer.getByRole("button", { name: /^Cook mode/ }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/haven-705-drawer-phone.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
    await sheet.evaluate((el) => el.scrollTo(0, 300));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/haven-705-drawer.png` });
  }
});

test("signed in, the Kitchen follows what Skippy changes: a swap said in his chat shows on the week at once (#698)", async ({ page }) => {
  await stub(page, { signedIn: true, plan: null });
  // The made-up planner file again; Skippy's turn changes it server side, as his meal tools do.
  let file: MealsFile = fakeMeals();
  let reads = 0;
  await page.route(`${BASE}/api/haven-meals`, (r) => {
    reads++;
    return r.fulfill({ json: { meals: file, components: allComponents(file) } });
  });
  await page.route(/\/api\/haven-photos(\?.*)?$/, (r) => r.fulfill({ status: 404, json: { error: "not-found" } }));
  const asked: string[] = [];
  await page.route(`${BASE}/api/skippy`, (r) => {
    if (r.request().method() !== "POST") return r.fulfill({ json: { ready: true } });
    asked.push((r.request().postDataJSON() as { message: string }).message);
    const got = applyEdit(file, { op: "swap", day: "tue", meal: "kofta" }, Date.now());
    if (got.ok) file = got.file;
    return r.fulfill({ json: { reply: "Kofta on Tuesday. Undo is on the Kitchen page.", actions: [], did: [got.ok ? got.changes[0] : ""], wrote: ["meals_swap"], spend: { usd: 1, cap: 60, warn: 50 } } });
  });
  await page.goto(`${BASE}/haven?open=kitchen`);
  const sheet = page.getByRole("dialog", { name: "Kitchen" });
  const week = sheet.getByRole("list", { name: "This week's meals" });
  await expect(week.getByRole("button", { name: "Tuesday's dinner: chicken plate" })).toBeVisible();
  const before = reads;

  await page.evaluate(() => (document.querySelector(".desk__skippy") as HTMLElement | null)?.click());
  const chat = page.getByRole("dialog", { name: "Skippy, the Magnificent" });
  await chat.getByRole("textbox", { name: "Message to Skippy" }).fill("swap Tuesday for kofta");
  await chat.getByRole("textbox", { name: "Message to Skippy" }).press("Enter");
  await expect(chat.getByText("Kofta on Tuesday.", { exact: false })).toBeVisible();
  expect(asked).toEqual(["swap Tuesday for kofta"]);

  // The planner read itself again and says what Skippy changed, with that night open.
  await expect(week.getByRole("button", { name: "Tuesday's dinner: kofta" })).toBeVisible();
  expect(reads).toBeGreaterThan(before);
  await expect(sheet.getByText("Skippy changed it: Tuesday: kofta instead of chicken plate.")).toBeVisible();
  await expect(sheet.getByRole("region", { name: "Tuesday's dinner" }).getByRole("heading", { name: "kofta" })).toBeVisible();
});
