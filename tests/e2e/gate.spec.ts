import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { MemoryAuthStore } from "../../api/_desk/store.ts";
import { handleGet as deskGet, handlePost as deskPost } from "../../api/desk-auth.ts";
import { gateRequest } from "../../api/_site/gate.ts";
import { MemorySiteStore } from "../../api/_site/state.ts";
import { handleGet, handlePost } from "../../api/_site/login.ts";
import { startDistServer } from "./dist-server.ts";

/**
 * The site lock with the gate ON (#236, #238): the built site served with the same gate Vercel's middleware runs
 * (api/_site/gate.ts), the real login function and the real Desk sign-in (api/desk-auth.ts) in front, the site
 * locked with the Desk passkey and no device enrolled yet. Chromium's virtual authenticator (WebAuthn over CDP)
 * stands in for the device's own passkey store. A browser with no session gets the login page for the Desk and the
 * Lattice and a 401 from the API; there is no password field; a new device adds itself with the Desk key, comes back
 * to the page asked for signed in, and later signs in with its passkey in one tap. (boot-check and the other browser
 * tests run unlocked, so the gate is off for them.)
 */

const PORT = Number(process.env.E2E_GATE_PORT ?? 5186);
const BASE = `http://localhost:${PORT}`;
const DESK_KEY = "an e2e desk key, not a real one";
const BYPASS = "a-test-bypass-token-that-is-long-enough-0123456789";
const env = { FOUNDRY_DESK_KEY: DESK_KEY, SITE_BYPASS_TOKEN: BYPASS };
let server: Server;

test.beforeAll(async () => {
  const dist = fileURLToPath(new URL("../../apps/world/dist/index.html", import.meta.url));
  if (!existsSync(dist)) execSync("npm run build", { cwd: fileURLToPath(new URL("../..", import.meta.url)), stdio: "ignore" });
  const site = new MemorySiteStore();
  site.record = { v: 1, passkey: true, locked: "2026-10-22T04:00:00.000Z", sv: "e2e-version" };
  const auth = new MemoryAuthStore();
  server = await startDistServer(PORT, async (request) => {
    const url = new URL(request.url);
    const now = Date.now();
    // The gate first, as Vercel's middleware runs before any function.
    const d = await gateRequest(request, { env, store: site, now });
    if (!d.allow) return d.response;
    // The login function, as Vercel routes /api/site-login.
    if (url.pathname === "/api/site-login") {
      const deps = { env, store: site, now };
      return request.method === "POST" ? handlePost(request, deps) : handleGet(request, deps);
    }
    // The Desk's sign-in function: the passkey ceremony the login page uses.
    if (url.pathname === "/api/desk-auth") {
      const deps = { deskKey: DESK_KEY, store: auth, now, env, site };
      return request.method === "POST" ? deskPost(request, deps) : deskGet(request, deps);
    }
    return new Response(null, { headers: { "x-middleware-next": "1", ...(d.setCookie && { "Set-Cookie": d.setCookie }) } });
  });
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

test("the passkey locks the Desk, the Lattice and the API; a new device adds itself, then signs in with one tap", async ({ page, request }) => {
  // A virtual platform authenticator: discoverable passkeys, the device's own unlock always passes.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  // The API: 401, marked locked; with the workflows' bypass it carries on (no functions here, so the file server's 404).
  const api = await request.get(`${BASE}/api/world`);
  expect(api.status()).toBe(401);
  expect(api.headers()["x-ceo-site-gate"]).toBe("locked");
  expect((await request.get(`${BASE}/api/world`, { headers: { "x-ceo-site-bypass": BYPASS } })).status()).toBe(404);
  expect((await request.get(`${BASE}/manifest.webmanifest`)).status()).toBe(200);

  // A page: the login page with the passkey, no password, no Desk.
  const first = await page.goto(`${BASE}/lattice`);
  expect(first?.status()).toBe(401);
  await expect(page.getByRole("button", { name: "Sign in with passkey" })).toBeVisible();
  await expect(page.locator('input[name="password"]')).toHaveCount(0);
  await expect(page.locator(".desk__tabs")).toHaveCount(0);

  // A new device: the wrong Desk key is refused, the right one makes a passkey and comes back to the Lattice.
  await page.getByText("New device with no passkey? Add it").click();
  await page.getByLabel("Desk key").fill("not the desk key");
  await page.getByRole("button", { name: "Add this device" }).click();
  await expect(page.getByRole("status")).toHaveText("That isn’t the Desk key.");
  await page.getByLabel("Desk key").fill(DESK_KEY);
  await page.getByLabel("This device’s name").fill("E2E laptop");
  const enrolled = page.waitForResponse((r) => r.url() === `${BASE}/api/desk-auth` && r.request().postDataJSON()?.action === "enrol");
  await page.getByRole("button", { name: "Add this device" }).click();
  expect((await enrolled).status()).toBe(200);
  // The login page is served at the address asked for, so it goes back to the same one: the login page is gone.
  await expect(page.getByRole("button", { name: "Sign in with passkey" })).toHaveCount(0, { timeout: 30_000 });
  expect(page.url()).toBe(`${BASE}/lattice`);
  const cookie = (await page.context().cookies()).find((c) => c.name === "__Host-ceo-site");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  expect(cookie && cookie.expires * 1000 - Date.now()).toBeGreaterThan(179 * 24 * 3600 * 1000);
  expect((await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials).toHaveLength(1);

  // Signed out of the site on this browser: the passkey alone brings it back, in one tap.
  await page.context().clearCookies();
  expect((await page.goto(`${BASE}/`))?.status()).toBe(401);
  const signedIn = page.waitForResponse((r) => r.url() === `${BASE}/api/desk-auth` && r.request().postDataJSON()?.action === "signin");
  await page.getByRole("button", { name: "Sign in with passkey" }).click();
  expect((await signedIn).status()).toBe(200);
  await expect(page.locator(".desk__tabs")).toBeVisible({ timeout: 30_000 });
  expect(page.url()).toBe(`${BASE}/`);
  expect((await page.request.get(`${BASE}/api/world`)).status()).toBe(404);
});
