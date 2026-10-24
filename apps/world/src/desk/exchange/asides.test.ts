import { BOOKIE_WORLD_QUIPS } from "@ceo/simulator";
import { describe, expect, it } from "vitest";
import { asideBadge, asideLine, byMove, moveWords, seedOf, shortName } from "./asides.ts";
import { isPmWorld, readBoard, type PmWorld } from "./polymarket.ts";
import { bookieWorldLine } from "../../rooms/liveBoards.ts";

const W = (id: string, over: Partial<PmWorld> = {}): PmWorld => ({
  id,
  question: "NATO x Russia military clash by December 31, 2026?",
  outcome: "Yes",
  prob: 0.175,
  change24h: -0.14,
  volume24h: 260_000,
  volume: 4_000_000,
  endDate: null,
  url: "https://polymarket.com/event/nato-x-russia-military-clash-in-2025",
  closed: false,
  spark: [],
  kind: "geopolitics",
  ...over,
});

describe("the Bookie's asides (#345)", () => {
  it("has lines for every topic, moved and still, each naming the market", () => {
    for (const set of Object.values(BOOKIE_WORLD_QUIPS)) {
      expect(set.moved.length).toBeGreaterThan(1);
      expect(set.still.length).toBeGreaterThan(1);
      for (const l of [...set.moved, ...set.still]) expect(l).toContain("{market}");
      for (const l of set.moved) expect(l).toContain("{move}");
    }
  });

  it("says the move in words and keeps a market's line steady", () => {
    expect(moveWords(W("1"))).toBe("down fourteen");
    expect(moveWords(W("1", { change24h: 0.04 }))).toBe("up four");
    const line = asideLine(W("1"));
    expect(line).toContain("NATO x Russia military clash");
    expect(line).not.toMatch(/\{|\$/);
    expect(asideLine(W("1"))).toBe(line);
    expect(seedOf("1")).toBeGreaterThanOrEqual(0);
    expect(seedOf("1")).toBeLessThan(1);
  });

  it("picks a still line when the market didn't move", () => {
    const still = asideLine(W("2", { change24h: 0.002, kind: "politics", question: "Balance of power?" }), 0);
    expect(still).toBe(BOOKIE_WORLD_QUIPS.politics.still[0]!.replace(/\{market\}/g, "Balance of power").replace(/\{odds\}/g, "18%"));
  });

  it("tags the biggest mover and the busiest", () => {
    const world = [W("1"), W("2", { change24h: 0.01, volume24h: 900_000, kind: "politics" }), W("3", { change24h: null, kind: "culture" })];
    expect(asideBadge(world[0]!, world)).toBe("Moved most today");
    expect(asideBadge(world[1]!, world)).toBe("Busiest today");
    expect(asideBadge(world[2]!, world)).toBe("Live");
  });

  it("reads only well-formed world markets off the board, and the podium waits without them", () => {
    expect(isPmWorld(W("1"))).toBe(true);
    expect(isPmWorld({ ...W("1"), kind: "sports" })).toBe(false);
    const b = readBoard({ ok: true, at: "x", top: [], watch: [], world: [W("1"), { ...W("2"), kind: "nfl" }, { ...W("3"), url: "javascript:1" }] })!;
    expect(b.world.map((m) => m.id)).toEqual(["1"]);
    expect(readBoard({ ok: true, at: "x", top: [], watch: [] })!.world).toEqual([]);
    expect(bookieWorldLine([], 0, 0)).toBeNull();
    expect(bookieWorldLine([W("1")], 0.5, 0.1)).toContain("NATO");
  });
});

describe("what the Bookie calls a market", () => {
  it("drops the question mark and the deadline", () => {
    expect(shortName("NATO x Russia military clash by December 31, 2026?")).toBe("NATO x Russia military clash");
    expect(shortName("Will the Iranian regime fall before 2027?")).toBe("Will the Iranian regime fall");
    expect(shortName("US x Iran ceasefire continues through October 31?")).toBe("US x Iran ceasefire continues");
    expect(shortName("2026 Balance of Power: R Senate, R House")).toBe("2026 Balance of Power: R Senate, R House");
    expect(shortName("X by 2026?")).toBe("X by 2026");
  });
});

describe("the movers rail (#367)", () => {
  it("puts the biggest move first, either way, and unknown moves last", () => {
    const xs = [{ id: "a", change24h: 0.02 }, { id: "b", change24h: null }, { id: "c", change24h: -0.15 }, { id: "d", change24h: 0.07 }];
    expect(byMove(xs).map((x) => x.id)).toEqual(["c", "d", "a", "b"]);
    expect(xs.map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });
});
