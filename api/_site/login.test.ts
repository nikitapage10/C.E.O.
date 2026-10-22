import { afterEach, describe, expect, it } from "vitest";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import { gateRequest } from "./gate.ts";
import { SITE_COOKIE, siteSessionOf } from "./session.ts";
import { MemorySiteStore, forgetCachedState, siteKeys } from "./state.ts";
import { handleGet, handlePost, type LoginDeps } from "./login.ts";
import { siteRoute } from "../desk-auth.ts";
import { handleGet as passwordGet, handlePost as passwordPost, type PasswordDeps } from "./control.ts";

/**
 * The site password's sign-in and its Desk control (#236): the right password opens a 180-day session and the wrong
 * one says nothing more than "no"; tries are counted and slowed; only a passkey session on the Desk can set, change
 * or drop the password, and doing so never locks the Desk's own browser out.
 */

const ORIGIN = "https://ceo.test";
const DESK = "a test desk key, not a real one";
const PASSWORD = "correct horse battery staple";
const NOW = Date.parse("2026-10-22T04:00:00Z");
const env = { FOUNDRY_DESK_KEY: DESK };

afterEach(() => forgetCachedState());

function form(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/site-login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "x-real-ip": "203.0.113.9", ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

const json = (body: unknown, cookie?: string, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/site-password`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie && { cookie }), ...headers }, body: JSON.stringify(body) });

/** The Desk with no site password yet, and Nikita signed in to the Desk with a passkey. */
async function setup() {
  const site = new MemorySiteStore();
  const auth = new MemoryAuthStore();
  const desk = await signedInCookie(DESK, NOW, auth);
  const pw: PasswordDeps = { deskKey: DESK, store: auth, now: NOW, env, site };
  const login = (now = NOW): LoginDeps => ({ env, store: site, limits: auth, now });
  return { site, auth, desk, pw, login };
}

const cookieOf = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith(`${SITE_COOKIE}=`)) ?? "";
const pair = (line: string) => line.split(";")[0]!;

describe("setting the site password from the Desk (#236)", () => {
  it("needs a Desk passkey session; without one nothing is stored", async () => {
    const { site, pw } = await setup();
    expect((await passwordPost(json({ action: "set", password: PASSWORD }), pw)).status).toBe(401);
    expect((await passwordGet(new Request(`${ORIGIN}/api/site-password`), pw)).status).toBe(401);
    expect(site.record).toBeNull();
  });

  it("from another site is refused", async () => {
    const { site, pw, desk } = await setup();
    expect((await passwordPost(json({ action: "set", password: PASSWORD }, desk, { origin: "https://evil.example" }), pw)).status).toBe(403);
    expect(site.record).toBeNull();
  });

  it("stores only a salted hash, locks the site, and keeps this browser signed in", async () => {
    const { site, pw, desk } = await setup();
    const res = await passwordPost(json({ action: "set", password: PASSWORD }, desk), pw);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ on: true, source: "blob" });
    expect(JSON.stringify(site.record)).not.toContain(PASSWORD);
    expect(site.record?.hash).toMatch(/^pbkdf2-sha256\$600000\$/);
    const cookie = cookieOf(res);
    expect(cookie).toContain("HttpOnly; Secure; SameSite=Lax");
    // The new cookie opens the gate at once.
    expect((await gateRequest(new Request(`${ORIGIN}/`, { headers: { cookie: pair(cookie) } }), { env, store: site, now: NOW })).allow).toBe(true);
    expect((await gateRequest(new Request(`${ORIGIN}/`), { env, store: site, now: NOW })).allow).toBe(false);
  });

  it("refuses a short password", async () => {
    const { site, pw, desk } = await setup();
    const res = await passwordPost(json({ action: "set", password: "short" }, desk), pw);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "too-short" });
    expect(site.record).toBeNull();
  });

  it("changing it or signing out everywhere ends every other session, and turning it off opens the site", async () => {
    const { site, pw, desk, login } = await setup();
    await passwordPost(json({ action: "set", password: PASSWORD }, desk), pw);
    const other = pair(cookieOf(await handlePost(form({ password: PASSWORD, next: "/" }), login())));
    const opens = async (cookie: string) => (await gateRequest(new Request(`${ORIGIN}/api/world`, { headers: { cookie } }), { env, store: site, now: NOW + 10_000 })).allow;
    expect(await opens(other)).toBe(true);

    const out = await passwordPost(json({ action: "signout-all" }, desk), pw);
    forgetCachedState();
    expect(await opens(other)).toBe(false);
    expect(await opens(pair(cookieOf(out)))).toBe(true);

    const changed = await passwordPost(json({ action: "set", password: "a brand new passphrase" }, desk), pw);
    forgetCachedState();
    expect(await opens(pair(cookieOf(out)))).toBe(false);
    expect(await opens(pair(cookieOf(changed)))).toBe(true);
    expect((await handlePost(form({ password: PASSWORD }), login())).status).toBe(401);

    const off = await passwordPost(json({ action: "off" }, desk), pw);
    expect(await off.json()).toMatchObject({ on: false, source: "none" });
    forgetCachedState();
    expect(await opens("")).toBe(true);
  });
});

describe("signing in with the site password (#236)", () => {
  it("goes straight on while no password is set", async () => {
    const { login } = await setup();
    const res = await handleGet(new Request(`${ORIGIN}/api/site-login?next=/lattice`), login());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/lattice");
  });

  it("shows the login page once locked, and goes on when already signed in", async () => {
    const { pw, desk, login } = await setup();
    const set = await passwordPost(json({ action: "set", password: PASSWORD }, desk), pw);
    const page = await handleGet(new Request(`${ORIGIN}/api/site-login?next=/lattice`), login());
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('value="/lattice"');
    const again = await handleGet(new Request(`${ORIGIN}/api/site-login?next=/lattice`, { headers: { cookie: pair(cookieOf(set)) } }), login());
    expect(again.status).toBe(303);
  });

  it("opens a 180-day session on the right password and goes back where it was", async () => {
    const { pw, desk, login } = await setup();
    await passwordPost(json({ action: "set", password: PASSWORD }, desk), pw);
    const res = await handlePost(form({ password: PASSWORD, next: "/lattice" }), login());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/lattice");
    const cookie = cookieOf(res);
    expect(cookie).toMatch(/Max-Age=15552000$/);
    const keys = (await siteKeys(env))!;
    expect(siteSessionOf(keys.session, pair(cookie).split("=")[1], NOW)?.f).toEqual(["password"]);
  });

  it("never leaves the site after signing in", async () => {
    const { pw, desk, login } = await setup();
    await passwordPost(json({ action: "set", password: PASSWORD }, desk), pw);
    for (const next of ["//evil.example", "https://evil.example/", "/\\evil.example"]) {
      expect((await handlePost(form({ password: PASSWORD, next }), login())).headers.get("location")).toBe("/");
    }
  });

  it("says only 'no' to a wrong password, counts it, and slows down after five", async () => {
    const { pw, desk, login, auth } = await setup();
    await passwordPost(json({ action: "set", password: PASSWORD }, desk), pw);
    for (let i = 0; i < 5; i++) {
      const res = await handlePost(form({ password: `wrong ${i}` }), login(NOW + i));
      expect(res.status).toBe(401);
      const html = await res.text();
      expect(html).toContain("That didn’t open it.");
      expect(html).not.toContain(`wrong ${i}`);
    }
    const sixth = await handlePost(form({ password: "wrong 6" }), login(NOW + 10));
    expect(sixth.status).toBe(401);
    // Now that address waits, even with the right password.
    const locked = await handlePost(form({ password: PASSWORD }), login(NOW + 20));
    expect(locked.status).toBe(429);
    expect(locked.headers.get("retry-after")).toBeTruthy();
    // Another address is not held up.
    expect((await handlePost(form({ password: PASSWORD }, { "x-real-ip": "198.51.100.4" }), login(NOW + 30))).status).toBe(303);
    // The counters never hold the address itself.
    expect(JSON.stringify(await auth.limits())).not.toContain("203.0.113.9");
  });

  it("refuses a form from another site", async () => {
    const { pw, desk, login } = await setup();
    await passwordPost(json({ action: "set", password: PASSWORD }, desk), pw);
    expect((await handlePost(form({ password: PASSWORD }, { origin: "https://evil.example" }), login())).status).toBe(403);
  });

  it("works with only SITE_PASSWORD_HASH set in Vercel", async () => {
    const { hashPassword } = await import("./password.ts");
    const site = new MemorySiteStore();
    const envHash = { ...env, SITE_PASSWORD_HASH: await hashPassword(PASSWORD) };
    const res = await handlePost(form({ password: PASSWORD }), { env: envHash, store: site, limits: new MemoryAuthStore(), now: NOW });
    expect(res.status).toBe(303);
    expect((await gateRequest(new Request(`${ORIGIN}/`, { headers: { cookie: pair(cookieOf(res)) } }), { env: envHash, store: site, now: NOW })).allow).toBe(true);
  });

  it("signs this browser out", async () => {
    const { login } = await setup();
    const res = await handlePost(form({ action: "signout" }), login());
    expect(cookieOf(res)).toMatch(/Max-Age=0$/);
  });
});

describe("the routes on Vercel (#236)", () => {
  it("reach the site password's handlers through the Desk's sign-in function, by vercel.json's rewrites", () => {
    expect(siteRoute(new Request(`${ORIGIN}/api/desk-auth?site=login&next=/`))).toBe("login");
    expect(siteRoute(new Request(`${ORIGIN}/api/desk-auth?site=password`))).toBe("password");
    expect(siteRoute(new Request(`${ORIGIN}/api/site-login`))).toBe("login");
    expect(siteRoute(new Request(`${ORIGIN}/api/desk-auth`))).toBeNull();
  });
});
