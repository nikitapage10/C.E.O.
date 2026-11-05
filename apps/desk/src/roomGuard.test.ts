import { describe, expect, it } from "vitest";
import { claimReload, describeError, isChunkError, RELOAD_GAP_MS, RELOAD_KEY } from "./roomGuard.ts";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("the room guard (#909)", () => {
  it("knows a page's code failing to load from any other error", () => {
    expect(isChunkError(new TypeError("Failed to fetch dynamically imported module: https://example.test/assets/Relay-abc.js"))).toBe(true);
    expect(isChunkError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkError(new Error("Unable to preload CSS for /assets/Relay-abc.css"))).toBe(true);
    expect(isChunkError(new Error("Minified React error #185"))).toBe(false);
    expect(isChunkError(null)).toBe(false);
  });

  it("reloads once, then not again within the gap", () => {
    const s = memory();
    expect(claimReload(s, 1_000_000)).toBe(true);
    expect(s.m.get(RELOAD_KEY)).toBe("1000000");
    expect(claimReload(s, 1_000_000 + RELOAD_GAP_MS - 1)).toBe(false);
    expect(claimReload(s, 1_000_000 + RELOAD_GAP_MS)).toBe(true);
    expect(claimReload(null, 1)).toBe(false);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => {} };
    expect(claimReload(broken, 1)).toBe(false);
  });

  it("shows one short line", () => {
    expect(describeError(new Error("first\nsecond"))).toBe("first");
    expect(describeError("x".repeat(400)).length).toBe(158);
    expect(describeError(undefined)).toBe("Something went wrong.");
  });
});
