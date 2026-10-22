import { describe, expect, it } from "vitest";
import { installSiteGate, isLocked, loginUrl } from "./siteGate.ts";
import { statusLine } from "./desk/SitePassword.tsx";

/** The site password, browser side (#236): a locked API answer sends the page to the login page, once. */

const answer = (status: number, gate?: string) => new Response("{}", { status, headers: gate ? { "x-ceo-site-gate": gate } : {} });

describe("the site gate in the browser (#236)", () => {
  it("knows a locked answer from any other 401", () => {
    expect(isLocked(answer(401, "locked"))).toBe(true);
    expect(isLocked(answer(503, "locked"))).toBe(true);
    expect(isLocked(answer(401))).toBe(false);
    expect(isLocked(answer(200, "locked"))).toBe(false);
  });

  it("comes back to the same page after signing in", () => {
    expect(loginUrl({ pathname: "/lattice", search: "?room=boiler" })).toBe("/api/site-login?next=%2Flattice%3Froom%3Dboiler");
  });

  it("sends the page to the login page once, and still hands the answer back", async () => {
    const went: string[] = [];
    let next = answer(401, "locked");
    const win = { fetch: async () => next, location: { pathname: "/", search: "", assign: (u: string) => went.push(u) } } as unknown as Window & typeof globalThis;
    installSiteGate(win);
    expect((await win.fetch("/api/world")).status).toBe(401);
    await win.fetch("/api/world");
    expect(went).toEqual(["/api/site-login?next=%2F"]);
    next = answer(200);
    expect((await win.fetch("/api/world")).status).toBe(200);
  });

  it("says plainly whether the site is locked", () => {
    expect(statusLine({ on: false, source: "none" })).toContain("Off");
    expect(statusLine({ on: true, source: "env" })).toContain("SITE_PASSWORD_HASH");
    expect(statusLine({ on: true, source: "blob", set: "2026-10-22T00:00:00Z" })).toContain("On since");
    expect(statusLine({ on: false, source: "off" })).toContain("SITE_GATE=off");
  });
});
