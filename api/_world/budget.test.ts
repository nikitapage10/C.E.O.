import { describe, expect, it, vi } from "vitest";
import { addSpend, canSpend, monthOf, STEP_CEILING_USD, stepCost, WORLD_BUDGET_USD, worldBudget } from "./budget.ts";
import { runStep, type Ask } from "./step.ts";
import { MemoryStore } from "./store.ts";
import { initialState } from "./step.ts";

const T0 = Date.parse("2026-10-20T16:05:00Z");

describe("what a step costs", () => {
  it("prices a call like idea shaping: $0.10 in and $0.50 out per million tokens", () => {
    expect(stepCost({ input_tokens: 10_000, output_tokens: 1_000 })).toEqual({ usd: (10_000 * 0.1 + 1_000 * 0.5) / 1e6, tokensIn: 10_000, tokensOut: 1_000 });
  });

  it("charges 1-hour cache writes at 2x input and cache reads at a tenth", () => {
    const write = stepCost({ input_tokens: 2_000, output_tokens: 0, cache_creation_input_tokens: 8_000, cache_creation: { ephemeral_1h_input_tokens: 8_000 } });
    expect(write.usd).toBeCloseTo((2_000 * 0.1 + 8_000 * 0.1 * 2) / 1e6, 12);
    expect(write.tokensIn).toBe(10_000);
    const read = stepCost({ input_tokens: 2_000, output_tokens: 0, cache_read_input_tokens: 8_000 });
    expect(read.usd).toBeCloseTo((2_000 * 0.1 + 8_000 * 0.01) / 1e6, 12);
  });

  it("a step at its most stays under two cents", () => {
    expect(STEP_CEILING_USD).toBeLessThan(0.02);
  });
});

describe("the budget guard", () => {
  it("lets Claude write while the month has room for one more step", () => {
    expect(canSpend(initialState(), T0)).toBe(true);
    const spend = { [monthOf(T0)]: { usd: WORLD_BUDGET_USD - STEP_CEILING_USD, tokensIn: 0, tokensOut: 0, calls: 0, scripted: 0 } };
    expect(canSpend({ spend }, T0)).toBe(true);
  });

  it("stops Claude when the next step could pass the world's budget", () => {
    const spend = { [monthOf(T0)]: { usd: WORLD_BUDGET_USD - STEP_CEILING_USD / 2, tokensIn: 0, tokensOut: 0, calls: 0, scripted: 0 } };
    expect(canSpend({ spend }, T0)).toBe(false);
  });

  it("starts afresh when the month turns", () => {
    const spend = { "2026-09": { usd: 50, tokensIn: 0, tokensOut: 0, calls: 0, scripted: 0 } };
    expect(canSpend({ spend }, T0)).toBe(true);
  });

  it("near the cap, the step falls back to the scripted lines without calling Claude", async () => {
    const store = new MemoryStore();
    store.state = { ...initialState(), spend: { "2026-10": { usd: 5.995, tokensIn: 0, tokensOut: 0, calls: 2000, scripted: 0 } } };
    const ask = vi.fn<Ask>();
    const r = await runStep({ store, now: T0, readFeed: async () => ({ issues: [], comments: [], runs: [] }), ask });
    expect(ask).not.toHaveBeenCalled();
    expect(r.stepped && r.entry.source).toBe("scripted");
    expect(store.state!.spend["2026-10"]).toMatchObject({ usd: 5.995, calls: 2000, scripted: 1 });
  });

  it("reads the world budget from the environment, never above the $10 cap", () => {
    expect(worldBudget(undefined)).toBe(WORLD_BUDGET_USD);
    expect(worldBudget("")).toBe(WORLD_BUDGET_USD);
    expect(worldBudget("3.5")).toBe(3.5);
    expect(worldBudget("0")).toBe(0);
    expect(worldBudget("25")).toBe(10);
    expect(worldBudget("lots")).toBe(WORLD_BUDGET_USD);
  });

  it("keeps a running month total and only the last six months", () => {
    let spend = {};
    for (let m = 0; m < 8; m++) spend = addSpend(spend, Date.UTC(2026, m, 15), { usd: 0.01, tokensIn: 100, tokensOut: 10 }, "claude");
    spend = addSpend(spend, Date.UTC(2026, 7, 16), null, "scripted");
    expect(Object.keys(spend)).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
    expect((spend as Record<string, { calls: number; scripted: number; usd: number }>)["2026-08"]).toMatchObject({ calls: 1, scripted: 1, usd: 0.01 });
  });
});
