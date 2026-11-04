import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";

/**
 * Lists on Today (#735): the built site with /api/haven stubbed in the browser. Signed in, every list shows as a tab
 * with its count; the open one lists its items, ticks one off, takes a quick add and clears what's ticked. Signed out,
 * the counts only and never an item. Every item here is made up.
 */

const PORT = Number(process.env.E2E_LISTS_PORT ?? 5187);
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
const SETUP = { items: { pings: "done", app: "done", devices: "done", ruleset: "done", automerge: "done" }, pings: { vercel: "done", actions: "done" } };

type Item = { id: string; name: string; addedAt: string; source: string; done: boolean };
const at = "2026-11-04T18:00:00Z";
const item = (id: string, name: string, done = false): Item => ({ id, name, addedAt: at, source: "phone", done });

async function stub(page: Page, signedIn: boolean) {
  const lists: Record<string, { name: string; items: Item[] }> = {
    kitchen: { name: "Groceries", items: [item("k1", "oat milk"), item("k2", "lemons"), item("k3", "sourdough")] },
    buy: { name: "Things to buy", items: [item("b1", "phone charger"), item("b2", "AA batteries"), item("b3", "desk lamp", true)] },
  };
  let n = 10;
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: [] }));
  await page.route(`${BASE}/api/foundry-feed`, (r) => r.fulfill({ json: FEED }));
  await page.route((u) => u.pathname === "/api/foundry", (r) => r.fulfill({ json: new URL(r.request().url()).searchParams.has("setup") ? SETUP : { buttons: true, direct: true, shape: true, images: false } }));
  await page.route(`${BASE}/api/desk-auth`, (r) => r.fulfill({ json: signedIn ? { ready: true, signedIn: true, until: Date.now() + 30 * 60_000, hardUntil: Date.now() + 8 * 3_600_000, device: "Test device", devices: [] } : { ready: true, signedIn: false } }));
  await page.route(`${BASE}/api/today-todos**`, (r) => r.fulfill({ json: { state: { todos: [], marks: [] } } }));
  await page.route((u) => u.pathname === "/api/haven", async (r) => {
    const req = r.request();
    const view = new URL(req.url()).searchParams.get("view");
    if (req.method() === "GET" && view === "status")
      return r.fulfill({ json: { kitchen: { open: 3, done: 0 }, todos: 0, gym: null, meals: null, lists: Object.entries(lists).map(([id, l]) => ({ id, name: l.name, open: l.items.filter((i) => !i.done).length, done: l.items.filter((i) => i.done).length })), ready: true } });
    if (req.method() === "GET" && view === "lists") return signedIn ? r.fulfill({ json: { lists: Object.entries(lists).map(([id, l]) => ({ id, ...l })) } }) : r.fulfill({ status: 401, json: { error: "signed-out" } });
    if (req.method() !== "POST") return r.fulfill({ status: 400, json: { error: "bad-request" } });
    const body = req.postDataJSON() as { action: string; list?: string; id?: string; done?: boolean; text?: string };
    const l = lists[body.list ?? "kitchen"]!;
    if (body.action === "tick") l.items = l.items.map((i) => (i.id === body.id ? { ...i, done: Boolean(body.done) } : i));
    if (body.action === "remove") l.items = l.items.filter((i) => i.id !== body.id);
    if (body.action === "clear-done") l.items = l.items.filter((i) => !i.done);
    if (body.action === "list-add") {
      const added = String(body.text).split(/\s*,\s*/).filter(Boolean);
      l.items = [...l.items, ...added.map((name) => item(`n${n++}`, name))];
      return r.fulfill({ json: { ok: true, added, already: [], items: l.items } });
    }
    return r.fulfill({ json: { ok: true } });
  });
  return lists;
}

test("the Lists on Today: tabs with counts, tick, quick add and clear (signed in, a phone)", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 860 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const lists = await stub(page, true);
  await page.goto(BASE + "/");
  const box = page.getByRole("region", { name: "Lists" });
  await expect(box.getByRole("tab", { name: /Groceries/ })).toBeVisible();
  await box.getByRole("tab", { name: /Things to buy/ }).click();
  await expect(box.getByText("phone charger")).toBeVisible();
  await expect(box.getByRole("button", { name: "Clear ticked (1)" })).toBeVisible();

  await box.getByRole("checkbox", { name: "AA batteries" }).check();
  await expect.poll(() => lists.buy!.items.find((i) => i.id === "b2")?.done).toBe(true);
  await box.getByRole("textbox", { name: "Add to Things to buy" }).fill("usb-c cable");
  await box.getByRole("button", { name: "Add", exact: true }).click();
  await expect(box.getByText("usb-c cable")).toBeVisible();
  await box.getByRole("checkbox", { name: "AA batteries" }).uncheck();
  await expect.poll(() => lists.buy!.items.find((i) => i.id === "b2")?.done).toBe(false);

  if (SHOTS) {
    await box.evaluate((el) => ((el as HTMLElement).style.scrollMarginTop = "150px", el.scrollIntoView({ block: "start" })));
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/lists-phone.png` });
  }
  await box.getByRole("button", { name: "Clear ticked (1)" }).click();
  await expect(box.getByText("desk lamp")).toHaveCount(0);
  expect(lists.buy!.items.map((i) => i.name)).toEqual(["phone charger", "AA batteries", "usb-c cable"]);
  expect(errors).toEqual([]);
});

test("signed out, the Lists show counts and never an item", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stub(page, false);
  await page.goto(BASE + "/");
  const box = page.getByRole("region", { name: "Lists" });
  await expect(box.getByText("Things to buy")).toBeVisible();
  await expect(box).toContainText("Groceries 3");
  await expect(box.getByText("phone charger")).toHaveCount(0);
  await expect(box.getByRole("checkbox")).toHaveCount(0);
});
