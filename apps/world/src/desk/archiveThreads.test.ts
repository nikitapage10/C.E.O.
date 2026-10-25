import { describe, expect, it } from "vitest";
import type { HistoryEntry, RoomId } from "../chronicle.ts";
import { threadDensity, threadPath, threadRate, threadsOf } from "./archiveThreads.ts";

const entry = (step: number, hour: number, scenes: [RoomId, number][]): HistoryEntry & { hour: number } =>
  ({
    step,
    hour,
    at: `2026-10-20T${String(hour).padStart(2, "0")}:30:00Z`,
    day: "2026-10-20",
    source: "claude",
    summary: "An hour.",
    scenes: scenes.map(([room, n]) => ({ room, title: "A scene", lines: Array.from({ length: n }, () => ({ who: "tessellate", text: "Hm." })) })),
    changes: [],
    remarks: [],
    events: [],
  }) as unknown as HistoryEntry & { hour: number };

const hourOf = (e: HistoryEntry) => (e as HistoryEntry & { hour: number }).hour;

describe("the Archive's threads (#431)", () => {
  it("runs one thread per room the day visited, in the rooms' order, with the hours it was set there", () => {
    const d = threadsOf(
      [
        entry(1, 3, [["relay", 2], ["foundry", 1]]),
        entry(2, 9, [["foundry", 3]]),
        entry(3, 9, [["foundry", 1]]),
        entry(4, 14, [["archive", 4]]),
      ],
      hourOf,
    );
    expect(d.threads.map((t) => t.room)).toEqual(["foundry", "relay", "archive"]);
    expect(d.threads[0]).toMatchObject({ hours: [3, 9], scenes: 3, lines: 5 });
    expect(d.from).toBe(3);
    expect(d.to).toBe(15);
  });

  it("an unwritten day has no threads", () => {
    expect(threadsOf([], hourOf)).toEqual({ threads: [], from: 0, to: 0 });
  });

  it("lays a thread through the written span, drawn in and knotted at its scenes", () => {
    const band = { x: 100, y: 0, w: 240, h: 60 };
    const t = { room: "foundry" as RoomId, hours: [5], scenes: 1, lines: 1 };
    const { via, knots } = threadPath(band, 0, 3, t, 4, 7);
    // Ends at the span's edges, an hour every 10 px.
    expect(via[0]![0]).toBe(140);
    expect(via.at(-1)![0]).toBe(170);
    expect(via).toHaveLength(5);
    // The top thread lies above the middle, and its knot is drawn in toward it.
    const lie = via[1]![1];
    expect(lie).toBeLessThan(30);
    expect(knots).toEqual([[155, 30 + (lie - 30) * 0.3]]);
  });

  it("keeps volume and pace in range", () => {
    expect(threadDensity(0, 10)).toBeCloseTo(0.18);
    expect(threadDensity(10, 10)).toBeCloseTo(0.7);
    expect(threadRate(0)).toBe(12);
    expect(threadRate(500)).toBe(46);
  });
});
