import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { MemoryAuthStore } from "../../api/_desk/store.ts";
import { gateRequest } from "../../api/_site/gate.ts";
import { hashPassword } from "../../api/_site/password.ts";
import { MemorySiteStore } from "../../api/_site/state.ts";
import { handleGet, handlePost } from "../../api/_site/login.ts";
import { startDistServer } from "./dist-server.ts";

/**
 * The site password with the gate ON (#236): the built site served with the same gate Vercel's middleware runs
 * (api/_site/gate.ts) and the real login function in front, a password already set. A browser with no session gets
 * the login page for the Desk and the Lattice and a 401 from the API; a wrong password gets one plain line; the right
 * one comes back to the page asked for, signed in, and stays signed in. (boot-check and the other browser tests run
 * with no password, so the gate is off for them.)
 */

const PORT = Number(process.env.E2E_GATE_PORT ?? 5186);
const BASE = `http://localhost:${PORT}`;
const PASSWORD = "correct horse battery staple";
const BYPASS = "a-test-bypass-token-that-is-long-enough-0123456789";
const env = { FOUNDRY_DESK_KEY: "an e2e desk key, not a real one", SITE_BYPASS_TOKEN: BYPASS };
let server: Server;

test.beforeAll(async () => {
  const dist = fileURLToPath(new URL("../../apps/world/dist/index.html", import.meta.url));
  if (!existsSync(dist)) execSync("npm run build", { cwd: fileURLToPath(new URL("../..", import.meta.url)), stdio: "ignore" });
  const store = new MemorySiteStore();
  store.record = { v: 1, sv: "e2e-version", hash: await hashPassword(PASSWORD) };
  const limits = new MemoryAuthStore();
  server = await startDistServer(PORT, async (request) => {
    const path = new URL(request.url).pathname;
    // The login function, as Vercel would route /api/site-login (the gate always lets it through).
    if (path === "/api/site-login") {
      const deps = { env, store, limits, now: Date.now() };
      return request.method === "POST" ? handlePost(request, deps) : handleGet(request, deps);
    }
    const d = await gateRequest(request, { env, store, now: Date.now() });
    if (!d.allow) return d.response;
    return new Response(null, { headers: { "x-middleware-next": "1", ...(d.setCookie && { "Set-Cookie": d.setCookie }) } });
  });
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

test("the site password locks the Desk, the Lattice and the API until the password is typed once", async ({ page, request }) => {
  // The API: 401, marked locked; with the workflows' bypass it carries on (no functions here, so the file server's 404).
  const api = await request.get(`${BASE}/api/world`);
  expect(api.status()).toBe(401);
  expect(api.headers()["x-ceo-site-gate"]).toBe("locked");
  expect((await request.get(`${BASE}/api/world`, { headers: { "x-ceo-site-bypass": BYPASS } })).status()).toBe(404);
  // The PWA's files stay reachable.
  expect((await request.get(`${BASE}/manifest.webmanifest`)).status()).toBe(200);

  // A page: the login page, no Desk.
  const first = await page.goto(`${BASE}/lattice`);
  expect(first?.status()).toBe(401);
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.locator(".desk__tabs")).toHaveCount(0);

  // A wrong password: one plain line, still locked.
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("status")).toHaveText("That didn’t open it. Try again.");

  // The right one: back to the page asked for, the Lattice.
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${BASE}/lattice`);
  const cookie = (await page.context().cookies()).find((c) => c.name === "__Host-ceo-site");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  expect(cookie && cookie.expires * 1000 - Date.now()).toBeGreaterThan(179 * 24 * 3600 * 1000);

  // Signed in: the Desk loads, and stays open on the next visit.
  await page.goto(`${BASE}/`);
  await expect(page.locator(".desk__tabs")).toBeVisible({ timeout: 30_000 });
  expect((await page.request.get(`${BASE}/api/world`)).status()).toBe(404);
});
