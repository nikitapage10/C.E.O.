import { describe, expect, it } from "vitest";
import { KEY_PLACEHOLDER, SETTABLE_KEYS } from "../../api/_keys/allowlist.ts";
import { KeyRefresh, KEYS_FRESH_MS } from "./keys.ts";
import { keyWriter, readSecret, secretDates, setSecret, vaultFromEnv, type Vault } from "./vault.ts";

/** The Key Vault over REST (#330), with fetch and the identity stubbed: what is called, and what is never kept. */

const BASE = "https://kv-ceo-test.vault.azure.net";
const credential = { getToken: async () => ({ token: "t", expiresOnTimestamp: Date.now() + 3_600_000 }) };

function vaultWith(handler: (url: string, init: RequestInit) => Response): { vault: Vault; calls: { url: string; method: string; body?: string; auth?: string }[] } {
  const calls: { url: string; method: string; body?: string; auth?: string }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body as string | undefined, auth: (init.headers as Record<string, string>)?.Authorization });
    return handler(url, init);
  }) as typeof fetch;
  return { vault: vaultFromEnv({ KEY_VAULT_URI: `${BASE}/` }, credential, f)!, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("the vault's address", () => {
  it("is taken only when it is a vault's own https address", () => {
    expect(vaultFromEnv({ KEY_VAULT_URI: "https://kv-ceo-besgu7fnckib2.vault.azure.net/" }, credential)?.base).toBe("https://kv-ceo-besgu7fnckib2.vault.azure.net");
    for (const bad of [undefined, "", "http://kv.vault.azure.net/", "https://evil.test/", "https://kv.vault.azure.net.evil.test/", "https://kv.vault.azure.net/secrets"]) expect(vaultFromEnv({ KEY_VAULT_URI: bad }, credential), String(bad)).toBeNull();
  });
});

describe("the Keys form's face of the vault", () => {
  it("sets a secret with the identity's token and keeps only the date of the answer", async () => {
    const { vault, calls } = vaultWith(() => json({ value: "echoed-by-the-vault", id: `${BASE}/secrets/openai/1`, attributes: { updated: 1_761_000_000 } }));
    const done = await setSecret(vault, "openai", "v");
    expect(done).toEqual({ updated: 1_761_000_000_000 });
    expect(JSON.stringify(done)).not.toContain("echoed");
    expect(calls).toEqual([{ url: `${BASE}/secrets/openai?api-version=7.4`, method: "PUT", body: JSON.stringify({ value: "v" }), auth: "Bearer t" }]);
  });

  it("lists names and dates only, and follows pages only on the vault's own host", async () => {
    const { vault, calls } = vaultWith((url) =>
      url.includes("page2")
        ? json({ value: [{ id: `${BASE}/secrets/openai`, attributes: { enabled: false, updated: 2 } }], nextLink: "https://evil.test/secrets?page3" })
        : json({ value: [{ id: `${BASE}/secrets/claude-api-key`, attributes: { enabled: true, updated: 1 } }], nextLink: `${BASE}/secrets?page2` }),
    );
    const dates = await secretDates(vault);
    expect([...dates]).toEqual([
      ["claude-api-key", { enabled: true, updated: 1000 }],
      ["openai", { enabled: false, updated: 2000 }],
    ]);
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/secrets?api-version=7.4&maxresults=25`, `${BASE}/secrets?page2`]);
  });

  it("marks the role paste's placeholders by their tag, never by a value", async () => {
    const { vault } = vaultWith(() =>
      json({ value: [{ id: `${BASE}/secrets/gemini-api-key`, attributes: { enabled: true, updated: 3 }, tags: { "ceo-placeholder": "1" } }, { id: `${BASE}/secrets/openai`, attributes: { enabled: true, updated: 4 }, tags: null }] }),
    );
    expect([...(await secretDates(vault))]).toEqual([
      ["gemini-api-key", { enabled: true, updated: 3000, placeholder: true }],
      ["openai", { enabled: true, updated: 4000 }],
    ]);
  });

  it("has no way to read, list values or delete", () => {
    const { vault } = vaultWith(() => json({}));
    expect(Object.keys(keyWriter(vault)).sort()).toEqual(["dates", "set"]);
  });

  it("refuses names Key Vault wouldn't take before calling it", async () => {
    const { vault, calls } = vaultWith(() => json({}));
    await expect(setSecret(vault, "../x", "v")).rejects.toThrow();
    await expect(readSecret(vault, "a/b")).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("keys set from the Desk reach the running app (azure/src/keys.ts)", () => {
  const source = (values: Record<string, string>, dates: Record<string, number>) => {
    const reads: string[] = [];
    return {
      reads,
      source: {
        dates: async () => new Map(Object.entries(dates).map(([k, u]) => [k, { enabled: true, updated: u }])),
        read: async (name: string) => (reads.push(name), values[name] ?? null),
      },
    };
  };

  it("loads allowlisted keys into their settings, and nothing else", async () => {
    const env: Record<string, string | undefined> = { FOUNDRY_DESK_KEY: "kept" };
    const { source: s, reads } = source({ "claude-api-key": " c\n", "foundry-desk-key": "never" }, { "claude-api-key": 1, "foundry-desk-key": 1 });
    const r = new KeyRefresh(s, env);
    expect(await r.refresh(0)).toEqual(["CLAUDE_API_KEY"]);
    expect(env).toEqual({ FOUNDRY_DESK_KEY: "kept", CLAUDE_API_KEY: "c" });
    expect(reads).toEqual(["claude-api-key"]);
  });

  it("looks at most every two minutes, and reads again only what is newer", async () => {
    const env: Record<string, string | undefined> = {};
    const dates: Record<string, number> = { "gemini-api-key": 1 };
    const values: Record<string, string> = { "gemini-api-key": "g1" };
    const { source: s, reads } = source(values, dates);
    const r = new KeyRefresh(s, env);
    await r.refresh(0);
    expect(await r.refresh(KEYS_FRESH_MS - 1)).toEqual([]);
    await r.refresh(KEYS_FRESH_MS);
    expect(reads).toEqual(["gemini-api-key"]);
    dates["gemini-api-key"] = 2;
    values["gemini-api-key"] = "g2";
    expect(await r.refresh(2 * KEYS_FRESH_MS)).toEqual(["GEMINI_API_KEY"]);
    expect(env.GEMINI_API_KEY).toBe("g2");
  });

  it("takes a key written on this instance at once, without reading it back", async () => {
    const env: Record<string, string | undefined> = {};
    const { source: s, reads } = source({}, { openai: 5 });
    const r = new KeyRefresh(s, env);
    r.noteSet("openai", "o", 5);
    r.noteSet("foundry-desk-key", "x", 5);
    await r.refresh(0);
    expect(env).toEqual({ OPENAI_STUDIO_KEY: "o" });
    expect(reads).toEqual([]);
  });

  it("never takes the role paste's placeholder for a key, by tag or by value", async () => {
    const env: Record<string, string | undefined> = {};
    const reads: string[] = [];
    const r = new KeyRefresh(
      {
        dates: async () => new Map([["claude-api-key", { enabled: true, updated: 1, placeholder: true }], ["gemini-api-key", { enabled: true, updated: 1 }]]),
        read: async (name: string) => (reads.push(name), KEY_PLACEHOLDER),
      },
      env,
    );
    expect(await r.refresh(0)).toEqual([]);
    r.noteSet("openai", KEY_PLACEHOLDER, 2);
    expect(env).toEqual({});
    expect(reads).toEqual(["gemini-api-key"]);
  });

  it("never throws when the vault is away, and logs names only", async () => {
    const logs: string[] = [];
    const r = new KeyRefresh({ dates: async () => Promise.reject(new Error("down secret-ish")), read: async () => null }, {}, (l) => logs.push(l));
    expect(await r.refresh(0)).toEqual([]);
    expect(logs).toEqual(["keys refresh: the vault didn't answer"]);
    expect(SETTABLE_KEYS.length).toBeGreaterThan(0);
  });
});
