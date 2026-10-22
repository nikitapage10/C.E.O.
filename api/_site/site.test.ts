import { afterEach, describe, expect, it } from "vitest";
import { signToken } from "../_desk/session.ts";
import { BYPASS_HEADER, GATE_HEADER, decide, gateRequest, isStaticPath, secretMatches, withGate, type GateContext } from "./gate.ts";
import { loginPage, safeNext } from "./page.ts";
import { ITERATIONS, hashPassword, parseHash, passwordProblem, verifyPassword } from "./password.ts";
import { RENEW_AFTER_S, SITE_COOKIE, SITE_SESSION_S, newSiteSession, renewedSite, sessionFits, siteCookie, siteSessionOf } from "./session.ts";
import { MemorySiteStore, STATE_TTL_MS, currentState, forgetCachedState, readRecord, siteKeys, stateOf, type SiteKeys, type SiteRecord } from "./state.ts";

/**
 * The site password (#236): the hash, the session cookie, and the gate in front of every page and API route, with
 * every exemption a machine caller relies on.
 */

const NOW = Date.parse("2026-10-22T04:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ORIGIN = "https://ceo.test";
const DESK = "a test desk key, not a real one";
const BYPASS = "a-test-bypass-token-that-is-long-enough-0123456789";
const PINGS = "a test pings secret, not a real one";
const PASSWORD = "correct horse battery staple";

let hash = "";
const record = async (over: Partial<SiteRecord> = {}): Promise<SiteRecord> => {
  hash ||= await hashPassword(PASSWORD);
  return { v: 1, hash, sv: "version-one", set: "2026-10-22T00:00:00.000Z", ...over };
};
const keys = async (env: Record<string, string> = { FOUNDRY_DESK_KEY: DESK }) => (await siteKeys(env))!;

function req(path: string, init: RequestInit & { cookie?: string } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

async function ctx(over: Partial<GateContext> = {}): Promise<GateContext> {
  return {
    state: stateOf(await record(), {}),
    keys: await keys(),
    env: { FOUNDRY_DESK_KEY: DESK, SITE_BYPASS_TOKEN: BYPASS, DESK_PINGS_SECRET: PINGS },
    now: NOW,
    ...over,
  };
}

const cookieFor = (k: SiteKeys, sv = "version-one", now = NOW, f: Array<"password" | "passkey"> = ["password"]) => `${SITE_COOKIE}=${signToken(k.session, newSiteSession(sv, now, f))}`;

afterEach(() => forgetCachedState());

describe("the password's hash (#236)", () => {
  it("is PBKDF2-SHA256 with 600,000 iterations and a fresh salt, never the password", async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).toMatch(/^pbkdf2-sha256\$600000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain(PASSWORD);
    expect(parseHash(a)?.iterations).toBe(ITERATIONS);
  });

  it("matches the password exactly, and nothing else", async () => {
    const stored = await hashPassword(PASSWORD);
    expect(await verifyPassword(PASSWORD, stored)).toBe(true);
    for (const wrong of ["", PASSWORD.toUpperCase(), `${PASSWORD} `, PASSWORD.slice(1), undefined, 42, null, "x".repeat(300)]) expect(await verifyPassword(wrong, stored)).toBe(false);
  });

  it("refuses a malformed or weak stored hash, so SITE_PASSWORD_HASH can't lower the bar", async () => {
    const weak = await hashPassword(PASSWORD, 1000);
    expect(parseHash(weak)).toBeNull();
    expect(await verifyPassword(PASSWORD, weak)).toBe(false);
    for (const bad of ["", "plain", "pbkdf2-sha256$600000$short$short", "sha1$600000$a$b", null, 7]) expect(parseHash(bad)).toBeNull();
  });

  it("asks for at least 10 characters", () => {
    expect(passwordProblem("short")).toBe("too-short");
    expect(passwordProblem(" ".repeat(12))).toBe("blank");
    expect(passwordProblem("x".repeat(257))).toBe("too-long");
    expect(passwordProblem(undefined)).toBe("missing");
    expect(passwordProblem(PASSWORD)).toBeNull();
  });
});

describe("the site session cookie (#236)", () => {
  it("is signed, HttpOnly, Secure, SameSite=Lax and lasts 180 days", async () => {
    const k = await keys();
    const line = siteCookie(k.session, newSiteSession("v1abcdefg", NOW), NOW);
    expect(line).toMatch(new RegExp(`^${SITE_COOKIE}=[^;]+; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SITE_SESSION_S}$`));
    const token = line.split(";")[0]!.split("=")[1]!;
    expect(siteSessionOf(k.session, token, NOW)).toEqual({ t: "site", v: "v1abcdefg", s: NOW / 1000, e: NOW / 1000 + SITE_SESSION_S, f: ["password"] });
  });

  it("refuses a changed token, another key's, an expired one and one from the Desk's own sessions", async () => {
    const k = await keys();
    const token = signToken(k.session, newSiteSession("v1abcdefg", NOW));
    const [body, sig] = token.split(".") as [string, string];
    const longer = Buffer.from(JSON.stringify({ t: "site", v: "v1abcdefg", s: NOW / 1000, e: NOW / 1000 + 10 * SITE_SESSION_S, f: ["password"] })).toString("base64url");
    for (const bad of [`${longer}.${sig}`, `${body}.${"A".repeat(43)}`, body, "", null]) expect(siteSessionOf(k.session, bad, NOW)).toBeNull();
    expect(siteSessionOf((await keys({ FOUNDRY_DESK_KEY: "another key" })).session, token, NOW)).toBeNull();
    expect(siteSessionOf(k.session, token, NOW + SITE_SESSION_S * 1000 + 1000)).toBeNull();
    expect(siteSessionOf(k.session, signToken(k.session, { t: "session", c: "x", s: NOW / 1000, e: NOW / 1000 + 60 }), NOW)).toBeNull();
    // Signed with too long a life, even by us: refused.
    expect(siteSessionOf(k.session, signToken(k.session, { t: "site", v: "v", s: NOW / 1000, e: NOW / 1000 + 2 * SITE_SESSION_S, f: ["password"] }), NOW)).toBeNull();
  });

  it("slides: renewed after a day of use, for another 180 days, and not before", () => {
    const s = newSiteSession("v1abcdefg", NOW);
    expect(renewedSite(s, NOW + 60_000)).toBeNull();
    const later = NOW + RENEW_AFTER_S * 1000 + 1000;
    expect(renewedSite(s, later)?.e).toBe(Math.floor(later / 1000) + SITE_SESSION_S);
    expect(renewedSite(s, later)?.s).toBe(s.s);
  });

  it("fits only the current version, with every factor the state asks for (the 2FA hook)", () => {
    const s = newSiteSession("v1abcdefg", NOW);
    expect(sessionFits(s, { sv: "v1abcdefg", factors: ["password"] })).toBe(true);
    expect(sessionFits(s, { sv: "v2abcdefg", factors: ["password"] })).toBe(false);
    expect(sessionFits(s, { sv: "v1abcdefg", factors: ["password", "passkey"] })).toBe(false);
    expect(sessionFits(newSiteSession("v1abcdefg", NOW, ["password", "passkey"]), { sv: "v1abcdefg", factors: ["password", "passkey"] })).toBe(true);
    expect(sessionFits(null, { sv: "v1abcdefg", factors: ["password"] })).toBe(false);
  });

  it("keys come from SITE_SESSION_SECRET when set, else from the Desk key, else none", async () => {
    const fromDesk = await keys();
    const fromSecret = await keys({ SITE_SESSION_SECRET: "s".repeat(40), FOUNDRY_DESK_KEY: DESK });
    expect(fromDesk.session.equals(fromSecret.session)).toBe(false);
    expect(fromDesk.session.equals(fromDesk.client)).toBe(false);
    // Too short a secret is ignored: the Desk key's keys are used.
    expect((await keys({ SITE_SESSION_SECRET: "short", FOUNDRY_DESK_KEY: DESK })).session.equals(fromDesk.session)).toBe(true);
    expect(siteKeys({})).toBeNull();
  });
});

describe("the gate's state (#236)", () => {
  it("is off until a password is set, on with a stored hash or SITE_PASSWORD_HASH, and off with SITE_GATE=off", async () => {
    expect(stateOf(null, {}).on).toBe(false);
    expect(stateOf({ v: 1, sv: "only-a-version" }, {}).on).toBe(false);
    const r = await record();
    expect(stateOf(r, {})).toMatchObject({ on: true, source: "blob", sv: "version-one", factors: ["password"] });
    expect(stateOf(null, { SITE_PASSWORD_HASH: r.hash })).toMatchObject({ on: true, source: "env" });
    expect(stateOf(null, { SITE_PASSWORD_HASH: "not a hash" }).on).toBe(false);
    expect(stateOf(r, { SITE_GATE: "off" })).toMatchObject({ on: false, source: "off" });
    expect(stateOf({ ...r, second: "passkey" }, {}).factors).toEqual(["password", "passkey"]);
  });

  it("reads only a well-formed record", async () => {
    expect(readRecord({ v: 1, sv: "version-one", hash: "junk" })).toEqual({ v: 1, sv: "version-one" });
    expect(readRecord({ sv: "x" })).toBeNull();
    expect(readRecord(null)).toBeNull();
    expect(readRecord(await record())).toEqual(await record());
  });

  it("is read at most every 20 s per instance, keeps the last good read when the store fails, and fails closed with none", async () => {
    const store = new MemorySiteStore();
    store.record = await record();
    expect((await currentState({}, store, NOW)).on).toBe(true);
    await currentState({}, store, NOW + 1000);
    expect(store.reads).toBe(1);
    store.fail = true;
    expect((await currentState({}, store, NOW + STATE_TTL_MS + 1)).on).toBe(true);
    forgetCachedState();
    expect(await currentState({}, store, NOW)).toMatchObject({ on: true, unknown: true });
    expect((await currentState({ SITE_GATE: "off" }, store, NOW)).on).toBe(false);
    // No store connected: the environment alone decides.
    expect((await currentState({}, null, NOW)).on).toBe(false);
  });
});

describe("the gate (#236)", () => {
  it("lets everything through while no password is set", async () => {
    const c = await ctx({ state: stateOf(null, {}) });
    for (const path of ["/", "/lattice", "/api/world", "/api/foundry-feed"]) expect(decide(req(path), c)).toEqual({ allow: true, why: "off" });
  });

  it("sends a page without a session to the login page (401), and an API route a 401 JSON", async () => {
    const c = await ctx();
    for (const path of ["/", "/lattice", "/foundry", "/systems/security", "/index.html", "/unknown"]) {
      const d = decide(req(path), c);
      expect(d.allow).toBe(false);
      if (d.allow) continue;
      expect(d.response.status).toBe(401);
      expect(d.response.headers.get(GATE_HEADER)).toBe("locked");
      expect(d.response.headers.get("content-type")).toContain("text/html");
      const html = await d.response.text();
      expect(html).toContain('action="/api/site-login"');
      expect(html).toContain(`value="${path}"`);
      expect(html).not.toContain("<script");
    }
    for (const [path, method] of [["/api/world", "GET"], ["/api/foundry-feed", "GET"], ["/api/world-step", "GET"], ["/api/foundry", "POST"], ["/api/desk-auth", "POST"], ["/api/site-password", "POST"], ["/", "POST"]] as const) {
      const d = decide(req(path, { method }), c);
      expect(d.allow).toBe(false);
      if (d.allow) continue;
      expect(d.response.status).toBe(401);
      expect(await d.response.json()).toEqual({ error: "site-locked" });
    }
  });

  it("opens with a good session, and renews it once a day of use", async () => {
    const c = await ctx();
    const k = c.keys!;
    expect(decide(req("/", { cookie: cookieFor(k) }), c)).toEqual({ allow: true, why: "session" });
    expect(decide(req("/api/world", { cookie: cookieFor(k) }), c)).toEqual({ allow: true, why: "session" });
    const later = decide(req("/", { cookie: cookieFor(k) }), { ...c, now: NOW + 2 * DAY });
    expect(later.allow && later.setCookie).toMatch(new RegExp(`^${SITE_COOKIE}=`));
  });

  it("refuses an old version, a forged cookie, an expired one, and a session short of the factors asked for", async () => {
    const c = await ctx();
    const k = c.keys!;
    for (const cookie of [cookieFor(k, "an-old-version"), `${SITE_COOKIE}=forged.token`, cookieFor(k, "version-one", NOW - 181 * DAY), cookieFor(await keys({ FOUNDRY_DESK_KEY: "other" }))]) {
      expect(decide(req("/", { cookie }), c).allow).toBe(false);
    }
    const twoFactor = await ctx({ state: stateOf(await record({ second: "passkey" }), {}) });
    expect(decide(req("/", { cookie: cookieFor(k) }), twoFactor).allow).toBe(false);
    expect(decide(req("/", { cookie: cookieFor(k, "version-one", NOW, ["password", "passkey"]) }), twoFactor).allow).toBe(true);
  });

  it("keeps the login page, the PWA files and the public build reachable, on GET only", async () => {
    const c = await ctx();
    expect(decide(req("/api/site-login"), c)).toEqual({ allow: true, why: "login" });
    expect(decide(req("/api/site-login", { method: "POST" }), c)).toEqual({ allow: true, why: "login" });
    for (const path of ["/manifest.webmanifest", "/sw.js", "/desk/icon-192.png", "/desk/badge-96.png", "/assets/index-abc.js", "/models/mech.glb", "/tide/syntherion-sigil.webp"]) {
      expect(decide(req(path), c)).toEqual({ allow: true, why: "static" });
    }
    expect(isStaticPath("POST", "/assets/x.js")).toBe(false);
    expect(isStaticPath("GET", "/assets/%2e%2e/api/world")).toBe(false);
    expect(isStaticPath("GET", "/desk")).toBe(false);
    expect(decide(req("/assets/..%2Fapi/world"), c).allow).toBe(false);
  });

  it("lets the machine callers through on their own keys, and only those", async () => {
    const c = await ctx();
    // The hourly world step: POST only (its GET is the Desk's clock, behind the gate).
    expect(decide(req("/api/world-step", { method: "POST" }), c)).toEqual({ allow: true, why: "world-step" });
    // The pings workflow: with the right DESK_PINGS_SECRET only.
    expect(decide(req("/api/desk-pings", { method: "POST", headers: { Authorization: `Bearer ${PINGS}` } }), c)).toEqual({ allow: true, why: "pings-secret" });
    for (const auth of [`Bearer ${PINGS}x`, "Bearer ", PINGS, ""]) expect(decide(req("/api/desk-pings", { method: "POST", headers: { Authorization: auth } }), c).allow).toBe(false);
    expect(decide(req("/api/foundry", { method: "POST", headers: { Authorization: `Bearer ${PINGS}` } }), c).allow).toBe(false);
    // The workflows that read the site (backup, seed, live watch): the bypass token, on any route.
    for (const path of ["/", "/lattice", "/api/world", "/api/day-story?day=2026-10-21"]) expect(decide(req(path, { headers: { [BYPASS_HEADER]: BYPASS } }), c)).toEqual({ allow: true, why: "bypass" });
    for (const wrong of [`${BYPASS}x`, BYPASS.slice(1), ""]) expect(decide(req("/api/world", { headers: { [BYPASS_HEADER]: wrong } }), c).allow).toBe(false);
    // A short SITE_BYPASS_TOKEN opens nothing, even when sent exactly.
    const short = await ctx({ env: { SITE_BYPASS_TOKEN: "short" } });
    expect(decide(req("/api/world", { headers: { [BYPASS_HEADER]: "short" } }), short).allow).toBe(false);
    // No pings secret set: a bare bearer opens nothing.
    const noSecret = await ctx({ env: {} });
    expect(decide(req("/api/desk-pings", { method: "POST", headers: { Authorization: "Bearer " } }), noSecret).allow).toBe(false);
  });

  it("fails closed when the store can't be read, and says it isn't set up without keys", async () => {
    const unknown = await ctx({ state: { ...stateOf(null, {}), on: true, unknown: true } });
    const d = decide(req("/api/world"), unknown);
    expect(!d.allow && d.response.status).toBe(503);
    // The machine callers still get through.
    expect(decide(req("/api/world", { headers: { [BYPASS_HEADER]: BYPASS } }), unknown).allow).toBe(true);
    const noKeys = await ctx({ keys: null });
    const page = decide(req("/"), noKeys);
    expect(!page.allow && (await page.response.text())).toContain("isn’t set up");
  });

  it("re-reads the record when a signed cookie is newer than the instance's copy (right after a change)", async () => {
    const store = new MemorySiteStore();
    store.record = await record();
    const env = { FOUNDRY_DESK_KEY: DESK };
    const k = await keys();
    expect((await gateRequest(req("/", { cookie: cookieFor(k) }), { env, store, now: NOW })).allow).toBe(true);
    store.record = await record({ sv: "version-two" });
    // Within the 20 s cache, a cookie for the new version still opens it (one forced re-read).
    expect((await gateRequest(req("/", { cookie: cookieFor(k, "version-two") }), { env, store, now: NOW + 3000 })).allow).toBe(true);
    // And the old version's cookie is refused from then on.
    expect((await gateRequest(req("/", { cookie: cookieFor(k) }), { env, store, now: NOW + 4000 })).allow).toBe(false);
  });

  it("wraps a handler for hosts with no middleware (Azure), adding the renewed cookie", async () => {
    const store = new MemorySiteStore();
    store.record = await record();
    const env = { FOUNDRY_DESK_KEY: DESK };
    const k = await keys();
    const handler = withGate(() => Response.json({ ok: true }), () => ({ env, store, now: NOW + 2 * DAY }));
    expect((await handler(req("/api/world"))).status).toBe(401);
    const res = await handler(req("/api/world", { cookie: cookieFor(k) }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^${SITE_COOKIE}=`));
  });

  it("compares secrets in constant time and never matches empty ones", () => {
    expect(secretMatches("abc", "abc")).toBe(true);
    expect(secretMatches("abc", "abd")).toBe(false);
    expect(secretMatches("", "")).toBe(false);
    expect(secretMatches(undefined, "abc")).toBe(false);
  });
});

describe("the login page (#236)", () => {
  it("only ever goes back to a path on this site", () => {
    expect(safeNext("/lattice?x=1")).toBe("/lattice?x=1");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil", "javascript:alert(1)", "", null, "/api/site-login?next=/"]) expect(safeNext(bad)).toBe("/");
  });

  it("escapes what it echoes and carries no script", () => {
    const html = loginPage({ next: '/x"><script>alert(1)</script>', message: "wrong" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("That didn’t open it.");
  });
});
