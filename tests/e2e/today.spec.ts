import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";

/**
 * Today as the Iris (#666): the built site with made-up data stubbed in the browser. The priority list stands alone on
 * the left (what needs Nikita, then what's still left), and the Council of Skippies sits on the right in 3D, ringed by
 * a nanite eye. Hovering a submind lights it from above; clicking it opens what its room is doing. Signed out, the
 * page keeps the Council and the counts only. The stat row, Coming up, the broadcast, the Kitchen chip and the bar's
 * toggles live elsewhere now (the Boiler Room's Settings, the Archive, the Haven).
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
}

for (const [label, width, height] of [
  ["wide", 1440, 900],
  ["phone", 390, 844],
] as const) {
  test(`Today's shots, ${label}`, async ({ page }) => {
    test.skip(!SHOTS, "pictures only");
    await page.setViewportSize({ width, height });
    await stub(page, true);
    await page.goto(BASE + "/");
    await expect(page.locator(".today .desk__title")).toBeVisible();
    await page.waitForTimeout(6_000);
    await page.screenshot({ path: `${SHOTS}/today-${label}.png` });
    if (label === "phone" && (await page.locator(".ti-stage").count())) {
      await page.locator(".ti-stage").evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(3_000);
      await page.screenshot({ path: `${SHOTS}/today-${label}-council.png` });
    }
  });
}

test("signed in: the list stands alone, the Council lights on a hover and opens a card", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await stub(page, true);
  await page.goto(BASE + "/");
  const list = page.locator(".td-now.is-iris");
  await expect(list.getByRole("heading", { level: 1 })).toHaveText("Four things, Nikita.");
  await expect(list.getByText("Two ideas wait for your pick")).toBeVisible();
  await expect(list.getByText("still left")).toBeVisible();
  await expect(list.locator(".td-ni.is-mine")).toHaveCount(2);
  await expect(list.getByRole("textbox", { name: "Add a to-do" })).toBeVisible();

  // The Council: Skippy and the ten, one button each.
  const council = page.getByRole("group", { name: /The Council of Skippies/ });
  await expect(council.locator(".ti-seat")).toHaveCount(11);
  const builder = council.getByRole("button", { name: /^The Builder, Foundry/ });
  await builder.hover();
  await expect(page.locator(".ti-cone")).toBeVisible();
  await expect(page.locator(".ti-tip")).toContainText("Foundry");
  await builder.click();
  const card = page.getByRole("complementary", { name: "The Builder, Foundry" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Now", { exact: true })).toBeVisible();
  await expect(card.getByText(/held for you here/)).toBeVisible();
  if (SHOTS) {
    await page.waitForTimeout(1_500);
    await expect(card).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/today-card-wide.png` });
  }
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);

  // What moved off the page: the stat row, Coming up, the broadcast, the Kitchen chip, the way into the Lattice.
  for (const gone of ["Coming up", "Enter the Lattice", "Today in Ilyr", "Kitchen list", "Shipped today", "Rooms live"]) await expect(page.getByText(gone, { exact: true })).toHaveCount(0);
  // The bar: the pages in their order, the account button and the Lattice; no Hide or Hands-free (they're in Settings).
  const bar = page.getByRole("navigation", { name: "Desk" });
  await expect(bar.getByRole("link")).toHaveText(["Today", "Haven", "Foundry", "Relay", "Green", "Exchange", "Archive", "Annex", "Spire", "Workshop", "Studio", "Boiler Room"]);
  await expect(page.locator(".wv-navr").getByRole("button", { name: /Hide/ })).toHaveCount(0);
  await expect(page.locator(".wv-navr").getByRole("button", { name: /Hands-free/ })).toHaveCount(0);
  await expect(page.locator(".wv-navr").getByRole("link", { name: /Lattice/ })).toBeVisible();
  // Ask Skippy stays bottom right.
  await expect(page.getByRole("button", { name: "Ask Skippy", exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("signed out: the Council and the counts, no private words", async ({ page }) => {
  await stub(page, false);
  await page.goto(BASE + "/");
  await expect(page.locator(".today .desk__title")).toBeVisible();
  await expect(page.getByText("Book the vet")).toHaveCount(0);
  const council = page.getByRole("group", { name: /The Council of Skippies/ });
  await expect(council.locator(".ti-seat")).toHaveCount(11);
  await council.getByRole("button", { name: /^The Messenger, Relay/ }).click();
  const card = page.getByRole("complementary", { name: "The Messenger, Relay" });
  await expect(card).toBeVisible();
  await expect(card.locator(".td-talks-l")).toHaveCount(0);
});

test("reduced motion: the Council holds still and the page still works", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await stub(page, true);
  await page.goto(BASE + "/");
  await expect(page.locator(".ti-council")).not.toHaveAttribute("data-gl", /idle|loading/, { timeout: 60_000 });
  await page.getByRole("button", { name: /^The Pessimist, Boiler Room/ }).click();
  await expect(page.getByRole("complementary", { name: "The Pessimist, Boiler Room" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("on a phone the ring sits under the list, with no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page, true);
  await page.goto(BASE + "/");
  const list = await page.locator(".ti-list").boundingBox();
  const stage = await page.locator(".ti-stage").boundingBox();
  expect(list && stage && stage.y >= list.y + list.height - 1).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Settings in the Boiler Room has Hide, Ilyr's clock and Coming up", async ({ page }) => {
  await stub(page, true);
  await page.goto(BASE + "/boiler/controls");
  const settings = page.locator("#ct-settings");
  await expect(settings.getByRole("heading", { name: "Settings" })).toBeVisible();
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
