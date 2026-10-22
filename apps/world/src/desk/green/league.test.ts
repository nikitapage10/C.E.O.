import { describe, expect, it } from "vitest";
import { claimWaiting, commentatorCall, greenLinks, ordinal, readGreen, sayNumber, scoreboardLine, sleeperLeagueUrl, yardLine, type GreenBoard, type GreenPlayer } from "./league.ts";
import { roomPhrase, roomPulses, type PulseInput } from "../roomPulse.ts";
import { EMPTY_FOUNDRY } from "../../foundry.ts";

const pl = (id: string, name: string, pos: GreenPlayer["pos"], proj: number | null, over: Partial<GreenPlayer> = {}): GreenPlayer => ({ id, name, pos, team: "KC", inj: null, proj, src: "form", avg: proj, last: proj, ecr: null, posRank: null, bye: null, ...over });

function board(over: Partial<GreenBoard> = {}): GreenBoard {
  const qb = pl("1", "Quinn Arm", "QB", 20);
  const rb = pl("2", "Rex Runner", "RB", 4, { inj: "O" });
  const bench = pl("3", "Benny Bench", "RB", 14);
  const them = pl("9", "Them QB", "QB", 15);
  return {
    ok: true,
    at: "2026-10-22T12:00:00.000Z",
    season: "2026",
    week: 7,
    league: { id: "1382508114531598336", name: "Horse Meat", teams: 12, scoring: "Half PPR", faab: 100 },
    me: { rosterId: 12, team: "Denver Dream Team", record: "5-1", rank: 1, pf: 671.2, pa: 550.6, benchLeft: 39.7, faabLeft: 51, streak: "1W" },
    roster: { starters: [{ slot: "QB", player: qb, pts: 0 }, { slot: "RB", player: rb, pts: 0 }], bench: [bench], reserve: [] },
    matchup: { week: 7, me: { rosterId: 12, team: "Denver Dream Team", record: "5-1", pts: 0, proj: 103.8, starters: [{ slot: "QB", player: qb, pts: 0 }] }, them: { rosterId: 5, team: "5:30 Abdi", record: "4-2", pts: 0, proj: 77.5, starters: [{ slot: "QB", player: them, pts: 0 }] }, win: 0.877, live: false },
    swaps: [{ slot: "RB", in: bench, out: rb, gain: 14, why: "Rex Runner is out" }],
    pickups: [{ player: pl("4", "Hot Pickup", "RB", null), adds: 120000, why: "Covers for Rex Runner · added in 120k leagues today", drop: null }],
    standings: [{ rosterId: 12, team: "Denver Dream Team", wins: 5, losses: 1, ties: 0, pf: 671.2, me: true }],
    dropping: [],
    byes: [],
    sources: { sleeper: "live", fantasypros: "waiting", fpAt: null, calls: "form" },
    ...over,
  };
}

describe("the Green's board in the browser (#252)", () => {
  it("keeps a good board and drops what doesn't fit the shape", () => {
    const b = board();
    expect(readGreen(JSON.parse(JSON.stringify(b)))).toEqual(b);
    expect(readGreen({ ok: false })).toBeNull();
    expect(readGreen(null)).toBeNull();
    const messy = { ...b, pickups: [...b.pickups, { player: { id: "x", name: "No position" }, adds: 1, why: "", drop: null }], league: { ...b.league, id: "javascript:alert(1)" } };
    const got = readGreen(JSON.parse(JSON.stringify(messy)))!;
    expect(got.pickups).toHaveLength(1);
    expect(got.league.id).toBe("");
    expect(sleeperLeagueUrl(got)).toBe("https://sleeper.com");
    expect(sleeperLeagueUrl(b)).toBe("https://sleeper.com/leagues/1382508114531598336");
  });

  it("puts the ball on the field where the win chance says", () => {
    expect(yardLine(0.71)).toEqual({ x: 0.71, words: "Ball on their 29" });
    expect(yardLine(0.3)).toEqual({ x: 0.3, words: "Ball on your own 30" });
    expect(yardLine(0.5).words).toBe("Ball at midfield");
    expect(yardLine(1).words).toBe("In the end zone");
    expect([sayNumber(71), sayNumber(40), sayNumber(13), sayNumber(100)]).toEqual(["SEVENTY-ONE", "FORTY", "THIRTEEN", "ONE HUNDRED"]);
    expect([ordinal(1), ordinal(2), ordinal(3), ordinal(11), ordinal(12), ordinal(22)]).toEqual(["1st", "2nd", "3rd", "11th", "12th", "22nd"]);
  });

  it("lets the Commentator call it from the real numbers", () => {
    expect(commentatorCall(board())).toBe("EIGHTY-EIGHT PERCENT! THIS ONE'S IN THE BAG, FOLKS! Projected 103.8 to 77.5, up 26.3. And a call from the booth: start Benny Bench over Rex Runner.");
    const close = board({ matchup: { ...board().matchup!, win: 0.5, live: true, me: { ...board().matchup!.me, pts: 40 }, them: { ...board().matchup!.them!, pts: 38.5 } }, swaps: [] });
    expect(commentatorCall(close)).toBe("A COIN FLIP! FIFTY PERCENT! THE CROWD IS ON ITS FEET! Live: 40.0 to 38.5.");
    expect(commentatorCall(board({ matchup: { ...board().matchup!, them: null } }))).toMatch(/^A BYE WEEK/);
  });

  it("lights the Lattice's scoreboard and the mailbox flag", () => {
    expect(scoreboardLine(null)).toBe("-- · --");
    expect(scoreboardLine(board())).toBe("WEEK 7 · WIN 88%");
    expect(scoreboardLine(board({ matchup: { ...board().matchup!, live: true, me: { ...board().matchup!.me, pts: 61.25 }, them: { ...board().matchup!.them!, pts: 40 } } }))).toBe("US 61.3 · THEM 40.0");
    expect(claimWaiting(board())).toBe(true);
    expect(claimWaiting(board({ pickups: [{ ...board().pickups[0]!, why: "Added in 5k leagues today" }] }))).toBe(false);
  });

  it("sets the Sleeper and FantasyPros links for Systems and the Boiler Room", () => {
    expect(greenLinks("ready", board())).toEqual({ sleeper: "ok", fantasypros: "off" });
    expect(greenLinks("ready", board({ stale: true, sources: { sleeper: "live", fantasypros: "live", fpAt: null, calls: "fp" } }))).toEqual({ sleeper: "slow", fantasypros: "ok" });
    expect(greenLinks("failed", null)).toEqual({ sleeper: "down", fantasypros: "off" });
    expect(greenLinks("idle", null)).toEqual({ sleeper: "off", fantasypros: "off" });
  });

  it("makes the Green's thread on Today real, in the Commentator's voice", () => {
    const input: PulseInput = { now: Date.parse("2026-10-22T19:00:00Z"), dayStart: Date.parse("2026-10-22T06:00:00Z"), foundry: { connected: true, data: EMPTY_FOUNDRY, pending: [] }, links: [], hub: "off", owed: 0, world: null };
    const sim = roomPulses(input).find((p) => p.id === "green")!;
    expect(sim.real).toBe(false);
    const green = roomPulses({ ...input, green: { status: "ready", board: board() } }).find((p) => p.id === "green")!;
    expect(green).toMatchObject({ real: true, state: "busy", status: "Week 7: 88% to win", short: "88% to win" });
    expect(green.report).toBe("DENVER DREAM TEAM, 5-1. Week 7 against 5:30 Abdi: projected 103.8 to 77.5, 88% to win. One lineup call from the booth. Top pickup: Hot Pickup.");
    expect(roomPhrase(green)).toBe("the Green has you at 88% to win");
    expect(roomPulses({ ...input, green: { status: "failed", board: null } }).find((p) => p.id === "green")!.state).toBe("down");
    expect(roomPulses({ ...input, green: { status: "off", board: null } }).find((p) => p.id === "green")!.real).toBe(false);
  });
});
