import { clamp } from "../wvCanvas.ts";
import { converge, fan, type Pt } from "../flow/path.ts";

/**
 * Relay's filter (#429), the maths with no DOM: how the real counts become the lines' volume, pace and splits, which
 * lines a change in the counts runs down, and the paths themselves (a feed into Dialtone's sort, then the split).
 * Unit tested in filter.test.ts. The page (RelayFilter.tsx) reads the DOM for the points and hands them in.
 */

/** The day's counts, from the email agent's public status (counts and states only). */
export interface Counts {
  /** New inbox mail today. */
  total: number;
  /** Noise and promotions, handled without Nikita. */
  handled: number;
  fyi: number;
  needs: number;
}

/** How much a day's mail fills the feed, 0..1: a quiet day is a thin feed, a heavy one dense (log, so 400 isn't 40x 10). */
export const volumeOf = (total: number) => clamp(0.22 + (Math.log10(1 + Math.max(0, total)) / 2.4) * 0.78, 0.22, 1);

/** How fast the feed runs, px/s: a busier day runs faster, within reason. */
export const rateOf = (total: number) => Math.round(24 + 34 * clamp(Math.log10(1 + Math.max(0, total)) / 2.4, 0, 1));

/**
 * Of the particles a branch carries through the sort, the share that goes on past it (`thin.keep`). Handled keeps
 * little (most of the day's mail settles away there), FYI keeps more, a needing mail keeps all of it.
 */
export function keepOf(kind: "handled" | "fyi" | "needs", c: Counts): number {
  if (kind === "needs") return 1;
  const all = Math.max(1, c.handled + c.fyi + c.needs);
  if (kind === "handled") return clamp(0.18 + 0.3 * (c.handled / all), 0.18, 0.48);
  return clamp(0.4 + 0.5 * (c.fyi / all), 0.4, 0.9);
}

/** How many particles a branch carries out of the sort (0..1), by its real share of the day: the bulk is Handled. */
export function densityOf(kind: "handled" | "fyi" | "needs", c: Counts, needLines = 1): number {
  const v = volumeOf(c.total);
  const all = Math.max(1, c.handled + c.fyi + c.needs);
  if (kind === "handled") return clamp(v * (0.55 + 0.45 * (c.handled / all)), 0.3, 1);
  if (kind === "fyi") return clamp(v * (0.14 + 0.5 * (c.fyi / all)), 0.1, 0.6);
  return clamp((v * 0.6) / Math.sqrt(Math.max(1, needLines)), 0.12, 0.45);
}

/** What arrived between two reads of the counts: each one runs a pulse down its branch. Nothing on the first read. */
export function arrivals(prev: Counts | null, next: Counts): { handled: number; fyi: number; needs: number } {
  if (!prev) return { handled: 0, fyi: 0, needs: 0 };
  return { handled: Math.max(0, next.handled - prev.handled), fyi: Math.max(0, next.fyi - prev.fyi), needs: Math.max(0, next.needs - prev.needs) };
}

/** A path, sampled. */
export type Sampled = { xs: number[]; ys: number[] };

/** A sampled path's length, px (how long a pulse takes to run the feed). */
export const lenOf = (s: Sampled) => {
  let l = 0;
  for (let i = 1; i < s.xs.length; i++) l += Math.hypot(s.xs[i]! - s.xs[i - 1]!, s.ys[i]! - s.ys[i - 1]!);
  return l;
};

/** How many threads the feed comes in as: a quiet day is one or two, a heavy one five. */
export const threadsOf = (total: number) => (total <= 0 ? 1 : clamp(Math.round(1 + Math.log2(1 + total) * 0.6), 1, 5));

/**
 * The feed: the day's mail as `threads` lines coming in from the left edge (spread over `fan` px about `src`'s height)
 * and `converge`d into the sort at `gate`; then the branches `fan` splits it into, from the sort to each end
 * (Handled, FYI, each needing mail). Every branch starts where the feed ends.
 */
export function filterPaths(src: Pt, gate: Pt, ends: readonly Pt[], o: { threads?: number; spread?: number } = {}): { feed: Sampled[]; branches: Sampled[] } {
  const k = Math.max(1, o.threads ?? 1);
  const sp = o.spread ?? 90;
  const froms: Pt[] = Array.from({ length: k }, (_, i) => [src[0], src[1] + (k === 1 ? 0 : (i / (k - 1) - 0.5) * sp)] as const);
  return { feed: converge(froms, gate, { trunk: 0.25, ease: 0.6 }) as Sampled[], branches: fan(gate, ends, { trunk: 0, ease: 0.5 }) as Sampled[] };
}

/**
 * Done (#429): the mail's way home, from its row back along its own branch to the sort and on down Handled's.
 * Null when either path is too short.
 */
export function homeward(need: Sampled, handled: Sampled): Sampled | null {
  if (need.xs.length < 2 || handled.xs.length < 2) return null;
  return { xs: [...need.xs].reverse().concat(handled.xs.slice(1)), ys: [...need.ys].reverse().concat(handled.ys.slice(1)) };
}
