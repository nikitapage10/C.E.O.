import { describe, expect, it } from "vitest";
import { CONNECTIONS } from "./connections.ts";
import { DESK_ROOMS } from "./deskData.ts";

/** Anything that looks like a credential: provider key prefixes, bearer headers, long runs of hex or base64. */
const KEY_LIKE = [/\bsk-[\w-]{8,}/i, /\bgh[pousr]_\w{8,}/, /github_pat_/i, /\bxox[abp]-/, /\bAKIA[0-9A-Z]{12,}/, /bearer\s+\S{8,}/i, /\b[0-9a-f]{32,}\b/i, /[A-Za-z0-9+/_-]{40,}/, /-----BEGIN/];

describe("How it connects", () => {
  it("gives every connection a kind and a line on how, sign-in and when", () => {
    expect(CONNECTIONS.length).toBeGreaterThan(0);
    for (const c of CONNECTIONS) {
      expect(c.kinds.length, c.id).toBeGreaterThan(0);
      for (const text of [c.name, c.serves, c.how, c.auth, c.when]) expect(text.trim().length, c.id).toBeGreaterThan(0);
      expect(Object.hasOwn(DESK_ROOMS, c.room), c.id).toBe(true);
    }
  });

  it("has unique ids", () => {
    const ids = CONNECTIONS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("holds nothing key-like, since the page is public", () => {
    for (const c of CONNECTIONS) {
      const all = Object.values(c).flat().join(" ");
      for (const pattern of KEY_LIKE) expect(all, `${c.id} matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it("catches a key if one slips in", () => {
    const leaked = "the token is ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    expect(KEY_LIKE.some((p) => p.test(leaked))).toBe(true);
  });

  it("is written without em-dashes", () => {
    for (const c of CONNECTIONS) expect(Object.values(c).flat().join(" "), c.id).not.toContain("—");
  });
});
