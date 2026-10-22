import { describe, expect, it } from "vitest";
import { EMPTY_FOUNDRY } from "../foundry.ts";
import { useSystems } from "../systems.ts";
import { CONNECTIONS, connectionsAt } from "./connections.ts";
import { DESK_ROOMS } from "./deskData.ts";
import { foundryGraph } from "./foundryGraph.ts";

/** Anything that looks like a credential: provider key prefixes, bearer headers, long runs of hex or base64. */
const KEY_LIKE = [/\bsk-[\w-]{8,}/i, /\bgh[pousr]_\w{8,}/, /github_pat_/i, /\bxox[abp]-/, /\bAKIA[0-9A-Z]{12,}/, /bearer\s+\S{8,}/i, /\b[0-9a-f]{32,}\b/i, /[A-Za-z0-9+/_-]{40,}/, /-----BEGIN/];

const text = (c: (typeof CONNECTIONS)[number]) => [c.name, c.serves, c.how, c.auth, c.when, ...c.kinds].join(" ");

describe("each system's How it works", () => {
  it("gives every connection a kind and a line on how, sign-in and when", () => {
    expect(CONNECTIONS.length).toBeGreaterThan(0);
    for (const c of CONNECTIONS) {
      expect(c.kinds.length, c.id).toBeGreaterThan(0);
      for (const t of [c.name, c.serves, c.how, c.auth, c.when]) expect(t.trim().length, c.id).toBeGreaterThan(0);
      expect(Object.hasOwn(DESK_ROOMS, c.room), c.id).toBe(true);
    }
  });

  it("has unique ids", () => {
    const ids = CONNECTIONS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts every connection in a real part's pop-over, or the world clock's, so none is lost", () => {
    const relay = new Set(useSystems.getState().links.filter((l) => l.room === "relay").map((l) => l.id));
    const foundry = new Set<string>(foundryGraph({ now: 0, connected: false, data: EMPTY_FOUNDRY, setup: null, nextCheck: 0 }).nodes.map((n) => n.id));
    for (const c of CONNECTIONS) {
      expect(c.at.length, c.id).toBeGreaterThan(0);
      for (const p of c.at) {
        if (p.system === "relay") expect(relay.has(p.part), `${c.id} at relay:${p.part}`).toBe(true);
        if (p.system === "foundry") expect(foundry.has(p.part), `${c.id} at foundry:${p.part}`).toBe(true);
      }
    }
  });

  it("explains each room's connections in that room", () => {
    expect(connectionsAt("relay", "bluebubbles").map((c) => c.id)).toEqual(["bluebubbles"]);
    expect(connectionsAt("relay", "openai").map((c) => c.id)).toEqual(["openai"]);
    expect(connectionsAt("relay", "hub").map((c) => c.id)).toEqual(["hub-socket"]);
    expect(connectionsAt("relay", "gmail").map((c) => c.id)).toEqual(["gmail"]);
    expect(connectionsAt("foundry", "builder").map((c) => c.id)).toEqual(["claude-code"]);
    expect(connectionsAt("foundry", "queue").map((c) => c.id)).toEqual(["doorbell"]);
    expect(connectionsAt("foundry", "checks").map((c) => c.id)).toEqual(["gemini-visual-qa"]);
    expect(connectionsAt("world").map((c) => c.id)).toEqual(["claude-api", "gemini-speech", "world-trigger", "blob"]);
    expect(connectionsAt("foundry", "main")).toEqual([]);
    expect(connectionsAt("exchange").map((c) => c.id)).toEqual(["polymarket", "polymarket-us"]);
    expect(connectionsAt("green").map((c) => c.id)).toEqual(["sleeper", "fantasypros"]);
    expect(connectionsAt("spire").map((c) => c.id)).toEqual(["paypal"]);
    for (const c of CONNECTIONS.filter((c) => c.room === "relay")) expect(c.at.every((p) => p.system === "relay"), c.id).toBe(true);
  });

  it("holds nothing key-like, since the page is public", () => {
    for (const c of CONNECTIONS) {
      const all = text(c);
      for (const pattern of KEY_LIKE) expect(all, `${c.id} matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it("catches a key if one slips in", () => {
    const leaked = "the token is ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    expect(KEY_LIKE.some((p) => p.test(leaked))).toBe(true);
  });

  it("is written without em-dashes", () => {
    for (const c of CONNECTIONS) expect(text(c), c.id).not.toContain("—");
  });
});
