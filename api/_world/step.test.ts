import { describe, expect, it, vi } from "vitest";
import { WORLD_CAST } from "./cast.ts";
import type { Feed } from "./digest.ts";
import { dayOf, runStep, STEP_EVERY_MS, type Ask } from "./step.ts";
import { MemoryStore, StaleStateError } from "./store.ts";

const HOUR = 3_600_000;
/** 10:05 am Mountain on 13 October 2026. */
const T0 = Date.parse("2026-10-13T16:05:00Z");
const noFeed = async (): Promise<Feed> => ({ issues: [], comments: [], runs: [] });

/** A stand-in for Claude: a fixed, well-formed hour, and the token use a real call reports. */
function fakeClaude(over: Record<string, unknown> = {}) {
  const answer = {
    summary: "Rocky welded a crate. Rusty apologised to it.",
    scenes: [
      {
        room: "foundry",
        title: "The crate",
        lines: [
          { who: "caret", text: "Crate done done done!" },
          { who: "tessellate", text: "Sorry, crate." },
        ],
      },
    ],
    changes: [{ a: "caret", b: "tessellate", kind: "friend", note: "Rocky waited for the safety briefing. Once." }],
    remarks: [],
    recap: "",
    ...over,
  };
  return vi.fn<Ask>(async () => ({ answer, usage: { input_tokens: 9000, output_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }));
}

describe("the hourly world step", () => {
  it("takes the first step from the cast's own relationships and saves the hour", async () => {
    const store = new MemoryStore();
    const ask = fakeClaude();
    const r = await runStep({ store, now: T0, readFeed: noFeed, ask });
    expect(r.stepped).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(store.state!.step).toBe(1);
    expect(store.state!.at).toBe(new Date(T0).toISOString());
    expect(store.state!.recent).toHaveLength(1);
    expect(store.state!.recent[0]!.source).toBe("claude");
    const rel = store.state!.relationships.find((x) => x.a === "caret" && x.b === "tessellate")!;
    expect(rel.kind).toBe("friend");
    expect(rel.since).toBe(new Date(T0).toISOString());
    expect((await store.readDay("2026-10-13")).entries.map((e) => e.step)).toEqual([1]);
  });

  it("is idempotent per hour: a second call within 55 minutes does nothing and spends nothing", async () => {
    const store = new MemoryStore();
    const ask = fakeClaude();
    await runStep({ store, now: T0, readFeed: noFeed, ask });
    const saved = structuredClone(store.state);
    const again = await runStep({ store, now: T0 + 30 * 60_000, readFeed: noFeed, ask });
    expect(again.stepped).toBe(false);
    if (!again.stepped) {
      expect(again.entry?.step).toBe(1);
      expect(again.nextAt).toBe(new Date(T0 + STEP_EVERY_MS).toISOString());
    }
    const nearly = await runStep({ store, now: T0 + STEP_EVERY_MS - 1, readFeed: noFeed, ask });
    expect(nearly.stepped).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(store.state).toEqual(saved);
  });

  it("steps again once the hour has passed", async () => {
    const store = new MemoryStore();
    const ask = fakeClaude();
    await runStep({ store, now: T0, readFeed: noFeed, ask });
    const r = await runStep({ store, now: T0 + STEP_EVERY_MS, readFeed: noFeed, ask });
    expect(r.stepped).toBe(true);
    expect(store.state!.step).toBe(2);
    expect(store.state!.recent.map((e) => e.step)).toEqual([1, 2]);
  });

  it("lets only one of two racing steps land", async () => {
    const store = new MemoryStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: Ask = async (p, s) => {
      await gate;
      return fakeClaude()(p, s);
    };
    const a = runStep({ store, now: T0, readFeed: noFeed, ask: slow });
    const b = runStep({ store, now: T0, readFeed: noFeed, ask: slow });
    release();
    const results = await Promise.allSettled([a, b]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: expect.any(StaleStateError) });
    expect((await store.readDay("2026-10-13")).entries).toHaveLength(1);
  });

  it("writes the hour from the scripted lines when Claude isn't set up", async () => {
    const store = new MemoryStore();
    const r = await runStep({ store, now: T0, readFeed: noFeed, ask: null });
    expect(r.stepped && r.entry.source).toBe("scripted");
    expect(r.stepped && r.entry.scenes.length).toBeGreaterThan(0);
    expect(r.stepped && r.entry.cost).toBeNull();
    expect(store.state!.spend["2026-10"]).toMatchObject({ usd: 0, calls: 0, scripted: 1 });
  });

  it("falls back to the scripted hour when Claude's answer is unusable, but still counts what it cost", async () => {
    const store = new MemoryStore();
    const ask = vi.fn<Ask>(async () => ({ answer: { nonsense: true }, usage: { input_tokens: 1000, output_tokens: 10 } }));
    const r = await runStep({ store, now: T0, readFeed: noFeed, ask });
    expect(r.stepped && r.entry.source).toBe("scripted");
    expect(store.state!.spend["2026-10"]!.calls).toBe(1);
    expect(store.state!.spend["2026-10"]!.usd).toBeGreaterThan(0);
  });

  it("gives each job that shipped this hour a line from its builder", async () => {
    const store = new MemoryStore();
    const feed = async (): Promise<Feed> => ({
      issues: [
        { number: 41, title: "Idea: Keep the Lattice alive", state: "closed", created_at: "2026-10-13T05:00:00Z", closed_at: new Date(T0 - 10 * 60_000).toISOString(), body: "**Builder:** Rocky (Opus)", labels: ["foundry", "foundry:build", "foundry:shipped"] },
      ],
      comments: [],
      runs: [],
    });
    const ask = fakeClaude({ remarks: [{ issue: 41, text: "Lattice lives! Amaze amaze amaze." }, { issue: 7, text: "Not shipped this hour." }] });
    const r = await runStep({ store, now: T0, readFeed: feed, ask });
    expect(r.stepped && r.entry.remarks).toEqual([{ issue: 41, title: "Keep the Lattice alive", who: "caret", text: "Lattice lives! Amaze amaze amaze." }]);
    expect(store.state!.remarks[0]).toMatchObject({ issue: 41, who: "caret" });
    expect(r.stepped && r.entry.events[0]).toMatch(/Shipped: #41 Keep the Lattice alive \(built by Rocky\)/);
  });

  it("the first step after midnight (Mountain) writes the day in Ilyr for the day that ended", async () => {
    const store = new MemoryStore();
    const late = Date.parse("2026-10-14T05:30:00Z"); // 11:30 pm Mountain, 13 October
    await runStep({ store, now: late, readFeed: noFeed, ask: null });
    const ask = fakeClaude({ recap: "The Historian records a long day." });
    const r = await runStep({ store, now: late + HOUR, readFeed: noFeed, ask });
    expect(dayOf(late)).toBe("2026-10-13");
    expect(r.stepped && r.entry.day).toBe("2026-10-14");
    expect(r.stepped && r.entry.recap).toEqual({ day: "2026-10-13", text: "The Historian records a long day." });
    expect(ask.mock.calls[0]![0].user).toContain("the day in Ilyr (recap) for 2026-10-13");
    expect((await store.readDay("2026-10-13")).recap).toBe("The Historian records a long day.");
    expect(store.state!.recapped).toBe("2026-10-13");
    // ...and only once.
    const next = await runStep({ store, now: late + 2 * HOUR, readFeed: noFeed, ask });
    expect(next.stepped && next.entry.recap).toBeUndefined();
  });

  it("keeps a day index, newest first, and remembers only the last day's worth of hours", async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 30; i++) await runStep({ store, now: T0 + i * HOUR, readFeed: noFeed, ask: null });
    expect(store.state!.step).toBe(30);
    expect(store.state!.recent).toHaveLength(24);
    expect(store.state!.days).toEqual(["2026-10-14", "2026-10-13"]);
  });

  it("only uses agents from the cast", () => {
    expect(WORLD_CAST.members.length).toBeGreaterThan(20);
  });
});
