import { beforeEach, describe, expect, it } from "vitest";
import { FP_PATH, forgetMemory, MemoryGreenStore, PLAYERS_PATH, SCHEDULE_PATH } from "./cache.ts";
import { FpUnavailable, fpIndex, fpKey, nameKey, readFantasyPros, statusOf, scoringOf, shapeInjuries, shapeProjections, shapeRankings, kickoffOf, type FpData } from "./fantasypros.ts";
import { LATE_GAME_RISK_GAP, buildBoard, byeTeams, formOf, formProjection, lineupSwaps, normCdf, slotTakes, winChance } from "./model.ts";
import { callsFor } from "./analyst.ts";
import { FP_SHAPE, forgetGreen, GET, isGreen, PATH, type GreenDeps } from "./route.ts";
import { LEAGUE_ID, NFL_TEAMS, USER_ID, byesOf, cleanText, shapeLeague, shapeClaimed, shapeSchedule, shapeMatchups, shapeRosters, shapeTeamNames, slimPlayers, type Fetcher } from "./sleeper.ts";
import type { GreenBoard, GreenPlayer } from "./types.ts";
import { GET as worldGET } from "../world.ts";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const FP_KEY = "fp-test-key-0123456789";
const THEM = "111111111111111111";

/* ── a small league: Nikita (roster 12) against roster 5, week 3 ── */

const P = (id: string, name: string, position: string, team: string | null, over: Record<string, unknown> = {}) => [id, { player_id: id, full_name: name, first_name: name.split(" ")[0], last_name: name.split(" ").slice(1).join(" "), position, team, search_rank: 100, yahoo_id: Number(id) + 9000, sportradar_id: null, injury_status: null, bio: "lots of fields the Green never keeps", ...over }] as const;

const PLAYERS = Object.fromEntries([
  P("1", "Quinn Arm", "QB", "KC"),
  P("2", "Rex Runner", "RB", "DAL"),
  P("3", "Rob Rusher", "RB", "NYJ", { injury_status: "Out" }),
  P("4", "Will Wide", "WR", "MIN"),
  P("5", "Walt Wider", "WR", "SF"),
  P("6", "Ty End", "TE", "BAL"),
  P("7", "Benny Bench", "RB", "DET"),
  P("8", "Wes Waiver", "WR", "GB", { search_rank: 40 }),
  P("9", "Old Guy", "WR", null),
  P("10", "Them QB", "QB", "BUF"),
  P("11", "Them RB", "RB", "PHI"),
  P("12", "Kicker Kid", "K", "LV"),
  P("13", "Lino Backer", "LB", "CHI"),
  P("14", "Hot Pickup", "RB", "ATL", { search_rank: 60 }),
  P("15", "Deep Bench", "WR", "HOU", { search_rank: 900 }),
  P("16", "Spare Part", "WR", "TEN", { search_rank: 950 }),
  ["MIN", { player_id: "MIN", position: "DEF", team: "MIN", first_name: "Minnesota", last_name: "Vikings" }],
  ["SEA", { player_id: "SEA", position: "DEF", team: "SEA", first_name: "Seattle", last_name: "Seahawks" }],
  ["bad id!", { position: "QB", team: "KC", full_name: "Nope" }],
]);

const LEAGUE = { league_id: LEAGUE_ID, name: "Horse Meat", season: "2026", total_rosters: 2, roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "BN", "BN", "BN", "IR"], scoring_settings: { rec: 0.5 }, settings: { waiver_type: 2, waiver_budget: 100, playoff_week_start: 15 } };
const ROSTERS = [
  { roster_id: 12, owner_id: USER_ID, players: ["1", "2", "3", "4", "5", "6", "7", "15", "16", "MIN"], starters: ["1", "2", "3", "4", "5", "6", "15", "MIN"], reserve: [], settings: { wins: 2, losses: 0, ties: 0, fpts: 240, fpts_decimal: 50, fpts_against: 200, fpts_against_decimal: 0, ppts: 260, ppts_decimal: 0, waiver_budget_used: 30 }, metadata: { streak: "2W" } },
  { roster_id: 5, owner_id: THEM, players: ["10", "11", "SEA"], starters: ["10", "11", "0", "0", "0", "0", "0", "SEA"], reserve: [], settings: { wins: 0, losses: 2, ties: 0, fpts: 150, fpts_decimal: 0, fpts_against: 240, fpts_against_decimal: 50 }, metadata: {} },
];
const USERS = [
  { user_id: USER_ID, display_name: "nikitapage10", metadata: { team_name: "Denver Dream Team" } },
  { user_id: THEM, display_name: "a-username-never-shown", metadata: { team_name: "5:30 Abdi" } },
];
const row = (rid: number, mid: number, starters: string[], pp: Record<string, number>) => ({ roster_id: rid, matchup_id: mid, starters, starters_points: starters.map((s) => pp[s] ?? 0), players_points: pp, points: starters.reduce((a, s) => a + (pp[s] ?? 0), 0) });
const WEEK1 = [row(12, 1, ROSTERS[0]!.starters, { "1": 20, "2": 12, "3": 10, "4": 15, "5": 9, "6": 8, "7": 18, "15": 1, MIN: 6 }), row(5, 1, ROSTERS[1]!.starters, { "10": 18, "11": 9, SEA: 5 })];
const WEEK2 = [row(12, 1, ROSTERS[0]!.starters, { "1": 24, "2": 14, "3": 0, "4": 17, "5": 11, "6": 10, "7": 16, "15": 2, MIN: 10 }), row(5, 1, ROSTERS[1]!.starters, { "10": 16, "11": 7, SEA: 3 })];
const WEEK3 = [row(12, 2, ROSTERS[0]!.starters, {}), row(5, 2, ROSTERS[1]!.starters, {})];
const TREND_ADD = [{ player_id: "14", count: 120_000 }, { player_id: "8", count: 50_000 }, { player_id: "4", count: 90_000 }, { player_id: "13", count: 99 }];
const TREND_DROP = [{ player_id: "15", count: 4000 }];

/** A season's games as Sleeper's schedule lists them, with the given teams on bye in the given weeks. */
function scheduleWith(byes: Record<number, string[]>): { status: string; date: string; home: string; away: string; week: number; game_id: string }[] {
  const games = [];
  for (let week = 1; week <= 18; week++) {
    const teams = [...NFL_TEAMS].filter((t) => !(byes[week] ?? []).includes(t));
    for (let i = 0; i + 1 < teams.length; i += 2) games.push({ status: "pre_game", date: "2026-10-25", home: teams[i]!, away: teams[i + 1]!, week, game_id: `${week}${i}` });
  }
  return games;
}
/** Week 3: Arizona and Houston (Deep Bench's team) rest. */
const SCHEDULE = scheduleWith({ 3: ["ARI", "HOU"] });

/** A stand-in for Sleeper (and FantasyPros): answers by URL, and counts the calls. */
function fakeApis(opts: { sleeperDown?: boolean; fpDown?: boolean; rosters?: unknown; schedule?: unknown; weeklyDown?: boolean } = {}) {
  const calls: { url: string; key: string | null }[] = [];
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const fetcher: Fetcher = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, key: headers["x-api-key"] ?? null });
    const u = new URL(url);
    if (u.hostname === "api.fantasypros.com") {
      if (opts.fpDown) return new Response("down", { status: 500 });
      if (u.pathname.endsWith("/projections")) {
        const pos = u.searchParams.get("position");
        const players = pos === "RB" ? [{ fpid: "101", name: "Rex Runner", position_id: "RB", team_id: "DAL", stats: { points: 9, points_half: 11.5, points_ppr: 14 } }, { fpid: "102", name: "Benny Bench", position_id: "RB", team_id: "DET", stats: [{ points: 15, points_half: 17, points_ppr: 19 }] }] : pos === "DST" ? [{ name: "Minnesota Vikings", position_id: "DST", team_id: "MIN", stats: { points: 8, points_half: 8, points_ppr: 8 } }] : [];
        return ok({ season: "2026", week: "3", players });
      }
      if (u.pathname.endsWith("/consensus-rankings") && u.searchParams.get("type") === "WEEKLY") {
        const pos = u.searchParams.get("position");
        if (opts.weeklyDown) return new Response("bad", { status: 400 });
        const players = pos === "RB" ? [{ player_id: 101, player_name: "Rex Runner", player_team_id: "DAL", player_position_id: "RB", player_yahoo_id: "9002", rank_ecr: 5, pos_rank: "RB5", player_bye_week: "8" }, { player_id: 102, player_name: "Benny Bench", player_team_id: "DET", player_position_id: "RB", player_yahoo_id: "9007", rank_ecr: 12, pos_rank: "RB12", player_bye_week: "6" }] : pos === "DST" ? [{ player_id: 300, player_name: "Minnesota Vikings", player_team_id: "MIN", player_position_id: "DST", rank_ecr: 4, pos_rank: "DST4", player_bye_week: "6" }] : [];
        return ok({ players });
      }
      if (u.pathname.endsWith("/consensus-rankings")) {
        return ok({ players: [{ player_id: 201, player_name: "Wes Waiver", player_team_id: "GB", player_position_id: "WR", player_yahoo_id: "9008", rank_ecr: 30, pos_rank: "WR15", player_bye_week: "9" }, { player_id: 202, player_name: "Hot Pickup", player_team_id: "ATL", player_position_id: "RB", player_yahoo_id: "9014", rank_ecr: 80, pos_rank: "RB30", player_bye_week: "5" }, { player_id: 203, player_name: "Deep Bench", player_team_id: "HOU", player_position_id: "WR", player_yahoo_id: "9015", rank_ecr: 300, pos_rank: "WR99", player_bye_week: "3" }, { player_id: 204, player_name: "Spare Part", player_team_id: "TEN", player_position_id: "WR", player_yahoo_id: "9016", rank_ecr: 400, pos_rank: "WR120", player_bye_week: "10" }] });
      }
      if (u.pathname.endsWith("/injuries")) return ok({ injuries: [{ name: "Walt Wider", yahoo_id: "9005", status_short: "Q" }] });
      if (u.pathname.endsWith("/nfl/news")) return ok({ items: [{ player_id: 101, player_name: "Rex Runner", title: "Rex Runner (ankle) expected to play Sunday", created: "2026-10-21T18:00:00Z", link: "https://example.com/never-kept" }, { player_name: "Nobody Here", title: "A player outside the league" }] });
      return new Response("nope", { status: 404 });
    }
    if (opts.sleeperDown) return new Response("down", { status: 503 });
    if (u.hostname === "api.sleeper.com") return u.pathname === "/schedule/nfl/regular/2026" && opts.schedule !== null ? ok(opts.schedule ?? SCHEDULE) : new Response("nope", { status: 404 });
    const path = u.pathname.replace("/v1", "");
    if (path === "/state/nfl") return ok({ season: "2026", league_season: "2026", display_week: 3, week: 3, season_type: "regular" });
    if (path === `/league/${LEAGUE_ID}`) return ok(LEAGUE);
    if (path === `/league/${LEAGUE_ID}/rosters`) return ok(opts.rosters ?? ROSTERS);
    if (path === `/league/${LEAGUE_ID}/users`) return ok(USERS);
    if (path === `/league/${LEAGUE_ID}/matchups/1`) return ok(WEEK1);
    if (path === `/league/${LEAGUE_ID}/matchups/2`) return ok(WEEK2);
    if (path === `/league/${LEAGUE_ID}/matchups/3`) return ok(WEEK3);
    if (path === "/players/nfl/trending/add") return ok(TREND_ADD);
    if (path === "/players/nfl/trending/drop") return ok(TREND_DROP);
    if (path === "/players/nfl") {
      // The real list is ~15 MB; pad this one so the "too short" guard passes.
      const pad = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [String(5000 + i), { position: "WR", team: "NE", full_name: `Filler ${i}`, search_rank: 5000 + i }]));
      return ok({ ...PLAYERS, ...pad });
    }
    return new Response("nope", { status: 404 });
  };
  return { fetcher, calls };
}

const deps = (fetcher: Fetcher, over: Partial<GreenDeps> = {}): GreenDeps => ({ fetcher, store: new MemoryGreenStore(), fpKey: null, now: NOW, ...over });
const get = (path = PATH) => new Request(`https://ceo.test${path}`);

beforeEach(() => {
  forgetGreen();
  forgetMemory();
});

describe("Sleeper's answers, trimmed (#252)", () => {
  it("keeps only fantasy positions on a team, with clean names and checked ids", () => {
    const slim = slimPlayers(PLAYERS);
    expect(slim["1"]).toEqual({ id: "1", n: "Quinn Arm", pos: "QB", team: "KC", inj: null, rank: 100, yh: "9001", sr: null });
    expect(slim["3"]!.inj).toBe("O");
    expect(slim.MIN!.n).toBe("Vikings D/ST");
    expect(slim["9"]).toBeUndefined(); // no team
    expect(slim["13"]).toBeUndefined(); // linebacker
    expect(slim["bad id!"]).toBeUndefined();
    expect(JSON.stringify(slim)).not.toContain("never keeps");
  });

  it("cleans text and reads the league, rosters and team names", () => {
    expect(cleanText("  A\u202eB\u0007  C ")).toBe("A B C");
    expect(cleanText("x".repeat(80), 10)).toHaveLength(10);
    const l = shapeLeague(LEAGUE);
    expect(l).toMatchObject({ id: LEAGUE_ID, name: "Horse Meat", rec: 0.5, faab: 100, slots: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF"] });
    const r = shapeRosters(ROSTERS);
    expect(r[0]).toMatchObject({ rosterId: 12, pf: 240.5, ppts: 260, faabUsed: 30, streak: "2W" });
    expect(r[1]!.ppts).toBeNull();
    expect(shapeTeamNames(USERS)).toEqual({ [USER_ID]: "Denver Dream Team", [THEM]: "5:30 Abdi" });
    expect(shapeMatchups([{ roster_id: 1, matchup_id: 2, players_points: { "1": 5, "x y": 3, "2": 9999 } }])[0]!.playerPoints).toEqual({ "1": 5 });
    expect(() => shapeLeague({ league_id: "nope" })).toThrow();
  });
});

describe("the predictions (#252)", () => {
  it("works out form, win chances and which slots take whom", () => {
    const form = formOf([shapeMatchups(WEEK1), shapeMatchups(WEEK2)]);
    expect(form.get("1")).toEqual([20, 24]);
    expect(form.get("3")).toEqual([10]); // a zero week is a bye or an injury, not a score
    expect(formProjection([10, 20, 30, 40])).toBe(0.6 * 30 + 0.4 * 25);
    expect(formProjection([-3])).toBe(0);
    expect(formProjection(undefined)).toBeNull();
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(winChance({ proj: 110, varr: 200 }, { proj: 90, varr: 200 })).toBeGreaterThan(0.8);
    expect(winChance({ proj: 90, varr: 0 }, { proj: 100, varr: 0 })).toBe(0);
    expect(slotTakes("FLEX")).toEqual(["RB", "WR", "TE"]);
    expect(slotTakes("BN")).toEqual([]);
  });

  it("starts the bench player over an injured starter, and leaves locked players alone", () => {
    const pl = (id: string, pos: GreenPlayer["pos"], proj: number | null, inj: GreenPlayer["inj"] = null): GreenPlayer => ({ id, name: `P${id}`, pos, team: "KC", inj, proj, src: "form", avg: proj, last: proj, wk: null, ecr: null, posRank: null, bye: null });
    const current = [
      { slot: "RB", player: pl("a", "RB", 0, "O"), pts: 0 },
      { slot: "WR", player: pl("b", "WR", 9), pts: 0 },
      { slot: "FLEX", player: pl("c", "WR", 4), pts: 12 },
    ];
    const bench = [pl("d", "RB", 11), pl("e", "WR", 9.2), pl("f", "WR", 15)];
    const swaps = lineupSwaps(["RB", "WR", "FLEX"], current, bench, (id) => id === "c", 3);
    expect(swaps.map((s) => [s.slot, s.in.id, s.out?.id])).toEqual([
      ["WR", "f", "b"],
      ["RB", "d", "a"],
    ]);
    expect(swaps[1]!.why).toBe("Pa is out");
    expect(swaps[0]!.gain).toBe(6);
  });

  it("builds the board from Sleeper alone", () => {
    const board = sleeperOnlyBoard();
    expect(board.me).toMatchObject({ team: "Denver Dream Team", record: "2-0", rank: 1, pf: 240.5, benchLeft: 19.5, faabLeft: 70, streak: "2W" });
    expect(board.league).toEqual({ id: LEAGUE_ID, name: "Horse Meat", teams: 2, scoring: "Half PPR", faab: 100 });
    expect(board.roster.starters.map((s) => s.slot)).toEqual(["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF"]);
    expect(board.roster.starters[2]!.player).toMatchObject({ name: "Rob Rusher", inj: "O", proj: 0 });
    expect(board.matchup).toMatchObject({ week: 3, live: false, them: { team: "5:30 Abdi", record: "0-2" } });
    expect(board.matchup!.win!).toBeGreaterThan(0.9);
    // Benny Bench (17 a game) comes in for the injured Rob Rusher; Deep Bench (1.5) sits for nobody better.
    expect(board.swaps[0]).toMatchObject({ slot: "RB", in: { name: "Benny Bench" }, out: { name: "Rob Rusher" }, why: "Rob Rusher is out" });
    // Pickups by today's adds, free agents only (Will Wide is rostered, the linebacker isn't a fantasy position here).
    expect(board.pickups.map((p) => p.player.name)).toEqual(["Hot Pickup", "Wes Waiver"]);
    expect(board.pickups[0]!.why).toBe("Covers for Rob Rusher · added in 120k leagues today");
    expect(board.pickups[0]!.drop?.name).toBe("Spare Part"); // never scored here, and far down Sleeper's own ranks
    expect(board.pickups[1]!.drop).toBeNull(); // nobody else is clearly worse
    expect(board.dropping).toEqual([{ player: expect.objectContaining({ name: "Deep Bench" }), drops: 4000 }]);
    expect(board.sources).toEqual({ sleeper: "live", fantasypros: "waiting", fpAt: null, calls: "form", fpParts: null });
    expect(board.byes).toEqual([]); // no schedule given: nobody is taken for on bye
    expect(JSON.stringify(board)).not.toContain("a-username-never-shown");
  });

  it("refuses a league Nikita has no team in", () => {
    const input = boardInput();
    expect(() => buildBoard({ ...input, rosters: input.rosters.filter((r) => r.rosterId !== 12) })).toThrow("not-in-league");
  });
});

describe("byes, whatever FantasyPros says (#259)", () => {
  it("reads the schedule warily: unknown teams and weeks dropped, a thin week says nothing", () => {
    const s = shapeSchedule([...SCHEDULE, { week: 3, home: "XYZ", away: "KC" }, { week: 40, home: "KC", away: "DAL" }, { week: 3, home: "KC", away: "KC" }, "junk", null]);
    expect(Object.keys(s)).toHaveLength(18);
    expect(s["3"]).not.toContain("XYZ");
    expect(byesOf(s, 3)).toEqual(["ARI", "HOU"]);
    expect(byesOf(s, 4)).toEqual([]);
    expect(byesOf(s, 19)).toBeNull(); // no games that week: unknown, not a league-wide bye
    expect(byesOf(shapeSchedule(scheduleWith({ 3: [...NFL_TEAMS].slice(0, 12) })), 3)).toBeNull(); // twelve teams resting can't be right
    expect(byesOf(null, 3)).toBeNull();
  });

  it("never offers a pickup who is on bye, out, or already being claimed (#531)", () => {
    const base = boardInput();
    const names = (b: ReturnType<typeof buildBoard>) => b.pickups.map((p) => p.player.name);
    // A free defence with adds shows up, until his team is on bye.
    const withDef = { ...base, players: { ...base.players, JAX: { id: "JAX", n: "JAX D/ST", pos: "DEF" as const, team: "JAX", inj: null, rank: 9999, yh: null, sr: null } }, adds: { ...base.adds, JAX: 500 } };
    expect(names(buildBoard(withDef))).toContain("JAX D/ST");
    const byeBoard = buildBoard({ ...withDef, schedule: shapeSchedule(scheduleWith({ 3: ["JAX", "GB"] })) });
    expect(names(byeBoard)).not.toContain("JAX D/ST");
    expect(names(byeBoard)).not.toContain("Wes Waiver"); // GB is on bye too
    expect(names(byeBoard)).toContain("Hot Pickup");
    // An Out player is dropped, and so is a doubtful one.
    for (const status of ["O", "D"] as const) {
      const hurt = { ...base, players: { ...base.players, "14": { ...base.players["14"]!, inj: status } } };
      expect(names(buildBoard(hurt))).toEqual(["Wes Waiver"]);
    }
    // A pending claim by another team drops him; with no claim read the others stay.
    expect(names(buildBoard({ ...base, claimed: ["14"] }))).toEqual(["Wes Waiver"]);
    expect(names(buildBoard(base))).toEqual(["Hot Pickup", "Wes Waiver"]);
  });

  it("reads pending and just-completed waiver and free-agent adds as claimed, and nothing else (#531)", () => {
    const raw = [
      { status: "pending", type: "waiver", adds: { "14": 3 }, roster_ids: [3] },
      { status: "complete", type: "free_agent", adds: { "8": 4 }, roster_ids: [4] },
      { status: "failed", type: "waiver", adds: { "15": 5 }, roster_ids: [5] },
      { status: "complete", type: "trade", adds: { "16": 6 }, roster_ids: [6] },
      { status: "pending", type: "waiver", adds: { "bad id!": 1 } },
    ];
    expect([...shapeClaimed(raw)].sort()).toEqual(["14", "8"]);
    expect(shapeClaimed(null).size).toBe(0);
    expect(shapeClaimed("nope").size).toBe(0);
  });

  it("puts a starter on bye from Sleeper's schedule alone: zero, a bye tag, and the call says so", () => {
    const board = buildBoard({ ...boardInput(), schedule: shapeSchedule(scheduleWith({ 3: ["DAL", "ARI"] })) });
    expect(board.byes).toEqual(["ARI", "DAL"]);
    const rex = board.roster.starters[1]!.player!;
    expect(rex).toMatchObject({ name: "Rex Runner", team: "DAL", proj: 0, bye: 3 });
    expect(board.swaps.find((x) => x.out?.name === "Rex Runner")).toMatchObject({ in: { name: "Benny Bench" }, why: "Rex Runner is on bye" });
    expect(board.sources.calls).toBe("form");
  });

  it("never infers a bye from teams missing in FantasyPros' projections: its answer can be partial (#266)", () => {
    // Projections for every team but Dallas (and Arizona), none for Rex Runner, and no schedule.
    const teams = [...NFL_TEAMS].filter((t) => t !== "DAL" && t !== "ARI");
    const fp: FpData = { at: "x", season: "2026", week: 3, scoring: "HALF", proj: [...teams.map((t, i) => ({ name: `Some One ${i}`, pos: "WR" as const, team: t, pts: 9 })), { name: "Benny Bench", pos: "RB", team: "DET", pts: 15 }], ranks: [], injuries: [] };
    expect(byeTeams(null, fp, 3)).toEqual(new Set());
    expect(byeTeams(null, { ...fp, week: 2 }, 3)).toBeNull();
    const board = buildBoard({ ...boardInput(), fp, fpState: "live" });
    expect(board.byes).toEqual([]);
    const rex = board.roster.starters[1]!.player!;
    expect(rex.bye).toBeNull();
    expect(rex.src).toBe("form");
    expect(rex.proj).toBeGreaterThan(0);
    expect(board.sources.calls).toBe("fp");
  });

  it("never says to start a player on bye or out, however high his projection", () => {
    const pl = (id: string, pos: GreenPlayer["pos"], proj: number | null, over: Partial<GreenPlayer> = {}): GreenPlayer => ({ id, name: `P${id}`, pos, team: "KC", inj: null, proj, src: "fp", avg: proj, last: proj, wk: null, ecr: null, posRank: null, bye: null, ...over });
    const current = [
      { slot: "WR", player: pl("a", "WR", 6), pts: 0 },
      { slot: "RB", player: pl("b", "RB", 14, { bye: 7 }), pts: 0 },
    ];
    const bench = [pl("c", "WR", 25, { bye: 7 }), pl("d", "WR", 22, { inj: "O" }), pl("e", "RB", 3)];
    const swaps = lineupSwaps(["WR", "RB"], current, bench, () => false, 7);
    expect(swaps.map((s) => [s.in.id, s.out?.id, s.why])).toEqual([["e", "b", "Pb is on bye"]]);
    // With nobody to bring in, a starter on bye stays put rather than being swapped for someone also on bye.
    expect(lineupSwaps(["RB"], [current[1]!], [pl("f", "RB", 30, { bye: 7 })], () => false, 7)).toEqual([]);
  });
});

describe("the Tuten case: FantasyPros live in week 7, Jacksonville on bye (#259)", () => {
  // Bhayshul Tuten (Sleeper 12490, RB, JAX) started for Nikita in week 7 of 2026 with a big form line, and the board
  // said to keep starting him though Jacksonville had no game.
  const TUTEN = { player_id: "12490", full_name: "Bhayshul Tuten", first_name: "Bhayshul", last_name: "Tuten", position: "RB", team: "JAX", search_rank: 80, yahoo_id: null, sportradar_id: null, injury_status: null };
  const tutenInput = (fp: FpData | null, schedule: ReturnType<typeof shapeSchedule> | null = null) => {
    const base = boardInput();
    const rosters = shapeRosters([{ ...ROSTERS[0]!, players: ROSTERS[0]!.players.map((id) => (id === "2" ? "12490" : id)), starters: ROSTERS[0]!.starters.map((id) => (id === "2" ? "12490" : id)) }, ROSTERS[1]]);
    const hot = shapeMatchups([row(12, 1, rosters[0]!.starters, { "12490": 24, "7": 9 })]);
    return { ...base, state: { season: "2026", week: 7, type: "regular" }, rosters, players: slimPlayers({ ...PLAYERS, "12490": TUTEN }), history: [...base.history, hot], matchups: [], fp, fpState: fp ? ("live" as const) : ("waiting" as const), schedule };
  };
  // FantasyPros' week 7: projections for every team but Jacksonville and three others on bye, Benny Bench among them.
  const BYES7 = ["BUF", "JAX", "LAC", "WAS"];
  const proj7 = [...NFL_TEAMS].filter((t) => !BYES7.includes(t)).map((t, i) => ({ fpid: String(500 + i), name: `Some Back ${i}`, pos: "RB" as const, team: t, pts: 7 }));
  const fp7 = (over: Partial<FpData>): FpData => ({ at: "x", season: "2026", week: 7, scoring: "HALF", proj: [...proj7, { fpid: "102", name: "Benny Bench", pos: "RB", team: "DET", pts: 12 }], weekly: [], ranks: [], injuries: [], ...over });
  const expectBenched = (board: GreenBoard) => {
    const tuten = board.roster.starters.find((x) => x.player?.id === "12490")!.player!;
    expect(tuten).toMatchObject({ name: "Bhayshul Tuten", team: "JAX", proj: 0, bye: 7 });
    expect(board.swaps.some((x) => x.in.id === "12490")).toBe(false);
    expect(board.swaps.find((x) => x.out?.id === "12490")).toMatchObject({ in: { name: "Benny Bench" }, why: "Bhayshul Tuten is on bye" });
    expect(board.sources.calls).toBe(board.sources.fantasypros === "live" ? "fp" : "form");
  };

  it("benches him on FantasyPros' own bye week for him (player_bye_week, a string)", () => {
    const ranks = shapeRankings({ players: [{ player_id: 9001, player_name: "Bhayshul Tuten", player_team_id: "JAC", player_position_id: "RB", rank_ecr: 40, pos_rank: "RB20", player_bye_week: "7" }] });
    expect(ranks[0]).toMatchObject({ team: "JAX", bye: 7, fpid: "9001" });
    expectBenched(buildBoard(tutenInput(fp7({ ranks }))));
  });

  it("a partial FantasyPros answer (week 7 came back short) puts nobody on bye: the schedule and its own bye weeks decide (#266)", () => {
    const partial = fp7({ proj: [...proj7.slice(0, 10), { fpid: "102", name: "Benny Bench", pos: "RB", team: "DET", pts: 12 }] });
    const board = buildBoard(tutenInput(partial));
    expect(board.byes).toEqual([]);
    const tuten = board.roster.starters.find((x) => x.player?.id === "12490")!.player!;
    expect(tuten).toMatchObject({ bye: null, src: "form" });
    expect(tuten.proj).toBeGreaterThan(0);
    // With the schedule, only the real byes count.
    const withSchedule = buildBoard(tutenInput(partial, shapeSchedule(scheduleWith({ 7: BYES7 }))));
    expect(withSchedule.byes).toEqual(BYES7);
    expectBenched(withSchedule);
  });

  it("benches him on Sleeper's schedule when FantasyPros can't say", () => {
    expectBenched(buildBoard(tutenInput(fp7({ proj: [{ fpid: "102", name: "Benny Bench", pos: "RB", team: "DET", pts: 12 }] }), shapeSchedule(scheduleWith({ 7: BYES7 })))));
    expectBenched(buildBoard(tutenInput(null, shapeSchedule(scheduleWith({ 7: BYES7 })))));
  });

  it("lets his form stand in when FantasyPros leaves him out, never benching him for that alone (#266)", () => {
    const fp = fp7({ proj: [...proj7, { fpid: "777", name: "Other Jag", pos: "RB", team: "JAX", pts: 6 }, { fpid: "102", name: "Benny Bench", pos: "RB", team: "DET", pts: 1 }] });
    const board = buildBoard(tutenInput(fp));
    const tuten = board.roster.starters.find((x) => x.player?.id === "12490")!.player!;
    expect(tuten).toMatchObject({ src: "form", bye: null });
    expect(tuten.proj).toBeGreaterThan(0);
    expect(board.swaps.some((x) => x.out?.id === "12490")).toBe(false);
  });
});

describe("the Goedert case: FantasyPros' figure as published (#340)", () => {
  // Week 7 of 2026: FantasyPros had Dallas Goedert (questionable, knee) at 8.8 in half PPR, the league's scoring; the
  // board showed 7.5, its own 85% questionable discount on top of FantasyPros' number.
  const fp: FpData = {
    at: "x",
    season: "2026",
    week: 3,
    scoring: "HALF",
    proj: [
      { name: "Walt Wider", pos: "WR", team: "SF", pts: 8.8 },
      { name: "Will Wide", pos: "WR", team: "MIN", pts: 10 },
      { name: "Ty End", pos: "TE", team: "BAL", pts: 7 },
    ],
    weekly: [],
    ranks: [],
    injuries: shapeInjuries({ injuries: [{ name: "Walt Wider", yahoo_id: "9005", status_short: "Q" }, { name: "Ty End", yahoo_id: "9006", status_short: "D" }] }),
  };
  const input = () => ({ ...boardInput(), players: slimPlayers({ ...PLAYERS, "7": P("7", "Benny Bench", "RB", "DET", { injury_status: "Questionable" })[1] }), fp, fpState: "live" as const });
  const find = (board: GreenBoard, name: string) => [...board.roster.starters.map((x) => x.player), ...board.roster.bench].find((p) => p?.name === name)!;

  it("uses a questionable player's FantasyPros projection as published, and keeps that figure beside it", () => {
    const board = buildBoard(input());
    expect(find(board, "Walt Wider")).toMatchObject({ inj: "Q", proj: 8.8, fp: 8.8, src: "fp" });
    expect(find(board, "Will Wide")).toMatchObject({ proj: 10, fp: 10 });
  });

  it("still scales a doubtful player, but shows FantasyPros' own number as fp", () => {
    expect(find(buildBoard(input()), "Ty End")).toMatchObject({ inj: "D", proj: 2.1, fp: 7 });
  });

  it("a questionable player on form alone still takes the 85%, with no FantasyPros figure", () => {
    const benny = find(buildBoard(input()), "Benny Bench");
    expect(benny).toMatchObject({ inj: "Q", src: "form", fp: null });
    expect(benny.proj).toBe(Math.round(formProjection([18, 16])! * 0.85 * 10) / 10);
  });
});

describe("FantasyPros (#252)", () => {
  it("reads the key only from FANTASYPROS, and maps the league's scoring", () => {
    expect(fpKey({ FANTASYPROS: "  abc  " })).toBe("abc");
    expect(fpKey({ FANTASYPROS: " " })).toBeNull();
    expect(fpKey({})).toBeNull();
    expect([scoringOf(0), scoringOf(0.5), scoringOf(1)]).toEqual(["STD", "HALF", "PPR"]);
  });

  it("matches FantasyPros' players to Sleeper's by id, then by name", () => {
    expect(nameKey("D.K. Metcalf Jr.")).toBe("dkmetcalf");
    expect(nameKey("Amon-Ra St. Brown")).toBe("amonrastbrown");
    const fp: FpData = {
      at: "x",
      season: "2026",
      week: 3,
      scoring: "HALF",
      proj: shapeProjections({ players: [{ name: "Rex Runner", position_id: "RB", team_id: "DAL", stats: { points_half: 11.5 } }, { name: "Vikings", position_id: "DST", team_id: "MIN", stats: { points_half: 8 } }, { name: "Junk", position_id: "RB", stats: { points_half: "lots" } }] }, "HALF", "RB"),
      ranks: shapeRankings({ players: [{ player_name: "Somebody Else", player_position_id: "WR", player_team_id: "JAC", player_yahoo_id: "9004", rank_ecr: 12, pos_rank: "WR6", player_bye_week: "7" }] }),
      injuries: shapeInjuries({ injuries: [{ name: "Walt Wider", yahoo_id: "1", status_short: "Q" }] }),
    };
    expect(fp.proj).toHaveLength(2);
    expect(fp.ranks[0]!.team).toBe("JAX");
    const view = fpIndex(fp);
    const slim = slimPlayers(PLAYERS);
    expect(view(slim["2"]!)).toMatchObject({ proj: 11.5, ecr: null });
    expect(view(slim.MIN!)).toMatchObject({ proj: 8 });
    expect(view(slim["4"]!)).toMatchObject({ ecr: 12, posRank: "WR6", bye: 7 }); // by Yahoo id, whatever the name
    expect(view(slim["5"]!)).toMatchObject({ inj: "Q" }); // by name
    expect(view(slim["1"]!)).toBeNull();
  });
});

describe("GET /api/green-league (#252)", () => {
  it("answers the board from Sleeper alone, cached, and says FantasyPros is waiting", async () => {
    const { fetcher, calls } = fakeApis();
    const res = await GET(get(), deps(fetcher));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=120, stale-while-revalidate=240");
    const board = (await res.json()) as GreenBoard;
    expect(board.sources.fantasypros).toBe("waiting");
    expect(board.me.team).toBe("Denver Dream Team");
    expect(calls.some((c) => c.url.includes("fantasypros"))).toBe(false);
    const n = calls.length;
    await GET(get(), deps(fetcher, { now: NOW + 30_000 }));
    expect(calls.length).toBe(n); // a warm instance answers from memory
  });

  it("sends a made-up query back to the bare address, and is reached through the world feed", async () => {
    const res = await GET(get(`${PATH}?z=1`), deps(fakeApis().fetcher));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(PATH);
    expect(isGreen(get("/api/world?green=league"))).toBe(true);
    expect(isGreen(get("/api/world"))).toBe(false);
    const viaWorld = await worldGET(get("/api/world?green=league&x=2"));
    expect(viaWorld.status).toBe(308);
  });

  it("keeps the trimmed players list in the store, so a cold instance doesn't read the 15 MB list again", async () => {
    const store = new MemoryGreenStore();
    const a = fakeApis();
    await GET(get(), deps(a.fetcher, { store }));
    expect(a.calls.filter((c) => c.url.endsWith("/players/nfl"))).toHaveLength(1);
    const kept = JSON.parse(store.files.get(PLAYERS_PATH)!) as { tag: string; value: Record<string, unknown> };
    expect(kept.tag).toBe("nfl");
    expect(JSON.stringify(kept)).not.toContain("never keeps");
    forgetGreen();
    forgetMemory();
    const b = fakeApis();
    await GET(get(), deps(b.fetcher, { store, now: NOW + 3_600_000 }));
    expect(b.calls.filter((c) => c.url.endsWith("/players/nfl"))).toHaveLength(0);
  });

  it("reads the byes from Sleeper's schedule without a FantasyPros key, once a day", async () => {
    const store = new MemoryGreenStore();
    const { fetcher, calls } = fakeApis();
    const board = (await (await GET(get(), deps(fetcher, { store }))).json()) as GreenBoard;
    expect(board.sources.fantasypros).toBe("waiting");
    expect(board.byes).toEqual(["ARI", "HOU"]);
    expect(board.roster.starters.find((s) => s.player?.name === "Deep Bench")!.player).toMatchObject({ proj: 0, bye: 3 });
    expect(board.swaps.find((x) => x.out?.name === "Deep Bench")?.why).toBe("Deep Bench is on bye");
    expect(calls.filter((c) => c.url === "https://api.sleeper.com/schedule/nfl/regular/2026")).toHaveLength(1);
    expect(JSON.parse(store.files.get(SCHEDULE_PATH)!).tag).toBe("2026");
    // Without the schedule the board still answers, just without the byes.
    forgetGreen();
    forgetMemory();
    const none = (await (await GET(get(), deps(fakeApis({ schedule: null }).fetcher))).json()) as GreenBoard;
    expect(none.byes).toEqual([]);
  });

  it("uses FantasyPros with the key: projections, consensus pickups and injuries, the key only in its header", async () => {
    const { fetcher, calls } = fakeApis();
    const res = await GET(get(), deps(fetcher, { fpKey: FP_KEY }));
    const text = await res.text();
    expect(text).not.toContain(FP_KEY);
    const board = JSON.parse(text) as GreenBoard;
    expect(board.sources.fantasypros).toBe("live");
    const fpCalls = calls.filter((c) => c.url.startsWith("https://api.fantasypros.com/public/v2/json/"));
    expect(fpCalls.length).toBe(13); // QB, RB, WR, TE, DST projections and weekly consensus, the ROS consensus, the injuries, the news
    expect(fpCalls.some((c) => c.url.includes("/nfl/2026/consensus-rankings?position=RB&type=WEEKLY&scoring=HALF&week=3"))).toBe(true);
    expect(board.sources.calls).toBe("fp");
    expect(board.sources.fpParts).toMatchObject({ proj: 3, weekly: 3, ros: 4, injuries: 1, errors: [] });
    expect(Object.values(board.sources.fpParts!.projBy ?? {}).reduce((a, b) => a + b, 0)).toBe(3);
    expect(fpCalls.every((c) => c.key === FP_KEY && !c.url.includes(FP_KEY))).toBe(true);
    expect(calls.filter((c) => !c.url.includes("fantasypros")).every((c) => c.key === null)).toBe(true);
    expect(fpCalls.some((c) => c.url.includes("/nfl/2026/projections?position=DST&week=3&scoring=HALF"))).toBe(true);
    const rex = board.roster.starters[1]!.player!;
    expect(rex).toMatchObject({ name: "Rex Runner", proj: 11.5, src: "fp", wk: 5, bye: 8 });
    // Players FantasyPros leaves out keep their form here, marked as form (#266).
    expect(board.roster.starters[0]!.player).toMatchObject({ name: "Quinn Arm", src: "form" });
    expect(board.swaps.every((x) => x.in.src === "fp")).toBe(true);
    expect(board.roster.starters.find((s) => s.player?.name === "Walt Wider")!.player!.inj).toBe("Q");
    // Deep Bench (on bye this week) sits; Pickups follow the consensus, Spare Part (WR120) is the clear drop for the WR,
    // and Benny Bench, whom the consensus doesn't rank, is never the one cut.
    expect(board.pickups.map((p) => p.player.name)).toEqual(["Wes Waiver", "Hot Pickup"]);
    expect(board.pickups[0]!.why).toBe("FantasyPros #30 (WR15) rest of season · added in 50k leagues today");
    expect(board.pickups[0]!.drop?.name).toBe("Spare Part");
    expect(board.pickups[1]!.drop).toBeNull();
    expect(board.roster.starters.find((x) => x.player?.name === "Deep Bench")!.player).toMatchObject({ proj: 0, bye: 3 });
    expect(board.swaps.some((x) => x.in.bye === 3)).toBe(false);
  });

  it("still answers when FantasyPros fails, and says which parts failed how, never with the key", async () => {
    const { fetcher } = fakeApis({ fpDown: true });
    const text = await (await GET(get(), deps(fetcher, { fpKey: FP_KEY }))).text();
    expect(text).not.toContain(FP_KEY);
    expect(text).not.toContain("api.fantasypros.com");
    const board = JSON.parse(text) as GreenBoard;
    expect(board.sources.fantasypros).toBe("failed");
    expect(board.sources.calls).toBe("form");
    expect(board.sources.fpParts!.errors).toContainEqual({ part: "projections RB", status: 500 });
    expect(board.sources.fpParts!.errors).toContainEqual({ part: "ROS rankings", status: 500 });
    expect(board.roster.starters[0]!.player!.src).toBe("form");
  });

  it("notes a part that failed while the rest answered, and keeps its copy under the new shape's tag", async () => {
    const store = new MemoryGreenStore();
    const board = (await (await GET(get(), deps(fakeApis({ weeklyDown: true }).fetcher, { fpKey: FP_KEY, store }))).json()) as GreenBoard;
    expect(board.sources.fantasypros).toBe("live");
    expect(board.sources.fpParts!.weekly).toBe(0);
    expect(board.sources.fpParts!.errors).toContainEqual({ part: "weekly RB", status: 400 });
    const kept = JSON.parse(store.files.get(FP_PATH)!) as { tag: string };
    expect(kept.tag).toBe(`${FP_SHAPE}-2026-3-HALF`);
    expect(FP_SHAPE).not.toBe("");
    expect(statusOf(new Error("upstream 403"))).toBe(403);
    expect(statusOf(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe("timeout");
    expect(statusOf(new Error("https://api.fantasypros.com/?k=secret"))).toBe("error");
  });

  it("throws with the parts when nothing from FantasyPros answers", async () => {
    const { fetcher } = fakeApis({ fpDown: true });
    const e = await readFantasyPros(fetcher, FP_KEY, "2026", 3, 0.5, ["QB", "RB"]).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FpUnavailable);
    expect((e as FpUnavailable).parts).toMatchObject({ proj: 0, weekly: 0, ros: 0, injuries: 0 });
    expect(JSON.stringify((e as FpUnavailable).parts)).not.toContain(FP_KEY);
  });

  it("says when Nikita isn't in the league, and when Sleeper is down; a last good board stands in for a while", async () => {
    const notIn = await GET(get(), deps(fakeApis({ rosters: [ROSTERS[1]] }).fetcher));
    expect(notIn.status).toBe(404);
    expect(await notIn.json()).toEqual({ error: "not-in-league" });
    const down = await GET(get(), deps(fakeApis({ sleeperDown: true }).fetcher));
    expect(down.status).toBe(502);
    await GET(get(), deps(fakeApis().fetcher));
    const stale = await GET(get(), deps(fakeApis({ sleeperDown: true }).fetcher, { now: NOW + 10 * 60_000 }));
    expect(stale.status).toBe(200);
    expect(stale.headers.get("cache-control")).toBe("no-store");
    expect(((await stale.json()) as GreenBoard).stale).toBe(true);
  });
});

function boardInput() {
  const slim = slimPlayers(PLAYERS);
  return {
    league: shapeLeague(LEAGUE),
    state: { season: "2026", week: 3, type: "regular" },
    rosters: shapeRosters(ROSTERS),
    teamNames: shapeTeamNames(USERS),
    matchups: shapeMatchups(WEEK3),
    history: [shapeMatchups(WEEK1), shapeMatchups(WEEK2)],
    players: slim,
    adds: Object.fromEntries(TREND_ADD.map((t) => [t.player_id, t.count])),
    drops: Object.fromEntries(TREND_DROP.map((t) => [t.player_id, t.count])),
    fp: null,
    fpState: "waiting" as const,
    at: new Date(NOW).toISOString(),
  };
}

function sleeperOnlyBoard(): GreenBoard {
  return buildBoard(boardInput());
}

describe("late-game risk: a Q/D starter in a later window than a close bench alternative (#370)", () => {
  const SUN = Date.parse("2026-10-25T17:00:00Z"); // Sunday 1pm ET
  const MON_ET = Date.parse("2026-10-27T00:15:00Z"); // Monday 8:15pm ET
  const pl = (id: string, name: string, pos: GreenPlayer["pos"], fp: number, over: Partial<GreenPlayer> = {}): GreenPlayer => ({ id, name, pos, team: "KC", inj: null, proj: fp, fp, src: "fp", avg: fp, last: fp, wk: null, ecr: null, posRank: null, bye: null, ...over });
  const slots = ["RB", "WR", "FLEX"];
  const base = () => [
    { slot: "RB", player: pl("1", "Rex", "RB", 15, { ko: SUN }), pts: 0 },
    { slot: "WR", player: pl("2", "Wes", "WR", 14, { ko: SUN }), pts: 0 },
  ];

  it("the threshold is a named constant", () => {
    expect(LATE_GAME_RISK_GAP).toBe(1.5);
  });

  it("recommends Tucker (Sunday) over a questionable Goedert (Monday) when FantasyPros has them under 1.5 apart", () => {
    const goedert = pl("3", "Dallas Goedert", "TE", 8.8, { inj: "Q", ko: MON_ET });
    const tucker = pl("4", "Tucker Kraft", "TE", 7.6, { ko: SUN });
    const current = [...base(), { slot: "FLEX", player: goedert, pts: 0 }];
    const swaps = lineupSwaps(slots, current, [tucker], () => false, 8);
    expect(swaps).toHaveLength(1);
    expect(swaps[0]).toMatchObject({ slot: "FLEX", in: { id: "4" }, out: { id: "3" } });
    expect(swaps[0]!.lateRisk).toMatch(/^Late-game risk: Dallas Goedert is questionable and kicks off Monday; Tucker Kraft plays Sunday/);
    const calls = callsFor(current, [tucker], swaps, 8, 0.6, () => false);
    expect(calls[0]).toMatchObject({ change: true, start: { id: "4" }, sit: { id: "3" } });
    expect(calls[0]!.lateRisk).toContain("Late-game risk");
    expect(calls[0]!.tiebreak).toBeNull();
  });

  it("keeps the questionable starter when the gap is 1.5 or more", () => {
    const goedert = pl("3", "Dallas Goedert", "TE", 9.1, { inj: "Q", ko: MON_ET });
    const tucker = pl("4", "Tucker Kraft", "TE", 7.6, { ko: SUN });
    expect(lineupSwaps(slots, [...base(), { slot: "FLEX", player: goedert, pts: 0 }], [tucker], () => false, 8)).toEqual([]);
  });

  it("does nothing for a healthy starter, an alternative in the same window, or an unknown kickoff", () => {
    const run = (s: Partial<GreenPlayer>, a: Partial<GreenPlayer>) => lineupSwaps(slots, [...base(), { slot: "FLEX", player: pl("3", "G", "TE", 8.8, { ko: MON_ET, ...s }), pts: 0 }], [pl("4", "T", "TE", 7.6, { ko: SUN, ...a })], () => false, 8);
    expect(run({}, {})).toEqual([]);
    expect(run({ inj: "Q", ko: SUN + 30 * 60_000 }, {})).toEqual([]);
    expect(run({ inj: "Q", ko: null }, {})).toEqual([]);
    expect(run({ inj: "Q" }, { ko: null })).toEqual([]);
    expect(run({ inj: "Q" }, { inj: "Q" })).toEqual([]);
  });

  it("applies to a doubtful starter too, and byes still come first", () => {
    const doubt = lineupSwaps(slots, [...base(), { slot: "FLEX", player: pl("3", "G", "TE", 8.8, { inj: "D", ko: MON_ET }), pts: 0 }], [pl("4", "T", "TE", 8.0, { ko: SUN })], () => false, 8);
    expect(doubt[0]).toMatchObject({ in: { id: "4" }, out: { id: "3" } });
    // The earlier-kicking alternative is on bye: no late-game swap to him.
    const bye = lineupSwaps(slots, [...base(), { slot: "FLEX", player: pl("3", "G", "TE", 8.8, { inj: "Q", ko: MON_ET }), pts: 0 }], [pl("4", "T", "TE", 8.0, { ko: SUN, bye: 8 })], () => false, 8);
    expect(bye).toEqual([]);
    // A starter on bye is swapped for the bye reason, not the late-game one.
    const forced = lineupSwaps(slots, [...base(), { slot: "FLEX", player: pl("3", "G", "TE", 8.8, { bye: 8 }), pts: 0 }], [pl("4", "T", "TE", 8.0, { ko: SUN })], () => false, 8);
    expect(forced[0]).toMatchObject({ why: "G is on bye" });
    expect(forced[0]!.lateRisk).toBeUndefined();
  });

  it("reads FantasyPros' kickoff (player_game_kickoff_ts) as epoch milliseconds", () => {
    expect(kickoffOf(1792947600)).toBe(1792947600000);
    expect(kickoffOf("1792947600")).toBe(1792947600000);
    expect(kickoffOf(1792947600000)).toBe(1792947600000);
    expect(kickoffOf("2026-10-25T17:00:00Z")).toBe(SUN);
    expect(kickoffOf("soon")).toBeNull();
    expect(kickoffOf(null)).toBeNull();
    const [r] = shapeRankings({ players: [{ player_id: 1, player_name: "Dallas Goedert", player_team_id: "PHI", player_position_id: "TE", rank_ecr: 9, pos_rank: "TE9", player_game_kickoff_ts: "2026-10-27T00:15:00Z" }] });
    expect(r!.ko).toBe(MON_ET);
  });
});
