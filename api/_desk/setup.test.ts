import { describe, expect, it } from "vitest";
import { MemoryAuthStore } from "./store.ts";
import { TEST_PASSKEY } from "./testing.ts";
import { SCAN_FRESH_MS, autoMergeState, both, devicesState, loadSetup, pingsActions, pingsVercel, rulesetState, setupStatus, type SetupDeps } from "./setup.ts";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const PING_ENV = { DESK_VAPID_PUBLIC_KEY: "pub-value", DESK_VAPID_PRIVATE_KEY: "priv-value", DESK_PINGS_SECRET: "secret-value" };
const APP_ENV = { FOUNDRY_APP_ID: "123", FOUNDRY_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----x" };

describe("the ping keys", () => {
  it("needs all three in Vercel", () => {
    expect(pingsVercel(PING_ENV)).toBe("done");
    expect(pingsVercel({ ...PING_ENV, DESK_PINGS_SECRET: "" })).toBe("todo");
    expect(pingsVercel({ ...PING_ENV, DESK_VAPID_PRIVATE_KEY: "   " })).toBe("todo");
    expect(pingsVercel({})).toBe("todo");
  });
  it("sees the Actions secret through a recent scan", () => {
    expect(pingsActions("done", NOW - 60_000, NOW)).toBe("done");
    expect(pingsActions("done", NOW - SCAN_FRESH_MS, NOW)).toBe("todo");
    expect(pingsActions("done", null, NOW)).toBe("todo");
    // A scan from the future (a clock skew) doesn't count.
    expect(pingsActions("done", NOW + 60_000, NOW)).toBe("todo");
  });
  it("can't tell about the Actions secret before Vercel's half is in, or without the store", () => {
    expect(pingsActions("todo", NOW, NOW)).toBe("unknown");
    expect(pingsActions("done", undefined, NOW)).toBe("unknown");
  });
  it("is done only when both halves are", () => {
    expect(both("done", "done")).toBe("done");
    expect(both("done", "todo")).toBe("todo");
    expect(both("todo", "unknown")).toBe("todo");
    expect(both("done", "unknown")).toBe("unknown");
  });
});

describe("devices, the ruleset and auto-merge", () => {
  it("wants a second device", () => {
    expect(devicesState(0)).toBe("todo");
    expect(devicesState(1)).toBe("todo");
    expect(devicesState(2)).toBe("done");
    expect(devicesState(null)).toBe("todo");
    expect(devicesState(undefined)).toBe("unknown");
  });
  it("counts the ruleset when main blocks deletion and force pushes", () => {
    expect(rulesetState([{ type: "deletion" }, { type: "non_fast_forward" }, { type: "required_signatures" }])).toBe("done");
    expect(rulesetState([{ type: "deletion" }, { type: "non_fast_forward" }, { type: "pull_request", parameters: {} }])).toBe("done");
    expect(rulesetState([{ type: "deletion" }])).toBe("todo");
    expect(rulesetState([])).toBe("todo");
    expect(rulesetState(undefined)).toBe("unknown");
    expect(rulesetState({ message: "Not Found" })).toBe("unknown");
  });
  it("reads allow_auto_merge only when GitHub shows it", () => {
    expect(autoMergeState({ allow_auto_merge: true })).toBe("done");
    expect(autoMergeState({ allow_auto_merge: false })).toBe("todo");
    expect(autoMergeState({ name: "C.E.O." })).toBe("unknown");
    expect(autoMergeState(undefined)).toBe("unknown");
  });
});

describe("setupStatus", () => {
  it("says only states, never a value", () => {
    const s = setupStatus({ env: { ...PING_ENV, ...APP_ENV }, scanned: NOW - 1000, devices: 3, rules: [], repo: {}, now: NOW });
    expect(s).toEqual({
      items: { pings: "done", app: "done", devices: "done", ruleset: "todo", automerge: "unknown" },
      pings: { vercel: "done", actions: "done" },
    });
    const out = JSON.stringify(s);
    for (const v of [...Object.values(PING_ENV), ...Object.values(APP_ENV)]) expect(out).not.toContain(v);
    for (const v of Object.values(s.items)) expect(["done", "todo", "unknown"]).toContain(v);
  });
  it("starts with everything to do", () => {
    expect(setupStatus({ env: {}, scanned: undefined, devices: null, rules: [], repo: { allow_auto_merge: false }, now: NOW }).items).toEqual({
      pings: "todo",
      app: "todo",
      devices: "todo",
      ruleset: "todo",
      automerge: "todo",
    });
  });
});

describe("loadSetup", () => {
  const deps = (over: Partial<SetupDeps> = {}): SetupDeps => ({
    env: { ...PING_ENV, FOUNDRY_DESK_KEY: "desk-key" },
    store: new MemoryAuthStore(),
    now: NOW,
    token: async () => "",
    fetch: (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/rules/branches/main")) return new Response(JSON.stringify([{ type: "deletion" }, { type: "non_fast_forward" }]));
      return new Response(JSON.stringify({ allow_auto_merge: true }));
    }) as typeof fetch,
    ...over,
  });

  it("reads the store and GitHub", async () => {
    const store = new MemoryAuthStore();
    store.keys = [TEST_PASSKEY, { ...TEST_PASSKEY, id: "phone" }];
    store.pingState = { subs: [], sent: {}, scanned: NOW - 5 * 60_000 };
    expect(await loadSetup(deps({ store }))).toEqual({
      items: { pings: "done", app: "todo", devices: "done", ruleset: "done", automerge: "done" },
      pings: { vercel: "done", actions: "done" },
    });
  });
  it("says it can't check when GitHub doesn't answer, and never throws", async () => {
    const failing = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    const s = await loadSetup(deps({ fetch: failing }));
    expect(s.items.ruleset).toBe("unknown");
    expect(s.items.automerge).toBe("unknown");
    const refused = (async () => new Response("{}", { status: 403 })) as typeof fetch;
    expect((await loadSetup(deps({ fetch: refused }))).items.ruleset).toBe("unknown");
  });
  it("counts devices as to do when sign-in isn't set up", async () => {
    expect((await loadSetup(deps({ env: {}, store: null }))).items.devices).toBe("todo");
  });
  it("sends the read token when there is one", async () => {
    const seen: string[] = [];
    const spy = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(String((init?.headers as Record<string, string>).Authorization ?? ""));
      return new Response("[]");
    }) as typeof fetch;
    await loadSetup(deps({ fetch: spy, token: async () => "tok" }));
    expect(seen).toEqual(["Bearer tok", "Bearer tok"]);
  });
});
