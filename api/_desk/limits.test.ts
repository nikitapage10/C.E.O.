import { describe, expect, it } from "vitest";
import { FORGET_MS, Gate, RULES, addressOf, failed, prune, waitOf, type Bucket, type Limits } from "./limits.ts";
import { BlobPreconditionError, type BlobBackend, type PutOptions } from "../_blob.ts";
import { BlobAuthStore, MemoryAuthStore } from "./store.ts";

const NOW = Date.parse("2026-10-14T09:00:00Z");
const MIN = 60_000;
const KEY = Buffer.alloc(32, 7);

/** The wait after each of n failures in a row, all at the same moment. */
function waits(rule: (typeof RULES)[keyof typeof RULES], n: number): number[] {
  let b: Bucket | undefined;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    b = failed(b, rule, NOW);
    out.push(waitOf(b, NOW));
  }
  return out;
}

describe("failed tries slow down, then lock out (#132)", () => {
  it("one address: two free, then 30 s, 2 min, and locked 15 min", () => {
    expect(waits(RULES.address, 6)).toEqual([0, 0, 30_000, 2 * MIN, 15 * MIN, 15 * MIN]);
  });

  it("every address together: enrolment locks for an hour from the 8th failure, sign-in for 15 min from the 22nd", () => {
    expect(waits(RULES.enrolAll, 9)).toEqual([0, 0, 0, 0, 0, MIN, 5 * MIN, 60 * MIN, 60 * MIN]);
    const signin = waits(RULES.signinAll, 23);
    expect(signin.slice(0, 20).every((w) => w === 0)).toBe(true);
    expect(signin.slice(20)).toEqual([MIN, 15 * MIN, 15 * MIN]);
  });

  it("forgets after an hour without a failure", () => {
    let b: Bucket | undefined;
    for (let i = 0; i < 5; i++) b = failed(b, RULES.address, NOW);
    expect(waitOf(b, NOW + 14 * MIN)).toBe(MIN);
    expect(waitOf(b, NOW + 15 * MIN)).toBe(0);
    // Back after the hour: the count starts again.
    expect(failed(b, RULES.address, NOW + FORGET_MS + 1).fails).toBe(1);
    // Within it: the next failure locks again at once.
    expect(waitOf(failed(b, RULES.address, NOW + 20 * MIN), NOW + 20 * MIN)).toBe(15 * MIN);
  });

  it("prunes forgotten buckets and keeps the record small", () => {
    const limits: Limits = { old: { fails: 1, last: NOW - 2 * FORGET_MS, until: 0 }, live: { fails: 3, last: NOW, until: NOW + 30_000 } };
    expect(Object.keys(prune(limits, NOW))).toEqual(["live"]);
    const many: Limits = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`b${i}`, { fails: 1, last: NOW - i, until: 0 }]));
    expect(Object.keys(prune(many, NOW))).toHaveLength(300);
  });

  it("reads the address Vercel reports", () => {
    expect(addressOf(new Request("https://x", { headers: { "x-real-ip": "203.0.113.9" } }))).toBe("203.0.113.9");
    expect(addressOf(new Request("https://x", { headers: { "x-forwarded-for": "198.51.100.2, 10.0.0.1" } }))).toBe("198.51.100.2");
    expect(addressOf(new Request("https://x"))).toBe("unknown");
  });
});

describe("the gate keeps its counters in the shared store (#132)", () => {
  it("counts failures per address and across addresses, never storing an address", async () => {
    const store = new MemoryAuthStore();
    for (let i = 0; i < 3; i++) await (await Gate.open(store, "enrol", "203.0.113.9", KEY, NOW)).fail();
    expect((await Gate.open(store, "enrol", "203.0.113.9", KEY, NOW)).wait()).toBe(30_000);
    // Another address isn't slowed by this one's three…
    expect((await Gate.open(store, "enrol", "198.51.100.2", KEY, NOW)).wait()).toBe(0);
    // …nor is signing in.
    expect((await Gate.open(store, "signin", "203.0.113.9", KEY, NOW)).wait()).toBe(0);
    const saved = JSON.stringify(await store.limits());
    expect(saved).not.toContain("203.0.113.9");
    expect(Object.keys(await store.limits())).toEqual(expect.arrayContaining(["enrol:all"]));
  });

  it("locks every address once enough fail from many", async () => {
    const store = new MemoryAuthStore();
    for (let i = 0; i < 8; i++) await (await Gate.open(store, "enrol", `192.0.2.${i}`, KEY, NOW)).fail();
    expect((await Gate.open(store, "enrol", "192.0.2.200", KEY, NOW)).wait()).toBe(60 * MIN);
  });

  it("clears an address's count when it gets it right", async () => {
    const store = new MemoryAuthStore();
    for (let i = 0; i < 2; i++) await (await Gate.open(store, "signin", "203.0.113.9", KEY, NOW)).fail();
    await (await Gate.open(store, "signin", "203.0.113.9", KEY, NOW)).pass("challenge-1", NOW + 5 * MIN);
    await (await Gate.open(store, "signin", "203.0.113.9", KEY, NOW)).fail();
    expect((await Gate.open(store, "signin", "203.0.113.9", KEY, NOW)).wait()).toBe(0);
  });

  it("spends a challenge once answered, until it would have expired", async () => {
    const store = new MemoryAuthStore();
    expect((await Gate.open(store, "signin", "203.0.113.9", KEY, NOW)).spent("challenge-1")).toBe(false);
    await (await Gate.open(store, "signin", "203.0.113.9", KEY, NOW)).pass("challenge-1", NOW + 5 * MIN);
    expect((await Gate.open(store, "signin", "198.51.100.2", KEY, NOW + MIN)).spent("challenge-1")).toBe(true);
    expect((await Gate.open(store, "signin", "198.51.100.2", KEY, NOW + MIN)).spent("challenge-2")).toBe(false);
    expect(JSON.stringify(await store.limits())).not.toContain("challenge-1");
  });
});

describe("a step-up challenge is spent atomically (#330)", () => {
  /** A blob store with the real write rule: no overwrite unless allowed (If-None-Match: * on Azure). */
  const blob = () => {
    const files = new Map<string, string>();
    const backend: BlobBackend = {
      kind: "azureblob",
      get: async () => null,
      etag: async () => null,
      async put(path: string, body: string | ArrayBuffer | Uint8Array, opts: PutOptions) {
        if (!opts.allowOverwrite && files.has(path)) throw new BlobPreconditionError("already exists");
        files.set(path, String(body));
        return { pathname: path };
      },
      del: async () => undefined,
    };
    return { files, backend };
  };

  it("gives the claim to the first caller only, with a create-if-absent write named by a hash", async () => {
    const { files, backend } = blob();
    const store = new BlobAuthStore(backend);
    const a = await Gate.open(store, "signin", "203.0.113.9", KEY, NOW);
    const b = await Gate.open(store, "signin", "198.51.100.2", KEY, NOW);
    expect(await Promise.all([a.claim("challenge-1", NOW + MIN), b.claim("challenge-1", NOW + MIN)])).toEqual([true, false]);
    expect(await b.claim("challenge-2", NOW + MIN)).toBe(true);
    expect([...files.keys()].every((k) => /^desk\/auth\/spent\/[a-f0-9]{32}\.json$/.test(k))).toBe(true);
    expect([...files.keys()].join()).not.toContain("challenge");
  });

  it("refuses an id that isn't a hash, and passes on any other store error", async () => {
    const store = new BlobAuthStore({ ...blob().backend, put: async () => Promise.reject(new Error("down")) });
    expect(await store.claim("../x", 0)).toBe(false);
    await expect(store.claim("a".repeat(32), 0)).rejects.toThrow("down");
  });
});
