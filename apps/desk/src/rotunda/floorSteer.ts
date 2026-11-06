import { SUBMIND_TITLE } from "./rite.ts";

/**
 * After Nikita's turn on the floor (#948). Nikita, 2026-11-06: the member he addressed answers aloud from his podium and
 * waits a while for a reply; if none comes he steps back down, and Skippy the Magnificent (or a member chiming in first,
 * "no surprise there, Pessimist") steers the chamber back: "before we were interrupted, we were talking about…". Then the
 * debate picks up where it left off.
 */

/** How long whoever answered him waits for a reply before stepping back down: several seconds, about nine. */
export const FLOOR_WAIT_MS = 9_000;

const name = (id: string) => (SUBMIND_TITLE[id] ?? id).replace(/^The /, "the ");

/** A member's aside on the one who just answered him. */
const CHIMES: ((who: string) => string)[] = [
  (w) => `No surprise there from ${w}.`,
  (w) => `Spoken like ${w}, as ever.`,
  (w) => `And that, Nikita, is ${w} in a nutshell.`,
  (w) => `Bold words from ${w}. Noted.`,
];

/** The chair bringing the chamber back to what it was on. */
const STEERS: ((where: string) => string)[] = [
  (w) => `Now. Before we were interrupted, ${w}.`,
  (w) => `As I was saying before the interruption, ${w}.`,
  (w) => `Where were we? Ah, yes: ${w}.`,
  (w) => `Back to it. Before we were interrupted, ${w}.`,
];

export interface SteerInput {
  /** Who answered him, in order ("kernel" for the chair). */
  answered: string[];
  /** What the chamber was on, as a clause ("the motion was that…"); null when it was on nothing. */
  where: string | null;
  /** The members seated now. */
  seated: string[];
  /** A whole number below `n`, for the choices (Math.random in the chamber; fixed in tests). */
  pick: (n: number) => number;
}

/**
 * The lines that bring the chamber back after his turn: perhaps a member's aside on the one who answered, then the
 * chair's steer. None when the chamber was on nothing (it simply picks up).
 */
export function steerLines({ answered, where, seated, pick }: SteerInput): { by: string; text: string }[] {
  if (!where) return [];
  const out: { by: string; text: string }[] = [];
  const members = answered.filter((b) => b !== "kernel");
  const last = members[members.length - 1];
  if (last) {
    const others = seated.filter((s) => s !== "kernel" && !answered.includes(s));
    if (others.length && pick(2) === 0) out.push({ by: others[pick(others.length)]!, text: CHIMES[pick(CHIMES.length)]!(name(last)) });
  }
  out.push({ by: "kernel", text: STEERS[pick(STEERS.length)]!(where) });
  return out;
}

/** What the chamber was on, as the chair's clause: the recess's motion, or a docket item by its number. */
export function whereClause(on: { motion: string } | { item: string } | null): string | null {
  if (!on) return null;
  if ("motion" in on) {
    const m = on.motion.trim().replace(/[.!?]+$/, "");
    if (!m) return null;
    return /^that\b/i.test(m) ? `the motion was ${m}` : `we were on ${m}`;
  }
  return on.item ? `we were on item ${on.item}` : null;
}
