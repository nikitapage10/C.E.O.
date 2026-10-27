import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GreenBoard, GreenPlayer } from "../green/league.ts";
import type { PmBoard } from "../exchange/polymarket.ts";
import type { Link } from "../../systems.ts";
import { readCard } from "./asked.ts";
import { useSkippy } from "./chat.ts";
import { WAIT_MAX_MS, answerIn, gaveUpText, pendingText, pollEvery } from "./handoff.ts";
import { PAGE_LINES, PAGE_MAX, boilerLines, exchangeLines, greenLines, pageContext } from "./page.ts";

/** The Desk's side of a hand-off's round trip (#341): the page's data for the quick take, the pending bubble, the answer in place. */

const pl = (id: string, name: string, pos: GreenPlayer["pos"], fp: number, sl: number, over: Partial<GreenPlayer> = {}): GreenPlayer => ({ id, name, pos, team: "LV", inj: null, proj: fp, fp, sl, src: "fp", avg: 8, last: 7, wk: 20, ecr: null, posRank: null, bye: null, ...over });
const goedert = pl("5022", "Dallas Goedert", "TE", 8.8, 9.1, { inj: "Q", wk: 8 });
const tucker = pl("10213", "Tre Tucker", "WR", 9.0, 7.6, { wk: 30 });
const board = {
  week: 7,
  league: { scoring: "Half PPR" },
  matchup: { win: 0.62, me: { proj: 104.2 }, them: { proj: 98.1 } },
  sources: { calls: "fp" },
  calls: [{ slot: "FLEX", start: goedert, sit: tucker, change: false, edge: -0.2, slEdge: 1.5, sleeper: "agrees", split: false, tiebreak: "Tiebreak: FantasyPros has them within a point and you're favoured (62%), so lean floor: Dallas Goedert's low is 8.8, Tre Tucker's 7.6.", why: "" }],
  roster: { starters: [{ slot: "FLEX", player: goedert, pts: 0 }], bench: [tucker], reserve: [] },
  byes: ["BUF"],
} as unknown as GreenBoard;
const pm = { top: [{ id: "1", question: "Will it rain in Denver?", outcome: "Yes", prob: 0.31, closed: false, volume: 123456, volume24h: 999 }], watch: [] } as unknown as PmBoard;
const links = [
  { id: "a", label: "Hub", state: "ok" },
  { id: "b", label: "Sleeper", state: "slow" },
  { id: "c", label: "Off one", state: "off" },
] as unknown as Link[];

describe("the page's data for Skippy's quick take (#341)", () => {
  it("leads with the Green's start/sit call, FantasyPros and Sleeper side by side, and the tiebreak", () => {
    const lines = greenLines(board);
    expect(lines[0]).toBe("Green, week 7, Half PPR: win chance 62%, projected 104.2 to 98.1. Start/sit: FantasyPros decides, Sleeper beside it.");
    expect(lines[1]).toBe("Call FLEX: keep Dallas Goedert (TE, Q, FP 8.8, Sleeper 9.1, TE8 this week) over Tre Tucker (WR, FP 9.0, Sleeper 7.6, WR30 this week); FP edge 0.2; Sleeper agrees; settled by the tiebreak.");
    expect(lines[2]).toMatch(/^FLEX Tiebreak: .*lean floor/);
    expect(lines.join("\n")).toContain("Bench: Tre Tucker WR FP 9.0 / SLP 7.6");
    expect(greenLines(null)).toEqual([]);
  });

  it("puts the Green first, then the page's own room, then the rest; never an amount", () => {
    const onExchange = pageContext({ path: "/exchange", green: board, exchange: pm, links });
    const rows = onExchange.split("\n");
    expect(rows[0]).toBe("Nikita is on the Desk's exchange page.");
    expect(rows[1]).toMatch(/^Green, week 7/);
    expect(rows.findIndex((r) => r.startsWith("Exchange"))).toBeLessThan(rows.findIndex((r) => r.startsWith("Systems")));
    expect(onExchange).toContain("Will it rain in Denver? Yes 31%");
    expect(onExchange).not.toMatch(/\$|123456|999/);
    expect(boilerLines(links)).toEqual(["Systems: 1 of 2 connected links healthy; Sleeper slow."]);
    expect(exchangeLines(null)).toEqual([]);
    expect(pageContext({ path: "/", green: null, exchange: null, links: [] })).toBe("");
  });

  it("stays inside the function's caps, cutting the other rooms before the Green", () => {
    const many = { ...board, calls: Array.from({ length: 30 }, () => board.calls![0]!) } as GreenBoard;
    const text = pageContext({ path: "/", green: many, exchange: pm, links });
    expect(text.length).toBeLessThanOrEqual(PAGE_MAX);
    expect(text.split("\n").length).toBeLessThanOrEqual(PAGE_LINES);
    expect(text).not.toContain("Exchange");
  });
});

describe("the pending bubble and the answer in its place (#341)", () => {
  it("names who has it, and looks often at first, then less", () => {
    expect(pendingText("turf")).toBe("Checking with The Commentator…");
    expect(pendingText("skippy")).toBe("Checking with Skippy's own thread…");
    expect(gaveUpText("turf", "green")).toBe("Still with The Commentator. The answer will show on the Green page, under Asked Skippy.");
    expect(pollEvery(0)).toBe(15_000);
    expect(pollEvery(10 * 60_000)).toBe(30_000);
  });

  it("finds the answer to its own turn only, with the card checked again", () => {
    const at = "2026-10-23T23:31:00.000Z";
    const card = { verdict: "Start Tre Tucker", cols: ["Sleeper", "FantasyPros"], rows: [{ label: "Tre Tucker", values: [7.61, 9] }], metrics: ["Under a point: the tiebreak"], sources: ["Sleeper projections"] };
    const body = {
      room: "green",
      turns: [
        { id: "1111111111111111", at, question: "Why Tucker?", answer: "Checking.", model: "m", needs: "turf", followUp: { from: "turf", text: "TUCKER.", at, card } },
        { id: "2222222222222222", at, question: "Other?", answer: "Checking.", model: "m", needs: "turf" },
      ],
    };
    expect(answerIn(body, { turn: "1111111111111111", room: "green" })).toEqual({ from: "turf", text: "TUCKER.", at, card });
    expect(answerIn(body, { turn: "2222222222222222", room: "green" })).toBeNull();
    expect(answerIn(body, { turn: "1111111111111111", room: "exchange" })).toBeNull();
    expect(readCard({ verdict: "x", cols: ["a"], rows: [{ label: "<b>", values: ["7"] }] })).toEqual({ verdict: "x", cols: ["a"], rows: [{ label: "<b>", values: [null] }], metrics: [], sources: [] });
  });

  describe("in the chat", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      useSkippy.setState({ turns: [], busy: false, open: true, voice: false, unread: false });
    });
    afterEach(() => vi.useRealTimers());

    const TURN = "3f9c0a1b2c3d4e5f";
    function site(answered: () => boolean) {
      const sent: { url: string; body?: unknown }[] = [];
      const doFetch = (async (url: string, init?: RequestInit) => {
        sent.push({ url, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
        if (url === "/api/skippy") return Response.json({ reply: "Goedert by a whisker; checking with the Commentator.", actions: [], room: "green", needs: "turf", turn: TURN });
        const at = "2026-10-23T23:31:00.000Z";
        const followUp = answered() ? { from: "turf", text: "TUCKER, FOLKS.", at, card: { verdict: "Start Tre Tucker", cols: ["Sleeper", "FantasyPros"], rows: [{ label: "Tre Tucker", values: [7.6, 9] }], metrics: [], sources: ["Sleeper projections"] } } : undefined;
        return Response.json({ room: "green", turns: [{ id: TURN, at, question: "Why Tucker?", answer: "Checking.", model: "m", needs: "turf", ...(followUp && { followUp }) }] });
      }) as unknown as typeof fetch;
      return { sent, doFetch };
    }

    it("shows the quick take, then the pending bubble, and swaps the answer in place", async () => {
      let answered = false;
      const { sent, doFetch } = site(() => answered);
      await useSkippy.getState().send("Why start Tre Tucker over Godwin?", doFetch);
      let turns = useSkippy.getState().turns;
      expect(turns.map((t) => t.text)).toEqual(["Why start Tre Tucker over Godwin?", "Goedert by a whisker; checking with the Commentator.", "Checking with The Commentator…"]);
      const pendingId = turns[2]!.id;
      expect(turns[2]!.pending).toMatchObject({ turn: TURN, room: "green", needs: "turf" });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(useSkippy.getState().turns[2]!.pending).toBeDefined();
      answered = true;
      useSkippy.setState({ open: false });
      await vi.advanceTimersByTimeAsync(15_000);
      turns = useSkippy.getState().turns;
      expect(turns).toHaveLength(3);
      expect(turns[2]).toMatchObject({ id: pendingId, text: "TUCKER, FOLKS.", from: "turf", card: { verdict: "Start Tre Tucker" } });
      expect(turns[2]!.pending).toBeUndefined();
      expect(useSkippy.getState().unread).toBe(true);
      useSkippy.getState().setOpen(true);
      expect(useSkippy.getState().unread).toBe(false);
      // Only the room's log while it waited, and nothing once it was answered.
      const reads = sent.filter((s) => s.url.startsWith("/api/skippy-log"));
      expect(reads.map((s) => s.url)).toEqual(["/api/skippy-log?room=green", "/api/skippy-log?room=green"]);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(sent.filter((s) => s.url.startsWith("/api/skippy-log"))).toHaveLength(2);
    });

    it("never sends the pending bubble as history, and stops waiting after two hours", async () => {
      const { sent, doFetch } = site(() => false);
      await useSkippy.getState().send("Why Tucker?", doFetch);
      await useSkippy.getState().send("And the kicker?", doFetch);
      const history = (sent.filter((s) => s.url === "/api/skippy")[1]!.body as { history: { text: string }[] }).history;
      expect(history.map((h) => h.text)).not.toContain("Checking with The Commentator…");
      await vi.advanceTimersByTimeAsync(WAIT_MAX_MS + 60_000);
      const left = useSkippy.getState().turns.filter((t) => t.pending);
      expect(left).toEqual([]);
      expect(useSkippy.getState().turns.at(-1)).toMatchObject({ note: true, text: gaveUpText("turf", "green") });
    });

    it("hands a build to the Kernel: an interim answer shows and keeps it waiting, the final one closes it (#480)", async () => {
      let phase: "none" | "interim" | "final" = "none";
      const sent: string[] = [];
      const doFetch = (async (url: string) => {
        sent.push(url);
        if (url === "/api/skippy") return Response.json({ reply: "A lift for the Spire? I'll get my thread on it.", actions: [], room: "kernel", needs: "skippy", turn: TURN });
        const followUp =
          phase === "interim" ? { from: "skippy", text: "On it: number 481 is open.", at: "2026-10-23T23:31:00.000Z", final: false } : phase === "final" ? { from: "skippy", text: "Shipped in number 481.", at: "2026-10-23T23:40:00.000Z" } : undefined;
        return Response.json({ room: "kernel", turns: [{ id: TURN, at: "2026-10-23T23:30:00.000Z", question: "Build a lift", answer: "On it.", model: "m", needs: "skippy", ...(followUp && { followUp }) }] });
      }) as unknown as typeof fetch;
      await useSkippy.getState().send("Build a lift in the Spire", doFetch);
      expect(useSkippy.getState().turns[2]).toMatchObject({ text: "Checking with Skippy's own thread…", pending: { room: "kernel", needs: "skippy" } });
      phase = "interim";
      useSkippy.setState({ open: false, unread: false });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(useSkippy.getState().turns[2]).toMatchObject({ text: "On it: number 481 is open.", from: "skippy", pending: { seen: "2026-10-23T23:31:00.000Z" } });
      expect(useSkippy.getState().unread).toBe(true);
      useSkippy.setState({ unread: false });
      // The same interim answer again: no second note.
      await vi.advanceTimersByTimeAsync(15_000);
      expect(useSkippy.getState().unread).toBe(false);
      phase = "final";
      await vi.advanceTimersByTimeAsync(15_000);
      expect(useSkippy.getState().turns[2]).toMatchObject({ text: "Shipped in number 481.", from: "skippy" });
      expect(useSkippy.getState().turns[2]!.pending).toBeUndefined();
      expect(useSkippy.getState().unread).toBe(true);
      expect(sent.filter((u) => u.startsWith("/api/skippy-log")).every((u) => u === "/api/skippy-log?room=kernel")).toBe(true);
      expect(gaveUpText("skippy", "kernel")).toMatch(/ping/);
    });
  });
});
