import { describe, expect, it } from "vitest";
import type { GreenBoard, GreenCall, GreenPlayer } from "../data/league.ts";
import { bowlCalls, bowlView, lineups } from "./bowlView.ts";
import { yardAt } from "./stadium.ts";

const pl = (id: string, name: string, pos: GreenPlayer["pos"], proj: number | null, over: Partial<GreenPlayer> = {}): GreenPlayer => ({ id, name, pos, team: "KC", inj: null, proj, src: "fp", avg: proj, last: proj, wk: null, ecr: null, posRank: null, bye: null, ...over });

function board(over: Partial<GreenBoard> = {}): GreenBoard {
  const qb = pl("1", "Quinn Arm", "QB", 20);
  const wr = pl("2", "Wade Wideout", "WR", 12, { inj: "O" });
  const them = pl("1", "Same Id QB", "QB", 15);
  return {
    ok: true,
    at: "2026-10-22T12:00:00.000Z",
    season: "2026",
    week: 7,
    league: { id: "1", name: "Horse Meat", teams: 12, scoring: "Half PPR", faab: 100 },
    me: { rosterId: 12, team: "Denver Dream Team", record: "5-1", rank: 1, pf: 671.2, pa: 550.6, benchLeft: 39.7, faabLeft: 51, streak: "1W" },
    roster: { starters: [{ slot: "QB", player: qb, pts: 11 }, { slot: "WR", player: wr, pts: 0 }], bench: [], reserve: [] },
    matchup: { week: 7, me: { rosterId: 12, team: "Denver Dream Team", record: "5-1", pts: 11, proj: 103.8, starters: [] }, them: { rosterId: 5, team: "5:30 Abdi", record: "4-2", pts: 9, proj: 77.5, starters: [{ slot: "QB", player: them, pts: 9 }] }, win: 0.71, live: true },
    swaps: [],
    pickups: [],
    standings: [],
    dropping: [],
    byes: [],
    sources: { sleeper: "live", fantasypros: "live", fpAt: null, calls: "fp", fpParts: null },
    ...over,
  };
}

const call = (start: GreenPlayer, sit: GreenPlayer, over: Partial<GreenCall> = {}): GreenCall => ({ slot: "WR", start, sit, change: false, edge: 3, slEdge: null, sleeper: "agrees", split: false, tiebreak: null, why: "", ...over });

describe("the bowl's view of the board (#824)", () => {
  it("stands both lineups on their own halves, ids kept apart, the ball on the win chance's yard line", () => {
    const v = bowlView(board());
    expect(v.men.map((m) => m.id)).toEqual(["1", "2", "t:1"]);
    for (const m of v.men) expect(m.mine ? m.along < 0.5 : m.along > 0.5).toBe(true);
    expect(v.ball).toBeCloseTo(yardAt(71));
    expect(v.me).toEqual({ team: "Denver Dream Team", score: 11 });
    expect(v.them).toEqual({ team: "5:30 Abdi", score: 9 });
    const out = v.men.find((m) => m.id === "2")!;
    expect(out.state).toBe("out");
    expect(out.banked).toBe(0);
  });

  it("shows projections before kickoff and an empty field without a board", () => {
    const b = board();
    const v = bowlView(board({ matchup: { ...b.matchup!, live: false } }));
    expect(v.me!.score).toBe(103.8);
    expect(v.men[0]!.banked).toBe(0);
    expect(v.men[0]!.proj).toBe(20);
    expect(bowlView(null)).toMatchObject({ me: null, them: null, men: [], win: null, ball: 0.5 });
    expect(lineups(null)).toEqual({ mine: [], theirs: [] });
  });

  it("sets the calls over the bowl from the board alone", () => {
    expect(bowlCalls(null)).toEqual([]);
    expect(bowlCalls(board()).map((c) => c.tag)).toEqual(["Set"]);
    const a = pl("3", "Ace Starter", "WR", 15);
    const b = pl("4", "Bo Benchwarmer Jr.", "WR", 9);
    const got = bowlCalls(
      board({
        calls: [call(a, b, { change: true }), call(b, a, { lateRisk: "Questionable, plays Sunday night" })],
        bids: [{ player: pl("5", "Wire Guy", "RB", 8), bid: 14, low: 10, high: 18, rivals: [], blocks: null, drop: null, why: "" }],
      }),
    );
    expect(got.map((c) => [c.tag, c.text, c.go])).toEqual([
      ["Start", "Ace Starter, WR · over Benchwarmer", "calls"],
      ["Watch", "Bo Benchwarmer Jr. · late-game risk", "calls"],
      ["Claim", "Wire Guy, RB · bid 14", "wire"],
    ]);
  });
});
