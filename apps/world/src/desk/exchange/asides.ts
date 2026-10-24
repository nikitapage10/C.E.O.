import { BOOKIE_WORLD_QUIPS, fillQuip } from "@ceo/simulator";
import { sayNumber } from "../green/league.ts";
import { moveTone, pct, type PmWorld, type PmWorldKind } from "./polymarket.ts";

/**
 * The Bookie's asides on world-moving odds (#345), worked out from the board's `world` list: what each market is about,
 * how far it moved, and one line in his voice on why it matters (BOOKIE_WORLD_QUIPS). Pure, shared by the Desk's
 * Exchange page (BookieAsides.tsx) and his podium in the Lattice (rooms/liveBoards.ts). Public odds only.
 */

export const KIND_LABEL: Record<PmWorldKind, string> = { geopolitics: "Geopolitics", politics: "Politics", culture: "Pop culture" };

/** A move of at least a point counts as a move; less is noise. */
export const MOVED = 0.01;

/** Whole points moved on the day, sign dropped; null when Polymarket didn't say. */
export function movePts(m: Pick<PmWorld, "change24h">): number | null {
  return m.change24h === null ? null : Math.round(Math.abs(m.change24h) * 100);
}

export function moved(m: Pick<PmWorld, "change24h">): boolean {
  return m.change24h !== null && Math.abs(m.change24h) >= MOVED;
}

/** The day's move in words: "up four", "down twelve". */
export function moveWords(m: Pick<PmWorld, "change24h">): string {
  const pts = movePts(m) ?? 0;
  return `${moveTone(m.change24h) === "down" ? "down" : "up"} ${sayNumber(pts).toLowerCase()}`;
}

/** A small, steady hash, so a market keeps its line between reads instead of flickering. */
export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/**
 * What the Bookie calls a market out loud: the question without its question mark or its deadline
 * ("NATO x Russia military clash by December 31, 2026?" → "NATO x Russia military clash"), so his line doesn't just
 * repeat the title above it. Falls back to the whole question when trimming would leave too little.
 */
export function shortName(q: string): string {
  const t = q
    .trim()
    .replace(/\?$/, "")
    .replace(/\s+(by|before|in|through)\s+(the end of\s+)?(\w+\s+\d{1,2},?\s+)?(\w+\s+)?\d{4}$/i, "")
    .replace(/\s+(by|before|through)\s+\w+\s+\d{1,2}$/i, "")
    .trim();
  return t.length >= 8 ? t : q.replace(/\?$/, "");
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The Bookie's line on one market. `r` (0..1) picks the line; by default the market's own id does, so it stays put. */
export function asideLine(m: PmWorld, r = seedOf(m.id), max = 90): string {
  const set = BOOKIE_WORLD_QUIPS[m.kind];
  const lines = moved(m) ? set.moved : set.still;
  const line = lines[Math.min(lines.length - 1, Math.floor(r * lines.length))]!;
  return fillQuip(line, { market: clip(shortName(m.question), max), odds: pct(m.prob), move: moveWords(m) });
}

/** The aside's tag: "Moved most today", "Busiest", or plain "Live". */
export function asideBadge(m: PmWorld, world: readonly PmWorld[]): string {
  const biggest = world.reduce<PmWorld | null>((best, x) => (moved(x) && (!best || Math.abs(x.change24h!) > Math.abs(best.change24h!)) ? x : best), null);
  if (biggest?.id === m.id) return "Moved most today";
  const busiest = world.reduce<PmWorld | null>((best, x) => (!best || x.volume24h > best.volume24h ? x : best), null);
  return busiest?.id === m.id ? "Busiest today" : "Live";
}

/** Biggest movers first, for the movers rail (#367); markets Polymarket gave no move for go last. */
export function byMove<T extends Pick<PmWorld, "change24h">>(world: readonly T[]): T[] {
  return [...world].sort((a, b) => (b.change24h === null ? -1 : Math.abs(b.change24h)) - (a.change24h === null ? -1 : Math.abs(a.change24h)));
}
