import { afterEach, describe, expect, it } from "vitest";
import type { GreenBoard } from "../_green/types.ts";
import { MemoryRoomLog } from "./log.ts";
import { NO_GAME } from "./sports.ts";
import { PLAYER_READ, SPORTS_READ, WEB_ACT, handle, type RoomSources } from "./toolroute.ts";
import { NEWS_PENDING, STILL_SEARCHING, forgetSearches, forgetWaitingLines, isEmptyLookup, mergeStatusNews, waitingLine, type WebDeps } from "./voicelookups.ts";
import { MemoryCrewStore, TOOL_HEADER, issueToolToken } from "./voicetoken.ts";
import { ONE_WAITING_LINE } from "./ponder.ts";

const NOW = Date.parse("2026-10-28T01:30:00Z");
const DESK = "a test desk key, not a real one";
const SITE = "https://ceo.test";

describe("player status and fresh news in one answer (#537)", () => {
  const listing = "Lamar Jackson (QB, BAL), on the C.E.O.'s roster. Sleeper: out (hamstring).";

  it("merges the listing with the fresh web news and tells him to say a conflict in one line", () => {
    const text = mergeStatusNews(listing, 'Web search for "Lamar Jackson injury status latest news": The coach says Wednesday decides.');
    expect(text).toContain("Sleeper: out");
    expect(text).toContain("Fresh news from the web, newer than the listing: The coach says Wednesday decides.");
    expect(text).toMatch(/disagree, say so in one line/);
    expect(text).not.toContain('Web search for "');
  });

  it("keeps the listing alone with no search, drops a useless search, and holds the answer while news is pending", () => {
    expect(mergeStatusNews(listing, null)).toBe(listing);
    expect(mergeStatusNews(listing, 'The web search for "x" found nothing reliable; hand it to hand_to_kernel.')).toBe(listing);
    expect(mergeStatusNews(listing, STILL_SEARCHING)).toBe(`${listing} ${NEWS_PENDING}`);
  });
});

describe("the one-waiting-line rule (#537)", () => {
  afterEach(() => forgetWaitingLines());
  it("gives a question one waiting line and then silence, and a new question a fresh one", () => {
    expect(waitingLine("call1", NOW)).toBe(true);
    expect(waitingLine("call1", NOW + 4_000)).toBe(false);
    expect(waitingLine("call1", NOW + 12_000)).toBe(false);
    expect(waitingLine("call2", NOW)).toBe(true);
    expect(waitingLine("call1", NOW + 60_000)).toBe(true);
  });
  it("is in every voice's prompt, and a wait never says it couldn't find it", () => {
    expect(ONE_WAITING_LINE).toMatch(/One waiting line per question in all/);
    expect(ONE_WAITING_LINE).toMatch(/never "I couldn't find it" while a deeper look is still running/);
    expect(STILL_SEARCHING).toMatch(/never say you couldn't find it/);
  });
});

describe("the route: scores, merged status and empty-tool escalation (#537)", () => {
  afterEach(() => {
    forgetSearches();
    forgetWaitingLines();
  });
  const board = { season: "2026", week: 8, byes: [], roster: { starters: [], bench: [], reserve: [] } } as unknown as GreenBoard;
  const web = (text: string): WebDeps => ({ search: async () => ({ text, usage: { input_tokens: 1, output_tokens: 1 }, usd: 0.01 }), canSpend: async () => true, addSpend: async () => undefined });
  const setup = async (over: Partial<RoomSources> = {}) => {
    const crew = new MemoryCrewStore();
    const log = new MemoryRoomLog();
    const token = (await issueToolToken(crew, DESK, "conv_live_537", NOW + 12 * 60_000, NOW))!;
    const sources = { players: { board: async () => board, players: async () => null, fp: async () => null }, web: web("Coach says Wednesday decides."), ...over } as unknown as RoomSources;
    return { token, log, crew, d: { deskKey: DESK, crew, log, sources, now: NOW } };
  };
  const get = (token: string, q: string) => new Request(`${SITE}/api/skippy-tools?${q}`, { headers: { [TOOL_HEADER]: token } });

  it("GET ?read=sports gives the live score straight from the scoreboard", async () => {
    const { token, d } = await setup({ scores: async (l, t) => `Final: ${t} 5, Other 2 (${l}).` });
    const body = (await (await handle(get(token, `read=${SPORTS_READ}&league=mlb&team=Brewers`), d)).json()) as { text: string; escalated?: boolean };
    expect(body.text).toBe("Final: Brewers 5, Other 2 (mlb).");
    expect(body.escalated).toBeUndefined();
    expect((await handle(get(token, `read=${SPORTS_READ}&url=x`), d)).status).toBe(400);
  });

  it("an empty score escalates to the kernel at once, with one waiting line and no 'failed'", async () => {
    const { token, d, log } = await setup({ scores: async () => `${NO_GAME} for "Brewers" in MLB today or yesterday.` });
    const body = (await (await handle(get(token, `read=${SPORTS_READ}&team=Brewers`), d)).json()) as { text: string; escalated?: boolean };
    expect(body.escalated).toBe(true);
    expect(body.text).toMatch(/Passed on to your deeper mind\. Say one short in-character line/);
    expect(body.text).not.toMatch(/couldn't|failed|ESPN/i);
    const kept = await log.list("kernel", NOW);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ needs: "skippy", model: "voice" });
    expect(kept[0]!.question).toMatch(/live score or game status for Brewers/);
  });

  it("a second empty result in the same question is told to stay quiet", async () => {
    const { token, d } = await setup({ scores: async () => NO_GAME });
    await handle(get(token, `read=${SPORTS_READ}&team=A`), d);
    const second = (await (await handle(get(token, `read=${SPORTS_READ}&team=B`), d)).json()) as { text: string };
    expect(second.text).toMatch(/already said this question's waiting line: say nothing/);
    expect(second.text).not.toMatch(/Say one short in-character line/);
  });

  it("player_news with a name returns the listing and the fresh news together", async () => {
    const players = { board: async () => board, players: async () => ({ value: { p1: { id: "p1", n: "Lamar Jackson", pos: "QB", team: "BAL", rank: 1, inj: "O" } }, at: NOW }), fp: async () => null };
    const { token, d } = await setup({ players } as unknown as Partial<RoomSources>);
    const body = (await (await handle(get(token, `read=${PLAYER_READ}&player=Lamar%20Jackson`), d)).json()) as { text: string };
    expect(body.text).toContain("Sleeper: out");
    expect(body.text).toContain("Fresh news from the web, newer than the listing: Coach says Wednesday decides.");
  });

  it("an unknown player escalates instead of telling Nikita there is nothing", async () => {
    const { token, d, log } = await setup();
    const body = (await (await handle(get(token, `read=${PLAYER_READ}&player=Nobody%20Atall`), d)).json()) as { text: string; escalated?: boolean };
    expect(body.escalated).toBe(true);
    expect((await log.list("kernel", NOW))[0]!.question).toMatch(/Nobody Atall/);
  });

  it("a web search with nothing reliable escalates; a still-running one carries one waiting line", async () => {
    const { token, d, log } = await setup({ web: web("") });
    const post = (q: string) => new Request(`${SITE}/api/skippy-tools?act=${WEB_ACT}`, { method: "POST", headers: { [TOOL_HEADER]: token, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
    const body = (await (await handle(post("who won the game"), d)).json()) as { escalated?: boolean };
    expect(body.escalated).toBe(true);
    expect((await log.list("kernel", NOW))[0]!.question).toBe("who won the game");
  });

  it("isEmptyLookup tells nothing-usable from an answer", () => {
    expect(isEmptyLookup(`${NO_GAME} for "x"`)).toBe(true);
    expect(isEmptyLookup('No player matching "x" on Sleeper')).toBe(true);
    expect(isEmptyLookup("Final: A 3, B 2, Final.")).toBe(false);
  });
});
