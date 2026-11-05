import { describe, expect, it } from "vitest";
import { readBoard } from "./feed.ts";
import { ago, leaderOf, matches, newCalls, ordered, STATE_NAMES, TILES, tileFill, type Filters, type Race } from "./model.ts";

const race = (id: number, state: string, office: Race["office"], cands: [string, "D" | "R" | "I" | "O", number, boolean?][], reporting = 50, district: string | null = null): Race => ({
  id,
  office,
  state,
  district,
  name: `${STATE_NAMES[state]} ${office}`,
  reporting,
  called: cands.some((c) => c[3]),
  candidates: cands.map(([name, key, votes, winner]) => ({ name, party: key, key, votes, pct: 0, winner: !!winner })),
});

const F: Filters = { tab: "senate", state: null, party: null, following: false, query: "" };

describe("Election night's parts", () => {
  it("has a tile for every state and DC, none on the same square", () => {
    const states = Object.keys(STATE_NAMES).filter((s) => !["PR", "GU", "VI", "AS", "MP"].includes(s));
    expect(Object.keys(TILES).sort()).toEqual(states.sort());
    const squares = Object.values(TILES).map(([c, r]) => `${c},${r}`);
    expect(new Set(squares).size).toBe(squares.length);
  });

  it("names the leader only once votes are in, and the winner once called", () => {
    expect(leaderOf(race(1, "GA", "senate", [["A", "D", 0], ["B", "R", 0]]))).toBeNull();
    expect(leaderOf(race(1, "GA", "senate", [["A", "D", 10], ["B", "R", 5]]))?.name).toBe("A");
    expect(leaderOf(race(1, "GA", "senate", [["A", "D", 10], ["B", "R", 5, true]]))?.name).toBe("B");
  });

  it("colours a tile by who leads, solid only when every race there is called", () => {
    expect(tileFill([])).toEqual({ kind: "none" });
    expect(tileFill([race(1, "GA", "senate", [["A", "D", 0]])])).toEqual({ kind: "waiting" });
    expect(tileFill([race(1, "GA", "senate", [["A", "R", 9, true]])])).toEqual({ kind: "party", party: "R", called: true });
    const house = [race(1, "MN", "house", [["A", "D", 9]], 50, "1"), race(2, "MN", "house", [["B", "R", 9, true]], 50, "2")];
    expect(tileFill(house)).toMatchObject({ kind: "party", called: false, split: true });
    expect(tileFill([race(3, "CA", "measure", [["Yes", "O", 3]])])).toEqual({ kind: "measures", count: 1 });
  });

  it("filters by tab, state, leading party, follows and search", () => {
    const ga = race(1, "GA", "senate", [["Jon Ossoff", "D", 10], ["Mike Collins", "R", 5]]);
    const follows = new Set([1]);
    expect(matches(ga, F, follows)).toBe(true);
    expect(matches(ga, { ...F, tab: "house" }, follows)).toBe(false);
    expect(matches(ga, { ...F, state: "NC" }, follows)).toBe(false);
    expect(matches(ga, { ...F, party: "R" }, follows)).toBe(false);
    expect(matches(ga, { ...F, following: true }, new Set())).toBe(false);
    expect(matches(ga, { ...F, query: "georgia" }, follows)).toBe(true);
    expect(matches(ga, { ...F, query: "collins" }, follows)).toBe(true);
    expect(matches(ga, { ...F, query: "texas" }, follows)).toBe(false);
  });

  it("puts followed races on top, then the close uncalled ones", () => {
    const close = race(1, "GA", "senate", [["A", "D", 10], ["B", "R", 9]]);
    close.candidates[0]!.pct = 50.5;
    close.candidates[1]!.pct = 49.5;
    const wide = race(2, "AL", "senate", [["A", "R", 10], ["B", "D", 1]]);
    wide.candidates[0]!.pct = 90;
    wide.candidates[1]!.pct = 10;
    const called = race(3, "AK", "senate", [["A", "R", 10, true]]);
    const pinned = race(4, "WY", "senate", [["A", "R", 0]], 0);
    expect(ordered([called, wide, pinned, close], new Set([4])).map((r) => r.id)).toEqual([4, 1, 2, 3]);
  });

  it("flashes only races newly called", () => {
    const a = race(1, "GA", "senate", [["A", "D", 1]]);
    const aCalled = race(1, "GA", "senate", [["A", "D", 1, true]]);
    expect(newCalls(null, [aCalled])).toEqual(new Set());
    expect(newCalls([a], [aCalled])).toEqual(new Set([1]));
    expect(newCalls([aCalled], [aCalled])).toEqual(new Set());
  });

  it("says how long ago, plainly", () => {
    expect([ago(3_000), ago(42_000), ago(180_000), ago(7_300_000)]).toEqual(["just now", "42s ago", "3m ago", "2h ago"]);
  });

  it("drops a board that isn't one, and races off the shape", () => {
    expect(readBoard({ archived: true })).toBeNull();
    const b = readBoard({ date: "2026-11-03", at: null, source: { state: "ok", lastTry: null }, tally: {}, races: [race(1, "GA", "senate", []), { id: "x" }] });
    expect(b?.races).toHaveLength(1);
  });
});
