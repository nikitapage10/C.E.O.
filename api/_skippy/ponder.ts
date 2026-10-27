/**
 * Skippy in character when he asks his deeper self (#498). The Kernel is the Lattice's own room and, behind it, Skippy's
 * own session doing the real work; Skippy never names that machinery out loud. On a call and in the Desk's chat he
 * reaches into the recesses of his magnificent mind instead, and the line rotates so it never sounds canned.
 *
 * Shared by the voice prompts (voice.ts, voicecrew.ts), the call's tool answers (toolroute.ts), the Desk chat's prompt
 * and its hand-off line (prompt.ts), and the Desk's own pending and caption strings (apps/world/src/desk/skippy). Pure:
 * no I/O, safe for the browser bundle.
 */

/** What Skippy says while his deeper self works on an ask: one, rotating. */
export const PONDER_LINES = [
  "Reaching into the recesses of my magnificent mind…",
  "Consulting the deeper me…",
  "Still pondering…",
  "Letting the vaster part of my brain chew on that…",
  "Hold on, the magnificent depths are churning…",
] as const;

/** Words Skippy never says aloud about it: the plumbing, not the persona. */
export const UNSPOKEN = /\b(?:threads?|hand-?offs?|hand(?:ed|ing|s)?\s+(?:it\s+|this\s+)?off|kernel)\b/i;

/** One line, picked by a seed (a turn id, a count), so the same ask always shows the same line and the next one moves on. */
export function ponderLine(seed: string | number = Date.now()): string {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PONDER_LINES[h % PONDER_LINES.length]!;
}

/** The lines as the prompts quote them: lower-case, no trailing dots. */
const QUOTED = PONDER_LINES.slice(0, 3).map((l) => `"${l.replace(/…$/, "").toLowerCase()}"`).join(", ");

/**
 * The prompt rule (#498). `skippy` words it for Skippy himself (his deeper self); a submind checks with Skippy, the
 * Magnificent instead. Either way: never "thread", "hand-off" or "Kernel", never a tool's name.
 */
export function inCharacter(skippy: boolean): string {
  const say = skippy
    ? `say it the way Skippy would, rotating the line and never the same one twice running: ${QUOTED}, or your own like them`
    : `say you're checking with Skippy, the Magnificent, or that you're getting the crew digging`;
  return `When you pass an ask on to dig deeper, stay in character: never say "thread", "hand-off", "hand off", "handed off" or "Kernel" out loud, and never say a tool's name; ${say}. What comes back is what the deeper ${skippy ? "you" : "Skippy"} worked out.`;
}
