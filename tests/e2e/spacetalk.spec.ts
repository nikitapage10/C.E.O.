import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { startDistServer } from "./dist-server.ts";

/**
 * Hold Space to talk on the Desk (#905), on the built site, signed out. Space never scrolls a Desk page: a tap does
 * nothing at all, and a hold shows a short hint to sign in instead of failing silently. Space typed into a field still
 * types.
 */

const PORT = Number(process.env.E2E_SPACE_PORT ?? 5197);
const BASE = `http://localhost:${PORT}`;
let server: Server;

test.beforeAll(async () => {
  const dist = fileURLToPath(new URL("../../apps/world/dist/index.html", import.meta.url));
  if (!existsSync(dist)) execSync("npm run build", { cwd: fileURLToPath(new URL("../..", import.meta.url)), stdio: "ignore" });
  server = await startDistServer(PORT);
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

test("Space on a Desk page never scrolls; a hold signed out says to sign in", async ({ page }) => {
  await page.route("https://api.github.com/**", (r) => r.fulfill({ json: [] }));
  await page.route(`${BASE}/api/desk-auth`, (r) => r.fulfill({ json: { ready: true, signedIn: false } }));
  await page.route(`${BASE}/api/foundry-feed`, (r) => r.fulfill({ json: { issues: [], runs: { workflow_runs: [] }, e2e: { workflow_runs: [] }, pulls: [], commits: [] } }));
  await page.goto(`${BASE}/boiler`);
  await expect(page.locator(".vdock__ask")).toBeVisible();
  await page.waitForLoadState("networkidle");
  // Room to scroll, whatever the page's own length.
  await page.evaluate(() => {
    const pad = document.createElement("div");
    pad.style.height = "4000px";
    document.body.append(pad);
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });

  // A tap: nothing, no scroll.
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator(".vdock__hold")).toHaveCount(0);

  // A hold: the sign-in hint, still no scroll.
  await page.keyboard.down("Space");
  await page.waitForTimeout(600);
  await page.keyboard.up("Space");
  await expect(page.locator(".vdock__hold.is-hint")).toContainText("Sign in");
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // In a field, Space types.
  await page.evaluate(() => {
    const i = document.createElement("input");
    i.id = "space-field";
    document.body.prepend(i);
  });
  await page.locator("#space-field").focus();
  await page.keyboard.type("a b");
  await expect(page.locator("#space-field")).toHaveValue("a b");
});
