import { BOOKIE_LIVE_QUIPS, BOOKIE_MOVE_QUIPS, COMMENTATOR_LIVE_QUIPS, COMMENTATOR_PROJECTED_QUIPS, fillQuip } from "@ceo/simulator";
import { moveTone, pct, type PmMarket } from "../desk/exchange/polymarket.ts";
import { signedPct, type PmPosition, type PosStatus } from "../desk/exchange/positions.ts";
import { sayNumber, type GreenBoard } from "../desk/green/league.ts";
import { tickerChunks } from "./exchangeTicker.ts";

/**
 * What the live rooms' boards in the Lattice say, worked out from the real feeds (Nikita, 2026-10-22: "all the rooms
 * integrate something live, only the ones that are actually working"). Pure, so it can be tested without the scene.
 *
 * - The Exchange's marquee: the C.E.O.'s Polymarket positions (market, side, odds now, P/L %), only for a signed-in
 *   Desk session and never while Hide is on; everyone else sees the public odds.
 * - The Green's scoreboard: projected, then live, then the win chance, against the opponent by name.
 * - The Bookie's and the Commentator's live lines: public numbers only (odds, scores, the win chance), never money.
 */

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/* ── the Exchange's marquee ── */

/** What the marquee can know about the C.E.O.'s book: the positions store's state, and whether Hide is on. */
export interface BookView {
  status: PosStatus;
  positions: readonly PmPosition[] | null;
  hidden: boolean;
}

/** The side a position is on: the outcome, or "SHORT <outcome>" (the other side, on Polymarket US). */
export const sideOf = (p: PmPosition) => (p.short ? `SHORT ${p.outcome}` : p.outcome).toUpperCase();

/** The price of the held side now, from its cash value per contract; null when there is nothing to go on. */
export function oddsNow(p: PmPosition): number | null {
  if (!(p.contracts > 0) || !Number.isFinite(p.value)) return null;
  return Math.max(0, Math.min(1, p.value / p.contracts));
}

/** One position on the marquee: "BREWERS WIN THE WORLD SERIES · YES · NOW 63% · P/L ▲+14.5%". No dollar figure. */
export function positionChunk(p: PmPosition): string {
  const now = oddsNow(p);
  const pl = p.pnlPct;
  const arrow = pl === null || Math.abs(pl) < 0.05 ? "" : pl > 0 ? "▲" : "▼";
  return `${clip(p.market.toUpperCase().replace(/\?$/, ""), 44)} · ${clip(sideOf(p), 18)} · NOW ${now === null ? "–" : pct(now)} · P/L ${arrow}${signedPct(pl)}`;
}

/** The most positions the marquee carries (largest first, as the server sends them); the rest are on the Desk. */
export const MARQUEE_MAX = 8;

/** Whether the marquee may show the book: signed in, read, and Hide off. */
export const showsBook = (book: BookView) => book.status === "live" && !book.hidden && !!book.positions;

/**
 * The marquee's words: the C.E.O.'s open positions when `showsBook`, else the public odds board (and, while Hide is
 * on for a signed-in Desk, a line saying the book is hidden). Expired positions are left off.
 */
export function marqueeChunks(book: BookView, top: readonly PmMarket[]): string[] {
  if (showsBook(book)) {
    const open = book.positions!.filter((p) => !p.expired);
    if (!open.length) return ["THE C.E.O.'S BOOK · NO OPEN POSITIONS", ...tickerChunks(top)];
    const shown = open.slice(0, MARQUEE_MAX).map(positionChunk);
    return [`THE C.E.O.'S BOOK · ${open.length} OPEN`, ...shown, ...(open.length > MARQUEE_MAX ? [`+${open.length - MARQUEE_MAX} MORE ON THE DESK`] : [])];
  }
  const head = book.hidden && book.status === "live" ? "THE C.E.O.'S BOOK · HIDDEN" : "POLYMARKET · LIVE ODDS";
  return [head, ...tickerChunks(top)];
}

/** A chunk's colour on the marquee: mint for a gain or a market up on the day, red for a loss or down, else white. */
export const chunkTone = (chunk: string): "up" | "down" | "flat" => (chunk.includes("▲") ? "up" : chunk.includes("▼") ? "down" : "flat");

/* ── the Green's scoreboard ── */

export interface ScoreRows {
  /** "HORSE MEAT v THE OTHER LOT", or the week's state when there is no game. */
  teams: string;
  /** "PROJ 112.4 – 98.1". */
  proj: string;
  /** "LIVE 45.2 – 38.0", or "LIVE AT KICK-OFF" before a game is on. */
  live: string;
  /** "WIN 71%", or "WIN --%" without a chance. */
  win: string;
}

const pts = (n: number) => n.toFixed(1);

/** The Green's scoreboard in the Lattice, from the C.E.O.'s real matchup (#252): projected first, then live, then the win chance. */
export function scoreRows(board: GreenBoard | null): ScoreRows {
  const m = board?.matchup;
  if (!board) return { teams: "READING THE LEAGUE", proj: "PROJ -- – --", live: "LIVE -- – --", win: "WIN --%" };
  if (!m) return { teams: `WEEK ${board.week} · NO GAME`, proj: "PROJ -- – --", live: "LIVE -- – --", win: "WIN --%" };
  const me = clip(m.me.team.toUpperCase(), 16);
  if (!m.them) return { teams: `${me} · BYE`, proj: `PROJ ${pts(m.me.proj)}`, live: "LIVE --", win: "WIN --%" };
  return {
    teams: `${me} v ${clip(m.them.team.toUpperCase(), 16)}`,
    proj: `PROJ ${pts(m.me.proj)} – ${pts(m.them.proj)}`,
    live: m.live ? `LIVE ${pts(m.me.pts)} – ${pts(m.them.pts)}` : "LIVE AT KICK-OFF",
    win: `WIN ${m.win === null ? "--" : `${Math.round(m.win * 100)}`}%`,
  };
}

/* ── live lines ── */

const pickOf = <T>(list: readonly T[], r: number): T => list[Math.min(list.length - 1, Math.floor(r * list.length))]!;

/** The Bookie on one of the board's real markets; null until the feed answers. `r1` picks the market, `r2` the line. */
export function bookieLine(top: readonly PmMarket[], r1: number, r2: number): string | null {
  if (!top.length) return null;
  const m = pickOf(top.slice(0, 6), r1);
  const market = clip(m.question.replace(/\?$/, ""), 60);
  const odds = pct(m.prob);
  const tone = moveTone(m.change24h);
  if (tone !== "flat" && m.change24h !== null && Math.abs(m.change24h) >= 0.01 && r2 < 0.4) {
    const pts = Math.round(Math.abs(m.change24h) * 100);
    return fillQuip(pickOf(BOOKIE_MOVE_QUIPS, r2 / 0.4), { market, odds, move: `${tone} ${sayNumber(pts).toLowerCase()}` });
  }
  return fillQuip(pickOf(BOOKIE_LIVE_QUIPS, r2), { market, odds });
}

/** The Commentator on the C.E.O.'s matchup; null without a game this week. */
export function commentatorLine(board: GreenBoard | null, r: number): string | null {
  const m = board?.matchup;
  if (!m?.them) return null;
  const vars = {
    me: m.me.team.toUpperCase(),
    them: m.them.team.toUpperCase(),
    proj: pts(m.me.proj),
    theirProj: pts(m.them.proj),
    score: pts(m.me.pts),
    theirScore: pts(m.them.pts),
    win: m.win === null ? "SOME" : sayNumber(m.win * 100),
  };
  return fillQuip(pickOf(m.live ? COMMENTATOR_LIVE_QUIPS : COMMENTATOR_PROJECTED_QUIPS, r), vars);
}
