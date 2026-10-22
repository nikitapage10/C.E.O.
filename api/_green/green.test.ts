import { beforeEach, describe, expect, it } from "vitest";
import { forgetMemory, MemoryGreenStore, PLAYERS_PATH } from "./cache.ts";
import { fpIndex, fpKey, nameKey, scoringOf, shapeInjuries, shapeProjections, shapeRankings, type FpData } from "./fantasypros.ts";
import { buildBoard, formOf, formProjection, lineupSwaps, normCdf, slotTakes, winChance } from "./model.ts";
import { forgetGreen, GET, isGreen, PATH, type GreenDeps } from "./route.ts";
import { LEAGUE_ID, USER_ID, cleanText, shapeLeague, shapeMatchups, shapeRosters, shapeTeamNames, slimPlayers, type Fetcher } from "./sleeper.ts";
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

/** A stand-in for Sleeper (and FantasyPros): answers by URL, and counts the calls. */
function fakeApis(opts: { sleeperDown?: boolean; fpDown?: boolean; rosters?: unknown } = {}) {
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
        const players = pos === "RB" ? [{ fpid: "1", name: "Rex Runner", position_id: "RB", team_id: "DAL", stats: { points: 9, points_half: 11.5, points_ppr: 14 } }, { fpid: "2", name: "Benny Bench", position_id: "RB", team_id: "DET", stats: [{ points: 15, points_half: 17, points_ppr: 19 }] }] : pos === "DST" ? [{ name: "Minnesota Vikings", position_id: "DST", team_id: "MIN", stats: { points: 8, points_half: 8, points_ppr: 8 } }] : [];
        return ok({ season: "2026", week: "3", players });
      }
      if (u.pathname.endsWith("/consensus-rankings")) {
        return ok({ players: [{ player_id: 1, player_name: "Wes Waiver", player_team_id: "GB", player_position_id: "WR", player_yahoo_id: "9008", rank_ecr: 30, pos_rank: "WR15", player_bye_week: "9" }, { player_id: 2, player_name: "Hot Pickup", player_team_id: "ATL", player_position_id: "RB", player_yahoo_id: "9014", rank_ecr: 80, pos_rank: "RB30", player_bye_week: "5" }, { player_id: 3, player_name: "Deep Bench", player_team_id: "HOU", player_position_id: "WR", player_yahoo_id: "9015", rank_ecr: 300, pos_rank: "WR99", player_bye_week: "3" }, { player_id: 4, player_name: "Spare Part", player_team_id: "TEN", player_position_id: "WR", player_yahoo_id: "9016", rank_ecr: 400, pos_rank: "WR120", player_bye_week: "10" }] });
      }
      if (u.pathname.endsWith("/injuries")) return ok({ injuries: [{ name: "Walt Wider", yahoo_id: "9005", status_short: "Q" }] });
      return new Response("nope", { status: 404 });
    }
    if (opts.sleeperDown) return new Response("down", { status: 503 });
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
    const pl = (id: string, pos: GreenPlayer["pos"], proj: number | null, inj: GreenPlayer["inj"] = null): GreenPlayer => ({ id, name: `P${id}`, pos, team: "KC", inj, proj, src: "form", avg: proj, last: proj, ecr: null, posRank: null, bye: null });
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
    expect(board.sources).toEqual({ sleeper: "live", fantasypros: "waiting", fpAt: null });
    expect(JSON.stringify(board)).not.toContain("a-username-never-shown");
  });

  it("refuses a league Nikita has no team in", () => {
    const input = boardInput();
    expect(() => buildBoard({ ...input, rosters: input.rosters.filter((r) => r.rosterId !== 12) })).toThrow("not-in-league");
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

  it("uses FantasyPros with the key: projections, consensus pickups and injuries, the key only in its header", async () => {
    const { fetcher, calls } = fakeApis();
    const res = await GET(get(), deps(fetcher, { fpKey: FP_KEY }));
    const text = await res.text();
    expect(text).not.toContain(FP_KEY);
    const board = JSON.parse(text) as GreenBoard;
    expect(board.sources.fantasypros).toBe("live");
    const fpCalls = calls.filter((c) => c.url.startsWith("https://api.fantasypros.com/public/v2/json/"));
    expect(fpCalls.length).toBe(7); // QB, RB, WR, TE, DST projections, the consensus, the injuries
    expect(fpCalls.every((c) => c.key === FP_KEY && !c.url.includes(FP_KEY))).toBe(true);
    expect(calls.filter((c) => !c.url.includes("fantasypros")).every((c) => c.key === null)).toBe(true);
    expect(fpCalls.some((c) => c.url.includes("/nfl/2026/projections?position=DST&week=3&scoring=HALF"))).toBe(true);
    const rex = board.roster.starters[1]!.player!;
    expect(rex).toMatchObject({ name: "Rex Runner", proj: 11.5, src: "fp" });
    expect(board.roster.starters.find((s) => s.player?.name === "Walt Wider")!.player!.inj).toBe("Q");
    // Deep Bench (on bye this week) sits; Pickups follow the consensus, Spare Part (WR120) is the clear drop for the WR,
    // and Benny Bench, whom the consensus doesn't rank, is never the one cut.
    expect(board.pickups.map((p) => p.player.name)).toEqual(["Wes Waiver", "Hot Pickup"]);
    expect(board.pickups[0]!.why).toBe("FantasyPros #30 (WR15) rest of season · added in 50k leagues today");
    expect(board.pickups[0]!.drop?.name).toBe("Spare Part");
    expect(board.pickups[1]!.drop).toBeNull();
    expect(board.swaps.find((x) => x.out?.name === "Deep Bench")?.why).toBe("Deep Bench is on bye");
  });

  it("still answers when FantasyPros fails, and says so", async () => {
    const { fetcher } = fakeApis({ fpDown: true });
    const board = (await (await GET(get(), deps(fetcher, { fpKey: FP_KEY }))).json()) as GreenBoard;
    expect(board.sources.fantasypros).toBe("failed");
    expect(board.roster.starters[0]!.player!.src).toBe("form");
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
