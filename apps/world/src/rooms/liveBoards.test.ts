import { describe, expect, it } from "vitest";
import type { PmMarket } from "../desk/exchange/polymarket.ts";
import type { PmPosition } from "../desk/exchange/positions.ts";
import type { GreenBoard } from "../desk/green/league.ts";
import { bookieLine, commentatorLine, marqueeChunks, oddsNow, positionChunk, scoreRows, showsBook, type BookView } from "./liveBoards.ts";

const market = (question: string, prob: number, change24h: number | null = null): PmMarket => ({ id: "1", question, outcome: "Yes", prob, change24h } as PmMarket);
const TOP = [market("Will it rain in Denver on Saturday?", 0.63, 0.04), market("Fed cuts in December?", 0.31, -0.02)];

const pos = (over: Partial<PmPosition> = {}): PmPosition => ({
  market: "Brewers win the World Series?",
  outcome: "Yes",
  url: null,
  short: false,
  contracts: 40,
  avgPrice: 0.55,
  value: 25.2,
  cost: 22,
  pnl: 3.2,
  pnlPct: 14.545,
  realized: 1.5,
  expired: false,
  ...over,
});
const BOOK = [pos(), pos({ market: "Fed cuts in December?", short: true, contracts: 10, value: 4, cost: 6, pnl: -2, pnlPct: -33.3 }), pos({ market: "Old market", expired: true })];

const view = (over: Partial<BookView> = {}): BookView => ({ status: "live", positions: BOOK, hidden: false, ...over });
const MONEY = /\$|25\.2|22\.00|3\.20|realized/i;

describe("the Exchange's marquee", () => {
  it("shows the C.E.O.'s open positions to a signed-in Desk: market, side, odds now, P/L %, no dollar figure", () => {
    const chunks = marqueeChunks(view(), TOP);
    expect(chunks[0]).toBe("THE C.E.O.'S BOOK · 2 OPEN");
    expect(chunks[1]).toBe("BREWERS WIN THE WORLD SERIES · YES · NOW 63% · P/L ▲+14.5%");
    expect(chunks[2]).toBe("FED CUTS IN DECEMBER · SHORT YES · NOW 40% · P/L ▼−33.3%");
    expect(chunks.join(" ")).not.toMatch(MONEY);
    expect(chunks.join(" ")).not.toMatch(/OLD MARKET/);
  });

  it("signed out, off, or not read yet: public odds only, never a position", () => {
    for (const status of ["signed-out", "off", "idle", "failed", "waiting"] as const) {
      const chunks = marqueeChunks(view({ status }), TOP);
      expect(showsBook(view({ status }))).toBe(false);
      expect(chunks[0]).toBe("POLYMARKET · LIVE ODDS");
      expect(chunks.join(" ")).not.toMatch(/BREWERS|P\/L|BOOK/);
    }
  });

  it("Hide masks the book: the marquee says so and shows the public odds instead", () => {
    const chunks = marqueeChunks(view({ hidden: true }), TOP);
    expect(chunks[0]).toBe("THE C.E.O.'S BOOK · HIDDEN");
    expect(chunks.join(" ")).not.toMatch(/BREWERS|P\/L|NOW /);
    expect(chunks.join(" ")).toMatch(/RAIN IN DENVER/);
  });

  it("works out the odds now from the cash value per contract", () => {
    expect(oddsNow(pos())).toBeCloseTo(0.63);
    expect(oddsNow(pos({ contracts: 0 }))).toBeNull();
    expect(positionChunk(pos({ pnlPct: null }))).toMatch(/P\/L –$/);
  });
});

function board(over: Partial<NonNullable<GreenBoard["matchup"]>> = {}): GreenBoard {
  const side = (team: string, pts: number, proj: number) => ({ rosterId: 1, team, record: "5-1", pts, proj, starters: [] });
  return {
    week: 7,
    matchup: { week: 7, me: side("Denver Dream Team", 0, 103.8), them: side("5:30 Abdi", 0, 77.5), win: 0.877, live: false, ...over },
  } as unknown as GreenBoard;
}

describe("the Green's scoreboard", () => {
  it("leads with the projected score, then live, then the win chance, against the opponent by name", () => {
    expect(scoreRows(board())).toEqual({ teams: "DENVER DREAM TE… v 5:30 ABDI", proj: "PROJ 103.8 – 77.5", live: "LIVE AT KICK-OFF", win: "WIN 88%" });
    const live = board({ live: true, me: { rosterId: 1, team: "Denver Dream Team", record: "5-1", pts: 61.25, proj: 110.2, starters: [] } });
    expect(scoreRows(live)).toMatchObject({ proj: "PROJ 110.2 – 77.5", live: "LIVE 61.3 – 0.0" });
  });

  it("says so without a league, a game or an opponent", () => {
    expect(scoreRows(null).teams).toBe("READING THE LEAGUE");
    expect(scoreRows({ week: 9, matchup: null } as unknown as GreenBoard).teams).toBe("WEEK 9 · NO GAME");
    expect(scoreRows(board({ them: null, win: null })).teams).toMatch(/BYE$/);
  });
});

describe("live lines", () => {
  it("the Bookie reads public odds, never money", () => {
    for (let i = 0; i < 20; i++) {
      const line = bookieLine(TOP, i / 20, ((i * 7) % 20) / 20)!;
      expect(line).toMatch(/63%|31%/);
      expect(line).not.toMatch(/\$|\{/);
    }
    expect(bookieLine([], 0, 0)).toBeNull();
  });

  it("the Commentator calls the real matchup: projected before kick-off, live after", () => {
    for (let i = 0; i < 10; i++) {
      const pre = commentatorLine(board(), i / 10)!;
      expect(pre).toMatch(/103\.8|EIGHTY-EIGHT/);
      expect(pre).not.toMatch(/\$|\{/);
      const on = commentatorLine(board({ live: true }), i / 10)!;
      expect(on).not.toMatch(/\{/);
    }
    expect(commentatorLine(board({ them: null }), 0)).toBeNull();
    expect(commentatorLine(null, 0)).toBeNull();
  });
});
