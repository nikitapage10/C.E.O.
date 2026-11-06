import { shortName } from "./asides.ts";
import { tapeItems, type TapeItem } from "./floor.ts";
import { moveTone, pct, type PmBoard, type PmStatus } from "./polymarket.ts";
import type { PosStatus } from "./positions.ts";

/**
 * The trade floor (#823): what the Exchange's 3D hall is built from, worked out from the real reads with no DOM and no
 * three.js, so it is unit tested (hall.test.ts). The busiest markets each take a trading post on the floor, their odds
 * on the post's screens; the marquee over the back wall runs the tape; the book's kiosk shows how many positions are
 * open and nothing else (a count, never a figure); and the posts still being assembled at the floor's edges are the
 * room's real "still to come", each saying what it waits on. Public odds only; nothing here is made up.
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

export interface HallBook {
  /** live: signed in with the key set; locked: behind the passkey; waiting: the key isn't set; off: not read here. */
  state: "live" | "locked" | "waiting" | "off";
  /** How many positions are open, only when live. Never a dollar figure. */
  open: number | null;
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

export function hallView(o: { status: PmStatus; board: PmBoard | null; posStatus: PosStatus; open: number | null; soon: readonly HallSoon[] }): HallView {
  return { status: hallStatus(o.status, o.board), posts: hallPosts(o.board), tape: tapeItems(o.board, 20), book: hallBook(o.posStatus, o.open), soon: [...o.soon] };
}

/** The book kiosk's screen: a count or a state, never a figure. */
export function bookWord(b: HallBook): [string, string] {
  if (b.state === "live") return b.open === null ? ["Your book", "reading"] : [`${b.open}`, b.open === 1 ? "position open" : "positions open"];
  if (b.state === "locked") return ["Your book", "behind your passkey"];
  if (b.state === "waiting") return ["Your book", "waiting for the key"];
  return ["Your book", "not read here"];
}
