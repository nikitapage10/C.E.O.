import { describe, expect, it, vi } from "vitest";
import { deskKeyFor, keyMatches, pictureSecret } from "./keys.ts";
import { CHALLENGE_S, IDLE_S, MAX_S, SESSION_COOKIE, challengeOf, cookie, newSession, readCookie, readToken, renewed, requireSession, sameOrigin, sessionCookie, sessionOf, signToken } from "./session.ts";
import { MemoryAuthStore } from "./store.ts";

const DESK = "a test desk key, not a real one";
const NOW = Date.parse("2026-10-14T09:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("the Desk's keys (#132)", () => {
  it("derives a different key for each use, none of them the Desk key, the same every time", async () => {
    const session = await deskKeyFor(DESK, "session");
    const challenge = await deskKeyFor(DESK, "challenge");
    expect(session).toHaveLength(32);
    expect(session.equals(challenge)).toBe(false);
    expect(session.equals(await deskKeyFor(DESK, "session"))).toBe(true);
    expect(session.equals(await deskKeyFor(`${DESK}!`, "session"))).toBe(false);
    expect(session.toString("utf8")).not.toContain(DESK);
    expect(await pictureSecret(DESK)).toMatch(/^[0-9a-f]{64}$/);
    expect(await pictureSecret("")).toBe("");
    await expect(deskKeyFor("", "session")).rejects.toThrow();
  });

  it("matches the Desk key exactly, and nothing else", () => {
    expect(keyMatches(DESK, DESK)).toBe(true);
    for (const given of ["", DESK.slice(0, -1), `${DESK} `, DESK.toUpperCase(), DESK + String.fromCharCode(0x200b), undefined, 42, null]) expect(keyMatches(given, DESK)).toBe(false);
    expect(keyMatches("", "")).toBe(false);
  });
});

describe("session tokens (#132)", () => {
  it("signs and reads back a session, and refuses any change to it", async () => {
    const key = await deskKeyFor(DESK, "session");
    const token = signToken(key, newSession("cred-1", NOW));
    expect(sessionOf(key, token, NOW)).toEqual({ t: "session", c: "cred-1", s: NOW / 1000, e: NOW / 1000 + IDLE_S });
    const [body, sig] = token.split(".") as [string, string];
    const stretched = Buffer.from(JSON.stringify({ t: "session", c: "cred-1", s: NOW / 1000, e: NOW / 1000 + MAX_S })).toString("base64url");
    for (const bad of [`${stretched}.${sig}`, `${body}.${"A".repeat(43)}`, `${body}.`, body, `${token}.x`, "", null]) expect(sessionOf(key, bad, NOW)).toBeNull();
    expect(sessionOf(await deskKeyFor("another key", "session"), token, NOW)).toBeNull();
    // A token for another use, signed by another derived key, never opens a session.
    expect(sessionOf(await deskKeyFor(DESK, "challenge"), token, NOW)).toBeNull();
  });

  it("lasts 14 days after its last use (#1078)", async () => {
    expect(IDLE_S).toBe(14 * DAY / 1000);
    const key = await deskKeyFor(DESK, "session");
    const token = signToken(key, newSession("cred-1", NOW));
    expect(sessionOf(key, token, NOW + 13 * DAY)).not.toBeNull();
    expect(sessionOf(key, token, NOW + 14 * DAY - MIN)).not.toBeNull();
    expect(sessionOf(key, token, NOW + 14 * DAY)).toBeNull();
  });

  it("renews quietly on use, but never past 30 days from the passkey sign-in (#1078)", async () => {
    expect(MAX_S).toBe(30 * DAY / 1000);
    const key = await deskKeyFor(DESK, "session");
    let session = newSession("cred-1", NOW);
    let at = NOW;
    // Used every few days: still signed in on day 27, then out at day 30 however recently it was used.
    while (at < NOW + 30 * DAY - 3 * DAY) {
      at += 3 * DAY;
      const read = sessionOf(key, signToken(key, session), at);
      expect(read, new Date(at).toISOString()).not.toBeNull();
      session = renewed(read!, at);
    }
    expect(session.e).toBe(NOW / 1000 + MAX_S);
    expect(sessionOf(key, signToken(key, session), NOW + MAX_S * 1000)).toBeNull();
    // A token claiming a longer life than the hard maximum is refused even when signed.
    expect(sessionOf(key, signToken(key, { t: "session", c: "x", s: NOW / 1000, e: NOW / 1000 + MAX_S + 60 }), NOW)).toBeNull();
    // So is one from the future.
    expect(sessionOf(key, signToken(key, { t: "session", c: "x", s: NOW / 1000 + 3600, e: NOW / 1000 + 3600 + IDLE_S }), NOW)).toBeNull();
  });

  it("survives a deploy: a fresh instance of a new build reads a session the old one signed (#1078)", async () => {
    const token = await sessionCookie(DESK, newSession("cred-1", NOW), NOW);
    const value = token.split(";")[0]!.slice(SESSION_COOKIE.length + 1);
    // A new build on a cold instance: every module loaded again, nothing kept in memory (no scrypt cache, no store).
    vi.resetModules();
    const fresh = { keys: await import("./keys.ts"), session: await import("./session.ts") };
    const read = fresh.session.sessionOf(await fresh.keys.deskKeyFor(DESK, "session"), value, NOW + 2 * HOUR);
    expect(read).toEqual({ t: "session", c: "cred-1", s: NOW / 1000, e: NOW / 1000 + IDLE_S });
    const store = new MemoryAuthStore();
    await store.savePasskeys([{ id: "cred-1", publicKey: "AQID", counter: 0, label: "PC", added: "2026-10-14T00:00:00Z" }]);
    const req = new Request("https://ceo.test/api/foundry", { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${value}` } });
    expect((await fresh.session.requireSession(req, { deskKey: DESK, store, now: NOW + 2 * HOUR })).ok).toBe(true);
  });

  it("carries a challenge for one step only, for five minutes", async () => {
    const key = await deskKeyFor(DESK, "challenge");
    const token = signToken(key, { t: "enrol", ch: "abc", e: NOW / 1000 + CHALLENGE_S, label: "Windows PC" });
    expect(challengeOf(key, token, "enrol", NOW)).toEqual({ t: "enrol", ch: "abc", e: NOW / 1000 + CHALLENGE_S, label: "Windows PC" });
    expect(challengeOf(key, token, "signin", NOW)).toBeNull();
    expect(challengeOf(key, token, "enrol", NOW + CHALLENGE_S * 1000)).toBeNull();
    expect(readToken(key, "x".repeat(5000))).toBeNull();
  });

  it("sets the cookie HttpOnly, Secure, SameSite=Strict, for the whole site, as long as the session lasts", async () => {
    const set = await sessionCookie(DESK, newSession("cred-1", NOW), NOW);
    expect(set).toMatch(new RegExp(`^${SESSION_COOKIE}=[\\w-]+\\.[\\w-]+; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${IDLE_S}$`));
    expect(SESSION_COOKIE.startsWith("__Host-")).toBe(true);
    expect(cookie(SESSION_COOKIE, "", 0)).toContain("Max-Age=0");
    const req = new Request("https://ceo.test/", { headers: { cookie: `a=1; ${SESSION_COOKIE}=tok.en; b=2` } });
    expect(readCookie(req, SESSION_COOKIE)).toBe("tok.en");
    expect(readCookie(req, "missing")).toBeNull();
  });

  it("accepts requests from the Desk's own pages only", () => {
    expect(sameOrigin(new Request("https://ceo.test/api/foundry", { method: "POST" }))).toBe(true);
    expect(sameOrigin(new Request("https://ceo.test/api/foundry", { method: "POST", headers: { origin: "https://ceo.test" } }))).toBe(true);
    expect(sameOrigin(new Request("https://ceo.test/api/foundry", { method: "POST", headers: { origin: "https://attacker.example" } }))).toBe(false);
  });
});

describe("requireSession, the gate on every Desk write (#132)", () => {
  const request = (cookieHeader?: string) => new Request("https://ceo.test/api/foundry", { method: "POST", headers: cookieHeader ? { cookie: cookieHeader } : {} });

  it("lets a good session through for an enrolled device, and renews it", async () => {
    const store = new MemoryAuthStore();
    await store.savePasskeys([{ id: "cred-1", publicKey: "AQID", counter: 0, label: "PC", added: "2026-10-14T00:00:00Z" }]);
    const token = signToken(await deskKeyFor(DESK, "session"), newSession("cred-1", NOW));
    const signed = await requireSession(request(`${SESSION_COOKIE}=${token}`), { deskKey: DESK, store, now: NOW + 10 * MIN });
    expect(signed.ok).toBe(true);
    if (signed.ok) {
      expect(signed.session.e).toBe((NOW + 10 * MIN) / 1000 + IDLE_S);
      expect(signed.cookie).toContain(`Max-Age=${IDLE_S}`);
    }
  });

  it("refuses no session, a removed device, a missing setup", async () => {
    const store = new MemoryAuthStore();
    const token = signToken(await deskKeyFor(DESK, "session"), newSession("cred-gone", NOW));
    for (const [req, deps, status] of [
      [request(), { deskKey: DESK, store, now: NOW }, 401],
      [request(`${SESSION_COOKIE}=${token}`), { deskKey: DESK, store, now: NOW }, 401],
      [request(`${SESSION_COOKIE}=${token}`), { deskKey: "", store, now: NOW }, 503],
      [request(`${SESSION_COOKIE}=${token}`), { deskKey: DESK, store: null, now: NOW }, 503],
    ] as const) {
      const signed = await requireSession(req, deps);
      expect(signed.ok).toBe(false);
      if (!signed.ok) expect(signed.response.status).toBe(status);
    }
    // A stale cookie is cleared on the way out.
    const stale = await requireSession(request(`${SESSION_COOKIE}=${token}`), { deskKey: DESK, store, now: NOW });
    if (!stale.ok) expect(stale.response.headers.getSetCookie()[0]).toContain("Max-Age=0");
  });
});
