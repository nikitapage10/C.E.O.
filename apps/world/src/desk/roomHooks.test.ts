import { afterEach, describe, expect, it } from "vitest";
import { useSystems, type Link } from "../systems.ts";
import { usePolymarket, type PmBoard } from "./exchange/polymarket.ts";
import { greenLines } from "./green/skippy.ts";
import { exchangeLines } from "./exchange/skippy.ts";
import { useGreen, type GreenBoard, type GreenPlayer } from "./green/league.ts";
import "./roomHooks.ts";
import { PAGE_LINES, PAGE_MAX, boilerLines, pageContext } from "./skippy/page.ts";
import { pageSources, texting } from "./skippy/rooms.ts";
import { pageNow } from "./skippy/roundtrip.ts";

/** The rooms plugged into the Desk's kits (#617, step 3): Skippy's page block from each room's own lines (#341), and texting. */

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

/** The rooms' lines as the round trip reads them, for a page block at `path`. */
async function block(path: string): Promise<string> {
  const rooms = await Promise.all(pageSources().map(async ({ room, first, lines }) => ({ room, first, lines: await lines() })));
  return pageContext({ path, rooms, links: useSystems.getState().links });
}

afterEach(() => {
  useGreen.setState({ board: null });
  usePolymarket.setState({ board: null });
  useSystems.setState({ links: [] });
});

describe("the page's data for Skippy's quick take (#341), from the rooms' own lines", () => {
  it("leads with the Green's start/sit call, FantasyPros and Sleeper side by side, and the tiebreak", () => {
    const lines = greenLines(board);
    expect(lines[0]).toBe("Green, week 7, Half PPR: win chance 62%, projected 104.2 to 98.1. Start/sit: FantasyPros decides, Sleeper beside it.");
    expect(lines[1]).toBe("Call FLEX: keep Dallas Goedert (TE, Q, FP 8.8, Sleeper 9.1, TE8 this week) over Tre Tucker (WR, FP 9.0, Sleeper 7.6, WR30 this week); FP edge 0.2; Sleeper agrees; settled by the tiebreak.");
    expect(lines[2]).toMatch(/^FLEX Tiebreak: .*lean floor/);
    expect(lines.join("\n")).toContain("Bench: Tre Tucker WR FP 9.0 / SLP 7.6");
    expect(greenLines(null)).toEqual([]);
  });

  it("puts the Green first, then the page's own room, then the rest; never an amount", async () => {
    useGreen.setState({ board });
    usePolymarket.setState({ board: pm });
    useSystems.setState({ links });
    const onExchange = await block("/exchange");
    const rows = onExchange.split("\n");
    expect(rows[0]).toBe("Nikita is on the Desk's exchange page.");
    expect(rows[1]).toMatch(/^Green, week 7/);
    expect(rows.findIndex((r) => r.startsWith("Exchange"))).toBeLessThan(rows.findIndex((r) => r.startsWith("Systems")));
    expect(onExchange).toContain("Will it rain in Denver? Yes 31%");
    expect(onExchange).not.toMatch(/\$|123456|999/);
    const onBoiler = (await block("/boiler")).split("\n");
    expect(onBoiler.findIndex((r) => r.startsWith("Systems"))).toBeLessThan(onBoiler.findIndex((r) => r.startsWith("Exchange")));
    expect(boilerLines(links)).toEqual(["Systems: 1 of 2 connected links healthy; Sleeper slow."]);
    expect(exchangeLines(null)).toEqual([]);
  });

  it("is empty with nothing loaded, as the round trip sends it", async () => {
    expect(await block("/")).toBe("");
    expect(await pageNow()).toBe("");
  });

  it("stays inside the function's caps, cutting the other rooms before the Green", async () => {
    useGreen.setState({ board: { ...board, calls: Array.from({ length: 30 }, () => board.calls![0]!) } as GreenBoard });
    usePolymarket.setState({ board: pm });
    useSystems.setState({ links });
    const text = await pageNow();
    expect(text.length).toBeLessThanOrEqual(PAGE_MAX);
    expect(text.split("\n").length).toBeLessThanOrEqual(PAGE_LINES);
    expect(text).toMatch(/^Nikita is on the Desk's Today page\.\nGreen, week 7/);
    expect(text).not.toContain("Exchange");
  });
});

describe("texting from Skippy (#536)", () => {
  it("is the Relay's, plugged in with its card loading on the first text", () => {
    expect(texting()).not.toBeNull();
    expect(texting()!.Card).toBeNull();
  });
});
