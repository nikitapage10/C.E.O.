import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepFeed, KEEP_MAX_MS, readKept } from "./feedKeep.ts";

const isList = (v: unknown): v is { items: number[] } => !!v && typeof v === "object" && Array.isArray((v as { items?: unknown }).items);

function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe("feedKeep", () => {
  beforeEach(() => vi.stubGlobal("localStorage", fakeStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("returns what was kept, with its time", () => {
    keepFeed("k", { items: [1] }, 1000);
    expect(readKept("k", isList, 5000)).toEqual({ value: { items: [1] }, at: 1000 });
  });
  it("drops a copy older than a day", () => {
    keepFeed("k", { items: [1] }, 1000);
    expect(readKept("k", isList, 1000 + KEEP_MAX_MS)).not.toBeNull();
    expect(readKept("k", isList, 1001 + KEEP_MAX_MS)).toBeNull();
  });
  it("drops a copy of the wrong shape, a broken entry and a time from the future", () => {
    keepFeed("k", { nope: 1 }, 1000);
    expect(readKept("k", isList, 2000)).toBeNull();
    localStorage.setItem("k", "{not json");
    expect(readKept("k", isList, 2000)).toBeNull();
    keepFeed("k", { items: [] }, 10_000_000);
    expect(readKept("k", isList, 2000)).toBeNull();
  });
  it("falls back silently when storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    });
    expect(() => keepFeed("k", { items: [] })).not.toThrow();
    expect(readKept("k", isList)).toBeNull();
  });
});
