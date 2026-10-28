import { afterEach, describe, expect, it } from "vitest";
import { NO_GAME, forgetScores, gameLine, leagueOf, liveScores, parseScoreboard, playsIn, readScoreboard } from "./sports.ts";

const NOW = Date.parse("2026-10-28T01:30:00Z");

/** ESPN's scoreboard shape, with made-up teams. */
const event = (over: Record<string, unknown> = {}) => ({
  id: "1",
  date: "2026-10-28T00:08Z",
  name: "Harbor Gulls at Lakeside Owls",
  status: { type: { state: "in", completed: false, shortDetail: "Top 6th", detail: "Top of the 6th Inning" } },
  competitions: [
    {
      competitors: [
        { id: "10", homeAway: "home", score: "3", team: { displayName: "Lakeside Owls", abbreviation: "LKO" } },
        { id: "20", homeAway: "away", score: "4", team: { displayName: "Harbor Gulls", abbreviation: "HBG" } },
      ],
      notes: [{ headline: "NLCS - Game 4" }],
      series: { type: "playoff", summary: "HBG leads 2-1", competitors: [{ id: "10", wins: 1 }, { id: "20", wins: 2 }] },
    },
  ],
  ...over,
});
const board = { events: [event(), event({ id: "2", name: "Final Game", status: { type: { state: "post", completed: true, shortDetail: "Final" } }, competitions: [{ competitors: [{ id: "1", homeAway: "home", score: "7", team: { displayName: "Dock Rays" } }, { id: "2", homeAway: "away", score: "2", team: { displayName: "Mill Foxes" } }] }] })] };

describe("the ESPN scoreboard parser (#537)", () => {
  it("reads score, status, note and the postseason series state", () => {
    const [g, f] = parseScoreboard(board);
    expect(g).toMatchObject({ state: "in", detail: "Top 6th", note: "NLCS - Game 4", series: "Harbor Gulls lead the series 2-1", home: { name: "Lakeside Owls", score: "3" }, away: { name: "Harbor Gulls", score: "4" } });
    expect(gameLine(g!)).toBe("LIVE NOW: Harbor Gulls 4, Lakeside Owls 3, Top 6th (NLCS - Game 4); Harbor Gulls lead the series 2-1.");
    expect(gameLine(f!)).toBe("Final: Mill Foxes 2, Dock Rays 7, Final.");
  });

  it("says a tied series, skips malformed events and never invents a game", () => {
    const tied = parseScoreboard({ events: [event({ competitions: [{ ...(event().competitions[0] as object), series: { type: "playoff", competitors: [{ id: "10", wins: 2 }, { id: "20", wins: 2 }] } }] })] });
    expect(tied[0]!.series).toBe("series tied 2-2");
    expect(parseScoreboard({ events: [{ name: "broken" }, null, 4] })).toEqual([]);
    expect(parseScoreboard(null)).toEqual([]);
    expect(parseScoreboard({ events: "nope" })).toEqual([]);
  });

  it("matches a team by name word or abbreviation, and a league by its folded name", () => {
    const [g] = parseScoreboard(board);
    expect(playsIn(g!, "gulls")).toBe(true);
    expect(playsIn(g!, "HBG")).toBe(true);
    expect(playsIn(g!, "Lakeside Owls")).toBe(true);
    expect(playsIn(g!, "Tigers")).toBe(false);
    expect(leagueOf("MLB")).toBe("mlb");
    expect(leagueOf("college football")).toBe("ncaaf");
    expect(leagueOf("cricket")).toBeNull();
  });
});

describe("the live score lookup (#537)", () => {
  afterEach(() => forgetScores());
  const fetcher = (calls: string[], data: unknown = board) => async (u: string) => {
    calls.push(u);
    return new Response(JSON.stringify(data), { status: 200 });
  };

  it("answers a team's live game from today's board, kept ~25 s so a repeat doesn't call ESPN again", async () => {
    const calls: string[] = [];
    const text = await liveScores("mlb", "Gulls", NOW, fetcher(calls));
    expect(text).toContain("LIVE NOW: Harbor Gulls 4, Lakeside Owls 3");
    expect(text).toContain("not a web search");
    await liveScores("mlb", "Gulls", NOW + 10_000, fetcher(calls));
    expect(calls).toEqual(["https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard"]);
    await readScoreboard("mlb", undefined, NOW + 30_000, fetcher(calls));
    expect(calls).toHaveLength(2);
  });

  it("with no league searches the big ones, and tries yesterday for a team not on today's board", async () => {
    const calls: string[] = [];
    const empty = { events: [] };
    const f = async (u: string) => {
      calls.push(u);
      return new Response(JSON.stringify(u.includes("baseball") && u.includes("dates=") ? board : empty), { status: 200 });
    };
    const text = await liveScores(null, "Gulls", NOW, f);
    expect(text).toContain("Harbor Gulls");
    expect(calls.some((u) => u.includes("dates=20261027"))).toBe(true);
  });

  it("never makes up a score: an empty or failing ESPN gives the no-game text the route escalates on", async () => {
    expect(await liveScores("mlb", "Gulls", NOW, fetcher([], { events: [] }))).toMatch(new RegExp(`^${NO_GAME}`));
    forgetScores();
    const down = async () => new Response("no", { status: 503 });
    expect(await liveScores("nfl", "Ravens", NOW, down)).toMatch(new RegExp(`^${NO_GAME}`));
    forgetScores();
    const boom = async () => {
      throw new Error("offline");
    };
    expect(await liveScores("nba", "", NOW, boom)).toMatch(new RegExp(`^${NO_GAME}`));
  });
});
