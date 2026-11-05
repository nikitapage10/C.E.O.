import { shortName } from "./asides.ts";
import { moveTone, pct, type PmBoard, type PmMarket } from "./polymarket.ts";

/**
 * The Exchange on the flow kit (#430): what its particle lines and its marquee are made of, worked out from the real
 * reads with no DOM and no canvas, so it is unit tested (floor.test.ts). Public odds give the floor's lines and the
 * marquee; Nikita's own positions give the book's lines, which carry shapes and rates only, never a dollar figure.
 */

export const MINT = "124,205,172";
export const ROSE = "240,122,143";
export const STILL = "200,206,220";

/** "r,g,b" for a move: mint up, rose down, a cool grey when it held. */
export const toneRgb = (t: "up" | "down" | "flat") => (t === "up" ? MINT : t === "down" ? ROSE : STILL);

/** Whole points moved on the day, sign kept; null when Polymarket didn't say. */
export const movePts = (c: number | null) => (c === null ? null : Math.round(c * 100));

/** A market's line on the floor: density is its share of the day's money, pace is the day's move, colour its way. */
export function marketLine(m: Pick<PmMarket, "volume24h" | "change24h">, maxVol: number): { density: number; rate: number; rgb: string; bright: number } {
  const share = maxVol > 0 ? Math.min(1, Math.max(0, m.volume24h / maxVol)) : 0;
  const pts = Math.min(12, Math.abs(m.change24h ?? 0) * 100);
  const t = moveTone(m.change24h);
  return { density: 0.12 + 0.6 * Math.sqrt(share), rate: 18 + pts * 9, rgb: toneRgb(t), bright: t === "flat" ? 0.5 : 0.6 + Math.min(0.35, pts / 25) };
}

/* ── the book ── */

export interface BookIn {
  value: number;
  cost: number;
  pnl: number;
  pnlPct: number | null;
  contracts: number;
  avgPrice: number | null;
}

/** A position's return in percent: Polymarket's figure when it sent one, else P&L over cost. */
export function returnPct(p: Pick<BookIn, "pnl" | "cost" | "pnlPct">): number {
  if (p.pnlPct !== null && Number.isFinite(p.pnlPct)) return p.pnlPct;
  return Math.abs(p.cost) > 0 ? (p.pnl / Math.abs(p.cost)) * 100 : 0;
}

/** How many are above water (in profit), under it (at a loss) and on it (flat). */
export function waterline(ps: readonly Pick<BookIn, "pnl">[]): { above: number; under: number; flat: number } {
  let above = 0;
  let under = 0;
  for (const p of ps) {
    if (p.pnl >= 0.005) above++;
    else if (p.pnl <= -0.005) under++;
  }
  return { above, under, flat: ps.length - above - under };
}

/** The price a position marks at now, per contract: its value over its size. */
export const nowPrice = (p: Pick<BookIn, "value" | "contracts">): number | null => (p.contracts > 0 ? Math.max(0, Math.min(1, p.value / p.contracts)) : null);

/**
 * A position's line in its row: from what was paid (`from`, 0..1 of the track's height, 0 the top) to where it marks
 * now (`to`), so the slope is the move since entry; it runs faster and brighter the further it has moved. Prices span
 * the day's own range only, never a dollar figure.
 */
export function positionLine(p: BookIn): { from: number; to: number; rate: number; bright: number; density: number; tone: "up" | "down" | "flat" } {
  const r = returnPct(p);
  const a = p.avgPrice;
  const n = nowPrice(p);
  const tone = Math.abs(p.pnl) < 0.005 ? "flat" : p.pnl > 0 ? "up" : "down";
  // Entry and now on a price axis widened to at least ten points, so a small move still tilts but never fills the row.
  let from: number;
  let to: number;
  if (a !== null && n !== null) {
    const mid = (a + n) / 2;
    const half = Math.max(0.05, Math.abs(n - a) / 2) / 0.8;
    from = 0.5 - (a - mid) / (2 * half);
    to = 0.5 - (n - mid) / (2 * half);
  } else {
    const k = Math.max(-0.4, Math.min(0.4, r / 100));
    from = 0.5 + k;
    to = 0.5 - k;
  }
  const mag = Math.min(1, Math.abs(r) / 40);
  return { from, to, rate: 14 + mag * 70, bright: 0.45 + mag * 0.5, density: 0.35 + mag * 0.5, tone };
}

/* ── the marquee ── */

export interface TapeItem {
  id: string;
  name: string;
  odds: string;
  /** "▲7", "▼3", "" when it held or Polymarket didn't say. */
  move: string;
  tone: "up" | "down" | "flat";
  url: string | null;
}

/** The marquee's run: the world-moving markets first, then the busiest, each once, at most `max`. */
export function tapeItems(board: Pick<PmBoard, "top" | "world"> | null, max = 16): TapeItem[] {
  if (!board) return [];
  const seen = new Set<string>();
  const out: TapeItem[] = [];
  for (const m of [...board.world, ...board.top]) {
    if (seen.has(m.id) || m.closed || out.length >= max) continue;
    seen.add(m.id);
    const t = moveTone(m.change24h);
    const pts = Math.abs(movePts(m.change24h) ?? 0);
    out.push({ id: m.id, name: shortName(m.question), odds: pct(m.prob), move: t === "flat" || pts === 0 ? "" : `${t === "up" ? "▲" : "▼"}${pts}`, tone: pts === 0 ? "flat" : t, url: m.url });
  }
  return out;
}

/** How long one run of the marquee takes, in seconds: a steady reading pace whatever its length. */
export const tapeSeconds = (width: number, pxPerS = 42) => Math.max(20, Math.round(width / pxPerS));

/** The floor's headline word: moving when anything moved a point or more today, quiet when nothing did. */
export function floorWord(board: Pick<PmBoard, "top" | "world"> | null): "moving" | "quiet" | "waiting" {
  if (!board || (!board.top.length && !board.world.length)) return "waiting";
  return [...board.top, ...board.world].some((m) => m.change24h !== null && Math.abs(m.change24h) >= 0.01) ? "moving" : "quiet";
}

/** The day's biggest move, in whole points, across the board; null when nothing says. */
export function biggestMove(board: Pick<PmBoard, "top" | "world"> | null): number | null {
  if (!board) return null;
  let best: number | null = null;
  for (const m of [...board.top, ...board.world]) if (m.change24h !== null) best = Math.max(best ?? 0, Math.abs(Math.round(m.change24h * 100)));
  return best;
}
