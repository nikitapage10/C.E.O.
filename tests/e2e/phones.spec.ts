import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";

/**
 * Hey Skippy's Phones panel (#627) on the built site, Boiler Room > Security, with /api/haven stubbed in the browser:
 * signed out it isn't there; signed in, "Add a phone" shows the new key once with Copy, the list shows when each phone
 * was last used, and Revoke stops one. The key here is made up.
 */

const PORT = Number(process.env.E2E_PHONES_PORT ?? 5189);
const SHOTS = process.env.E2E_SHOTS ?? "";
const BASE = `http://localhost:${PORT}`;
let server: Server;

test.beforeAll(async () => {
  const dist = fileURLToPath(new URL("../../apps/world/dist/index.html", import.meta.url));
  if (!existsSync(dist)) execSync("npm run build", { cwd: fileURLToPath(new URL("../..", import.meta.url)), stdio: "ignore" });
  server = await startDistServer(PORT);
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

const FAKE_KEY = `skp_${"t".repeat(43)}`;

async function stub(page: Page, signedIn: boolean) {
  const now = Date.now();
  const phones: { id: string; label: string; created: string; lastUsed: string | null; revoked: string | null }[] = [{ id: "aaaaaaaaaaaa", label: "Old phone", created: new Date(now - 86_400_000).toISOString(), lastUsed: new Date(now - 3_600_000).toISOString(), revoked: null }];
  const posts: Record<string, unknown>[] = [];
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: [] }));
  await page.route(`${BASE}/api/foundry-feed`, (r) => r.fulfill({ json: { issues: [], runs: { workflow_runs: [] }, e2e: { workflow_runs: [] }, pulls: [], commits: [] } }));
  await page.route(`${BASE}/api/desk-auth`, (r) => r.fulfill({ json: signedIn ? { ready: true, signedIn: true, until: now + 30 * 60_000, hardUntil: now + 8 * 3_600_000, device: "Test device", devices: [] } : { ready: true, signedIn: false } }));
  await page.route(`${BASE}/api/keys`, (r) => r.fulfill({ json: { vault: "ok", stepUpSeconds: 120, keys: [] } }));
  await page.route(/\/api\/haven(\?.*)?$/, async (r) => {
    const url = new URL(r.request().url());
    if (r.request().method() === "GET") {
      if (url.searchParams.get("view") === "status") return r.fulfill({ json: { kitchen: { open: 2, done: 0 }, todos: 0, ready: true } });
      if (!signedIn) return r.fulfill({ status: 401, json: { error: "signed-out" } });
      if (url.searchParams.get("view") === "list") return r.fulfill({ json: { items: [] } });
      return r.fulfill({ json: { phones, greetings: { made: null, clips: 0 }, voice: true } });
    }
    const body = r.request().postDataJSON() as Record<string, unknown>;
    posts.push(body);
    if (body.action === "add-phone") {
      const phone = { id: "bbbbbbbbbbbb", label: String(body.label), created: new Date().toISOString(), lastUsed: null, revoked: null };
      phones.push(phone);
      return r.fulfill({ json: { phone, key: FAKE_KEY } });
    }
    if (body.action === "revoke-phone") {
      const p = phones.find((x) => x.id === body.id);
      if (p) p.revoked = new Date().toISOString();
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({ status: 400, json: { error: "bad-request" } });
  });
  return posts;
}

test("the Phones panel isn't there signed out", async ({ page }) => {
  await stub(page, false);
  await page.goto(`${BASE}/boiler/security`);
  await expect(page.getByRole("heading", { name: "Set a key, never see one" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Phones" })).toHaveCount(0);
});

test("signed in: add a phone shows its key once, with Copy; Revoke stops one", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const posts = await stub(page, true);
  await page.goto(`${BASE}/boiler/security`);
  const panel = page.getByRole("region", { name: "Phones" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Old phone")).toBeVisible();
  await expect(panel.getByText(/Last used 1 h ago/)).toBeVisible();

  await panel.getByPlaceholder("iPhone 17").fill("iPhone 17");
  await panel.getByRole("button", { name: "Add a phone" }).click();
  const keyBox = panel.getByLabel("The new phone key");
  await expect(keyBox).toHaveValue(FAKE_KEY);
  if (SHOTS) await panel.screenshot({ path: `${SHOTS}/phones-new-key.png` });
  await panel.getByRole("button", { name: "Copy" }).click();
  await expect(panel.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(FAKE_KEY);
  await panel.getByRole("button", { name: "Done" }).click();
  // Gone once dismissed: the Desk never shows it again.
  await expect(keyBox).toHaveCount(0);
  await expect(page.getByText(FAKE_KEY)).toHaveCount(0);
  await expect(panel.getByText("Not used yet")).toBeVisible();

  await panel.getByRole("button", { name: "Revoke Old phone" }).click();
  await expect(panel.getByText(/Revoked\. That phone's key opens nothing now\./)).toBeVisible();
  if (SHOTS) await panel.screenshot({ path: `${SHOTS}/phones-list.png` });
  expect(posts).toEqual([
    { action: "add-phone", label: "iPhone 17" },
    { action: "revoke-phone", id: "aaaaaaaaaaaa" },
  ]);
});

test("signed in, Today's Kitchen list chip opens the list and ticks things off", async ({ page }) => {
  await stub(page, true);
  const ticks: Record<string, unknown>[] = [];
  await page.route(/\/api\/haven(\?.*)?$/, async (r) => {
    if (r.request().method() === "POST") {
      ticks.push(r.request().postDataJSON() as Record<string, unknown>);
      return r.fulfill({ json: { ok: true } });
    }
    const view = new URL(r.request().url()).searchParams.get("view");
    if (view === "list") return r.fulfill({ json: { items: [{ id: "i1", name: "garlic", addedAt: new Date().toISOString(), source: "phone", done: false }, { id: "i2", name: "lemons", addedAt: new Date().toISOString(), source: "phone", done: false }] } });
    return r.fulfill({ json: { kitchen: { open: 2, done: 0 }, todos: 0, ready: true } });
  });
  await page.goto(`${BASE}/`);
  const chip = page.getByRole("button", { name: /Kitchen list/ });
  await expect(chip).toContainText("2 to get");
  await chip.click();
  await page.getByRole("checkbox", { name: "garlic" }).check();
  await expect(chip).toContainText("1 to get");
  if (SHOTS) await page.locator(".kl").screenshot({ path: `${SHOTS}/kitchen-list.png` });
  expect(ticks).toEqual([{ action: "tick", id: "i1", done: true }]);
});
