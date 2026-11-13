import { describe, expect, it } from "vitest";
import { buildReport } from "../../../api/_usage/aggregate.ts";
import { capTone, dayBars, monthVerdict, perCall, readUsage, shortDay, tokens, usd } from "./tokenomics.ts";

/** The Tokenomics tab's browser side (#1142). Every figure is made up. */

const NOW = Date.parse("2026-11-13T18:00:00Z");

describe("the Tokenomics tab's data (#1142)", () => {
  it("reads the route's answers as the tab's states", async () => {
    expect(await readUsage(new Response("{}", { status: 401 }))).toEqual({ status: "signed-out" });
    expect(await readUsage(new Response("{}", { status: 503 }))).toEqual({ status: "not-set-up" });
    expect(await readUsage(new Response("{}", { status: 502 }))).toEqual({ status: "error" });
    expect(await readUsage(new Response("{}", { status: 200 }))).toEqual({ status: "error" });
    const report = buildReport([], {}, { now: NOW, days: 7, env: {} });
    expect((await readUsage(new Response(JSON.stringify(report)))).status).toBe("ready");
  });

  it("words dollars, tokens and days", () => {
    expect([0, 0.00042, 0.042, 1.5, 123.4].map(usd)).toEqual(["$0", "$0.0004", "$0.042", "$1.50", "$123"]);
    expect([812, 1_500, 14_200, 1_250_000].map(tokens)).toEqual(["812", "1.5k", "14k", "1.3M"]);
    expect(shortDay("2026-11-13")).toBe("Nov 13");
  });

  it("tones a cap and the month, and draws the days", () => {
    expect([capTone(1, 10), capTone(8, 10), capTone(10, 10), capTone(0, 0)]).toEqual(["ok", "warn", "over", "ok"]);
    const empty = buildReport([], {}, { now: NOW, days: 7, env: {} });
    expect(monthVerdict(empty).tone).toBe("wait");
    const line = { at: NOW - 1000, provider: "anthropic" as const, model: "claude-sonnet-5-5", feature: "email.advise", tokensIn: 100, tokensOut: 10, cacheWrite: 0, cacheRead: 0, searches: 0, usd: 9, ms: 1, ok: true };
    const r = buildReport([line], {}, { now: NOW, days: 7, env: {} });
    expect(monthVerdict(r)).toEqual({ word: "near a cap", tone: "warn" });
    expect(dayBars(r).at(-1)!.total).toBe(9);
    expect(perCall(r.totals)).toEqual({ usd: 9, tokensIn: 100, tokensOut: 10 });
  });
});
