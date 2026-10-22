import { describe, expect, it } from "vitest";
import { bidCandidates, bidsFor, callsFor, ceilingOf, floorOf, seeded, simulate, teamsFor, tradeFor, type OddsTeam, type RosterView } from "./analyst.ts";
import { shapeNews, shapeRankings } from "./fantasypros.ts";
import { shapeSlProjections, shapeTransactions, slField } from "./sleeper.ts";
import type { GreenPlayer, GreenSlot, GreenTeam } from "./types.ts";

/**
 * The Green's analyst desk (#276): FantasyPros decides each call with Sleeper beside it, the tiebreak only within a
 * point, every team's needs and surplus, FAAB bids, one trade, and the seeded playoff simulation. Plus the new shapers
 * for Sleeper's projections and transactions and FantasyPros' news and expert ranges.
 */

const pl = (id: string, pos: GreenPlayer["pos"], proj: number | null, over: Partial<GreenPlayer> = {}): GreenPlayer => ({
  id,
  name: `Player ${id}`,
  pos,
  team: "KC",
  inj: null,
  proj,
  src: "fp",
  avg: proj,
  last: null,
  wk: null,
  ecr: null,
  posRank: null,
  bye: null,
  ...over,
});
const slot = (s: string, p: GreenPlayer | null): GreenSlot => ({ slot: s, player: p, pts: 0 });
const never = () => false;

describe("calls: FantasyPros decides, Sleeper sits beside it (#276)", () => {
  it("a clear FantasyPros edge that Sleeper shares is no call at all", () => {
    const a = pl("1", "WR", 15, { sl: 14 });
    const b = pl("2", "WR", 8, { sl: 7 });
    expect(callsFor([slot("WR", a)], [b], [], 8, 0.5, never)).toEqual([]);
  });

  it("Sleeper ordering the pair the other way makes a split decision, but FantasyPros still decides", () => {
    const a = pl("1", "WR", 12, { sl: 9 });
    const b = pl("2", "WR", 10.5, { sl: 11 });
    const [c] = callsFor([slot("WR", a)], [b], [], 8, 0.5, never);
    expect(c).toMatchObject({ start: { id: "1" }, sit: { id: "2" }, change: false, edge: 1.5, slEdge: -2, sleeper: "disagrees", split: true, tiebreak: null });
    expect(c!.why).toContain("Sleeper: 9.0 to 11.0");
  });

  it("margins 3 or more apart are a split even when both agree on the order", () => {
    const [c] = callsFor([slot("RB", pl("1", "RB", 11, { sl: 16 }))], [pl("2", "RB", 9.5, { sl: 9.5 })], [], 8, 0.5, never);
    expect(c).toMatchObject({ sleeper: "agrees", split: true, edge: 1.5, slEdge: 6.5 });
  });

  it("within a point the underdog leans to the higher ceiling and the favourite to the safer floor", () => {
    const steady = pl("1", "WR", 10, { sl: 9.8 });
    const boom = pl("2", "WR", 9.6, { sl: 13 });
    expect(ceilingOf(boom)).toBe(13);
    expect(floorOf(steady)).toBe(9.8);
    const under = callsFor([slot("WR", steady)], [boom], [], 8, 0.3, never)[0]!;
    expect(under.start.id).toBe("2");
    expect(under.change).toBe(true);
    expect(under.tiebreak).toMatch(/underdog \(30%\), so lean ceiling/);
    const fav = callsFor([slot("WR", steady)], [boom], [], 8, 0.7, never)[0]!;
    expect(fav.start.id).toBe("1");
    expect(fav.change).toBe(false);
    expect(fav.tiebreak).toMatch(/favoured \(70%\), so lean floor/);
  });

  it("never offers a bench player on bye or out, nor a locked one", () => {
    const a = pl("1", "WR", 10);
    expect(callsFor([slot("WR", a)], [pl("2", "WR", 9.9, { bye: 8 })], [], 8, 0.5, never)).toEqual([]);
    expect(callsFor([slot("WR", a)], [pl("3", "WR", 9.9, { inj: "O" })], [], 8, 0.5, never)).toEqual([]);
    expect(callsFor([slot("WR", a)], [pl("4", "WR", 9.9)], [], 8, 0.5, (id) => id === "4")).toEqual([]);
  });
});

const SLOTS = ["QB", "RB", "WR", "TE", "FLEX"];
function roster(rosterId: number, base: number, over: Partial<RosterView> = {}, extra: GreenPlayer[] = []): RosterView {
  const id = (s: string) => `${rosterId}${s}`;
  return {
    rosterId,
    team: `Team ${rosterId}`,
    wins: 3,
    losses: 3,
    ties: 0,
    pf: 600,
    faab: 50,
    games: 6,
    opp: null,
    players: [pl(id("01"), "QB", base + 8), pl(id("02"), "RB", base), pl(id("03"), "RB", base - 2), pl(id("04"), "WR", base), pl(id("05"), "WR", base - 2), pl(id("06"), "TE", base - 5), ...extra],
    ...over,
  };
}

describe("the whole league (#276)", () => {
  const rosters = [roster(1, 6), roster(2, 12), roster(3, 14, {}, [pl("3099", "RB", 13)]), roster(4, 11)];
  const teams = teamsFor(SLOTS, rosters, 8, [new Set(), new Set()], new Map(), null);

  it("finds each team's needs, surplus and rank by position", () => {
    expect(teams.find((t) => t.rosterId === 1)!.needs).toEqual(expect.arrayContaining(["QB", "RB", "WR", "TE"]));
    expect(teams.find((t) => t.rosterId === 3)!.surplus).toContain("RB");
    expect(teams.find((t) => t.rosterId === 3)!.posRank).toMatchObject({ QB: 1, RB: 1 });
    expect(teams.find((t) => t.rosterId === 1)!.posRank).toMatchObject({ QB: 4 });
  });

  it("a bye coming leaves a hole even for a strong team", () => {
    const [t] = teamsFor(SLOTS, [roster(5, 20)], 8, [new Set(["KC"]), new Set()], new Map(), null);
    expect(t!.needs).toEqual(expect.arrayContaining(["QB", "TE"]));
  });

  it("prices a bid against the rivals who need him and never past what Nikita has", () => {
    const rank = new Map([[1, 4], [2, 3], [3, 1], [4, 2]]);
    const short = teams.map((t) => (t.rosterId === 2 ? { ...t, needs: ["RB"], faab: 40 } : t));
    const target = pl("9001", "RB", 9, { ecr: 40, posRank: "RB18" });
    const [bid] = bidsFor([{ player: target, adds: 0, drop: null, covers: false }], short, 1, 100, 30, rank, []);
    expect(bid!.rivals).toEqual(["Team 2"]);
    expect(bid!.blocks).toBe("Team 2");
    expect(bid!.rivals.length).toBeGreaterThan(0);
    expect(bid!.bid).toBeGreaterThan(0);
    expect(bid!.bid).toBeLessThanOrEqual(30);
    expect(bid!.low).toBeLessThanOrEqual(bid!.bid);
    expect(bid!.high).toBeGreaterThanOrEqual(bid!.bid);
    expect(bid!.why).toMatch(/FantasyPros #40 \(RB18\)/);
  });

  it("with no rival short there, the league's typical winning bid caps it; without FAAB a claim is free", () => {
    const none: GreenTeam[] = teams.map((t) => ({ ...t, needs: [] }));
    const target = pl("9002", "WR", 12, { ecr: 10 });
    const [capped] = bidsFor([{ player: target, adds: 0, drop: null, covers: false }], none, 1, 100, 100, new Map(), [3, 4, 5]);
    expect(capped!.bid).toBe(4);
    expect(capped!.why).toMatch(/no rival is short at WR/);
    const [free] = bidsFor([{ player: target, adds: 0, drop: null, covers: false }], none, 1, null, null, new Map(), []);
    expect(free).toMatchObject({ bid: 0, low: 0, high: 0 });
  });

  it("picks at most two candidates a position and skips anyone out", () => {
    const free = [pl("a", "RB", 9, { ecr: 30 }), pl("b", "RB", 9, { ecr: 31 }), pl("c", "RB", 9, { ecr: 32 }), pl("d", "WR", 9, { ecr: 60 }), pl("e", "WR", 9, { ecr: 5, inj: "IR" })];
    const got = bidCandidates(free, {}, teams[0], rosters[0]!.players, SLOTS, 8).map((p) => p.id);
    expect(got).toEqual(["a", "b", "d"]);
  });

  it("finds one trade: their spare where Nikita is thin, paid from his spare where they're thin", () => {
    const me = roster(1, 10, {}, [pl("1099", "WR", 9.5)]);
    const rival = roster(3, 14, {}, [pl("3099", "RB", 9.5)]);
    const all = [me, roster(2, 12), rival, roster(4, 11)];
    const base = (rosterId: number, posRank: Record<string, number>, needs: string[], surplus: string[]): GreenTeam => ({ rosterId, team: `Team ${rosterId}`, wins: 3, losses: 3, ties: 0, pf: 600, faab: 50, needs, surplus, posRank, opp: null, proj: null, playoff: null });
    const t = [base(1, { QB: 2, RB: 4, WR: 1, TE: 2 }, ["RB"], ["WR"]), base(2, { QB: 3, RB: 2, WR: 2, TE: 3 }, [], []), base(3, { QB: 1, RB: 1, WR: 4, TE: 1 }, ["WR"], ["RB"]), base(4, { QB: 4, RB: 3, WR: 3, TE: 4 }, [], [])];
    const trade = tradeFor(SLOTS, me, all.filter((r) => r.rosterId !== 1), t);
    expect(trade).not.toBeNull();
    expect(trade!.team).toBe("Team 3");
    expect(trade!.give[0]!.pos).toBe("WR");
    expect(trade!.get[0]!.pos).toBe("RB");
  });
});

describe("the playoff simulation (#276)", () => {
  const T = (rosterId: number, wins: number, mean: number): OddsTeam => ({ rosterId, team: `Team ${rosterId}`, wins, losses: 6 - wins, ties: 0, pf: 600 + wins * 20, mean, sd: 20 });
  const teams = [T(1, 3, 100), T(2, 5, 110), T(3, 1, 90), T(4, 3, 100)];
  const weeks = [[{ a: 1, b: 3 }, { a: 2, b: 4 }], [{ a: 1, b: 2 }, { a: 3, b: 4 }]];

  it("is the same every time for the same seed, and the odds add up", () => {
    const one = simulate(teams, weeks, 1, 2, 42, 2000)!;
    const two = simulate(teams, weeks, 1, 2, 42, 2000)!;
    expect(one.odds).toEqual(two.odds);
    expect(one.odds.seeds).toHaveLength(2);
    expect(one.odds.seeds.reduce((a, b) => a + b, 0)).toBeCloseTo(one.odds.playoff, 2);
    const total = [...one.byTeam.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(2, 2);
    expect(one.byTeam.get(2)!).toBeGreaterThan(one.byTeam.get(3)!);
  });

  it("names the other game that moves Nikita's chance, rooting against his rival for the spot", () => {
    const { odds } = simulate(teams, weeks, 1, 2, 7, 3000)!;
    expect(odds.swing[0]).toMatchObject({ root: "Team 2", a: "Team 2", b: "Team 4" });
    expect(odds.swing[0]!.ifWin).toBeGreaterThan(odds.swing[0]!.ifLose);
  });

  it("has nothing to say without Nikita's team or the games", () => {
    expect(simulate(teams, weeks, 99, 2, 1)).toBeNull();
    expect(simulate(teams, [], 1, 2, 1)).toBeNull();
    const r = seeded(5);
    expect(r()).toBe(seeded(5)());
  });
});

describe("the new reads (#276)", () => {
  it("Sleeper's projections: the league's scoring field, opponent checked, nonsense left out", () => {
    expect(slField(0.5)).toBe("pts_half_ppr");
    expect(slField(1)).toBe("pts_ppr");
    expect(slField(0)).toBe("pts_std");
    const got = shapeSlProjections(
      [
        { player_id: "4046", opponent: "mia", stats: { pts_half_ppr: 14.26, pts_ppr: 17 } },
        { player_id: "KC", opponent: "XXX", stats: { pts_half_ppr: 7 } },
        { player_id: "<b>", stats: { pts_half_ppr: 9 } },
        { player_id: "99", stats: { pts_half_ppr: 900 } },
        { player_id: "98", stats: {} },
      ],
      0.5,
    );
    expect(got).toEqual({ "4046": { pts: 14.3, opp: "MIA" }, KC: { pts: 7, opp: null } });
  });

  it("transactions: completed moves only, newest first, with the winning bid", () => {
    const got = shapeTransactions([
      { status: "complete", type: "waiver", roster_ids: [3], adds: { "123": 3 }, drops: { "456": 3 }, settings: { waiver_bid: 17 }, status_updated: 1_760_000_000_000 },
      { status: "failed", type: "waiver", roster_ids: [4], adds: { "123": 4 }, settings: { waiver_bid: 30 }, status_updated: 1_760_000_100_000 },
      { status: "complete", type: "trade", roster_ids: [1, 2], adds: { "7": 1, "8": 2 }, drops: { "7": 2, "8": 1 }, created: 1_760_000_200_000 },
      { status: "complete", type: "commissioner", roster_ids: [1] },
    ]);
    expect(got.map((m) => m.kind)).toEqual(["trade", "waiver"]);
    expect(got[1]).toMatchObject({ rosterIds: [3], adds: { "123": 3 }, drops: { "456": 3 }, bid: 17 });
  });

  it("FantasyPros: the experts' range, tier, roster share and move; news headlines without links", () => {
    const [r] = shapeRankings({ players: [{ player_id: 17, player_name: "Some Receiver", player_position_id: "WR", player_team_id: "KC", rank_ecr: 30, pos_rank: "WR12", rank_min: 18, rank_max: 52, rank_std: 6.84, tier: 4, player_owned_avg: 88.6, player_ecr_delta: -3 }] });
    expect(r).toMatchObject({ min: 18, max: 52, std: 6.8, tier: 4, own: 89, delta: -3 });
    const news = shapeNews({ items: [{ player_id: 17, player_name: "Some Receiver", title: "Some Receiver limited Wednesday", link: "https://example.test/x", created: "2026-10-21T18:00:00Z" }, { title: "" }] });
    expect(news).toEqual([{ fpid: "17", name: "Some Receiver", text: "Some Receiver limited Wednesday", at: "2026-10-21T18:00:00.000Z" }]);
  });
});
