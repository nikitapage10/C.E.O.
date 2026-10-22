import { describe, expect, it } from "vitest";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import { MemoryChatLedger } from "../_skippy/budget.ts";
import { AUTO_GAP_MS, MANUAL_GAP_MS, MemoryAnalysisStore, WEEKLY_PING, checkWords, factsOf, handleGet, handlePost, isAnalysis, isWeeklySlot, makeAnalysis, runWeekly, scripted, type AnalysisDeps, type Writer } from "./analysis.ts";
import { canGreen, greenBudget, GREEN_CEILING_USD } from "./budget.ts";
import type { GreenBoard, GreenPlayer } from "./types.ts";

/**
 * The Commentator's call (#276): words from the board's numbers only (a section carrying any other number is replaced
 * by the numbers said plainly), the month's Claude cap respected, a Sources footer on every analysis, a signed-in GET,
 * an on-demand refresh at most every ten minutes, and the Tuesday run at most every six hours with a Desk ping.
 */

const ORIGIN = "https://ceo.test";
const DESK = "a test desk key, not a real one";
// Tuesday 2026-10-20, 17:39 in Denver (MDT, UTC-6).
const TUESDAY = Date.parse("2026-10-20T23:39:00Z");

const pl = (id: string, name: string, pos: GreenPlayer["pos"], proj: number, over: Partial<GreenPlayer> = {}): GreenPlayer => ({ id, name, pos, team: "KC", inj: null, proj, src: "fp", avg: proj, last: null, wk: null, ecr: null, posRank: null, bye: null, ...over });

function board(): GreenBoard {
  const qb = pl("1", "Quarter Back", "QB", 21.2);
  const te = pl("2", "Tight End", "TE", 6.1, { inj: "Q" });
  const sub = pl("3", "Bench Wideout", "WR", 9.4, { sl: 12.9 });
  const wr = pl("4", "Starting Wideout", "WR", 9.8, { sl: 8.1 });
  const target = pl("5", "Wire Back", "RB", 8.2, { ecr: 90 });
  return {
    ok: true,
    at: new Date(TUESDAY).toISOString(),
    season: "2026",
    week: 8,
    league: { id: "1", name: "Horse Meat", teams: 12, scoring: "half", faab: 100 },
    me: { rosterId: 1, team: "Denver Dream Team", record: "2-5", rank: 10, pf: 700, pa: 760, benchLeft: null, faabLeft: 96, streak: null },
    roster: { starters: [{ slot: "QB", player: qb, pts: 0 }, { slot: "WR", player: wr, pts: 0 }, { slot: "TE", player: te, pts: 0 }], bench: [sub], reserve: [] },
    matchup: { week: 8, me: { rosterId: 1, team: "Denver Dream Team", record: "2-5", pts: 0, proj: 93.4, starters: [] }, them: { rosterId: 2, team: "Waiver Wire Wizards", record: "3-4", pts: 0, proj: 104.2, starters: [] }, win: 0.33, live: false },
    swaps: [],
    pickups: [],
    standings: [],
    dropping: [],
    byes: [],
    sources: { sleeper: "live", fantasypros: "live", fpAt: null, calls: "fp", fpParts: null },
    calls: [{ slot: "WR", start: wr, sit: sub, change: false, edge: 0.4, slEdge: -4.8, sleeper: "disagrees", split: true, tiebreak: null, why: "" }],
    teams: [{ rosterId: 1, team: "Denver Dream Team", wins: 2, losses: 5, ties: 0, pf: 700, faab: 96, needs: ["TE"], surplus: [], posRank: { QB: 3, RB: 9, WR: 6, TE: 12 }, opp: 2, proj: 93.4, playoff: 0.13 }],
    bids: [{ player: target, bid: 17, low: 12, high: 24, rivals: ["Team 3"], blocks: "The Audible", drop: pl("6", "Spare Part", "RB", 2), why: "" }],
    trade: null,
    odds: { playoff: 0.13, seeds: [0.01, 0.02, 0.03, 0.03, 0.02, 0.02], playoffTeams: 6, weeksLeft: 7, sims: 3000, swing: [{ a: "Gridiron Gremlins", b: "Bye Week Blues", root: "Gridiron Gremlins", ifWin: 0.13, ifLose: 0.11 }] },
    byeWeeks: [{ week: 10, teams: ["KC"], out: [{ id: "1", name: "Quarter Back", pos: "QB" }], holes: ["QB"] }],
    feeds: [{ name: "Sleeper league", state: "live", at: new Date(TUESDAY).toISOString() }],
  };
}

async function setup(over: Partial<AnalysisDeps> = {}) {
  const auth = new MemoryAuthStore();
  const cookie = await signedInCookie(DESK, TUESDAY, auth);
  const store = new MemoryAnalysisStore();
  const ledger = new MemoryChatLedger();
  const pings: string[] = [];
  let boards = 0;
  const deps: AnalysisDeps = {
    board: async () => {
      boards++;
      return board();
    },
    store,
    ledger,
    others: async () => 0,
    write: null,
    second: null,
    budget: 0.25,
    now: TUESDAY,
    desk: { deskKey: DESK, store: auth, now: TUESDAY },
    ping: async (t) => {
      pings.push(t.body);
      return 1;
    },
    ...over,
  };
  return { deps, store, ledger, pings, cookie, boards: () => boards };
}

const get = (cookie?: string) => new Request(`${ORIGIN}/api/green-analysis`, { headers: { ...(cookie && { cookie }) } });
const post = (cookie: string | undefined, body: unknown = { action: "refresh" }) =>
  new Request(`${ORIGIN}/api/green-analysis`, { method: "POST", headers: { "Content-Type": "application/json", origin: ORIGIN, ...(cookie && { cookie }) }, body: JSON.stringify(body) });

describe("the facts and the words (#276)", () => {
  it("reads the facts from the whole board: weak spots, splits, byes, injuries, the waiver call", () => {
    const f = factsOf(board());
    expect(f.weak.map((w) => w.pos)).toEqual(["TE", "RB"]);
    expect(f.weak[0]).toMatchObject({ rank: 12, starters: [{ name: "Tight End", proj: 6.1 }] });
    expect(f.splits).toEqual([{ slot: "WR", start: "Starting Wideout", sit: "Bench Wideout", fp: [9.8, 9.4], sl: [8.1, 12.9] }]);
    expect(f.injuries).toEqual([{ name: "Tight End", pos: "TE", status: "questionable", starting: true }]);
    expect(f.waiver).toMatchObject({ action: "bid", player: "Wire Back", bid: 17, faabLeft: 96, drop: "Spare Part", blocks: "The Audible" });
    expect(f.byes).toEqual([{ week: 10, out: ["Quarter Back"], holes: ["QB"] }]);
  });

  it("says the facts plainly without Claude", () => {
    const w = scripted(factsOf(board()), 8);
    expect(w.headline).toBe("Denver Dream Team projects 93.4 to 104.2 against Waiver Wire Wizards, a 33% win chance.");
    expect(w.waiver).toBe("Bid 17 on Wire Back (12 to 24) of your 96 FAAB, dropping Spare Part. It also keeps him from The Audible.");
    expect(w.byes).toBe("Week 10: Quarter Back on bye, short at QB.");
  });

  it("keeps a section only when every number in it is in the facts, and strips links and markdown", () => {
    const f = factsOf(board());
    const { words, replaced } = checkWords({ headline: "**A 33% shot** at 104.2", matchup: "Playoff odds are 45%, trust me.", waiver: "Go get Wire Back for 17 https://evil.example/x", weak: "TE is the hole.", byes: "", injuries: 5, trade: "Nothing." }, f, 8);
    expect(words.headline).toBe("A 33% shot at 104.2");
    expect(words.waiver).toBe("Go get Wire Back for 17");
    expect(words.matchup).toBe(scripted(f, 8).matchup);
    expect(replaced).toBe(3);
  });
});

describe("the month's Claude cap (#276)", () => {
  it("gives the Green a small share and never more than the shared cap allows", () => {
    expect(greenBudget(undefined)).toBe(0.25);
    expect(greenBudget("1")).toBe(1);
    expect(greenBudget("-3")).toBe(0.25);
    expect(greenBudget("50")).toBe(8);
    expect(canGreen(0, 0, 0.25)).toBe(true);
    expect(canGreen(0.25 - GREEN_CEILING_USD / 2, 0, 0.25)).toBe(false);
    expect(canGreen(0, 8, 0.25)).toBe(false);
  });

  it("past the cap writes the facts plainly and calls nobody", async () => {
    let calls = 0;
    const write: Writer = async () => {
      calls++;
      return { answer: null, usage: null };
    };
    const { deps } = await setup({ write, others: async () => 7.999 });
    const a = await makeAnalysis(deps, board(), "manual");
    expect(calls).toBe(0);
    expect(a).toMatchObject({ writer: "scripted", scripted: "capped" });
  });

  it("with Claude: the call is counted in the Green's ledger, and the Sources footer names every feed", async () => {
    const write: Writer = async (f) => ({ answer: { ...scripted(f, 8), headline: "Underdogs at 33%." }, usage: { input_tokens: 2000, output_tokens: 300 } });
    const second = async () => "FantasyPros has it 9.8 to 9.4; Sleeper sees 12.9 for the bench man.";
    const { deps, ledger } = await setup({ write, second });
    const a = await makeAnalysis(deps, board(), "manual");
    expect(a.writer).toBe("claude");
    expect(a.headline).toBe("Underdogs at 33%.");
    expect(a.second).toHaveLength(1);
    expect(Object.keys(await ledger.load())).toHaveLength(1);
    expect(a.sources.map((s) => s.name)).toEqual(["Sleeper league", "Claude Haiku (claude-haiku-5-5), the words", "OpenAI second opinion (split decisions)"]);
    expect(a.sources.every((s) => s.state !== "off")).toBe(true);
  });

  it("without keys, the footer still says what was skipped", async () => {
    const { deps } = await setup();
    const a = await makeAnalysis(deps, board(), "manual");
    expect(a).toMatchObject({ writer: "scripted", scripted: "no-key" });
    expect(a.sources.slice(-2).map((s) => s.state)).toEqual(["off", "off"]);
  });
});

describe("the endpoint (#276)", () => {
  it("answers at /api/green-analysis and the world's ?green=analysis", () => {
    expect(isAnalysis(new Request(`${ORIGIN}/api/green-analysis`))).toBe(true);
    expect(isAnalysis(new Request(`${ORIGIN}/api/world?green=analysis`))).toBe(true);
    expect(isAnalysis(new Request(`${ORIGIN}/api/world?green=1`))).toBe(false);
  });

  it("is for the signed-in Desk only", async () => {
    const { deps } = await setup();
    expect((await handleGet(get(), deps)).status).toBe(401);
    expect((await handlePost(post(undefined), deps)).status).toBe(401);
  });

  it("refreshes on demand at most once every ten minutes", async () => {
    const { deps, cookie, boards } = await setup();
    const empty = await handleGet(get(cookie), deps);
    expect(await empty.json()).toMatchObject({ state: "none", refreshAfter: null });
    const first = await handlePost(post(cookie), deps);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { analysis: { trigger: string } }).analysis.trigger).toBe("manual");
    const again = await handlePost(post(cookie), { ...deps, now: TUESDAY + 60_000 });
    expect(again.status).toBe(429);
    expect(again.headers.get("retry-after")).toBe(String((MANUAL_GAP_MS - 60_000) / 1000));
    expect(boards()).toBe(1);
    const ready = await handleGet(get(cookie), { ...deps, now: TUESDAY + 60_000 });
    expect(await ready.json()).toMatchObject({ state: "ready", refreshAfter: new Date(TUESDAY + MANUAL_GAP_MS).toISOString() });
    expect((await handlePost(post(cookie), { ...deps, now: TUESDAY + MANUAL_GAP_MS })).status).toBe(200);
    expect((await handlePost(post(cookie, { action: "nope" }), { ...deps, now: TUESDAY + 2 * MANUAL_GAP_MS })).status).toBe(400);
  });
});

describe("the Tuesday call (#276)", () => {
  it("runs only in Tuesday's 5pm hour in Denver", () => {
    expect(isWeeklySlot(TUESDAY)).toBe(true);
    expect(isWeeklySlot(Date.parse("2026-11-04T00:39:00Z"))).toBe(true); // MST, UTC-7
    expect(isWeeklySlot(TUESDAY + 3_600_000)).toBe(false);
    expect(isWeeklySlot(TUESDAY - 86_400_000)).toBe(false);
  });

  it("writes once, pings the Desk, and not again within six hours", async () => {
    const { deps, store, pings } = await setup();
    expect(await runWeekly({ ...deps, now: TUESDAY - 86_400_000 })).toBe("not-now");
    expect(await runWeekly(deps)).toBe("written");
    expect(store.saved.analysis?.trigger).toBe("scheduled");
    expect(pings).toEqual([WEEKLY_PING.body]);
    expect(await runWeekly({ ...deps, now: TUESDAY + 60_000 }, true)).toBe("too-soon");
    expect(await runWeekly({ ...deps, now: TUESDAY + AUTO_GAP_MS }, true)).toBe("written");
    expect(await runWeekly({ ...deps, store: null })).toBe("no-store");
  });
});
