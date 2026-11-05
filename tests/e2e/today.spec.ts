import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";

/**
 * Today as the Senate (#740): the built site with made-up data stubbed in the browser. Skippy chairs a round
 * chamber with the Council's subminds on bronze pods; what needs Nikita is the docket along its foot, each item a duty,
 * a decision or a repair that plays on the floor and answers in place. His own to-dos and the Lists sit under the
 * chamber. Signed out, the page keeps the chamber and the counts only.
 */

const PORT = Number(process.env.E2E_TODAY_PORT ?? 5187);
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
const issue = (number: number, title: string, labels: string[], body = "") => ({
  number,
  title,
  state: "open",
  html_url: `https://github.com/nikitapage10/C.E.O./issues/${number}`,
  created_at: hoursAgo(5),
  updated_at: hoursAgo(1),
  closed_at: null,
  body,
  labels: labels.map((name) => ({ name })),
});

/** Made-up Foundry work: two ideas waiting for a pick, one build in flight. */
const FEED = {
  issues: [
    issue(901, "Idea: A shadow pass for the Lattice", ["foundry", "foundry:idea"], "**Pitch:** Softer shadows.\n**Size:** small\n**Short:** Softening shadows\n**Builder:** Rusty (Sonnet)"),
    issue(902, "Idea: Tidy merged branches", ["foundry", "foundry:idea"], "**Pitch:** Branches tidy themselves.\n**Size:** small\n**Short:** Tidying branches\n**Builder:** Rivet (Haiku)"),
    issue(903, "Brighter idea cards", ["foundry", "foundry:chat", "foundry:working"], "**Pitch:** Brighter.\n**Size:** small\n**Short:** Brightening cards\n**Builder:** Rusty (Sonnet)"),
  ],
  runs: { workflow_runs: [] },
  e2e: { workflow_runs: [] },
  pulls: [],
  commits: [],
};
const SETUP = { items: { pings: "todo", app: "done", devices: "done", ruleset: "done", automerge: "done" }, pings: { vercel: "todo", actions: "unknown" } };
const TODOS = {
  todos: [
    { id: "todo-vet01", text: "Book the vet", at: hoursAgo(3), updated: hoursAgo(3) },
    { id: "todo-plant1", text: "Water the plants", at: hoursAgo(2), updated: hoursAgo(2) },
  ],
  marks: [],
};

const listItem = (id: string, name: string, done = false) => ({ id, name, addedAt: hoursAgo(4), source: "phone", done });
const LISTS = [
  { id: "kitchen", name: "Groceries", items: [listItem("k1", "Oat milk"), listItem("k2", "Lemons")] },
  { id: "buy", name: "Things to buy", items: [listItem("b1", "AA batteries"), listItem("b2", "Desk lamp", true)] },
];

async function stub(page: Page, signedIn: boolean) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.SpeechRecognition;
    delete w.webkitSpeechRecognition;
  });
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: [] }));
  await page.route(`${BASE}/api/foundry-feed`, (r) => r.fulfill({ json: FEED }));
  await page.route((u) => u.pathname === "/api/foundry", (r) => r.fulfill({ json: new URL(r.request().url()).searchParams.has("setup") ? SETUP : { buttons: true, direct: true, shape: true, images: false } }));
  await page.route(`${BASE}/api/desk-auth`, (r) =>
    r.fulfill({ json: signedIn ? { ready: true, signedIn: true, until: Date.now() + 30 * 60_000, hardUntil: Date.now() + 8 * 3_600_000, device: "Test device", devices: [] } : { ready: true, signedIn: false } }),
  );
  await page.route(`${BASE}/api/today-todos`, (r) => r.fulfill({ json: signedIn ? { state: TODOS } : { count: TODOS.todos.length } }));
  // The Lists (#735), made up: a Groceries list and Things to buy.
  await page.route((u) => u.pathname === "/api/haven", (r) => {
    const view = new URL(r.request().url()).searchParams.get("view");
    const meta = LISTS.map((l) => ({ id: l.id, name: l.name, open: l.items.filter((i) => !i.done).length, done: l.items.filter((i) => i.done).length }));
    if (view === "status") return r.fulfill({ json: { kitchen: { open: 2, done: 0 }, todos: 0, gym: null, meals: null, lists: meta, ready: true } });
    if (view === "lists") return signedIn ? r.fulfill({ json: { lists: LISTS } }) : r.fulfill({ status: 401, json: { error: "signed-out" } });
    return r.fallback();
  });
}

for (const [label, width, height] of [
  ["wide", 1440, 900],
  ["phone", 390, 844],
] as const) {
  test(`Today's shots, ${label}`, async ({ page }) => {
    test.skip(!SHOTS, "pictures only");
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height });
    await stub(page, true);
    await page.goto(BASE + "/");
    await expect(page.locator(".today .desk__title")).toBeVisible();
    await expect(page.locator(".rt-stage")).toHaveAttribute("data-gl", "on", { timeout: 90_000 });
    await page.waitForTimeout(4_000);
    await page.screenshot({ path: `${SHOTS}/today-${label}.png` });
    // A speaker on the floor: the first item's advocate, mid-debate.
    await expect(page.locator(".rt-cap.on").first()).toBeVisible({ timeout: 120_000 });
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: `${SHOTS}/today-${label}-floor.png` });
    // An item answered in place: the setup duty's card, on the floor panel.
    const duty = page.locator(".rt-mo").filter({ hasText: "Setup, only you can do" });
    await duty.getByRole("button", { name: "Answer" }).click();
    await page.waitForTimeout(800);
    if (label === "phone") await duty.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `${SHOTS}/today-${label}-answer.png` });
  });
}

test("signed in: the docket in the chamber, the Council's pods, the to-dos and the Lists", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await stub(page, true);
  await page.goto(BASE + "/");
  const now = page.locator(".td-now.is-rotunda");
  await expect(now.getByRole("heading", { level: 1 })).toHaveText("Two items before you, Nikita.");

  // The docket: one card per item, each a kind with its ritual's summary.
  const docket = page.getByRole("list", { name: "Held for you" });
  await expect(docket.locator(".rt-mo")).toHaveCount(2);
  const ideas = docket.locator(".rt-mo.is-decision");
  await expect(ideas).toContainText("Decision");
  await expect(ideas).toContainText("Item I · Foundry");
  await expect(ideas.getByText("Two ideas wait for your pick")).toBeVisible();
  await expect(ideas).toContainText("2 advocates · counterpoint: the Pessimist");
  const setup = docket.locator(".rt-mo.is-duty");
  await expect(setup).toContainText("Item II · Boiler Room");
  await expect(setup).toContainText("Moved by the Pessimist · no debate");
  // A decision's options are buttons; one opens the real answer card, with Build and Not this one.
  await ideas.getByRole("button", { name: "A shadow pass for the Lattice", exact: true }).click();
  const floor = ideas.locator(".rt-floor");
  await expect(floor.getByRole("button", { name: "Build" }).first()).toBeVisible();
  await floor.getByRole("button", { name: "Fold" }).click();
  await expect(floor.getByRole("button", { name: "Build" })).toHaveCount(0);
  // A duty answers in place too.
  await setup.getByRole("button", { name: "Answer" }).click();
  await expect(setup.locator(".rt-floor")).toBeVisible();
  await setup.getByRole("button", { name: "Fold" }).first().click();

  // Still left, under the chamber: his own to-dos and the add line; the Lists beside them.
  await expect(now.getByText("still left")).toBeVisible();
  await expect(now.locator(".td-ni.is-mine")).toHaveCount(2);
  await expect(now.getByRole("textbox", { name: "Add a to-do" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Lists" })).toBeVisible();

  // The Council: Skippy presiding and twelve pods (the ten rooms' subminds and the Desk's two), a button each.
  const council = page.getByRole("group", { name: /The Council of Skippies/ });
  await expect(council.locator(".rt-pod")).toHaveCount(12);
  await expect(council.getByRole("button", { name: /^Skippy, the Magnificent/ })).toBeVisible();
  const builder = council.getByRole("button", { name: /^The Builder, Foundry/ });
  await builder.hover();
  await expect(builder).toHaveClass(/is-lit/);
  await expect(builder.locator(".rt-tip")).toContainText("Foundry");
  await builder.click();
  const card = page.getByRole("complementary", { name: "The Builder, Foundry" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Now", { exact: true })).toBeVisible();
  await expect(card.getByText(/held for you here/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await council.getByRole("button", { name: /^Skippy, the Magnificent/ }).click();
  await expect(page.getByRole("complementary", { name: "Skippy, the Magnificent" }).getByRole("button", { name: "Talk to Skippy" })).toBeVisible();
  await page.keyboard.press("Escape");

  // The session: in 3D the first item comes to the floor, the chair reads it, and its card takes its stamp.
  await expect(page.locator(".rt-stage")).toHaveAttribute("data-gl", "on", { timeout: 90_000 });
  await expect(page.locator(".rt-chair")).toContainText(/Item i, a decision|The chair recognizes|Counterpoint|put to you/, { timeout: 60_000 });
  await expect(ideas).toHaveClass(/is-on/);
  await expect(page.locator(".rt-order")).toContainText("Item I · Decision");
  await expect(ideas).toHaveClass(/is-stamped/, { timeout: 150_000 });
  // The gallery never murmurs more than three lines at once.
  expect(await page.locator(".rt-mur.on").count()).toBeLessThanOrEqual(3);
  // A card brings its item to the floor.
  await setup.locator(".rt-mo-main").click();
  await expect(setup).toHaveClass(/is-on/, { timeout: 30_000 });
  await expect(page.locator(".rt-chair")).toContainText("a duty", { timeout: 30_000 });

  // The bar, and Ask Skippy bottom right.
  const bar = page.getByRole("navigation", { name: "Desk" });
  await expect(bar.getByRole("link")).toHaveText(["Senate", "Haven", "Foundry", "Relay", "Green", "Exchange", "Archive", "Annex", "Spire", "Workshop", "Studio", "Boiler Room"]);
  await expect(page.getByRole("button", { name: "Ask Skippy", exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("signed out: the chamber and the counts, no private words", async ({ page }) => {
  await stub(page, false);
  await page.goto(BASE + "/");
  await expect(page.locator(".today .desk__title")).toBeVisible();
  await expect(page.getByText("Book the vet")).toHaveCount(0);
  const council = page.getByRole("group", { name: /The Council of Skippies/ });
  await expect(council.locator(".rt-pod")).toHaveCount(12);
  await council.getByRole("button", { name: /^The Messenger, Relay/ }).click();
  const card = page.getByRole("complementary", { name: "The Messenger, Relay" });
  await expect(card).toBeVisible();
  await expect(card.locator(".td-talks-l")).toHaveCount(0);
});

test("reduced motion: the chamber holds near still and the page still works", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await stub(page, true);
  await page.goto(BASE + "/");
  await expect(page.locator(".rt-stage")).not.toHaveAttribute("data-gl", /idle|loading/, { timeout: 90_000 });
  await page.getByRole("button", { name: /^The Pessimist, Boiler Room/ }).click();
  await expect(page.getByRole("complementary", { name: "The Pessimist, Boiler Room" })).toBeVisible();
  // No murmurs from the gallery under reduced motion.
  await page.waitForTimeout(4_000);
  await expect(page.locator(".rt-mur.on")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the sound: off by default, on with a tap, remembered, and every line asked for in its member's voice", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await stub(page, true);
  // ElevenLabs is "capped" here: no audio comes back, so the chamber falls back to reading pace without a sound.
  const asked: { room?: string; speak?: string; as?: string }[] = [];
  await page.route(`${BASE}/api/skippy-room`, (r) => {
    const body = JSON.parse(r.request().postData() ?? "{}") as { room?: string; speak?: string; as?: string };
    asked.push(body);
    return r.fulfill({ json: { say: body.speak, kind: "spoken" } });
  });
  await page.goto(BASE + "/");
  const sound = page.getByRole("button", { name: /Sound (on|off)/ });
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".rt-stage")).toHaveAttribute("data-gl", "on", { timeout: 90_000 });
  await page.waitForTimeout(3_000);
  expect(asked).toEqual([]);
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  await expect(sound.locator(".rt-sound-lv")).toBeVisible();
  await expect.poll(() => asked.length, { timeout: 60_000 }).toBeGreaterThan(0);
  for (const a of asked) {
    expect(a.room).toBe("today");
    expect(a.as).toMatch(/^(kernel|foundry|relay|exchange|green|spire|archive|boiler|breakroom|workshop|studio|annex|haven)$/);
    expect(a.speak).not.toMatch(/Book the vet|Oat milk/);
  }
  // Without audio the session still runs, at reading pace.
  await expect(page.locator(".rt-chair")).toContainText(/Item i|The chair recognizes|put to you|a duty/, { timeout: 60_000 });
  // A fresh visit on the same device remembers the choice.
  await page.goto("about:blank");
  await page.goto(BASE + "/");
  await expect(page.getByRole("button", { name: /Sound (on|off)/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Sound (on|off)/ }).click();
  await expect(page.getByRole("button", { name: /Sound (on|off)/ })).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});

test("on a phone the docket sits under the chamber, with no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page, true);
  await page.goto(BASE + "/");
  const stage = await page.locator(".rt-stage").boundingBox();
  const dock = await page.locator(".rt-dock").boundingBox();
  expect(stage && dock && dock.y >= stage.y + stage.height - 1).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Settings in the Boiler Room has Hide, Ilyr's clock and Coming up", async ({ page }) => {
  await stub(page, true);
  await page.goto(BASE + "/boiler/controls");
  const settings = page.locator("#ct-settings");
  await expect(settings.getByRole("heading", { name: "Settings" })).toBeVisible();
  await settings.locator(".bx-fold").click();
  const hide = settings.getByRole("button", { name: "Hide" });
  await hide.click();
  await expect(settings.getByRole("button", { name: "Hidden" })).toHaveAttribute("aria-pressed", "true");
  await settings.getByRole("button", { name: "Hidden" }).click();
  await expect(settings.getByRole("region", { name: "Ilyr's clock" })).toBeVisible();
  await expect(settings.getByRole("region", { name: "Coming up" })).toBeVisible();
  if (SHOTS) {
    await settings.scrollIntoViewIfNeeded();
    await settings.screenshot({ path: `${SHOTS}/boiler-settings.png` });
  }
});
