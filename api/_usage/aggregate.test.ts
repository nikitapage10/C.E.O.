import { describe, expect, it } from "vitest";
import { buildReport, readLine, rowOf, wasteFlags } from "./aggregate.ts";
import type { UsageLine } from "./meter.ts";

/** The Tokenomics report (#1142). Every line is made up. */

const NOW = Date.parse("2026-11-13T18:00:00Z");
const T = Date.parse("2026-11-13T10:00:00Z");

const line = (over: Partial<UsageLine> = {}): UsageLine => ({ at: T, provider: "anthropic", model: "claude-sonnet-5-5", feature: "skippy.talk", tokensIn: 1000, tokensOut: 100, cacheWrite: 0, cacheRead: 0, searches: 0, usd: 0.01, ms: 800, ok: true, ...over });

describe("the report (#1142)", () => {
  it("sums by provider, feature, model and day, and the month against each cap", () => {
    const lines = [
      line(),
      line({ at: T - 86_400_000, feature: "email.sort", model: "claude-haiku-5-5", usd: 0.002 }),
      line({ provider: "google", model: "gemini-3.8-flash", feature: "skippy.world", usd: 0.004 }),
      line({ provider: "openai", model: "gpt-image-2.6-sunburst", feature: "haven.photos", usd: 0.3 }),
      // Last month: in a 30-day window, not in this month.
      line({ at: Date.parse("2026-10-30T10:00:00Z"), usd: 1 }),
    ];
    const r = buildReport(lines, {}, { now: NOW, days: 30, env: { SKIPPY_BUDGET_USD: "50" } });
    expect(r.totals.calls).toBe(5);
    expect(r.totals.usd).toBeCloseTo(1.316);
    expect(r.month.usd).toBeCloseTo(0.316);
    expect(r.month.label).toBe("November 2026");
    expect(r.month.byProvider.openai).toBeCloseTo(0.3);
    expect(r.byProvider.map((p) => p.key)).toEqual(["anthropic", "google", "openai"]);
    expect(r.byFeature[0]!.key).toBe("skippy.talk");
    expect(r.byModel.find((m) => m.key === "gemini-3.8-flash")?.provider).toBe("google");
    expect(r.byDay).toHaveLength(30);
    expect(r.byDay.at(-1)!.usd.openai).toBeCloseTo(0.3);
    const skippy = r.caps.find((c) => c.id === "skippy")!;
    expect(skippy.cap).toBe(50);
    expect(skippy.usd).toBeCloseTo(0.014);
    expect(r.caps.find((c) => c.id === "images")!.usd).toBeCloseTo(0.3);
    expect(r.drivers[0]!.key).toBe("skippy.talk · claude-sonnet-5-5");
    // A short window leaves the older lines out.
    expect(buildReport(lines, {}, { now: NOW, days: 1, env: {} }).totals.calls).toBe(3);
  });

  it("works out the cache hit rate and averages", () => {
    const r = rowOf("x", [line({ tokensIn: 100, cacheRead: 800, cacheWrite: 100, ms: 1000 }), line({ ok: false, tokensIn: 0, tokensOut: 0, usd: 0, ms: 0 })]);
    expect(r.cacheHit).toBeCloseTo(0.8);
    expect(r.errors).toBe(1);
    expect(r.ms).toBe(500);
  });

  it("sets the bill beside the ledger, and waits without a key", () => {
    const lines = [line({ usd: 2 }), line({ provider: "openai", model: "gpt-4.1-mini", usd: 0.5 })];
    const truth = { anthropic: { pulledAt: NOW, ok: true, days: { "2026-11-13": { "claude-sonnet-5-5": { usd: 2.5, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 }, "claude-opus-5-5": { usd: 1, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 } } } } };
    const r = buildReport(lines, truth, { now: NOW, days: 7, env: {} });
    const a = r.truth.find((t) => t.provider === "anthropic")!;
    expect(a).toMatchObject({ state: "ok", billed: 3.5, ledger: 2, gap: 1.5 });
    expect(a.models[0]).toEqual({ model: "claude-sonnet-5-5", billed: 2.5, ledger: 2 });
    expect(r.truth.find((t) => t.provider === "openai")).toMatchObject({ state: "waiting", billed: null, ledger: 0.5 });
    expect(r.truth.find((t) => t.provider === "google")).toMatchObject({ state: "ledger" });
    const failed = buildReport(lines, { openai: { pulledAt: NOW, ok: false, status: 401, days: {} } }, { now: NOW, days: 7, env: { OPENAI_ADMIN_KEY: "set" } });
    expect(failed.truth.find((t) => t.provider === "openai")!.state).toBe("failed");
  });

  it("reads back only well-formed lines", () => {
    expect(readLine("not json")).toBeNull();
    expect(readLine(JSON.stringify({ at: 1, provider: "someone", feature: "x" }))).toBeNull();
    expect(readLine(JSON.stringify({ at: 1, provider: "openai", feature: "x", usd: -3, ok: false }))).toMatchObject({ usd: 0, ok: false, tokensIn: 0 });
  });
});

describe("the waste flags (#1142)", () => {
  const kinds = (lines: UsageLine[]) => wasteFlags(lines).map((f) => f.kind);

  it("flags the same call again within seconds, not an agent's growing rounds", () => {
    const dup = [line({ at: T }), line({ at: T + 3_000, usd: 0.02 })];
    const flags = wasteFlags(dup);
    expect(flags[0]).toMatchObject({ kind: "duplicate", feature: "skippy.talk", usd: 0.02 });
    expect(flags[0]!.text).toContain("1 time");
    expect(kinds([line({ at: T }), line({ at: T + 3_000, tokensIn: 4000 })])).not.toContain("duplicate");
    expect(kinds([line({ at: T }), line({ at: T + 60_000 })])).not.toContain("duplicate");
  });

  it("flags a cache that misses, and a big prompt with none", () => {
    const missing = Array.from({ length: 6 }, (_, i) => line({ at: T + i * 600_000, tokensIn: 500, cacheWrite: 4000, cacheRead: 200 }));
    expect(kinds(missing)).toContain("cache");
    const hitting = Array.from({ length: 6 }, (_, i) => line({ at: T + i * 600_000, tokensIn: 100, cacheWrite: 100, cacheRead: 4000 }));
    expect(kinds(hitting)).not.toContain("cache");
    const uncached = Array.from({ length: 10 }, (_, i) => line({ at: T + i * 600_000, tokensIn: 12_000 + i }));
    expect(kinds(uncached)).toContain("uncached");
  });

  it("flags oversized inputs, maxed searches, cut-off answers and failures", () => {
    expect(kinds([line({ tokensIn: 70_000 })])).toContain("oversized");
    const search = Array.from({ length: 3 }, (_, i) => line({ at: T + i * 60_000, searches: 3, tokensIn: 1000 + i * 50 }));
    expect(kinds(search)).toContain("searches");
    const cut = wasteFlags([line({ stop: "max_tokens", usd: 0.05 })]);
    expect(cut[0]).toMatchObject({ kind: "cutoff", usd: 0.05 });
    expect(kinds([line({ ok: false, usd: 0 }), line({ at: T + 60_000, tokensIn: 3000 })])).toContain("errors");
  });

  it("flags Gemini failing over to Claude", () => {
    const flags = wasteFlags([line({ provider: "google", model: "gemini-3.8-flash", feature: "skippy.world", ok: false, status: 500, usd: 0 }), line({ at: T + 4_000, usd: 0.03 })]);
    const f = flags.find((x) => x.kind === "fallback")!;
    expect(f.text).toContain("went on to Claude");
    expect(f.usd).toBeCloseTo(0.03);
  });

  it("says nothing about a clean month", () => {
    expect(wasteFlags(Array.from({ length: 4 }, (_, i) => line({ at: T + i * 3_600_000, tokensIn: 1000 + i * 100 })))).toEqual([]);
  });
});
