import { describe, expect, it } from "vitest";
import { doordashAction, expiryWords, isDoorDashSignIn, loadDoorDash, readView } from "./doordash.ts";

/** The Kitchen's DoorDash card, browser side (#1195): the server's answers read as untrusted data. Made-up values only. */

const SIGNIN = "https://identity.doordash.com/authorize?client_id=test&state=s";
const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("DoorDash on the Kitchen page (#1195)", () => {
  it("reads only the four states and a real time", () => {
    expect(readView({ state: "live", expiresAt: "2026-11-20T18:00:00.000Z" })).toEqual({ state: "live", expiresAt: "2026-11-20T18:00:00.000Z" });
    expect(readView({ state: "live", expiresAt: "<b>soon</b>" })).toEqual({ state: "live", expiresAt: null });
    expect(readView({ state: "ordering" })).toBeNull();
    expect(readView(null)).toBeNull();
  });

  it("opens only DoorDash's own sign-in page", async () => {
    expect(isDoorDashSignIn(SIGNIN)).toBe(true);
    expect(isDoorDashSignIn("https://identity.doordash.com.evil.test/authorize?x")).toBe(false);
    expect(isDoorDashSignIn("javascript:alert(1)")).toBe(false);
    const good = await doordashAction({ action: "signin-start" }, (async () => res({ ok: true, url: SIGNIN })) as typeof fetch);
    expect(good.url).toBe(SIGNIN);
    const bad = await doordashAction({ action: "signin-start" }, (async () => res({ ok: true, url: "https://evil.test/authorize?x" })) as typeof fetch);
    expect(bad.url).toBeNull();
    const no = await doordashAction({ action: "signin-finish", pasted: "x" }, (async () => res({ error: "no-pending" }, 409)) as typeof fetch);
    expect(no).toMatchObject({ ok: false, status: 409, error: "no-pending" });
  });

  it("loads the state, signed out when the session is gone, off when the server has no route", async () => {
    expect(await loadDoorDash((async () => res({ state: "signed-out", expiresAt: null })) as typeof fetch)).toEqual({ state: "ready", view: { state: "signed-out", expiresAt: null } });
    expect(await loadDoorDash((async () => res({ error: "signed-out" }, 401)) as typeof fetch)).toEqual({ state: "out" });
    expect(await loadDoorDash((async () => new Response("nope", { status: 404 })) as typeof fetch)).toEqual({ state: "off" });
    expect(await loadDoorDash((async () => Promise.reject(new Error("offline"))) as typeof fetch)).toEqual({ state: "failed" });
  });

  it("says when the sign-in runs out", () => {
    const now = Date.parse("2026-11-17T18:00:00Z");
    expect(expiryWords(null, now)).toBe("expiry unknown");
    expect(expiryWords("2026-11-20T18:00:00Z", now)).toMatch(/^expires /);
    expect(expiryWords("2026-11-16T18:00:00Z", now)).toMatch(/^expired /);
  });
});
