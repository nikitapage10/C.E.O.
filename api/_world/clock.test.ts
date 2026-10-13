import { describe, expect, it } from "vitest";
import { readClock } from "./clock.ts";
import type { Feed } from "./digest.ts";
import { runStep, STEP_EVERY_MS } from "./step.ts";
import { MemoryStore } from "./store.ts";

const T0 = Date.parse("2026-10-13T16:05:00Z");
const noFeed = async (): Promise<Feed> => ({ issues: [], comments: [], runs: [] });
const opts = { store: "memory" as const, claude: false, budget: 6, now: T0 + 60_000 };

describe("the world clock (GET /api/world-step)", () => {
  it("before the first step: no time, no source, nothing spent", () => {
    const c = readClock(null, opts);
    expect(c).toMatchObject({ at: null, step: 0, nextAt: null, source: null, spend: { month: "2026-10", usd: 0, budget: 6, calls: 0, scripted: 0 } });
  });

  it("after a scripted hour: when it ran, when the next is due, who wrote it and the month's spend", async () => {
    const store = new MemoryStore();
    await runStep({ store, now: T0, readFeed: noFeed, ask: null });
    const c = readClock(await store.loadState(), opts);
    expect(c.at).toBe(new Date(T0).toISOString());
    expect(c.nextAt).toBe(new Date(T0 + STEP_EVERY_MS).toISOString());
    expect(c.step).toBe(1);
    expect(c.source).toBe("scripted");
    expect(c.spend).toEqual({ month: "2026-10", usd: 0, budget: 6, calls: 0, scripted: 1 });
  });

  it("carries only times, counts and dollars: nothing an hour said", async () => {
    const store = new MemoryStore();
    await runStep({ store, now: T0, readFeed: noFeed, ask: null });
    const state = (await store.loadState())!;
    const clock = readClock(state, opts);
    expect(Object.keys(clock).sort()).toEqual(["at", "claude", "nextAt", "source", "spend", "step", "store"]);
    expect(JSON.stringify(clock)).not.toContain(state.recent.at(-1)!.summary);
  });
});
