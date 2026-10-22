import { afterEach, describe, expect, it } from "vitest";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import { gateRequest } from "./gate.ts";
import { SITE_COOKIE, siteSessionOf } from "./session.ts";
import { MemorySiteStore, forgetCachedState, siteKeys } from "./state.ts";
import { handleGet, handlePost, passkeySiteCookie, type LoginDeps } from "./login.ts";
import { siteRoute } from "../desk-auth.ts";
import { handleGet as lockGet, handlePost as lockPost, type PasswordDeps } from "./control.ts";

/**
 * The site lock's login and its Desk control (#236, #238): only a passkey session on the Desk can lock, sign out
 * everywhere or unlock, and doing so never locks the Desk's own browser out. The login page offers the passkey and
 * nothing else: there is no password to post. (The passkey ceremony itself, and the site cookie it sets, are tested
 * end to end with a software passkey in api/desk-auth.test.ts.)
 */

const ORIGIN = "https://ceo.test";
const DESK = "a test desk key, not a real one";
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

/** The Desk with the site unlocked, and Nikita signed in to the Desk with a passkey. */
async function setup() {
  const site = new MemorySiteStore();
  const auth = new MemoryAuthStore();
  const desk = await signedInCookie(DESK, NOW, auth);
  const lock: PasswordDeps = { deskKey: DESK, store: auth, now: NOW, env, site };
  const login = (now = NOW): LoginDeps => ({ env, store: site, now });
  return { site, auth, desk, lock, login };
}

const cookieOf = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith(`${SITE_COOKIE}=`)) ?? "";
const pair = (line: string) => line.split(";")[0]!;
const opens = async (site: MemorySiteStore, cookie: string) => (await gateRequest(new Request(`${ORIGIN}/lattice`, { headers: { cookie } }), { env, store: site, now: NOW + 10_000 })).allow;

describe("locking the site from the Desk (#236, #238)", () => {
  it("needs a Desk passkey session; without one nothing is stored", async () => {
    const { site, lock } = await setup();
    expect((await lockPost(json({ action: "lock" }), lock)).status).toBe(401);
    expect((await lockGet(new Request(`${ORIGIN}/api/site-password`), lock)).status).toBe(401);
    expect(site.record).toBeNull();
  });

  it("from another site is refused", async () => {
    const { site, lock, desk } = await setup();
    expect((await lockPost(json({ action: "lock" }, desk, { origin: "https://evil.example" }), lock)).status).toBe(403);
    expect(site.record).toBeNull();
  });

  it("locks with the passkey and no password, and keeps this browser in", async () => {
    const { site, lock, desk } = await setup();
    const res = await lockPost(json({ action: "lock" }, desk), lock);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ on: true, source: "blob", locked: new Date(NOW).toISOString(), second: false });
    expect(Object.keys(site.record!).sort()).toEqual(["locked", "passkey", "sv", "v"]);
    const cookie = cookieOf(res);
    expect(cookie).toContain("HttpOnly; Secure; SameSite=Lax");
    expect(siteSessionOf((await siteKeys(env))!.session, pair(cookie).split("=")[1], NOW)?.f).toEqual(["passkey"]);
    forgetCachedState();
    expect(await opens(site, "")).toBe(false);
    expect(await opens(site, pair(cookie))).toBe(true);
  });

  it("has no password to set any more", async () => {
    const { site, lock, desk } = await setup();
    for (const action of ["set", "drop-password", "nope"]) {
      expect((await lockPost(json({ action, password: "correct horse battery staple" }, desk), lock)).status).toBe(400);
    }
    expect(site.record).toBeNull();
  });

  it("signing out everywhere ends every other session, and unlocking opens the site", async () => {
    const { site, lock, desk } = await setup();
    const first = await lockPost(json({ action: "lock" }, desk), lock);
    const other = pair((await passkeySiteCookie(env, site, NOW))!);
    forgetCachedState();
    expect(await opens(site, other)).toBe(true);

    const out = await lockPost(json({ action: "signout-all" }, desk), lock);
    forgetCachedState();
    expect(await opens(site, other)).toBe(false);
    expect(await opens(site, pair(cookieOf(first)))).toBe(false);
    expect(await opens(site, pair(cookieOf(out)))).toBe(true);

    const off = await lockPost(json({ action: "off" }, desk), lock);
    expect(await off.json()).toMatchObject({ on: false, source: "none" });
    expect(site.record?.passkey).toBeUndefined();
    forgetCachedState();
    expect(await opens(site, "")).toBe(true);
    // Signing out everywhere while unlocked: nothing to do.
    expect((await lockPost(json({ action: "signout-all" }, desk), lock)).status).toBe(409);
  });

  it("reads a lock set by #236 (a password's hash) as locked with the passkey, and drops the hash at the next write", async () => {
    const { site, lock, desk } = await setup();
    site.record = { v: 1, sv: "old-version-1", hash: "pbkdf2-sha256$600000$salt$hash", set: "2026-10-22T00:00:00.000Z" } as never;
    const status = await lockGet(new Request(`${ORIGIN}/api/site-password`, { headers: { cookie: desk } }), lock);
    expect(await status.json()).toMatchObject({ on: true, source: "blob" });
    await lockPost(json({ action: "signout-all" }, desk), lock);
    expect(JSON.stringify(site.record)).not.toContain("hash");
  });
});

describe("the login page (#236, #238)", () => {
  it("goes straight on while the site isn't locked", async () => {
    const { login } = await setup();
    const res = await handleGet(new Request(`${ORIGIN}/api/site-login?next=/lattice`), login());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/lattice");
  });

  it("offers the passkey and adding a device, no password, and goes on when already signed in", async () => {
    const { lock, desk, login } = await setup();
    const locked = await lockPost(json({ action: "lock" }, desk), lock);
    const page = await handleGet(new Request(`${ORIGIN}/api/site-login?next=/lattice`), login());
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('data-next="/lattice"');
    expect(html).toContain("Sign in with passkey");
    expect(html).toContain("Add this device");
    expect(html).not.toContain('name="password"');
    const again = await handleGet(new Request(`${ORIGIN}/api/site-login?next=/lattice`, { headers: { cookie: pair(cookieOf(locked)) } }), login());
    expect(again.status).toBe(303);
    expect(again.headers.get("location")).toBe("/lattice");
  });

  it("serves the page's script from this site", async () => {
    const { login } = await setup();
    const res = await handleGet(new Request(`${ORIGIN}/api/site-login?part=script`), login());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toContain("navigator.credentials.get");
  });

  it("takes no password: a posted one opens nothing", async () => {
    const { site, lock, desk, login } = await setup();
    await lockPost(json({ action: "lock" }, desk), lock);
    const res = await handlePost(form({ password: "anything at all", next: "/" }), login());
    expect(res.status).toBe(400);
    expect(cookieOf(res)).toBe("");
    forgetCachedState();
    expect(await opens(site, "")).toBe(false);
  });

  it("refuses a form from another site, and signs this browser out", async () => {
    const { login } = await setup();
    expect((await handlePost(form({ action: "signout" }, { origin: "https://evil.example" }), login())).status).toBe(403);
    const res = await handlePost(form({ action: "signout" }), login());
    expect(cookieOf(res)).toMatch(/Max-Age=0$/);
    expect(await res.text()).toContain("Signed out on this device.");
  });

  it("the passkey's site cookie: 180 days, only while locked", async () => {
    const { site, lock, desk } = await setup();
    expect(await passkeySiteCookie(env, site, NOW)).toBeNull();
    await lockPost(json({ action: "lock" }, desk), lock);
    expect(await passkeySiteCookie(env, site, NOW)).toMatch(/Max-Age=15552000$/);
    expect(await passkeySiteCookie({ ...env, SITE_GATE: "off" }, site, NOW)).toBeNull();
    site.fail = true;
    expect(await passkeySiteCookie(env, site, NOW)).toBeNull();
  });
});

describe("the routes on Vercel (#236)", () => {
  it("reach the site lock's handlers through the Desk's sign-in function, by vercel.json's rewrites", () => {
    expect(siteRoute(new Request(`${ORIGIN}/api/desk-auth?site=login&next=/`))).toBe("login");
    expect(siteRoute(new Request(`${ORIGIN}/api/desk-auth?site=password`))).toBe("password");
    expect(siteRoute(new Request(`${ORIGIN}/api/site-login`))).toBe("login");
    expect(siteRoute(new Request(`${ORIGIN}/api/desk-auth`))).toBeNull();
  });
});
