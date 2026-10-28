import { describe, expect, it } from "vitest";
import { LEAGUE_ID, USER_ID, lineupSlots, shapeRosters } from "../_green/sleeper.ts";
import { ENABLED_SETTING, forgetTaken, judgment, respond, type AgentDeps, type AgentRequest, type AgentRun } from "./kernelagent.ts";
import { leagueText, rosterGroups, rosterText } from "./kernelleague.ts";
import { MemoryChatLedger } from "./budget.ts";
import { MemoryRoomLog } from "./log.ts";

/** Made-up league: three teams, never a real name or score. */
const USERS = [
  { user_id: USER_ID, metadata: { team_name: "Sample Dream Team" } },
  { user_id: "111111111111111111", metadata: { team_name: "Other Sample Team" } },
  { user_id: "222222222222222222", metadata: { team_name: "Third Sample Team" } },
];
const ROSTERS = [
  { roster_id: 1, owner_id: USER_ID, players: [], starters: [], settings: { wins: 2, losses: 3, fpts: 500, fpts_decimal: 25, fpts_against: 520, fpts_against_decimal: 0 } },
  { roster_id: 2, owner_id: "111111111111111111", players: [], starters: [], settings: { wins: 3, losses: 2, fpts: 530, fpts_against: 500 } },
  { roster_id: 3, owner_id: "222222222222222222", players: [], starters: [], settings: { wins: 3, losses: 2, fpts: 510, fpts_against: 505 } },
];
const week = (w: number) => [
  { roster_id: 1, matchup_id: 1, points: 100 + w, starters: ["100", "200"], starters_points: [20.5, 11.25], players_points: { "100": 20.5, "200": 11.25, "300": 4.5, "400": 0 } },
  { roster_id: 2, matchup_id: 1, points: 90 + w, starters: [], starters_points: [], players_points: {} },
  { roster_id: 3, matchup_id: null, points: 0, starters: [], starters_points: [], players_points: {} },
];

function sleeper(played = 5): { fetcher: (url: string) => Promise<Response>; urls: string[] } {
  const urls: string[] = [];
  const base = `https://api.sleeper.app/v1/league/${LEAGUE_ID}`;
  const fetcher = async (url: string) => {
    urls.push(url);
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url === `${base}/users`) return ok(USERS);
    if (url === `${base}/rosters`) return ok(ROSTERS);
    if (url === "https://api.sleeper.app/v1/state/nfl") return ok({ season: "2026", week: played + 1, season_type: "regular" });
    const m = /matchups\/(\d+)$/.exec(url);
    if (m) return ok(Number(m[1]) <= played ? week(Number(m[1])) : week(0).map((r) => ({ ...r, points: 0 })));
    return new Response("{}", { status: 404 });
  };
  return { fetcher, urls };
}

const NAMES = async () => ({ "100": { n: "Sample Runner", pos: "RB", team: "AAA" }, "200": { n: "Sample Catcher", pos: "WR", team: "BBB" }, "300": { n: "Sample Benchwarmer", pos: "TE", team: null } });

describe("the Sleeper league tool (#507)", () => {
  it("reads the standings", async () => {
    const text = await leagueText({ read: "standings" }, sleeper().fetcher);
    expect(text.split("\n")).toHaveLength(3);
    expect(text).toContain("Sample Dream Team 2-3, scored 500.25, allowed 520.00");
  });

  it("gives the last six played weeks, matchup by matchup, when no weeks are named", async () => {
    const s = sleeper(7);
    const text = await leagueText({ read: "weeks" }, s.fetcher);
    expect(text).toContain("Week 2: Sample Dream Team 102.00 vs Other Sample Team 92.00 (Sample Dream Team won)");
    expect(text).toContain("Week 7:");
    expect(text).not.toContain("Week 1:");
    expect(s.urls.filter((u) => u.includes("/matchups/"))).toHaveLength(6);
  });

  it("reads any week named, at most eight, and says so when a week isn't played", async () => {
    const s = sleeper(4);
    const text = await leagueText({ read: "weeks", from: 3, to: 6 }, s.fetcher);
    expect(text).toContain("Week 3:");
    expect(text).toContain("Week 5: not played yet");
    const long = sleeper(18);
    await leagueText({ read: "weeks", from: 1, to: 18 }, long.fetcher);
    expect(long.urls.filter((u) => u.includes("/matchups/")).length).toBeLessThanOrEqual(8);
  });

  it("gives one team's whole week: opponent, totals, every starter and the bench, with points", async () => {
    const text = await leagueText({ read: "week", week: 5 }, sleeper().fetcher, NAMES);
    expect(text).toContain("Week 5: Sample Dream Team 105.00 vs Other Sample Team 95.00 (won)");
    expect(text).toContain("Starters: Sample Runner (RB, AAA) 20.50; Sample Catcher (WR, BBB) 11.25");
    expect(text).toContain("Bench: Sample Benchwarmer (TE) 4.50; player 400 0.00");
    const other = await leagueText({ read: "week", week: 5, team: "other sample" }, sleeper().fetcher, NAMES);
    expect(other).toContain("Week 5: Other Sample Team 95.00 vs Sample Dream Team 105.00 (lost)");
    expect(await leagueText({ read: "week", week: 5, team: "nobody" }, sleeper().fetcher, NAMES)).toContain("No team");
    expect(await leagueText({ read: "week", week: 9 }, sleeper(4).fetcher, NAMES)).toContain("no score yet");
  });

  it("builds every URL itself and never lets the model reach anything else", async () => {
    const s = sleeper();
    await leagueText({ read: "week", week: 5, team: "https://evil.example/x", from: "../../x", url: "https://evil.example" }, s.fetcher, NAMES);
    for (const u of s.urls) expect(u.startsWith("https://api.sleeper.app/v1/"), u).toBe(true);
  });

  it("says plainly when Sleeper doesn't answer", async () => {
    const down = async () => new Response("no", { status: 503 });
    expect(await leagueText({ read: "standings" }, down)).toBe("Sleeper isn't answering right now.");
  });
});

describe("past-week facts go to the model and its tools, not to silence", () => {
  const NOW = Date.parse("2026-10-27T16:00:00Z");
  async function ask(question: string) {
    forgetTaken();
    const log = new MemoryRoomLog();
    await log.add({ at: new Date(NOW - 1000).toISOString(), question, answer: "On it.", room: "kernel", model: "voice", needs: "skippy" }, NOW);
    const id = (await log.list("kernel", NOW))[0]!.id;
    const kept: { text: string; final: boolean }[] = [];
    const calls: unknown[] = [];
    let toolText = "";
    const deps = (run: (req: AgentRequest) => Promise<AgentRun>, over: Partial<AgentDeps> = {}): AgentDeps => ({
      log,
      ledger: new MemoryChatLedger(),
      env: { CLAUDE_API_KEY: "test-not-a-key" },
      now: NOW,
      run,
      brief: async () => "",
      desk: async () => ({ desk: "", rooms: "" }),
      league: async (args) => (calls.push(args), "Week 5: Sample Dream Team 105.00 vs Other Sample Team 95.00 (won)"),
      fileIssue: async () => null,
      keep: async (a) => (kept.push(a), true),
      ...over,
    });
    return { id, deps, kept, calls, tool: () => toolText, setTool: (t: string) => (toolText = t) };
  }

  it("the six-week history and the week 5 breakdown are facts, not judgment calls", () => {
    for (const q of ["week-by-week history of Denver Dream Team, last six weeks: score, opponent, result, trends", "give me the week 5 breakdown: starters, bench, points and opponent"]) expect(judgment(q), q).toBe(false);
  });

  it("runs the model, hands it the league tool, and keeps its final answer", async () => {
    const t = await ask("week-by-week history of Denver Dream Team, last six weeks: score, opponent, result, trends");
    const out = await respond(
      t.id,
      t.deps(async (req) => {
        t.setTool(await req.league({ read: "weeks" }));
        return { out: { mode: "answer", text: "Won week 5, monkey, and the trend is up." }, usage: { input_tokens: 100, output_tokens: 20 }, searches: 0 };
      }),
    );
    expect(out.state).toBe("answered");
    expect(t.calls).toEqual([{ read: "weeks" }]);
    expect(t.tool()).toContain("Week 5");
    expect(t.kept).toEqual([{ id: t.id, text: "Won week 5, monkey, and the trend is up.", final: true }]);
  });

  it("is never silent: a run that fails or gives nothing usable leaves a pondering line, and says why by class only", async () => {
    const a = await ask("give me the week 5 breakdown");
    const failed = await respond(a.id, a.deps(async () => Promise.reject(Object.assign(new Error("secret detail in message"), { name: "APIError", status: 400 }))));
    expect(failed).toMatchObject({ state: "failed", why: "APIError-400" });
    expect(JSON.stringify(failed)).not.toContain("secret");
    expect(a.kept).toHaveLength(1);
    expect(a.kept[0]!.final).toBe(false);

    const b = await ask("week 5 breakdown please");
    const none = await respond(b.id, b.deps(async () => ({ out: null, usage: { input_tokens: 10, output_tokens: 1 }, searches: 0 })));
    expect(none.state).toBe("unusable");
    expect(b.kept).toHaveLength(1);
    expect(b.kept[0]!.final).toBe(false);
  });

  it("stays quiet only when it is off, over its cap or keyless", async () => {
    const t = await ask("week 5 breakdown please");
    expect((await respond(t.id, t.deps(async () => Promise.reject(new Error("x")), { env: { [ENABLED_SETTING]: "false" } }))).state).toBe("off");
    expect(t.kept).toHaveLength(0);
  });
});

describe("the roster read (#526)", () => {
  it("lists starters and bench with Sleeper's injury status and leads with the Out starter", async () => {
    const fx = sleeper();
    const rosters = [{ ...ROSTERS[0], players: ["100", "200", "300", "400"], starters: ["100", "200"] }, ROSTERS[1], ROSTERS[2]];
    const f = async (url: string) => (url.endsWith("/rosters") ? new Response(JSON.stringify(rosters), { status: 200 }) : fx.fetcher(url));
    const names = async () => ({
      "100": { n: "Sample Passer", pos: "QB", team: "AAA", inj: "O" },
      "200": { n: "Sample Catcher", pos: "WR", team: "BBB", inj: null },
      "300": { n: "Sample Backup", pos: "QB", team: "CCC", inj: null },
      "400": { n: "Sample Hurt", pos: "RB", team: "DDD", inj: "Q" },
    });
    const text = await leagueText({ read: "roster" }, f, names);
    expect(text.split("\n")[0]).toBe("Heads up: your starting QB Sample Passer is Out. Sample Backup is on your bench.");
    expect(text).toContain("Sample Passer QB AAA Out");
    expect(text).toContain("Sample Hurt RB DDD Questionable");
  });
});

describe("rosterGroups and rosterText (#544)", () => {
  const slots = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "BN", "BN", "IR"];
  const playable = lineupSlots({ roster_positions: slots });
  const roster = shapeRosters([{ roster_id: 1, owner_id: USER_ID, players: ["11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21"], starters: ["11", "12", "13", "14", "0", "16", "17", "18"], reserve: ["21"], settings: {} }])[0]!;
  const names = Object.fromEntries(
    ["Quinn Sample", "Rex Sample", "Rory Sample", "Wes Sample", "Wanda Sample", "Tess Sample", "Flo Sample", "Dee Sample", "Ben Sample", "Bo Sample", "Ivy Sample"].map((n, i) => [String(11 + i), { n, pos: ["QB", "RB", "RB", "WR", "WR", "TE", "WR", "DEF", "RB", "WR", "RB"][i]!, team: "SMP", inj: i === 10 ? "IR" : i === 9 ? "Q" : null }]),
  );

  it("drops BN, IR and taxi from the slots and keeps the order", () => {
    expect(playable).toEqual(["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF"]);
  });

  it("labels slots from starters[] in order, an empty slot is 0", () => {
    const g = rosterGroups(roster, playable);
    expect(g.starters.map((s) => `${s.slot}:${s.id}`)).toEqual(["QB:11", "RB1:12", "RB2:13", "WR1:14", "WR2:null", "TE:16", "FLEX:17", "DEF:18"]);
  });

  it("never puts a player in two groups", () => {
    const withTaxi = { ...roster, taxi: ["20"] };
    const g = rosterGroups(withTaxi, playable);
    const all = [...g.starters.flatMap((s) => (s.id ? [s.id] : [])), ...g.bench, ...g.reserve, ...g.taxi];
    expect(new Set(all).size).toBe(all.length);
    expect(g.bench).toEqual(["15", "19"]);
    expect(g.reserve).toEqual(["21"]);
    expect(g.taxi).toEqual(["20"]);
    // A feed that lists a starter again in reserve still leaves him in one group.
    const dup = rosterGroups({ ...roster, reserve: ["13", "21"] }, playable);
    expect(dup.reserve).toEqual(["21"]);
  });

  it("says slots, bench and reserve apart and labels the injury tag", () => {
    const t = rosterText(roster, names, 8, playable);
    expect(t).toContain("RB2 Rory Sample RB SMP");
    expect(t).toContain("WR2 empty");
    expect(t).toMatch(/Bench \(not starting\): Wanda Sample[^;]*; Ben Sample RB SMP/);
    expect(t).toMatch(/Reserve\/IR slot: Ivy Sample RB SMP on IR \(per Sleeper feed\)/);
    expect(t).toContain("Bo Sample WR SMP Questionable (per Sleeper feed)");
    const starterLine = t.split("\n").find((l) => l.startsWith("Nikita's starters"))!;
    expect(starterLine).not.toContain("Ben Sample");
    expect(starterLine).not.toContain("Ivy Sample");
  });
});
