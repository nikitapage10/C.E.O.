import { shortName } from "./asides.ts";
import { tapeItems, type TapeItem } from "./floor.ts";
import { moveTone, pct, type PmBoard, type PmStatus } from "./polymarket.ts";
import type { PmPosition, PosStatus } from "./positions.ts";

/**
 * The trade floor (#823): what the Exchange's 3D hall is built from, worked out from the real reads with no DOM and no
 * three.js, so it is unit tested (hall.test.ts). The busiest markets each take a trading post on the floor, their odds
 * on the post's screens; the marquee over the back wall runs the tape; the book's kiosk shows how many positions are
 * open and nothing else (a count, never a figure); and the posts still being assembled at the floor's edges are the
 * room's real "still to come", each saying what it waits on. Public odds only; nothing here is made up.
 *
 * Nikita's open positions stand in the ring at the floor's centre (#988), one lit pillar each, as tall as its share of
 * the book. Only a signed-in Desk ever has them (the positions store reads them behind the passkey); the pillars carry
 * the market, the side and the share, never a dollar figure, and signed out the ring stands empty in wire.
 */

/** How many trading posts stand on the floor: the busiest markets, in order. */
export const POSTS = 5;

export interface HallPost {
  id: string;
  /** The market's short name, for the post's screens and its tag. */
  name: string;
  /** The full question, for the tag's title. */
  question: string;
  odds: string;
  prob: number;
  /** "▲7", "▼3", "" when it held or Polymarket didn't say. */
  move: string;
  tone: "up" | "down" | "flat";
  /** Its share of the floor's day's money, 0..1 (the busiest is 1). */
  share: number;
}

export interface HallSoon {
  id: string;
  /** What it will be ("The research desk"). */
  name: string;
  /** What it waits on ("Waiting on a price source"). */
  on: string;
}

/** How many positions stand in the ring at the floor's centre; the rest are counted on the kiosk. */
export const HOLDINGS = 5;

/** One open position as a pillar in the ring (#988): what it is on and how much of the book it is, never a dollar figure. */
export interface HallHolding {
  id: string;
  /** The market's short name. */
  name: string;
  /** "Yes", "Short Brewers". */
  side: string;
  /** Its share of the open book by current value, 0..1. */
  share: number;
  /** Against the biggest holding, 0..1 (the biggest is 1): how tall its pillar stands. */
  rel: number;
  /** Which way it has gone since it was bought; flat while Hide is on. */
  tone: "up" | "down" | "flat";
}

export interface HallBook {
  /** live: signed in with the key set; locked: behind the passkey; waiting: the key isn't set; off: not read here. */
  state: "live" | "locked" | "waiting" | "off";
  /** How many positions are open, only when live. Never a dollar figure. */
  open: number | null;
  /** The biggest open positions, for the ring's pillars; empty unless live. */
  holds?: HallHolding[];
  /** Open positions past the ring's pillars. */
  more?: number;
  /** The Desk's Hide is on: the pillars keep their size, their screens and tags are veiled. */
  hide?: boolean;
}

export interface HallView {
  status: "reading" | "live" | "stale" | "failed" | "off";
  posts: HallPost[];
  tape: TapeItem[];
  book: HallBook;
  soon: HallSoon[];
}

/** The hall's state word from Polymarket's read. */
export function hallStatus(status: PmStatus, board: Pick<PmBoard, "stale"> | null): HallView["status"] {
  if (status === "ready" && board) return board.stale ? "stale" : "live";
  if (status === "failed") return "failed";
  if (status === "off") return "off";
  return "reading";
}

/** The book's kiosk: a state, and a count only when it is live. */
export function hallBook(status: PosStatus, open: number | null): HallBook {
  if (status === "live") return { state: "live", open };
  if (status === "signed-out") return { state: "locked", open: null };
  if (status === "waiting") return { state: "waiting", open: null };
  return { state: "off", open: null };
}

/**
 * The ring's pillars (#988): the open positions (not expired) by their share of the book's current value, biggest first,
 * at most `n`. Shares only, never the dollars they came from; the tone is the sign of the open profit or loss.
 */
export function hallHoldings(positions: readonly PmPosition[] | null | undefined, n = HOLDINGS): { holds: HallHolding[]; more: number } {
  const open = (positions ?? []).filter((p) => !p.expired);
  const size = (p: PmPosition) => (Number.isFinite(p.value) ? Math.abs(p.value) : 0);
  const total = open.reduce((x, p) => x + size(p), 0);
  const sorted = open.map((p, i) => ({ p, i })).sort((a, b) => size(b.p) - size(a.p) || a.i - b.i);
  const top = sorted.slice(0, n);
  const max = top.length ? size(top[0]!.p) : 0;
  const holds = top.map(({ p, i }): HallHolding => {
    const t = Math.abs(p.pnl) < 0.005 ? "flat" : p.pnl > 0 ? "up" : "down";
    return {
      id: `hold-${i}`,
      name: shortName(p.market),
      side: `${p.short ? "Short " : ""}${p.outcome}`,
      share: total > 0 ? size(p) / total : 1 / Math.max(1, open.length),
      rel: max > 0 ? size(p) / max : 1,
      tone: t,
    };
  });
  return { holds, more: Math.max(0, open.length - holds.length) };
}

/** "38%" of the book; "<1%" for a sliver. */
export const shareWord = (s: number): string => (s > 0 && s < 0.005 ? "<1%" : `${Math.round(s * 100)}%`);

/** The book with its pillars: only when live, and veiled (tone flat) while Hide is on. */
export function withHoldings(b: HallBook, positions: readonly PmPosition[] | null | undefined, hide: boolean): HallBook {
  if (b.state !== "live") return { ...b, holds: [], more: 0, hide };
  const { holds, more } = hallHoldings(positions);
  return { ...b, holds: hide ? holds.map((h) => ({ ...h, tone: "flat" as const })) : holds, more, hide };
}

/** The busiest open markets, one per post, each with its share of the day's money among them. */
export function hallPosts(board: Pick<PmBoard, "top"> | null, n = POSTS): HallPost[] {
  const top = (board?.top ?? []).filter((m) => !m.closed).slice(0, n);
  const max = top.reduce((x, m) => Math.max(x, m.volume24h), 0);
  return top.map((m) => {
    const t = moveTone(m.change24h);
    const pts = Math.abs(Math.round((m.change24h ?? 0) * 100));
    return {
      id: m.id,
      name: shortName(m.question),
      question: m.question,
      odds: pct(m.prob),
      prob: m.prob,
      move: t === "flat" || pts === 0 ? "" : `${t === "up" ? "▲" : "▼"}${pts}`,
      tone: pts === 0 ? "flat" : t,
      share: max > 0 ? Math.min(1, m.volume24h / max) : 0,
    };
  });
}

export function hallView(o: { status: PmStatus; board: PmBoard | null; posStatus: PosStatus; open: number | null; soon: readonly HallSoon[]; positions?: readonly PmPosition[] | null; hide?: boolean }): HallView {
  return { status: hallStatus(o.status, o.board), posts: hallPosts(o.board), tape: tapeItems(o.board, 20), book: withHoldings(hallBook(o.posStatus, o.open), o.positions, o.hide ?? false), soon: [...o.soon] };
}

/** The book kiosk's screen: a count or a state, never a figure. */
export function bookWord(b: HallBook): [string, string] {
  if (b.state === "live") return b.open === null ? ["Your book", "reading"] : [`${b.open}`, b.open === 1 ? "position open" : "positions open"];
  if (b.state === "locked") return ["Your book", "behind your passkey"];
  if (b.state === "waiting") return ["Your book", "waiting for the key"];
  return ["Your book", "not read here"];
}
