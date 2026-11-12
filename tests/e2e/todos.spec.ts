import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { readTalkBack } from "../../api/_today/parse.ts";
import { keepState, mergeState, type TodoState } from "../../api/_today/todos.ts";
import { startDistServer } from "./dist-server.ts";

/**
 * Nikita's own to-dos and talk-back (#622): the built site, signed in, with /api/today-todos stubbed in the browser by
 * the real merge (api/_today/todos.ts). Since #1056 the to-dos live in the Haven: its To-dos gauge opens the panel,
 * where a line typed into the capture box becomes a to-do at once, with one line saying what it did and an Undo that
 * takes it back, and Done and Tomorrow take one tap. On the Senate a held row's mic opens a one-line talk-back that
 * snoozes it (the row goes, with Undo), and a bare time asks with two chips; the Senate has no to-dos of its own.
 * Nothing opens a chat. The browser's dictation is switched off here, so the words are typed.
 */

const PORT = Number(process.env.E2E_TODOS_PORT ?? 5186);
const BASE = `http://localhost:${PORT}`;
/** Where to save the screenshots, when set. */
const SHOTS = process.env.E2E_SHOTS ?? "";
let server: Server;

test.beforeAll(async () => {
  const dist = fileURLToPath(new URL("../../apps/world/dist/index.html", import.meta.url));
  if (!existsSync(dist)) execSync("npm run build", { cwd: fileURLToPath(new URL("../..", import.meta.url)), stdio: "ignore" });
  server = await startDistServer(PORT);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

const FEED = { issues: [], runs: { workflow_runs: [] }, e2e: { workflow_runs: [] }, pulls: [], commits: [] };
const SETUP = { items: { pings: "todo", app: "done", devices: "todo", ruleset: "done", automerge: "done" }, pings: { vercel: "todo", actions: "unknown" } };

async function stub(page: Page) {
  let state: TodoState = { todos: [], marks: [] };
  const saves: unknown[] = [];
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.SpeechRecognition;
    delete w.webkitSpeechRecognition;
  });
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: [] }));
  await page.route(`${BASE}/api/foundry-feed`, (r) => r.fulfill({ json: FEED }));
  await page.route((u) => u.pathname === "/api/foundry", (r) => r.fulfill({ json: new URL(r.request().url()).searchParams.has("setup") ? SETUP : { buttons: true, direct: true, shape: true, images: false } }));
  await page.route(`${BASE}/api/desk-auth`, (r) => r.fulfill({ json: { ready: true, signedIn: true, until: Date.now() + 30 * 60_000, hardUntil: Date.now() + 8 * 3_600_000, device: "Test device", devices: [] } }));
  // The Haven, made up and quiet: no plan, nothing connected.
  await page.route(/\/api\/haven(\?.*)?$/, (r) => r.fulfill({ json: new URL(r.request().url()).searchParams.get("view") === "status" ? { kitchen: { open: 0, done: 0 }, todos: 0, ready: true } : { items: [] } }));
  await page.route(/\/api\/haven\/devices(\?.*)?$/, (r) => r.fulfill({ json: { vendors: { roborock: "waiting", petlibro: "waiting", whisker: "waiting", nest: "waiting" }, devices: [] } }));
  await page.route(`${BASE}/api/haven-plan`, (r) => r.fulfill({ json: { plan: null } }));
  await page.route(`${BASE}/api/today-todos`, async (r) => {
    if (r.request().method() === "GET") return r.fulfill({ json: { state } });
    const body = r.request().postDataJSON() as { action: string; todos?: unknown[]; marks?: unknown[]; drop?: unknown[] };
    if (body.action === "save") {
      saves.push(body);
      state = mergeState(state, body, Date.now());
      return r.fulfill({ json: { state } });
    }
    // The fallback read: never reached in these words, which the rules read.
    return r.fulfill({ json: { intent: null } });
  });
  return { saves, state: () => keepState(state, Date.now()) };
}

/** A picture once the rows have drawn in, the held list in view on a phone. */
async function shot(page: Page, path: string) {
  await page.locator(".td-now").evaluate((el) => ((el as HTMLElement).style.scrollMarginTop = "100px", el.scrollIntoView({ block: "start" })));
  await page.waitForTimeout(1_500);
  await page.screenshot({ path });
}

for (const width of [1440, 400]) {
  test(`the Haven's To-dos gauge opens his to-dos: add by a line, Undo, Tomorrow and Done (${width} wide)`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 600 ? 900 : 860 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const api = await stub(page);
    await page.goto(BASE + "/haven");
    const gauge = page.getByRole("button", { name: /^To-dos: 0, clear\. Opens your to-dos\./ });
    await expect(gauge).toBeVisible();
    await gauge.click();
    const panel = page.getByRole("dialog", { name: "To-dos" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Nothing left. Say or type one above.")).toBeVisible();

    // T jumps to the capture line.
    const box = panel.getByRole("textbox", { name: "Add a to-do" });
    await expect(box).toBeVisible();
    await expect(async () => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("t");
      await expect(box).toBeFocused({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await box.fill("tomorrow I need to respond to the dermatologist");
    await box.press("Enter");

    const list = panel.getByRole("list", { name: "Your to-dos" });
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list.getByText("Respond to the dermatologist")).toBeVisible();
    await expect(list.getByText(/tomorrow 9:00 am/)).toBeVisible();
    const did = panel.locator(".td-did");
    await expect(did).toContainText("Added for tomorrow 9:00 am");
    await expect(box).toHaveValue("");
    await expect(gauge).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^To-dos: 1, open\./ })).toBeVisible();
    await expect.poll(() => api.state().todos.map((t) => t.text)).toEqual(["Respond to the dermatologist"]);
    if (SHOTS) {
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${SHOTS}/1056-haven-todos-${width}.png` });
    }

    // Undo takes it back, on the store too.
    await did.getByRole("button", { name: "Undo" }).click({ force: true });
    await expect(list).toHaveCount(0);
    await expect.poll(() => api.state().todos).toEqual([]);

    // Two more: Tomorrow snoozes one (it leaves the list), Done ticks the other off.
    await box.fill("water the plants");
    await box.press("Enter");
    await box.fill("book the vet");
    await box.press("Enter");
    await expect(list.getByRole("listitem")).toHaveCount(2);
    if (SHOTS) {
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SHOTS}/1056-haven-todos-two-${width}.png` });
    }
    await list.getByRole("listitem").filter({ hasText: "Water the plants" }).getByRole("button", { name: "Tomorrow" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await list.getByRole("button", { name: "Done: Book the vet" }).click();
    await expect(panel.getByText("Nothing left. Say or type one above.")).toBeVisible();
    await expect.poll(() => api.state().todos.find((t) => t.text === "Book the vet")?.done).toBeTruthy();

    // A to-do's mic opens the same talk-back as the Senate's rows.
    await box.fill("call mom");
    await box.press("Enter");
    const call = list.getByRole("listitem").filter({ hasText: "Call mom" });
    await call.getByRole("button", { name: /Talk back to this to-do/ }).click();
    const talk = call.getByRole("textbox", { name: "Say something back to it" });
    await expect(talk).toBeFocused();
    await talk.fill("note: ask about the weekend");
    await talk.press("Enter");
    await expect(call.getByText("Note: ask about the weekend")).toBeVisible();

    // Escape closes it.
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`talking back to what needs you on the Senate, which keeps no to-dos (${width} wide)`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 600 ? 900 : 860 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const api = await stub(page);
    await page.goto(BASE + "/");
    const held = page.locator(".td-now");
    await expect(held.getByText("Setup, only you can do")).toBeVisible();
    // No capture line and no list of his own here since #1056.
    await expect(held.getByRole("textbox", { name: "Add a to-do" })).toHaveCount(0);
    await expect(held.getByText("still left")).toHaveCount(0);
    const did = held.locator(".td-did");

    // Talk back to a held row: a bare time asks with two chips.
    const setupRow = held.locator(".td-ni").filter({ hasText: "Setup, only you can do" });
    await setupRow.getByRole("button", { name: /Talk back to this/ }).click();
    const talk = setupRow.getByRole("textbox", { name: "Say something back to it" });
    await expect(talk).toBeFocused();
    await talk.fill("friday");
    await talk.press("Enter");
    // The chips name the time from where today stands ("tomorrow 9:00 am" on a Thursday, "Friday 9:00 am" earlier in
    // the week), so the labels come from the same reading the page does (api/_today/parse.ts), not a fixed weekday.
    const reading = readTalkBack("friday", Date.now());
    if (!reading || reading.ok) throw new Error("\"friday\" should ask: snooze it or remind you?");
    const [snooze, remind] = reading.choices.map((c) => c.label);
    expect(snooze).toMatch(/^Snooze till .+ 9:00 am$/);
    expect(remind).toMatch(/^Remind me .+ 9:00 am$/);
    await expect(setupRow.getByRole("button", { name: snooze, exact: true })).toBeVisible();
    await expect(setupRow.getByRole("button", { name: remind, exact: true })).toBeVisible();
    if (SHOTS) await shot(page, `${SHOTS}/622-chips-${width}.png`);
    await setupRow.getByRole("button", { name: "Never mind" }).click();

    // "Snooze till tomorrow": the row goes, the line says so, and Undo brings it back.
    await setupRow.getByRole("button", { name: /Talk back to this/ }).click();
    await setupRow.getByRole("textbox", { name: "Say something back to it" }).fill("snooze till tomorrow");
    await page.keyboard.press("Enter");
    await expect(did).toContainText("Snoozed till tomorrow 9:00 am");
    await expect(held.getByText("Setup, only you can do")).toHaveCount(0);
    await expect.poll(() => api.state().marks).toEqual([expect.objectContaining({ ref: "setup", until: expect.any(String) })]);
    // (Undo first: the line fades after 12 s, and the chamber's frames are slow here.)
    await did.getByRole("button", { name: "Undo" }).click();
    await expect(held.getByText("Setup, only you can do")).toBeVisible();

    // Nothing here opened a chat.
    await expect(held.getByRole("dialog")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
